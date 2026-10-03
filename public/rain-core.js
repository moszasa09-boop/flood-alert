// ตรรกะวิเคราะห์ภาพเรดาร์ (ฟังก์ชันล้วน ใช้ได้ทั้งเบราว์เซอร์และ node test)

// ระดับฝนจากสีของ RainViewer (ชุดสี Universal Blue)
export const RAIN_LEVEL = ['ไม่มีฝน', 'ละอองฝน', 'ฝนเบา', 'ฝนปานกลาง', 'ฝนหนัก', 'ฝนหนักมาก'];

export function classifyPixel(r, g, b, a) {
  if (a === 0) return 0;
  if (a < 200) return 1;                 // สีเบจโปร่งแสง = สัญญาณอ่อนมาก
  if (r >= 200 && g < 100) return 5;     // แดง/ชมพู
  if (r >= 200) return 4;                // เหลือง/ส้ม
  if (g >= 180) return 2;                // ฟ้าอ่อน
  return 3;                              // น้ำเงินเข้ม
}

// ขนาด 1 พิกเซลบนพื้นดิน (กม.) ที่ซูม z ละติจูด lat
export const pxKm = (z, lat) => (156.54303 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

// ตำแหน่งพิกเซลรวมของพิกัดบนแผนที่ Web Mercator
export function lonLatToPixel(lon, lat, z) {
  const n = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

const DIRS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
export const dirName = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// ตัดจุดฝนเดี่ยวๆ (มักเป็นสัญญาณรบกวน) — นับเป็นฝนเมื่อมีเพื่อนบ้านเป็นฝนอย่างน้อย 2 จาก 8 ช่อง
export function denoise(levelAt) {
  return (x, y) => {
    const lv = levelAt(x, y);
    if (lv < 2) return lv;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && levelAt(x + dx, y + dy) >= 2) n++;
    }
    return n >= 2 ? lv : 0;
  };
}

// วิเคราะห์กริดพิกเซลรอบบ้าน
// levelAt(px, py) → ระดับฝน, (hx, hy) = ตำแหน่งบ้าน, km = กม.ต่อพิกเซล
export function analyze(levelAt, hx, hy, km, radiusKm = 100) {
  const R = Math.ceil(radiusKm / km);
  let atHome = 0;
  let nearest = null;
  let maxNear = 0; // ฝนแรงสุดในรัศมี 25 กม.
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) * km;
      if (d > radiusKm) continue;
      const lv = levelAt(Math.round(hx + dx), Math.round(hy + dy));
      if (lv < 2) continue;
      if (d <= 2.5) atHome = Math.max(atHome, lv);
      if (d <= 25) maxNear = Math.max(maxNear, lv);
      if (!nearest || d < nearest.km) {
        const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
        nearest = { km: d, bearing: (bearing + 360) % 360, level: lv };
      }
    }
  }
  return { atHome, nearest, maxNear };
}

// ประมาณว่ากลุ่มฝนกำลังเข้าใกล้หรือไม่ จากระยะกลุ่มฝนใกล้สุด 2 ช่วงเวลา
// (คร่าวๆ: กลุ่มฝนใกล้สุดอาจเป็นคนละกลุ่มกันก็ได้)
export function approach(prev, now, minutes) {
  if (!prev?.nearest || !now?.nearest || minutes <= 0) return null;
  const speed = ((prev.nearest.km - now.nearest.km) / minutes) * 60; // กม./ชม. (+ = เข้าใกล้)
  if (Math.abs(speed) < 3) return { trend: 'steady', speed };
  // เร็วเกิน 50 กม./ชม. ไม่สมจริงสำหรับกลุ่มฝน → น่าจะเป็นกลุ่มฝนก่อตัวใหม่ใกล้บ้าน ไม่เดาเวลาถึง
  if (speed > 50) return { trend: 'new', speed: null, etaMin: null };
  if (speed < 0) return { trend: 'away', speed };
  const etaMin = now.nearest.km <= 2.5 ? 0 : Math.round((now.nearest.km / speed) * 60);
  return { trend: 'closer', speed, etaMin: etaMin > 240 ? null : etaMin };
}

// สรุปพยากรณ์รายชั่วโมง: ช่วงแรกที่น่าจะมีฝน
export function firstRainWindow(times, prob, mm, fromIdx = 0, hours = 24, minProb = 50, minMm = 0.3) {
  const end = Math.min(times.length, fromIdx + hours);
  let start = -1;
  let stop = -1;
  for (let i = fromIdx; i < end; i++) {
    const wet = (prob[i] ?? 0) >= minProb && (mm[i] ?? 0) >= minMm;
    if (wet && start < 0) start = i;
    if (start >= 0) {
      if (wet) stop = i;
      else break;
    }
  }
  if (start < 0) {
    let maxP = 0;
    for (let i = fromIdx; i < end; i++) maxP = Math.max(maxP, prob[i] ?? 0);
    return { found: false, maxProb: maxP };
  }
  let maxP = 0;
  let total = 0;
  for (let i = start; i <= stop; i++) { maxP = Math.max(maxP, prob[i] ?? 0); total += mm[i] ?? 0; }
  return { found: true, start: times[start], end: times[stop], maxProb: maxP, totalMm: Math.round(total * 10) / 10 };
}
