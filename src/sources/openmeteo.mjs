// พยากรณ์ฝน Open-Meteo (ฟรี ไม่ต้องใช้ key)
import { HOME, SOURCES } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';

export function rainForecastUrl() {
  const q = new URLSearchParams({
    latitude: HOME.lat, longitude: HOME.lon, timezone: 'Asia/Bangkok', forecast_days: 3,
    daily: 'precipitation_sum,precipitation_probability_max',
  });
  return `${SOURCES.openmeteo}?${q}`;
}

// คืนค่า [{ date, mm, prob }] 3 วัน (วันนี้ พรุ่งนี้ มะรืน)
export async function fetchRainDaily() {
  const res = await fetchWithRetry(rainForecastUrl(), {}, { tries: 2 });
  const d = (await res.json()).daily;
  if (!d?.time?.length) throw new Error('Open-Meteo: ได้ข้อมูลผิดรูปแบบ');
  return d.time.map((date, i) => ({ date, mm: d.precipitation_sum[i], prob: d.precipitation_probability_max[i] }));
}
