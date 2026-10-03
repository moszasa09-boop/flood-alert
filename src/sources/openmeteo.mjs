// พยากรณ์ฝน Open-Meteo (ฟรี ไม่ต้องใช้ key)
import { HOME, SOURCES } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';

export function rainForecastUrl() {
  const q = new URLSearchParams({
    latitude: HOME.lat, longitude: HOME.lon, timezone: 'Asia/Bangkok', forecast_days: 3,
    daily: 'precipitation_sum,precipitation_probability_max',
    hourly: 'precipitation,precipitation_probability',
  });
  return `${SOURCES.openmeteo}?${q}`;
}

// คืนค่า [{ date, mm, prob }] 3 วัน (วันนี้ พรุ่งนี้ มะรืน) + .hourly = [{ t, mm, prob }]
export async function fetchRainDaily() {
  const res = await fetchWithRetry(rainForecastUrl(), {}, { tries: 2 });
  const json = await res.json();
  const d = json.daily;
  if (!d?.time?.length) throw new Error('Open-Meteo: ได้ข้อมูลผิดรูปแบบ');
  const days = d.time.map((date, i) => ({ date, mm: d.precipitation_sum[i], prob: d.precipitation_probability_max[i] }));
  const h = json.hourly || { time: [] };
  days.hourly = h.time.map((s, i) => ({ t: Date.parse(`${s}:00+07:00`), mm: h.precipitation[i], prob: h.precipitation_probability[i] }));
  return days;
}

// ฝนหนัก (≥ 10 มม./ชม. และโอกาส ≥ 60%) ภายใน 3 ชม. ข้างหน้า → { mm, prob, at } หรือ null
export function heavyRainSoon(hourly, now, hours = 3, minMm = 10, minProb = 60) {
  for (const h of hourly || []) {
    if (h.t + 3600e3 <= now || h.t > now + hours * 3600e3) continue;
    if ((h.mm ?? 0) >= minMm && (h.prob ?? 0) >= minProb) {
      const at = new Date(h.t + 7 * 3600e3).toISOString().slice(11, 16);
      return { mm: Math.round(h.mm), prob: h.prob, at };
    }
  }
  return null;
}
