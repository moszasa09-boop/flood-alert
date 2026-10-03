// ตัดสินใจว่าจะส่งแจ้งเตือนอะไร (ฟังก์ชันล้วน ทดสอบใน test/notify.test.mjs) + ส่งผ่าน ntfy
import { rank } from './status.mjs';

export const SITE_URL = 'https://moszasa09-boop.github.io/flood-alert/';
const LABEL = { green: 'ปกติ', yellow: 'เฝ้าระวัง', orange: 'เตรียมพร้อม', red: 'น้ำกำลังมา', unknown: 'ข้อมูลไม่พอ' };
const EMOJI = { green: '🟢', yellow: '🟡', orange: '🟠', red: '🔴', unknown: '⚪' };
const PRIORITY = { green: 3, yellow: 3, orange: 4, red: 5, unknown: 4 }; // ntfy: 5 = ด่วน
const ACTIONS = {
  yellow: 'เตรียมกระสอบทรายไว้ใกล้ประตู พร้อมวางได้ทันที',
  orange: 'วางกระสอบทราย/ติดแผ่นกั้นน้ำตอนนี้! ยกของขึ้นที่สูง เตรียมย้ายรถ',
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

const RAIN_LEVEL = ['ไม่มีฝน', 'ละอองฝน', 'ฝนเบา', 'ฝนปานกลาง', 'ฝนหนัก', 'ฝนหนักมาก'];
const DIRS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
const dirName = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const hm = (t) => new Date(t + 7 * 3600e3).toISOString().slice(11, 16);
const dur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม.${m % 60 ? ` ${m % 60} นาที` : ''}`;
};
const APPROACH_GAP_MS = 2 * 3600e3; // เตือน "กลุ่มฝนกำลังเข้ามา" ห่างกันอย่างน้อย 2 ชม.
const DAM_STEP = 300;               // เขื่อนเปลี่ยนการปล่อยน้ำ ≥ 300 ลบ.ม./วิ จึงแจ้ง

/**
 * state: สถานะการแจ้งเตือนรอบก่อน (เก็บใน latest.json)
 * ctx: { status, reasons, home, now,
 *        rainWindow: { start, end, maxProb, totalMm, peakMm } | null   ← พยากรณ์ 12 ชม.
 *        radar: { time, atHome, nearest, trend } | null               ← เรดาร์จริง
 *        rainToday: { mm, prob } | null
 *        river: { frontIdx, frontName, frontProvince, overflowCount, damFlow } | null }
 * คืนค่า { messages: [...], state }
 */
export function decide(state, ctx) {
  const s = {
    lastStatus: null, pendingDown: null, redCount: 0, lastRedAt: 0, unknownRuns: 0, morningDate: null,
    rainWindowStart: null, rainWindowEnd: null, raining: false, rainStartedAt: null, lastWetAt: null, dryRuns: 0, approachAt: 0,
    riverFrontIdx: undefined, damNotified: null,
    ...(state || {}),
  };
  const { status, reasons = [], home, now, rainWindow, radar, rainToday, river } = ctx;
  const msgs = [];
  statusAlerts(s, msgs, { status, reasons, home, now });
  rainAlerts(s, msgs, { rainWindow, radar, home, now });
  riverAlerts(s, msgs, river);

  // สรุปเช้า (วันละครั้ง ช่วง 07:00–07:59)
  if (thaiHour(now) === MORNING_HOUR && s.morningDate !== thaiDate(now)) {
    s.morningDate = thaiDate(now);
    const lines = [homeLine(home)];
    if (rainWindow) lines.push(`ฝน: น่าจะตก ${hm(rainWindow.start)}–${hm(rainWindow.end + 3600e3)} (โอกาส ${rainWindow.maxProb}%)`);
    else if (rainToday) lines.push(`ฝนวันนี้ ~${rainToday.mm} มม. (โอกาส ${rainToday.prob}%)`);
    if (river?.frontName) lines.push(`น้ำเหนือ: ล้นตลิ่ง ${river.overflowCount} จุด ใต้สุดที่ ${river.frontName}${river.frontProvince ? ` (${river.frontProvince})` : ''}`);
    if (reasons.length) lines.push(reasons.join(' · '));
    msgs.push({ title: `☀️ สรุปเช้า: ${EMOJI[status] || '⚪'} ${LABEL[status] || status}`, message: lines.join('\n'), priority: 2, tags: ['sunrise'] });
  }
  return { messages: msgs, state: s };
}

function statusAlerts(s, msgs, { status, reasons, home, now }) {
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
    return;
  }
  const wasUnknown = s.unknownRuns >= 2;
  s.unknownRuns = 0;
  const before = msgs.length;

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
  if (s.lastStatus === 'red' && status === 'red' && msgs.length === before) {
    const gap = s.redCount < RED_REPEAT_MAX ? RED_REPEAT_MIN : 60;
    if (now - s.lastRedAt >= (gap - 2) * 60000) {
      s.redCount++;
      s.lastRedAt = now;
      msgs.push(statusMsg('red', `(เตือนซ้ำ ${s.redCount}) `));
    }
  }
  if (wasUnknown && msgs.length === before) {
    msgs.push({ title: `${EMOJI[status]} ระบบกลับมาดึงข้อมูลได้แล้ว`, message: `สถานะตอนนี้: ${LABEL[status]}\n${homeLine(home)}`, priority: 3, tags: ['white_check_mark'] });
  }
}

function rainAlerts(s, msgs, { rainWindow, radar, home, now }) {
  // 1) พยากรณ์: ช่วงฝนครั้งถัดไปใน 12 ชม. (แจ้งครั้งเดียวต่อช่วง แจ้งใหม่ถ้าเวลาเลื่อนเกิน 90 นาที)
  if (rainWindow) {
    const shifted = s.rainWindowStart == null || Math.abs(rainWindow.start - s.rainWindowStart) > 90 * 60000;
    if (shifted && !s.raining) {
      const endT = rainWindow.end + 3600e3;
      const heavy = rainWindow.peakMm >= 10;
      msgs.push({
        title: `🌧️ พยากรณ์: ${heavy ? 'ฝนหนัก' : 'ฝน'}จะตกที่บ้าน ${hm(rainWindow.start)}–${hm(endT)}`,
        message: `ราว ${hm(rainWindow.start)} ถึง ${hm(endT)} น. (~${dur(endT - rainWindow.start)})\nรวม ~${rainWindow.totalMm} มม. · แรงสุด ~${rainWindow.peakMm} มม./ชม. · โอกาส ${rainWindow.maxProb}%\nเป็นพยากรณ์ อาจคลาดเคลื่อน — ดูเรดาร์ในแท็บ "ฝน"`,
        priority: heavy ? 4 : 3,
        tags: ['cloud_with_rain'],
      });
    }
    s.rainWindowStart = rainWindow.start;
    s.rainWindowEnd = rainWindow.end;
  } else if (s.rainWindowEnd != null && now > s.rainWindowEnd + 3600e3) {
    s.rainWindowStart = s.rainWindowEnd = null;
  }

  if (!radar) return;
  const wet = radar.atHome >= 2;
  // 2) เรดาร์: ฝนเริ่มตกที่บ้าน
  if (wet && !s.raining) {
    s.raining = true;
    s.rainStartedAt = radar.time;
    s.lastWetAt = radar.time;
    s.dryRuns = 0;
    const until = s.rainWindowEnd && s.rainWindowEnd + 3600e3 > now ? `\nพยากรณ์ว่าน่าจะหยุดราว ${hm(s.rainWindowEnd + 3600e3)} น.` : '';
    msgs.push({
      title: `🌧️ ${RAIN_LEVEL[radar.atHome]}เริ่มตกที่บ้านแล้ว (${hm(radar.time)})`,
      message: `จากเรดาร์เวลา ${hm(radar.time)} น.${until}\n${homeLine(home)}`,
      priority: radar.atHome >= 4 ? 4 : 3,
      tags: ['umbrella'],
    });
    return;
  }
  if (wet) { s.lastWetAt = radar.time; s.dryRuns = 0; return; }
  // 3) เรดาร์: ฝนหยุด (ต้องแห้งติดกัน 2 รอบ)
  if (s.raining) {
    s.dryRuns++;
    if (s.dryRuns >= 2) {
      msgs.push({
        title: `⛅ ฝนหยุดแล้ว — ตกนาน ~${dur(s.lastWetAt - s.rainStartedAt + 10 * 60000)}`,
        message: `ตกราว ${hm(s.rainStartedAt)}–${hm(s.lastWetAt + 10 * 60000)} น. (จากเรดาร์)\n${homeLine(home)}`,
        priority: 2,
        tags: ['partly_sunny'],
      });
      s.raining = false;
      s.rainStartedAt = s.lastWetAt = null;
      s.dryRuns = 0;
    }
    return;
  }
  // 4) เรดาร์: กลุ่มฝนก่อตัวใหม่ใกล้บ้าน (≤ 10 กม.) — ไม่มีเวลาถึง
  const nn = radar.nearest;
  if (nn && nn.km <= 10 && radar.trend?.trend === 'new' && now - s.approachAt > APPROACH_GAP_MS) {
    s.approachAt = now;
    msgs.push({
      title: `🌦️ มี${RAIN_LEVEL[nn.level]}ก่อตัวใกล้บ้าน ${Math.round(nn.km)} กม.`,
      message: `ทิศ${dirName(nn.bearing)} (จากเรดาร์ ${hm(radar.time)} น.) — อาจตกที่บ้านได้ในไม่ช้า`,
      priority: nn.level >= 4 ? 4 : 3,
      tags: ['cloud_with_rain'],
    });
    return;
  }
  // 5) เรดาร์: กลุ่มฝนกำลังเข้ามา (≤ 20 กม. และอาจถึงใน 60 นาที)
  const n = radar.nearest;
  if (n && n.km <= 20 && radar.trend?.trend === 'closer' && radar.trend.etaMin != null && radar.trend.etaMin <= 60 && now - s.approachAt > APPROACH_GAP_MS) {
    s.approachAt = now;
    msgs.push({
      title: `🌦️ ${RAIN_LEVEL[n.level]}กำลังเข้ามา อาจถึงบ้านใน ~${radar.trend.etaMin} นาที`,
      message: `กลุ่มฝนห่าง ${Math.round(n.km)} กม. ทิศ${dirName(n.bearing)} เคลื่อนเข้ามา ~${Math.round(radar.trend.speed)} กม./ชม.\n(ประมาณจากเรดาร์ ${hm(radar.time)} น. — กลุ่มฝนอาจเปลี่ยนทิศหรือสลายได้)`,
      priority: n.level >= 4 ? 4 : 3,
      tags: ['cloud_with_rain'],
    });
  }
}

function riverAlerts(s, msgs, river) {
  if (!river) return;
  // น้ำเหนือล้นตลิ่งลงมาใต้กว่าเดิม (ใกล้ กทม. ขึ้น)
  if (river.frontIdx != null) {
    if (s.riverFrontIdx !== undefined && s.riverFrontIdx !== null && river.frontIdx > s.riverFrontIdx) {
      const near = ['นนทบุรี', 'กรุงเทพฯ', 'ปทุมธานี'].includes(river.frontProvince);
      msgs.push({
        title: `🌊 น้ำเหนือล้นตลิ่งลงมาถึง ${river.frontProvince || river.frontName} แล้ว`,
        message: `สถานี ${river.frontName}${river.frontProvince ? ` (${river.frontProvince})` : ''} ล้นตลิ่ง · แม่น้ำเจ้าพระยาล้นตลิ่งรวม ${river.overflowCount} จุด${river.damFlow ? `\nเขื่อนเจ้าพระยาปล่อย ${river.damFlow.toLocaleString('en-US')} ลบ.ม./วิ` : ''}\nดูแท็บ "น้ำเหนือ"`,
        priority: near ? 4 : 3,
        tags: ['ocean'],
      });
    }
    s.riverFrontIdx = river.frontIdx;
  } else if (s.riverFrontIdx === undefined) {
    s.riverFrontIdx = null;
  }
  // เขื่อนเจ้าพระยาเปลี่ยนการปล่อยน้ำมาก
  if (river.damFlow != null) {
    if (s.damNotified == null) s.damNotified = river.damFlow;
    else if (Math.abs(river.damFlow - s.damNotified) >= DAM_STEP) {
      const up = river.damFlow > s.damNotified;
      msgs.push({
        title: `🚰 เขื่อนเจ้าพระยา${up ? 'เพิ่ม' : 'ลด'}การปล่อยน้ำเป็น ${river.damFlow.toLocaleString('en-US')} ลบ.ม./วิ`,
        message: `จากเดิม ${s.damNotified.toLocaleString('en-US')} ลบ.ม./วิ${up ? '\nน้ำจากเขื่อนใช้เวลาราว 2–3 วันถึงกรุงเทพฯ (ค่าประมาณทั่วไป)' : ''}`,
        priority: up ? 3 : 2,
        tags: ['ocean'],
      });
      s.damNotified = river.damFlow;
    }
  }
}

// ส่งผ่าน ntfy (topic เก็บเป็นความลับใน GitHub Secrets — ใครรู้ชื่อ topic ก็รับแจ้งเตือนได้)
// ลองใหม่สูงสุด 3 ครั้ง (เว้น 2, 4 วินาที) ถ้ายังไม่ได้ throw ให้ผู้เรียกเก็บเข้าคิวส่งรอบหน้า
export async function sendNtfy(topic, msg, { tries = 3, fetchImpl = fetch, waitMs = 2000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl('https://ntfy.sh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, click: SITE_URL, ...msg }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return;
      last = new Error(`ntfy HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // ผิดถาวร ไม่ต้องลองซ้ำ
    } catch (err) { last = err; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs * (i + 1)));
  }
  throw last;
}

// ส่งข้อความรอบนี้ + ข้อความค้างจากรอบก่อน (outbox) — ส่งไม่ได้เก็บไว้ลองรอบหน้า ไม่เกิน 3 ชม.
const OUTBOX_MAX_AGE = 3 * 3600e3;
export async function deliver(topic, messages, outbox = [], now = Date.now(), send = sendNtfy) {
  const queue = [
    ...outbox.filter((o) => now - o.at <= OUTBOX_MAX_AGE).map((o) => ({ ...o, retry: true })),
    ...messages.map((msg) => ({ msg, at: now, retry: false })),
  ];
  const log = [];
  const pending = [];
  for (const item of queue) {
    const msg = item.retry ? { ...item.msg, title: `(ส่งซ้ำ) ${item.msg.title}` } : item.msg;
    try { await send(topic, msg); log.push(`ส่งแล้ว: ${msg.title}`); }
    catch (err) { pending.push({ msg: item.msg, at: item.at }); log.push(`ส่งไม่สำเร็จ (จะลองรอบหน้า): ${msg.title} (${err.message})`); }
  }
  const dropped = outbox.length - outbox.filter((o) => now - o.at <= OUTBOX_MAX_AGE).length;
  if (dropped) log.push(`ทิ้งข้อความค้างเกิน 3 ชม. ${dropped} ข้อความ`);
  return { log, outbox: pending };
}
