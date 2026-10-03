// รอไลบรารีจาก CDN (โหลดแบบ async) — แอปแสดงสถานะได้ทันทีโดยไม่ต้องรอไลบรารี
// คืน true เมื่อพร้อม, false ถ้ารอเกิน timeoutMs (เน็ตช้า/CDN ล่ม)
export function whenLib(name, timeoutMs = 20000) {
  if (window[name]) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window[name]) { clearInterval(iv); resolve(true); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(false); }
    }, 150);
  });
}
