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
// "อีก 1 ชม. 15 นาที" นับจาก now ถึง t
const until = (t, now) => (t - now <= 60000 ? 'ตอนนี้' : `อีก ${dur(t - now)}`);
const RAIN_REMIND_MIN = 35;         // เตือนซ้ำเมื่อเหลือไม่ถึง 35 นาทีก่อนฝนเริ่ม
const RAIN_UPDATE_MS = 60 * 60000;  // ฝนตกนาน: ส่งอัปเดตทุก 1 ชม.
const RISE_ALERT = 0.03;            // น้ำขึ้น ≥ 3 ซม./ชม. = แจ้ง
const RISE_GAP_MS = 3 * 3600e3;     // แจ้งน้ำขึ้นเร็วของสถานีเดิม ห่างกันอย่างน้อย 3 ชม.
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
    rainRemindFor: null, rainUpdateAt: 0, riseAt: {}, overbank: {},
    pasakFrontIdx: undefined, pasakRelease: null, pasakFull: null,
    ...(state || {}),
  };
  const { status, reasons = [], home, now, rainWindow, radar, rainToday, river, pasak, stations = [] } = ctx;
  const msgs = [];
  statusAlerts(s, msgs, { status, reasons, home, now });
  rainAlerts(s, msgs, { rainWindow, radar, home, now });
  stationAlerts(s, msgs, stations, now);
  riverAlerts(s, msgs, river);
  pasakAlerts(s, msgs, pasak);

  // สรุปเช้า (วันละครั้ง ช่วง 07:00–07:59)
  if (thaiHour(now) === MORNING_HOUR && s.morningDate !== thaiDate(now)) {
    s.morningDate = thaiDate(now);
    const lines = [homeLine(home)];
    if (rainWindow) lines.push(`ฝน: น่าจะตก ${hm(rainWindow.start)}–${hm(rainWindow.end + 3600e3)} (โอกาส ${rainWindow.maxProb}%)`);
    else if (rainToday) lines.push(`ฝนวันนี้ ~${rainToday.mm} มม. (โอกาส ${rainToday.prob}%)`);
    if (pasak?.dam) lines.push(`เขื่อนป่าสัก: ${pasak.dam.storagePct}% · ปล่อย ${pasak.dam.releaseCms} ลบ.ม./วิ`);
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
    const endT = rainWindow.end + 3600e3;
    const shifted = s.rainWindowStart == null || Math.abs(rainWindow.start - s.rainWindowStart) > 90 * 60000;
    const heavy = rainWindow.peakMm >= 10;
    if (shifted && !s.raining) {
      msgs.push({
        title: `🌧️ ${heavy ? 'ฝนหนัก' : 'ฝน'}จะตกที่บ้าน${until(rainWindow.start, now) === 'ตอนนี้' ? 'ตอนนี้' : `ใน${until(rainWindow.start, now)}`}`,
        message: `⏱️ เริ่มราว ${hm(rainWindow.start)} น. (${until(rainWindow.start, now)})\n⏹️ หยุดราว ${hm(endT)} น. · ตกนาน ~${dur(endT - rainWindow.start)}\nรวม ~${rainWindow.totalMm} มม. · แรงสุด ~${rainWindow.peakMm} มม./ชม. · โอกาส ${rainWindow.maxProb}%\nเป็นพยากรณ์ อาจคลาดเคลื่อน — ดูเรดาร์ในแท็บ "ฝน"`,
        priority: heavy ? 4 : 3,
        tags: ['cloud_with_rain'],
      });
    }
    // เตือนนับถอยหลังก่อนฝนเริ่ม ~30 นาที (ครั้งเดียวต่อช่วงฝน)
    const left = (rainWindow.start - now) / 60000;
    const reminded = s.rainRemindFor != null && Math.abs(rainWindow.start - s.rainRemindFor) <= 90 * 60000;
    if (!s.raining && left > 0 && left <= RAIN_REMIND_MIN && !reminded && !shifted) {
      s.rainRemindFor = rainWindow.start;
      msgs.push({
        title: `⏰ ฝนจะเริ่มในอีก ~${Math.round(left)} นาที`,
        message: `ราว ${hm(rainWindow.start)} น. และน่าจะหยุดราว ${hm(endT)} น. (~${dur(endT - rainWindow.start)})\nเก็บผ้า ปิดหน้าต่าง เตรียมกระสอบทรายให้พร้อม`,
        priority: heavy ? 4 : 3,
        tags: ['alarm_clock'],
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
    const stopAt = s.rainWindowEnd != null && s.rainWindowEnd + 3600e3 > now ? s.rainWindowEnd + 3600e3 : null;
    const stopTxt = stopAt ? `\n⏹️ คาดว่าจะหยุดใน${until(stopAt, now)} (ราว ${hm(stopAt)} น.)` : '\n⏹️ ยังบอกเวลาหยุดไม่ได้ (พยากรณ์ไม่ได้คาดว่าจะมีฝนช่วงนี้)';
    s.rainUpdateAt = now;
    msgs.push({
      title: `🌧️ ${RAIN_LEVEL[radar.atHome]}เริ่มตกที่บ้านแล้ว (${hm(radar.time)})`,
      message: `จากเรดาร์เวลา ${hm(radar.time)} น.${stopTxt}\n${homeLine(home)}`,
      priority: radar.atHome >= 4 ? 4 : 3,
      tags: ['umbrella'],
    });
    return;
  }
  if (wet) {
    s.lastWetAt = radar.time;
    s.dryRuns = 0;
    // ฝนยังตกต่อเนื่อง: อัปเดตทุก 1 ชม. ว่าตกมานานเท่าไร และคาดว่าจะหยุดเมื่อไร
    if (now - (s.rainUpdateAt || 0) >= RAIN_UPDATE_MS - 2 * 60000) {
      s.rainUpdateAt = now;
      const stopAt = s.rainWindowEnd != null && s.rainWindowEnd + 3600e3 > now ? s.rainWindowEnd + 3600e3 : null;
      msgs.push({
        title: `☔ ฝนยังตกอยู่ — ตกมาแล้ว ${dur(now - s.rainStartedAt)}`,
        message: `${RAIN_LEVEL[radar.atHome]} (เรดาร์ ${hm(radar.time)} น.)\n${stopAt ? `⏹️ คาดว่าจะหยุดใน${until(stopAt, now)} (ราว ${hm(stopAt)} น.)` : '⏹️ ยังบอกเวลาหยุดไม่ได้'}\n${homeLine(home)}`,
        priority: radar.atHome >= 4 ? 4 : 2,
        tags: ['umbrella'],
      });
    }
    return;
  }
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

// แต่ละสถานี: น้ำขึ้นเร็ว และ น้ำเกินตลิ่ง/กลับต่ำกว่าตลิ่ง
// stations: [{ key, name, role, status, wl, bank, margin, rate, time }]
function stationAlerts(s, msgs, stations, now) {
  // 1) น้ำขึ้นเร็ว ≥ 3 ซม./ชม. (เฉพาะจุดที่เหลือไม่ถึง 1 ม. ถึงตลิ่ง) — รวมเป็นข้อความเดียว
  const rising = stations.filter((x) => ['green', 'yellow', 'orange', 'red'].includes(x.status) && x.rate != null && x.rate >= RISE_ALERT
    && x.margin != null && x.margin < 1 && x.margin > 0 && now - (s.riseAt[x.key] || 0) >= RISE_GAP_MS);
  if (rising.length) {
    rising.sort((a, b) => a.margin / a.rate - b.margin / b.rate);
    const lines = rising.slice(0, 4).map((x) => {
      const eta = x.margin / x.rate; // ชม. ถ้าขึ้นต่อในอัตรานี้
      return `• ${x.role === 'home' ? '🏠 ' : ''}${x.name}: ขึ้น ${Math.round(x.rate * 100)} ซม./ชม. · เหลือ ${Math.round(x.margin * 100)} ซม. → ถึงตลิ่งใน ~${dur(eta * 3600e3)} ถ้าขึ้นต่อแบบนี้`;
    });
    const urgent = rising.some((x) => x.role === 'home' || x.margin / x.rate <= 6);
    msgs.push({
      title: `📈 น้ำขึ้นเร็ว ${rising.length} จุด${rising.some((x) => x.role === 'home') ? ' (รวมคลองใกล้บ้าน)' : ''}`,
      message: `${lines.join('\n')}\nเวลาถึงตลิ่งเป็นการประมาณ ถ้าน้ำขึ้นต่อด้วยอัตราเดิม`,
      priority: urgent ? 4 : 3,
      tags: ['chart_with_upwards_trend'],
    });
    for (const x of rising) s.riseAt[x.key] = now;
  }

  // 2) เกินตลิ่ง: ยืนยันด้วยค่าวัดใหม่ก่อนแจ้ง / กลับต่ำกว่าตลิ่ง: ต้องต่ำกว่า 2 รอบ
  const seen = new Set();
  for (const x of stations) {
    if (!['green', 'yellow', 'orange', 'red'].includes(x.status) || x.margin == null) continue;
    seen.add(x.key);
    const ob = s.overbank[x.key];
    if (x.margin <= 0) {
      if (!ob) { s.overbank[x.key] = { firstAt: x.time, notified: false, below: 0 }; continue; }
      ob.below = 0;
      if (!ob.notified && x.time > ob.firstAt) {
        ob.notified = true;
        msgs.push({
          title: `🔴 ${x.role === 'home' ? '🏠 ' : ''}${x.name} น้ำเกินตลิ่งแล้ว`,
          message: `ระดับน้ำ ${x.wl.toFixed(2)} ม. เกินตลิ่ง ${Math.round(-x.margin * 100)} ซม.${x.rate != null ? ` · ${x.rate > 0.005 ? `ยังขึ้น ${Math.round(x.rate * 100)} ซม./ชม.` : x.rate < -0.005 ? `เริ่มลด ${Math.round(-x.rate * 100)} ซม./ชม.` : 'ทรงตัว'}` : ''}`,
          priority: x.role === 'home' ? 5 : 4,
          tags: ['rotating_light'],
        });
      }
    } else if (ob) {
      ob.below++;
      if (ob.below >= 2) {
        if (ob.notified) msgs.push({ title: `✅ ${x.name} น้ำกลับต่ำกว่าตลิ่งแล้ว`, message: `ต่ำกว่าตลิ่ง ${Math.round(x.margin * 100)} ซม.`, priority: 2, tags: ['white_check_mark'] });
        delete s.overbank[x.key];
      }
    }
  }
  for (const k of Object.keys(s.overbank)) if (!seen.has(k) && now - (s.overbank[k].firstAt || 0) > 24 * 3600e3) delete s.overbank[k];
  for (const k of Object.keys(s.riseAt)) if (now - s.riseAt[k] > 24 * 3600e3) delete s.riseAt[k];
}

// แม่น้ำป่าสัก (ต้นทางคลองระพีพัฒน์ → บ้านเรา) + เขื่อนป่าสักชลสิทธิ์
const PASAK_RELEASE_STEP = 50; // ลบ.ม./วิ
function pasakAlerts(s, msgs, p) {
  if (!p) return;
  if (p.frontIdx != null) {
    if (s.pasakFrontIdx != null && p.frontIdx > s.pasakFrontIdx) {
      const atBranch = p.branchIdx >= 0 && p.frontIdx >= p.branchIdx && s.pasakFrontIdx < p.branchIdx;
      msgs.push({
        title: atBranch ? '🌊 น้ำป่าสักล้นตลิ่งถึงจุดแยกเข้าคลองระพีพัฒน์แล้ว' : `🌊 น้ำป่าสักล้นตลิ่งลงมาถึง ${p.frontProvince || p.frontName}`,
        message: `สถานี ${p.frontName}${p.frontProvince ? ` (${p.frontProvince})` : ''} ล้นตลิ่ง · แม่น้ำป่าสักล้นรวม ${p.overflowCount} จุด${atBranch ? '\nน้ำส่วนนี้ไหลเข้าคลองระพีพัฒน์ → รังสิต → หกวา → คลองแถวบ้านเรา เฝ้าระวังคลองฝั่งตะวันออก' : ''}`,
        priority: atBranch ? 4 : 3,
        tags: ['ocean'],
      });
    }
    s.pasakFrontIdx = p.frontIdx;
  } else if (s.pasakFrontIdx === undefined) s.pasakFrontIdx = null;

  const d = p.dam;
  if (!d || d.releaseCms == null) return;
  if (s.pasakRelease == null) s.pasakRelease = d.releaseCms;
  else if (Math.abs(d.releaseCms - s.pasakRelease) >= PASAK_RELEASE_STEP) {
    const up = d.releaseCms > s.pasakRelease;
    msgs.push({
      title: `🚰 เขื่อนป่าสักชลสิทธิ์${up ? 'เพิ่ม' : 'ลด'}การปล่อยน้ำเป็น ${d.releaseCms} ลบ.ม./วิ`,
      message: `จากเดิม ${s.pasakRelease} ลบ.ม./วิ · น้ำในเขื่อน ${d.storagePct}% ของระดับเก็บกัก${up ? '\nน้ำที่ปล่อยไหลลงแม่น้ำป่าสัก → คลองระพีพัฒน์ (ต้นทางน้ำฝั่งบ้านเรา)' : ''}`,
      priority: up ? 3 : 2,
      tags: ['ocean'],
    });
    s.pasakRelease = d.releaseCms;
  }
  const full = d.storagePct != null && d.storagePct >= 100;
  if (s.pasakFull === null) s.pasakFull = full;
  else if (full && !s.pasakFull) {
    msgs.push({ title: `💧 เขื่อนป่าสักชลสิทธิ์น้ำเกินระดับเก็บกัก (${d.storagePct}%)`, message: `เขื่อนรับน้ำเพิ่มได้น้อย น้ำที่ไหลเข้า (${d.inflowCms} ลบ.ม./วิ) ต้องปล่อยออกเกือบทั้งหมด`, priority: 3, tags: ['warning'] });
    s.pasakFull = true;
  } else if (!full) s.pasakFull = false;
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
