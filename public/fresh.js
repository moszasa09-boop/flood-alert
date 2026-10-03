// ตัวตรวจ "ความสด" กลางของหน้าเว็บ — ทุกแท็บใช้กฎเดียวกัน และประเมินใหม่ทุกครั้งที่แสดง
// (หน้าเว็บที่เปิดค้างไว้นานก็จะเห็นค่าเก่าเป็นสีเทาเอง ไม่ต้องรอรอบข้อมูลใหม่)
export const RIVER_STALE_MIN = 180;
export const DAM_STALE_MIN = 360;
export const RADAR_STALE_MIN = 40;
export const RAIN_STALE_MIN = 180;
export const LIVE = ['green', 'yellow', 'orange', 'red'];

// กฎเดียวกับ src/sources/river.mjs → riverStatus
export function riverStatus(diff, time, now = Date.now()) {
  if (diff == null || !Number.isFinite(diff) || Math.abs(diff) > 50) return 'unknown';
  if (time == null || !Number.isFinite(time)) return 'unknown';
  const ageMin = (now - time) / 60000;
  if (ageMin < -30) return 'unknown';
  if (ageMin > RIVER_STALE_MIN) return 'stale';
  if (diff >= 0) return 'red';
  if (diff > -0.3) return 'orange';
  if (diff > -1.0) return 'yellow';
  return 'green';
}

const fresh = (t, maxMin, now) => Number.isFinite(t) && now - t <= maxMin * 60000 && t <= now + 30 * 60000;

// แม่น้ำ: สีของทุกสถานี + จุดล้นใต้สุด จากสถานีที่ยังสดเท่านั้น
export function riverView(river, now = Date.now()) {
  if (!river?.stations?.length) return { stations: [], live: [], front: { overflow: null, near: null, overflowCount: 0 }, liveCount: 0, asOf: null, dam: null, rama8: null };
  const stations = river.stations.map((s) => ({ ...s, status: riverStatus(s.diff, s.time, now) }));
  const live = stations.filter((s) => LIVE.includes(s.status));
  const pick = (lv) => [...live].reverse().find((s) => lv.includes(s.status)) || null;
  return {
    stations,
    live,
    front: { overflow: pick(['red']), near: pick(['red', 'orange']), overflowCount: live.filter((s) => s.status === 'red').length },
    liveCount: live.length,
    asOf: live.length ? Math.max(...live.map((s) => s.time)) : null,
    lastSeen: stations.reduce((m, s) => (Number.isFinite(s.time) && s.time > m ? s.time : m), 0) || null,
    dam: river.damRelease?.flow != null ? { ...river.damRelease, fresh: fresh(river.damRelease.time, DAM_STALE_MIN, now) } : null,
    rama8: river.rama8?.flow != null ? { ...river.rama8, fresh: fresh(river.rama8.time, DAM_STALE_MIN, now) } : null,
  };
}

// พยากรณ์ฝน: ok = ดึงสำเร็จและยังไม่เก่า → เฉพาะกรณีนี้ window=null จึงแปลว่า "ไม่มีฝน"
export function rainView(rain, now = Date.now()) {
  const ok = !!rain?.ok && fresh(rain.fetchedAt, RAIN_STALE_MIN, now);
  return { ok, window: ok ? rain.window || null : null };
}

// เรดาร์: ใช้ได้เมื่อภาพไม่เก่าเกิน 40 นาที
export function radarView(radar, now = Date.now()) {
  return radar && fresh(radar.time, RADAR_STALE_MIN, now) ? radar : null;
}
