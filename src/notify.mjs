// ตัดสินใจว่าจะส่งแจ้งเตือนอะไร (ฟังก์ชันล้วน ทดสอบใน test/notify.test.mjs) + ส่งผ่าน ntfy
import { rank } from './status.mjs';

export const SITE_URL = 'https://moszasa09-boop.github.io/flood-alert/';
const LABEL = { green: 'ปกติ', yellow: 'เฝ้าระวัง', orange: 'เตรียมพร้อม', red: 'น้ำกำลังมา', unknown: 'ข้อมูลไม่พอ' };
const EMOJI = { green: '🟢', yellow: '🟡', orange: '🟠', red: '🔴', unknown: '⚪' };
const PRIORITY = { green: 3, yellow: 3, orange: 4, red: 5, unknown: 4 }; // ntfy: 5 = ด่วน
const ACTIONS = {
  yellow: 'เตรียมของเลย! เอากระสอบทรายมาวางกั้นไว้ตอนนี้',
  orange: 'ยกของขึ้นที่สูงตอนนี้! ติดแผ่นกั้นน้ำ เตรียมย้ายรถ',
  red: 'รีบย้ายรถและของออกเดี๋ยวนี้! ตัดไฟชั้นล่าง · ช่วยเหลือโทร 1555 / 1784',
  green: 'น้ำยังไม่ขึ้นสูง ใช้ชีวิตได้ตามปกติ',
  unknown: 'ไปดูคลองหนองระแหงด้วยตาเอง',
};
const RED_REPEAT_MIN = 15;   // แดง: เตือนซ้ำทุก 15 นาที
const RED_REPEAT_MAX = 12;   // …สูงสุด 12 ครั้ง (3 ชม.) แล้วเหลือชั่วโมงละครั้ง
const MORNING_HOUR = 7;      // สรุปเช้า 07:xx เวลาไทย

const thaiHour = (t) => new Date(t + 7 * 3600e3).getUTCHours();
const thaiDate = (t) => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);

// ข้อความสั้นของคลองใกล้บ้าน
export function homeLine(home) {
  if (!home || home.wl == null) return 'คลองใกล้บ้าน: ไม่มีข้อมูล';
  const m = home.bank != null ? home.bank - home.wl : null;
  const pos = m == null ? '' : m <= 0 ? ` เกินตลิ่ง ${Math.round(-m * 100)} ซม.` : ` ต่ำกว่าตลิ่ง ${Math.round(m * 100)} ซม.`;
  const rate = home.rate == null || Math.abs(home.rate) < 0.005 ? '' : ` (${home.rate > 0 ? 'ขึ้น' : 'ลด'} ${Math.abs(Math.round(home.rate * 100))} ซม./ชม.)`;
  return `คลองใกล้บ้าน ${home.wl.toFixed(2)} ม.${pos}${rate}`;
}

/**
 * state: สถานะการแจ้งเตือนรอบก่อน (เก็บใน latest.json)
 * ctx: { status, reasons, home, rainSoon, rainToday, now }
 *   rainSoon: { mm, prob, at } ฝนหนักใน 3 ชม. ข้างหน้า หรือ null
 * คืนค่า { messages: [...], state }
 */
export function decide(state, ctx) {
  const s = { lastStatus: null, pendingDown: null, redCount: 0, lastRedAt: 0, unknownRuns: 0, morningDate: null, rainAlertDate: null, ...(state || {}) };
  const { status, reasons = [], home, rainSoon, rainToday, now } = ctx;
  const msgs = [];
  const body = (st) => [`👉 ${ACTIONS[st]}`, reasons.join(' · '), homeLine(home), 'ไม่ใช่ประกาศทางการ'].filter(Boolean).join('\n');
  const statusMsg = (st, prefix = '') => ({
    title: `${EMOJI[st]} ${prefix}${LABEL[st]} — น้ำท่วมคลองสามวา`,
    message: body(st),
    priority: PRIORITY[st],
    tags: [st === 'red' ? 'rotating_light' : 'droplet'],
  });

  // ข้อมูลไม่พอ: เตือนเมื่อเป็นติดกัน 2 รอบ (กันสะดุดชั่วคราว) และเตือนครั้งเดียว
  if (status === 'unknown') {
    s.unknownRuns++;
    if (s.unknownRuns === 2) msgs.push({ ...statusMsg('unknown'), message: 'ระบบดึงข้อมูลคลองใกล้บ้านไม่ได้ — ช่วยดูคลองหนองระแหงเอง\nไม่ใช่ประกาศทางการ' });
    return { messages: msgs, state: s };
  }
  const wasUnknown = s.unknownRuns >= 2;
  s.unknownRuns = 0;

  const prev = s.lastStatus;
  if (prev === null) {
    s.lastStatus = status; // รอบแรก: จำไว้เฉยๆ ไม่ส่ง
  } else if (rank(status) > rank(prev)) {
    msgs.push(statusMsg(status, 'ยกระดับ: '));
    s.lastStatus = status;
    s.pendingDown = null;
    if (status === 'red') { s.redCount = 1; s.lastRedAt = now; }
  } else if (rank(status) < rank(prev)) {
    // ลดระดับ: ต้องเห็นต่ำลงติดกัน 2 รอบ กันแจ้งเตือนสลับไปมา
    if (s.pendingDown === status) {
      msgs.push({ ...statusMsg(status, 'ลดระดับ: '), priority: 3, tags: ['white_check_mark'] });
      s.lastStatus = status;
      s.pendingDown = null;
      s.redCount = 0;
    } else {
      s.pendingDown = status;
    }
  } else {
    s.pendingDown = null;
  }

  // แดงค้าง: เตือนซ้ำเฉพาะเมื่อค่ารอบนี้ยังแดงจริง (ถ้ากำลังลดระดับ ไม่ส่ง "น้ำกำลังมา" ซ้ำ)
  if (s.lastStatus === 'red' && status === 'red' && msgs.length === 0) {
    const gap = s.redCount < RED_REPEAT_MAX ? RED_REPEAT_MIN : 60;
    if (now - s.lastRedAt >= (gap - 2) * 60000) {
      s.redCount++;
      s.lastRedAt = now;
      msgs.push(statusMsg('red', `(เตือนซ้ำ ${s.redCount}) `));
    }
  }
  if (wasUnknown && msgs.length === 0) {
    msgs.push({ title: `${EMOJI[status]} ระบบกลับมาดึงข้อมูลได้แล้ว`, message: `สถานะตอนนี้: ${LABEL[status]}\n${homeLine(home)}`, priority: 3, tags: ['white_check_mark'] });
  }

  // ฝนหนักใกล้มา (วันละครั้ง)
  if (rainSoon && s.rainAlertDate !== thaiDate(now)) {
    s.rainAlertDate = thaiDate(now);
    msgs.push({
      title: '🌧️ ฝนหนักใน 3 ชม. ข้างหน้า',
      message: `พยากรณ์ ~${rainSoon.mm} มม./ชม. (โอกาส ${rainSoon.prob}%) ราว ${rainSoon.at} น.\n${homeLine(home)}\nเปิดแท็บ "ฝน" ดูเรดาร์ได้`,
      priority: 4,
      tags: ['cloud_with_rain'],
    });
  }

  // สรุปเช้า (วันละครั้ง ช่วง 07:00–07:59)
  if (thaiHour(now) === MORNING_HOUR && s.morningDate !== thaiDate(now)) {
    s.morningDate = thaiDate(now);
    const rain = rainToday ? `\nฝนวันนี้ ~${rainToday.mm} มม. (โอกาส ${rainToday.prob}%)` : '';
    msgs.push({ title: `☀️ สรุปเช้า: ${EMOJI[status]} ${LABEL[status]}`, message: `${homeLine(home)}${rain}\n${reasons.join(' · ')}`, priority: 2, tags: ['sunrise'] });
  }

  return { messages: msgs, state: s };
}

// ส่งผ่าน ntfy (topic เก็บเป็นความลับใน GitHub Secrets — ใครรู้ชื่อ topic ก็รับแจ้งเตือนได้)
export async function sendNtfy(topic, msg) {
  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, click: SITE_URL, ...msg }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}
