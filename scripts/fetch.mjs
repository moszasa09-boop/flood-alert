// ดึงข้อมูลทุกแหล่ง → คำนวณสถานะ → เขียน public/data/latest.json + history.json
// รัน: npm run fetch
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, NODES, STALE_MIN, HISTORY_HOURS, HEAVY_RAIN_MM } from '../src/config.mjs';
import { fetchRainDaily } from '../src/sources/openmeteo.mjs';
import { fetchBmaAll, fetchBmaHistory } from '../src/sources/bma.mjs';
import { fetchThaiwater } from '../src/sources/thaiwater.mjs';
import { stationStatus, overallStatus, risingRate, worst } from '../src/status.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'public', 'data');
const LATEST = join(DATA, 'latest.json');
const HISTORY = join(DATA, 'history.json');

const readJson = async (p, fallback) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};
const writeJson = async (p, obj) => {
  await writeFile(p + '.tmp', JSON.stringify(obj));
  await rename(p + '.tmp', p);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distKm(aLat, aLon, bLat, bLon) {
  const r = (d) => (d * Math.PI) / 180;
  const x = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

function mergeHistory(list, points, cutoff) {
  const map = new Map(list.map((p) => [p[0], p[1]]));
  for (const [t, v] of points) if (t && v !== null && v !== undefined) map.set(t, Math.round(v * 1000) / 1000);
  return [...map.entries()].filter(([t]) => t >= cutoff).sort((a, b) => a[0] - b[0]);
}

async function main() {
  const now = Date.now();
  const cutoff = now - HISTORY_HOURS * 3600e3;
  await mkdir(DATA, { recursive: true });
  // บน GitHub Actions: ไม่มีไฟล์ในเครื่อง → ดึงรอบก่อนจากเว็บที่ขึ้นไว้แล้ว (SEED_URL) มาต่อประวัติ
  const seed = async (file) => {
    if (!process.env.SEED_URL) return null;
    try {
      const res = await fetch(`${process.env.SEED_URL.replace(/\/$/, '')}/data/${file}?t=${now}`, { signal: AbortSignal.timeout(20000) });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const prev = (await readJson(LATEST, null)) ?? (await seed('latest.json'));
  const history = (await readJson(HISTORY, null)) ?? (await seed('history.json')) ?? {};

  // 1) ดึงข้อมูล 2 แหล่งพร้อมกัน — แหล่งไหนล่มก็ยังไปต่อได้
  const [bma, tw, rainRes] = await Promise.allSettled([fetchBmaAll(), fetchThaiwater(), fetchRainDaily()]);
  const sources = {
    bma: bma.status === 'fulfilled' ? { ok: true, count: bma.value.length } : { ok: false, error: String(bma.reason?.message || bma.reason) },
    tw: tw.status === 'fulfilled' ? { ok: true, count: tw.value.length } : { ok: false, error: String(tw.reason?.message || tw.reason) },
    rain: rainRes.status === 'fulfilled' ? { ok: true } : { ok: false, error: String(rainRes.reason?.message || rainRes.reason) },
  };
  // พยากรณ์ฝน: ดูวันนี้ + พรุ่งนี้
  const rainDays = rainRes.status === 'fulfilled' ? rainRes.value : [];
  const wettest = rainDays.slice(0, 2).reduce((a, b) => ((b.mm ?? 0) > (a?.mm ?? -1) ? b : a), null);
  const rain = { days: rainDays, heavy: !!wettest && wettest.mm >= HEAVY_RAIN_MM, mm: wettest?.mm ?? null, date: wettest?.date ?? null };
  const index = new Map();
  for (const s of bma.value || []) index.set(s.key, s);
  for (const s of tw.value || []) index.set(s.key, s);
  // สถานีที่ดึงไม่ได้รอบนี้ ใช้ค่าล่าสุดจากรอบก่อน (จะถูกนับเป็น "ข้อมูลเก่า" เองเมื่อเกินเวลา)
  const prevStations = new Map((prev?.nodes || []).flatMap((n) => n.stations).map((s) => [s.key, s]));

  // 2) ประวัติ: เติมจากรอบนี้ + เติมย้อนหลังจากหน้า กทม. ถ้ามีไม่ถึง 6 ชม.
  for (const node of NODES) {
    for (const ref of node.stations) {
      const key = `${ref.src}:${ref.id}`;
      const s = index.get(key);
      const pts = [];
      if (s?.time && s.wl !== null) pts.push([s.time, s.wl]);
      let h = mergeHistory(history[key] || [], pts, cutoff);
      const span = h.length ? (h.at(-1)[0] - h[0][0]) / 3600e3 : 0;
      if (ref.src === 'bma' && sources.bma.ok && span < 6 && !s?.url?.includes('bmawaterflow')) {
        try {
          h = mergeHistory(h, await fetchBmaHistory(ref.id), cutoff);
          await sleep(800);
        } catch (err) {
          console.warn(`  เติมประวัติ ${key} ไม่ได้: ${err.message}`);
        }
      }
      history[key] = h;
    }
  }

  // 3) คำนวณสถานะ
  const nodes = NODES.map((node) => {
    const stations = node.stations.map((ref) => {
      const key = `${ref.src}:${ref.id}`;
      const s = index.get(key) || prevStations.get(key) || { key, src: ref.src, id: ref.id, name: key, wl: null, time: null };
      const base = s;
      const rate = risingRate(history[key]);
      const st = stationStatus(base, rate, STALE_MIN[ref.src === 'tw' ? 'thaiwater' : 'bma'], now);
      return {
        ...base,
        primary: !!ref.primary,
        rate: rate === null ? null : Math.round(rate * 1000) / 1000,
        status: st.status,
        reason: st.reason,
        margin: st.margin ?? null,
        distKm: s.lat ? Math.round(distKm(HOME.lat, HOME.lon, s.lat, s.lon) * 10) / 10 : null,
      };
    });
    const live = stations.map((s) => s.status);
    const status = live.some((x) => ['green', 'yellow', 'orange', 'red'].includes(x)) ? worst(live) : 'stale';
    return { id: node.id, name: node.name, role: node.role, note: node.note, status, stations };
  });

  const groupOf = (role) => {
    const st = nodes.filter((n) => n.role === role).map((n) => n.status);
    const w = worst(st);
    return w === 'unknown' ? 'stale' : w;
  };
  const groups = { up: groupOf('up'), home: groupOf('home'), down: groupOf('down') };
  const overall = overallStatus(groups, !!prev?.overall?.candidateRed, rain);

  const latest = {
    version: 1,
    generatedAt: now,
    home: HOME,
    sources,
    overall: { ...overall, since: prev?.overall?.status === overall.status ? prev.overall.since : now },
    previousStatus: prev?.overall?.status ?? null,
    groups,
    rain,
    nodes,
  };
  await writeJson(LATEST, latest);
  await writeJson(HISTORY, history);

  // สรุปบนหน้าจอ
  console.log(`[${new Date(now).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] สถานะรวม: ${overall.status} — ${overall.reasons.join(' / ')}`);
  console.log(`  แหล่งข้อมูล: กทม. ${sources.bma.ok ? '✓ ' + sources.bma.count : '✗ ' + sources.bma.error} · ThaiWater ${sources.tw.ok ? '✓ ' + sources.tw.count : '✗ ' + sources.tw.error} · ฝน ${sources.rain.ok ? '✓ ' + rainDays.map((d) => `${d.date.slice(5)} ${d.mm}มม./${d.prob}%`).join(', ') : '✗ ' + sources.rain.error}`);
  for (const n of nodes) {
    console.log(`  ${n.status.padEnd(7)} ${n.name}`);
    for (const s of n.stations) {
      const r = s.rate === null ? '' : ` ${s.rate >= 0 ? '+' : ''}${Math.round(s.rate * 100)}ซม./ชม.`;
      console.log(`           ${s.status.padEnd(7)} ${s.name} wl=${s.wl ?? '-'} ตลิ่ง=${s.bank ?? '-'}${r} (${s.reason}) จุดประวัติ=${history[s.key]?.length ?? 0}`);
    }
  }

  if (!sources.bma.ok && !sources.tw.ok) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
