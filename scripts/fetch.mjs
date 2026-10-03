// ดึงข้อมูลทุกแหล่ง → คำนวณสถานะ → เขียน public/data/latest.json + history.json
// รัน: npm run fetch
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, NODES, STALE_MIN, HISTORY_HOURS, HEAVY_RAIN_MM, SOURCES } from '../src/config.mjs';
import { fetchRainDaily, rainWindowAhead } from '../src/sources/openmeteo.mjs';
import { fetchRiver } from '../src/sources/river.mjs';
import { fetchRadarNow } from '../src/sources/radar.mjs';
import { decide, deliver } from '../src/notify.mjs';
import { fetchPopnixAll, fetchPopnixHistory, matchByLocation, POPNIX_CREDIT } from '../src/sources/popnix.mjs';
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
  // SKIP=bma,popnix,tw,rain ใช้จำลองกรณีแหล่งข้อมูลล่ม (ทดสอบ) — SKIP_BMA=1 เท่ากับ SKIP=bma
  const skip = new Set([...(process.env.SKIP || '').split(','), process.env.SKIP_BMA ? 'bma' : ''].filter(Boolean));
  const get = (name, fn) => (skip.has(name) ? Promise.reject(new Error(`ข้าม (SKIP=${name})`)) : fn());
  const [bma, tw, rainRes, pop, riverRes, radarRes] = await Promise.allSettled([
    get('bma', fetchBmaAll), get('tw', fetchThaiwater), get('rain', fetchRainDaily), get('popnix', fetchPopnixAll),
    get('river', fetchRiver), get('radar', fetchRadarNow),
  ]);
  const sources = {
    bma: bma.status === 'fulfilled' ? { ok: true, count: bma.value.length } : { ok: false, error: String(bma.reason?.message || bma.reason) },
    tw: tw.status === 'fulfilled' ? { ok: true, count: tw.value.length } : { ok: false, error: String(tw.reason?.message || tw.reason) },
    rain: rainRes.status === 'fulfilled' ? { ok: true } : { ok: false, error: String(rainRes.reason?.message || rainRes.reason) },
    river: riverRes.status === 'fulfilled' ? { ok: true, count: riverRes.value.stations.length } : { ok: false, error: String(riverRes.reason?.message || riverRes.reason) },
    radar: radarRes.status === 'fulfilled' ? { ok: true } : { ok: false, error: String(radarRes.reason?.message || radarRes.reason) },
    popnix: pop.status === 'fulfilled' ? { ok: true, count: pop.value.length, used: 0, credit: POPNIX_CREDIT } : { ok: false, error: String(pop.reason?.message || pop.reason) },
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

  // แหล่งสำรอง POPNIX: ถ้าดึง กทม. ตรงไม่ได้ (หรือของ POPNIX ใหม่กว่า) ใช้ค่าจากสถานี POPNIX ที่ตำแหน่งตรงกัน
  const popMatch = new Map();
  for (const node of NODES) {
    for (const ref of node.stations) {
      if (ref.src !== 'bma' || pop.status !== 'fulfilled') continue;
      const key = `bma:${ref.id}`;
      const p = matchByLocation(pop.value, ref.lat, ref.lon);
      if (!p || p.wl === null || !p.time) continue;
      popMatch.set(key, p);
      const direct = index.get(key);
      if (direct?.time && direct.time >= p.time) continue; // ของ กทม. ตรงใหม่กว่า/เท่ากัน
      const base = direct || prevStations.get(key) || { key, src: 'bma', id: ref.id, name: ref.name || p.name, isGate: false, wlOut: null };
      index.set(key, {
        ...base,
        key, src: 'bma', id: ref.id,
        name: base.name && base.name !== key ? base.name : p.name,
        lat: ref.lat, lon: ref.lon,
        time: p.time, wl: p.wl, wlOut: null,
        bank: p.bank ?? base.bank ?? null,
        warning: p.warning, critical: p.critical,
        maxToday: p.maxToday, maxYesterday: p.maxYesterday,
        agencyStatus: null,
        via: 'POPNIX',
        url: 'https://flood.pop.in.th',
      });
      sources.popnix.used++;
    }
  }

  // 2) ประวัติ: เติมจากรอบนี้ + เติมย้อนหลังจากหน้า กทม. ถ้ามีไม่ถึง 6 ชม.
  for (const node of NODES) {
    for (const ref of node.stations) {
      const key = `${ref.src}:${ref.id}`;
      const s = index.get(key);
      const pts = [];
      if (s?.time && s.wl !== null) pts.push([s.time, s.wl]);
      let h = mergeHistory(history[key] || [], pts, cutoff);
      const span = h.length ? (h.at(-1)[0] - h[0][0]) / 3600e3 : 0;
      if (ref.src === 'bma' && span < 6) {
        try {
          if (sources.bma.ok && !s?.via && !s?.url?.includes('bmawaterflow')) {
            h = mergeHistory(h, await fetchBmaHistory(ref.id), cutoff);
            await sleep(800);
          } else if (popMatch.has(key)) {
            h = mergeHistory(h, await fetchPopnixHistory(popMatch.get(key).popId), cutoff);
            await sleep(300);
          }
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
      const found = index.get(key) || prevStations.get(key) || { key, src: ref.src, id: ref.id, wl: null, time: null };
      // ชื่อ: ใช้ของแหล่งข้อมูล ถ้าไม่มี (หรือเป็นรหัส เช่น "bma:303" จากรอบเก่า) ใช้ชื่อใน config
      const s = {
        ...found,
        name: found.name && found.name !== key ? found.name : ref.name || key,
        lat: found.lat ?? ref.lat, lon: found.lon ?? ref.lon,
        url: found.url || (ref.src === 'bma' ? SOURCES.bmaDetail(ref.id) : 'https://www.thaiwater.net/water/wl'),
      };
      const base = s;
      const rate = risingRate(history[key]);
      const st = stationStatus(base, rate, STALE_MIN[ref.src === 'tw' ? 'thaiwater' : 'bma'], now, { risingOrange: node.role === 'home' });
      return {
        ...base,
        primary: !!ref.primary,
        rate: rate === null ? null : Math.round(rate * 1000) / 1000,
        status: st.status,
        reason: st.status === 'unknown' && ref.src === 'bma' && !sources.bma.ok
          ? 'มีข้อมูลเฉพาะบนเว็บ กทม. ซึ่งไม่เปิดให้ระบบออนไลน์ดึง — กด "ดูหน้าทางการ"'
          : st.reason,
        offline: st.status === 'unknown' && ref.src === 'bma' && !sources.bma.ok,
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
  // เวลาวัดล่าสุดของสถานีบ้านที่เป็นแดง (ใช้ยืนยันแดงด้วยค่าวัดใหม่)
  const homeRed = nodes.filter((n) => n.role === 'home').flatMap((n) => n.stations).filter((s) => s.status === 'red');
  const homeRedTime = homeRed.length ? Math.max(...homeRed.map((s) => s.time)) : null;
  const overall = overallStatus(groups, { candidateRedAt: prev?.overall?.candidateRedAt ?? null }, rain, homeRedTime);

  // แจ้งเตือนเข้ามือถือ (ntfy) — ส่งเฉพาะเมื่อมี NTFY_TOPIC (ตั้งใน GitHub Secrets)
  const homeNode = nodes.find((n) => n.role === 'home');
  const homeLive = homeNode.stations.filter((s) => ['green', 'yellow', 'orange', 'red'].includes(s.status));
  const homeStation = homeLive.find((s) => s.primary) || homeLive[0] || null;
  const river = riverRes.status === 'fulfilled' ? riverRes.value : null;
  const radar = radarRes.status === 'fulfilled' ? radarRes.value : null;
  const rainWindow = rainWindowAhead(rainDays.hourly, now);
  const front = river?.front?.overflow;
  const decision = decide(prev?.notify, {
    status: overall.status,
    reasons: overall.reasons,
    home: homeStation,
    rainWindow,
    radar,
    rainToday: rainDays[0] ? { mm: rainDays[0].mm, prob: rainDays[0].prob } : null,
    stations: nodes.flatMap((n) => n.stations.map((s) => ({ key: s.key, name: s.name, role: n.role, status: s.status, wl: s.wl, bank: s.bank, margin: s.margin, rate: s.rate, time: s.time }))),
    river: river ? {
      frontIdx: front ? river.stations.indexOf(front) : null,
      frontName: front?.name ?? null,
      frontProvince: front?.province ?? null,
      overflowCount: river.front.overflowCount,
      damFlow: river.damRelease?.flow ?? null,
    } : null,
    now,
  });
  if (process.env.NOTIFY_TEST) {
    decision.messages.push({ title: '🔔 ทดสอบแจ้งเตือน', message: `ถ้าเห็นข้อความนี้ แปลว่าแจ้งเตือนใช้ได้\nสถานะตอนนี้: ${overall.status}`, priority: 3, tags: ['bell'] });
  }
  let notifyLog = [];
  if (process.env.NTFY_TOPIC) {
    const d = await deliver(process.env.NTFY_TOPIC, decision.messages, prev?.notify?.outbox || [], now);
    notifyLog = d.log;
    decision.state.outbox = d.outbox; // ส่งไม่ได้ → เก็บไว้ส่งรอบหน้า
  } else {
    notifyLog = decision.messages.map((m) => `(ไม่ได้ส่ง ไม่มี NTFY_TOPIC) ${m.title}`);
    decision.state.outbox = [];
  }

  const latest = {
    version: 1,
    generatedAt: now,
    home: HOME,
    sources,
    overall: { ...overall, since: prev?.overall?.status === overall.status ? prev.overall.since : now },
    previousStatus: prev?.overall?.status ?? null,
    groups,
    rain: { ...rain, days: rainDays.map(({ date, mm, prob }) => ({ date, mm, prob })), window: rainWindow },
    radar,
    river: river ?? prev?.river ?? null,
    notify: decision.state,
    nodes,
  };
  await writeJson(LATEST, latest);
  await writeJson(HISTORY, history);

  // สรุปบนหน้าจอ
  console.log(`[${new Date(now).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] สถานะรวม: ${overall.status} — ${overall.reasons.join(' / ')}`);
  console.log(`  แหล่งข้อมูล: กทม. ${sources.bma.ok ? '✓ ' + sources.bma.count : '✗ ' + sources.bma.error} · POPNIX ${sources.popnix.ok ? '✓ ใช้ ' + sources.popnix.used + ' สถานี' : '✗ ' + sources.popnix.error} · แม่น้ำ ${sources.river.ok ? '✓ ' + sources.river.count : '✗ ' + sources.river.error} · เรดาร์ ${sources.radar.ok ? '✓' : '✗ ' + sources.radar.error} · ThaiWater ${sources.tw.ok ? '✓ ' + sources.tw.count : '✗ ' + sources.tw.error} · ฝน ${sources.rain.ok ? '✓ ' + rainDays.map((d) => `${d.date.slice(5)} ${d.mm}มม./${d.prob}%`).join(', ') : '✗ ' + sources.rain.error}`);
  for (const n of nodes) {
    console.log(`  ${n.status.padEnd(7)} ${n.name}`);
    for (const s of n.stations) {
      const r = s.rate === null ? '' : ` ${s.rate >= 0 ? '+' : ''}${Math.round(s.rate * 100)}ซม./ชม.`;
      console.log(`           ${s.status.padEnd(7)} ${s.via ? '[POPNIX] ' : ''}${s.name} wl=${s.wl ?? '-'} ตลิ่ง=${s.bank ?? '-'}${r} (${s.reason}) จุดประวัติ=${history[s.key]?.length ?? 0}`);
    }
  }

  for (const l of notifyLog) console.log(`  แจ้งเตือน: ${l}`);
  // แหล่งข้อมูลล่ม ≠ โปรแกรมพัง: ต้องจบแบบปกติเพื่อให้เว็บอัปเดต (แสดง "ข้อมูลไม่พอ") และบันทึกสถานะการแจ้งเตือน
  if (!sources.bma.ok && !sources.tw.ok && !sources.popnix.ok) console.warn('  ⚠️ แหล่งข้อมูลระดับน้ำล่มทั้งหมด — เผยแพร่สถานะ "ข้อมูลไม่พอ" ต่อ');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
