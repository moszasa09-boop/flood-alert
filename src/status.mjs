// ตรรกะตัดสินสถานะ — ฟังก์ชันล้วน ไม่มี I/O (ทดสอบใน test/status.test.mjs)
import { THRESHOLDS as T } from './config.mjs';

export const LEVELS = ['green', 'yellow', 'orange', 'red'];
export const rank = (s) => LEVELS.indexOf(s); // stale/unknown = -1
export const worst = (list) =>
  list.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'unknown');

// ค่ากลาง (median) ของจุดในช่วง ±25 นาทีรอบเวลา t — กันค่ากระโดดชั่วขณะ (เช่น 0.19 → 0.35 → 0.19)
function medianAround(history, t, windowMin = 25) {
  const vals = history.filter(([x]) => Math.abs(x - t) <= windowMin * 60000).map(([, v]) => v).sort((a, b) => a - b);
  if (!vals.length) return null;
  const m = vals.length >> 1;
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

// อัตราขึ้น-ลง (ม./ชม.) จากจุดล่าสุดเทียบจุดที่ใกล้ "windowH ชม.ก่อน" ที่สุด (ใช้ค่ากลางรอบๆ ทั้งสองฝั่ง)
// ต้องมีข้อมูลห่างกันอย่างน้อย 45 นาที ไม่งั้นคืน null
export function risingRate(history, windowH = T.rateWindowH) {
  if (!history || history.length < 2) return null;
  const [tLast] = history[history.length - 1];
  const target = tLast - windowH * 3600e3;
  let best = null;
  for (const p of history) {
    if (p[0] >= tLast) break;
    if (!best || Math.abs(p[0] - target) < Math.abs(best[0] - target)) best = p;
  }
  if (!best) return null;
  const dtH = (tLast - best[0]) / 3600e3;
  if (dtH < 0.75) return null;
  return (medianAround(history, tLast) - medianAround(history, best[0])) / dtH;
}

// สถานะของสถานีเดียว
// station: { wl, bank, time }, rate: ม./ชม. หรือ null, staleMin: นาที
// risingOrange: กฎ "ใกล้ตลิ่ง + กำลังขึ้น = ส้ม" ใช้กับคลองใกล้บ้านเท่านั้น
//   สถานีไกล (ต้นน้ำ/ทางระบาย) ค่ามักแกว่งตามการเปิด-ปิดเครื่องสูบ → ส้มเฉพาะเมื่อเหลือ < 20 ซม. จริงๆ
export function stationStatus({ wl, bank, time }, rate, staleMin, now = Date.now(), { risingOrange = true } = {}) {
  if (wl === null || wl === undefined || !time) return { status: 'unknown', reason: 'ไม่มีข้อมูล' };
  // ข้อมูลผิดรูปแบบ (ไม่ใช่ตัวเลข / ค่าเพี้ยนเกินจริง / เวลาในอนาคต) → ไม่นำมาตัดสิน ห้ามตกไปเป็นเขียว
  if (!Number.isFinite(wl) || Math.abs(wl) > 100 || !Number.isFinite(time) || time > now + 30 * 60000) {
    return { status: 'unknown', reason: 'ข้อมูลผิดรูปแบบ — ไม่นำมาตัดสิน' };
  }
  if (rate !== null && !Number.isFinite(rate)) rate = null;
  const ageMin = (now - time) / 60000;
  if (ageMin > staleMin) return { status: 'stale', reason: `ข้อมูลล่าสุด ${fmtAge(ageMin)} ที่แล้ว` };
  if (bank === null || bank === undefined || !Number.isFinite(bank)) {
    // ไม่รู้ระดับตลิ่ง → บอกไม่ได้ว่าปลอดภัย: ไม่นำมาตัดสิน (ยกเว้นน้ำขึ้นเร็ว = เหลือง)
    if (rate !== null && rate >= T.fastRate) return { status: 'yellow', reason: 'น้ำขึ้นเร็ว (ไม่ทราบระดับตลิ่ง)' };
    return { status: 'unknown', reason: 'ไม่ทราบระดับตลิ่ง — ไม่นำมาตัดสิน', noBank: true };
  }
  const margin = Math.round((bank - wl) * 100) / 100; // ปัดเป็น ซม. กันปัญหาทศนิยม (1.5-1.3=0.1999…)
  const rising = rate !== null && rate >= T.risingRate;
  if (margin <= 0) return { status: 'red', reason: 'น้ำถึง/เกินตลิ่ง', margin };
  if (margin < T.orangeMargin) return { status: 'orange', reason: `เหลือ ${cm(margin)} ถึงตลิ่ง`, margin };
  if (margin < T.watchMargin && rising && risingOrange) return { status: 'orange', reason: `เหลือ ${cm(margin)} และกำลังขึ้น`, margin };
  if (margin < T.watchMargin) return { status: 'yellow', reason: `เหลือ ${cm(margin)} ถึงตลิ่ง`, margin };
  if (rate !== null && rate >= T.fastRate) return { status: 'yellow', reason: 'น้ำขึ้นเร็ว', margin };
  return { status: 'green', reason: `ต่ำกว่าตลิ่ง ${cm(margin)}`, margin };
}

// สถานะรวมของบ้าน จากสถานะแต่ละกลุ่ม (up / home / down)
// แดงต้องยืนยันด้วย "ค่าวัดใหม่ของสถานีเดียวกัน" — ไม่ใช่รันซ้ำแล้วได้ค่าเดิม หรือสลับไปสถานีสำรอง
//   prev.candidateRed: { key, at } สถานีและเวลาวัดของค่าแรกที่เห็นแดง (เก็บจากรอบก่อน)
//   homeRed: [{ key, time }] สถานีบ้านที่เป็นแดงในรอบนี้
// rain: { heavy: bool, mm, date } จากพยากรณ์ฝน 2 วัน (ไม่บังคับ)
export function overallStatus({ up, home, down }, prev = {}, rain = null, homeRed = []) {
  const reasons = [];
  let status = 'green';
  const bump = (s, why) => {
    if (rank(s) > rank(status)) status = s;
    reasons.push(why);
  };

  if (home === 'unknown' || home === 'stale') {
    // ไม่มีข้อมูลคลองใกล้บ้าน → ไม่ฟันธงว่าปลอดภัย
    return {
      status: 'unknown',
      candidateRed: null,
      reasons: ['ดึงข้อมูลคลองใกล้บ้านไม่ได้ — ช่วยดูคลองหนองระแหงด้วยตาเอง'],
    };
  }

  let candidateRed = null;
  if (home === 'red') {
    const first = prev?.candidateRed ?? null;
    const same = first ? homeRed.find((r) => r.key === first.key) : null;
    if (same && same.time > first.at) {
      candidateRed = first;
      bump('red', 'คลองใกล้บ้านถึงตลิ่ง');
    } else {
      const newest = [...homeRed].sort((a, b) => b.time - a.time)[0] || null;
      candidateRed = same ? first : newest ? { key: newest.key, at: newest.time } : null;
      bump('orange', 'คลองใกล้บ้านถึงตลิ่ง (รอยืนยันจากค่าวัดถัดไป)');
    }
  } else if (home === 'orange') bump('orange', 'คลองใกล้บ้านใกล้ตลิ่ง');
  else if (home === 'yellow') bump('yellow', 'คลองใกล้บ้านสูงกว่าปกติ');

  const upHigh = rank(up) >= rank('orange');
  const downHigh = rank(down) >= rank('orange');
  if (upHigh && downHigh) bump('orange', 'น้ำเหนือใกล้ล้น และทางระบายใต้เต็ม');
  else if (upHigh) bump('yellow', 'น้ำเหนือใกล้ล้น');
  else if (downHigh) bump('yellow', 'ทางระบายใต้เต็ม');
  if (rain?.heavy) bump('yellow', `พยากรณ์ฝนหนัก ${Math.round(rain.mm)} มม.`);

  if (!reasons.length) reasons.push('คลองทุกจุดยังต่ำกว่าตลิ่ง');
  return { status, candidateRed, reasons };
}

const cm = (m) => `${Math.round(m * 100)} ซม.`;
export function fmtAge(min) {
  if (min < 60) return `${Math.round(min)} นาที`;
  if (min < 48 * 60) return `${Math.round(min / 60)} ชม.`;
  return `${Math.round(min / 1440)} วัน`;
}
