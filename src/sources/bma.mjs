// สำนักการระบายน้ำ กทม. (weather.bangkok.go.th/water)
import { SOURCES } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';

const num = (v) => (v === null || v === undefined || v === '' || Number(v) <= -90 ? null : Number(v));

// "/Date(1791026400000)/" → epoch ms
export function parseDotNetDate(s) {
  const m = /\/Date\((-?\d+)\)\//.exec(s || '');
  return m ? Number(m[1]) : null;
}

// แปลงแถวจาก endpoint แผนที่ ให้เป็นรูปแบบกลางของระบบ
export function normalizeBma(r) {
  const banks = [num(r.left_bank), num(r.right_bank)].filter((v) => v !== null);
  const wlIn = num(r.wl_in);
  const wlOut = num(r.wl_out01);
  return {
    key: `bma:${r.water_id}`,
    src: 'bma',
    id: r.water_id,
    name: (r.water_shortname || r.water_name || '').trim(),
    fullName: (r.water_name || '').trim(),
    code: r.water_code,
    district: r.district_name,
    lat: num(r.latitude),
    lon: num(r.longitude),
    time: parseDotNetDate(r.site_timestamp),
    // สถานีประตูน้ำ: ใช้น้ำ "ด้านใน" เทียบตลิ่ง ส่วน "ด้านนอก" แสดงเป็นข้อมูลประกอบ
    wl: wlIn ?? wlOut,
    wlOut: wlIn !== null ? wlOut : null,
    isGate: wlOut !== null && wlIn !== null,
    bank: banks.length ? Math.min(...banks) : null,
    leftBank: num(r.left_bank),
    rightBank: num(r.right_bank),
    warning: num(r.warning),
    critical: num(r.critical),
    maxToday: num(r.max_in_day),
    maxYesterday: num(r.max_in_yesterday),
    agencyStatus: r.txtStatus || null,
    url: r.water_url || SOURCES.bmaDetail(r.water_id),
  };
}

export async function fetchBmaAll() {
  const res = await fetchWithRetry(SOURCES.bmaAll, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: 'payload=TEST_DATA_GOES_HERE',
  });
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 50) throw new Error(`BMA: ได้ข้อมูลผิดรูปแบบ (${rows?.length})`);
  return rows.map(normalizeBma);
}

// ดึงกราฟย้อนหลัง ~48 ชม. จากหน้ารายละเอียดสถานี (ใช้เติมประวัติครั้งแรก)
// คืนค่า [[epochMs, wlIn], ...] — ตัวเลขใน Date.UTC ของหน้าเว็บเป็นเวลาไทย จึงลบ 7 ชม.
export function parseBmaDetailSeries(html) {
  const start = html.indexOf('series:');
  if (start < 0) return [];
  // ข้อมูลเป็น [Date.UTC(...),v] คั่นด้วยจุลภาค — series จบที่ "]" ตัวแรกที่ไม่ได้ตามหลังตัวเลข
  const m = /name:\s*series1,\s*data:\s*\[((?:\s*,?\s*\[Date\.UTC\([^)]*\),\s*(?:-?[\d.]+|null)\])*)\s*\]/.exec(html.slice(start));
  if (!m) return [];
  const out = [];
  const re = /Date\.UTC\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\),\s*(-?[\d.]+|null)/g;
  let p;
  while ((p = re.exec(m[1]))) {
    if (p[7] === 'null') continue;
    const v = Number(p[7]);
    if (v <= -90) continue;
    const t = Date.UTC(+p[1], +p[2], +p[3], +p[4], +p[5], +p[6]) - 7 * 3600e3;
    out.push([t, v]);
  }
  return out;
}

export async function fetchBmaHistory(id) {
  const res = await fetchWithRetry(SOURCES.bmaDetail(id), {}, { tries: 2 });
  return parseBmaDetailSeries(await res.text());
}
