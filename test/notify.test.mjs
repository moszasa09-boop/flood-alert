import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, homeLine, deliver, sendNtfy } from '../src/notify.mjs';

// 10:00 เวลาไทย (ไม่ชนสรุปเช้า)
const T0 = Date.UTC(2026, 9, 3, 3, 0);
const min = (m) => T0 + m * 60000;
const home = { wl: 1.32, bank: 1.6, rate: 0.03 };
const run = (state, status, m, extra = {}) => decide(state, { status, reasons: ['เหตุผล'], home, now: min(m), ...extra });

test('รอบแรกไม่ส่ง แค่จำสถานะ', () => {
  const r = run(null, 'yellow', 0);
  assert.equal(r.messages.length, 0);
  assert.equal(r.state.lastStatus, 'yellow');
});

test('ยกระดับ → ส่งทันที', () => {
  let r = run(null, 'yellow', 0);
  r = run(r.state, 'orange', 15);
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].title, /ยกระดับ: เตรียมพร้อม/);
  assert.equal(r.messages[0].priority, 4);
});

test('ลดระดับ → ต้องต่ำลงติดกัน 2 รอบ (กันสลับไปมา)', () => {
  let r = run({ lastStatus: 'orange' }, 'yellow', 0);
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'orange', 15); // เด้งกลับ → ไม่ส่งอะไร
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'yellow', 30);
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'yellow', 45);
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].title, /ลดระดับ: เฝ้าระวัง/);
});

test('แดง → ด่วน + เตือนซ้ำทุก 15 นาที', () => {
  let r = run({ lastStatus: 'orange' }, 'red', 0);
  assert.equal(r.messages[0].priority, 5);
  r = run(r.state, 'red', 15);
  assert.match(r.messages[0].title, /เตือนซ้ำ 2/);
  r = run(r.state, 'red', 20); // ยังไม่ครบ 15 นาที
  assert.equal(r.messages.length, 0);
});

test('ข้อมูลไม่พอ: เตือนครั้งเดียวเมื่อเป็นติดกัน 2 รอบ แล้วแจ้งเมื่อกลับมา', () => {
  let r = run({ lastStatus: 'yellow' }, 'unknown', 0);
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'unknown', 15);
  assert.equal(r.messages.length, 1);
  r = run(r.state, 'unknown', 30);
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'yellow', 45);
  assert.match(r.messages[0].title, /กลับมาดึงข้อมูลได้/);
});

test('สรุปเช้า 07:xx วันละครั้ง', () => {
  const seven = Date.UTC(2026, 9, 4, 0, 7); // 07:07 ไทย
  let r = decide({ lastStatus: 'yellow' }, { status: 'yellow', reasons: [], home, now: seven, rainToday: { mm: 9, prob: 80 } });
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].title, /สรุปเช้า/);
  r = decide(r.state, { status: 'yellow', reasons: [], home, now: seven + 15 * 60000 });
  assert.equal(r.messages.length, 0);
});

test('พยากรณ์ช่วงฝน: แจ้งครั้งเดียว แจ้งใหม่ถ้าเวลาเลื่อนเกิน 90 นาที', () => {
  const w = { start: min(120), end: min(240), maxProb: 70, totalMm: 8, peakMm: 4 };
  let r = run({ lastStatus: 'green' }, 'green', 0, { rainWindow: w });
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].title, /ฝนจะตกที่บ้าน 12:00–15:00/);
  r = run(r.state, 'green', 15, { rainWindow: { ...w, start: min(180) } }); // เลื่อน 60 นาที → ไม่แจ้ง
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'green', 30, { rainWindow: { ...w, start: min(300), end: min(360) } }); // เลื่อนจากล่าสุด 120 นาที
  assert.equal(r.messages.length, 1);
});

test('เรดาร์: ฝนกำลังเข้ามา → เริ่มตก → หยุด (บอกเวลาและระยะเวลา)', () => {
  const far = { time: min(0), atHome: 0, nearest: { km: 12, bearing: 0, level: 3 }, trend: { trend: 'closer', speed: 20, etaMin: 36 } };
  let r = run({ lastStatus: 'green' }, 'green', 0, { radar: far });
  assert.match(r.messages[0].title, /ฝนปานกลางกำลังเข้ามา อาจถึงบ้านใน ~36 นาที/);
  r = run(r.state, 'green', 15, { radar: { ...far, time: min(15) } }); // ไม่เตือนซ้ำภายใน 2 ชม.
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'green', 30, { radar: { time: min(30), atHome: 3, nearest: { km: 0, bearing: 0, level: 3 } } });
  assert.match(r.messages[0].title, /ฝนปานกลางเริ่มตกที่บ้านแล้ว \(10:30\)/);
  r = run(r.state, 'green', 45, { radar: { time: min(45), atHome: 2, nearest: { km: 0, bearing: 0, level: 2 } } });
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'green', 60, { radar: { time: min(60), atHome: 0, nearest: null } }); // แห้งรอบ 1
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'green', 75, { radar: { time: min(75), atHome: 0, nearest: null } }); // แห้งรอบ 2
  assert.match(r.messages[0].title, /ฝนหยุดแล้ว — ตกนาน ~25 นาที/);
  assert.match(r.messages[0].message, /10:30–10:55/);
});

test('น้ำเหนือ: แจ้งเมื่อล้นตลิ่งลงมาใต้กว่าเดิม และเมื่อเขื่อนเปลี่ยนการปล่อยน้ำมาก', () => {
  const rv = (frontIdx, frontProvince, damFlow) => ({ frontIdx, frontName: 'สถานี', frontProvince, overflowCount: 3, damFlow });
  let r = run({ lastStatus: 'yellow' }, 'yellow', 0, { river: rv(13, 'อยุธยา', 2500) }); // รอบแรก จำไว้
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'yellow', 15, { river: rv(14, 'นนทบุรี', 2500) });
  assert.match(r.messages[0].title, /น้ำเหนือล้นตลิ่งลงมาถึง นนทบุรี แล้ว/);
  assert.equal(r.messages[0].priority, 4);
  r = run(r.state, 'yellow', 30, { river: rv(12, 'อยุธยา', 2700) }); // ถอยขึ้นเหนือ + เขื่อนเปลี่ยนน้อย → ไม่แจ้ง
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'yellow', 45, { river: rv(12, 'อยุธยา', 2850) });
  assert.match(r.messages[0].title, /เพิ่มการปล่อยน้ำเป็น 2,850/);
});

test('ข้อมูลไม่พอ ยังแจ้งเรื่องฝนได้', () => {
  const r = run({ lastStatus: 'yellow' }, 'unknown', 0, { radar: { time: min(0), atHome: 3, nearest: { km: 0, bearing: 0, level: 3 } } });
  assert.match(r.messages[0].title, /เริ่มตกที่บ้าน/);
});

test('ข้อความคลองใกล้บ้าน', () => {
  assert.equal(homeLine(home), 'คลองใกล้บ้าน 1.32 ม. ต่ำกว่าตลิ่ง 28 ซม. (ขึ้น 3 ซม./ชม.)');
  assert.equal(homeLine({ wl: 1.7, bank: 1.6, rate: 0 }), 'คลองใกล้บ้าน 1.70 ม. เกินตลิ่ง 10 ซม.');
});

test('แดงกำลังลดระดับ: ไม่ส่ง "น้ำกำลังมา" ซ้ำ ระหว่างรอยืนยัน', () => {
  let r = run({ lastStatus: 'orange' }, 'red', 0);
  r = run(r.state, 'yellow', 15); // ค่าลดลงรอบแรก
  assert.equal(r.messages.length, 0);
  r = run(r.state, 'yellow', 30); // ยืนยัน
  assert.match(r.messages[0].title, /ลดระดับ/);
});

test('ส่งแจ้งเตือน: ลองใหม่เมื่อล้มเหลวชั่วคราว', async () => {
  let calls = 0;
  const flaky = async () => { calls++; return calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200 }; };
  await sendNtfy('t', { title: 'x' }, { fetchImpl: flaky, waitMs: 1 });
  assert.equal(calls, 3);
  let c2 = 0;
  await assert.rejects(sendNtfy('t', { title: 'x' }, { fetchImpl: async () => { c2++; return { ok: false, status: 400 }; }, waitMs: 1 }));
  assert.equal(c2, 1); // 400 = ผิดถาวร ไม่ลองซ้ำ
});

test('ส่งไม่ได้ → เก็บเข้าคิว แล้วส่งซ้ำรอบหน้า (ไม่เกิน 3 ชม.)', async () => {
  const fail = async () => { throw new Error('network'); };
  const ok = async () => {};
  const r1 = await deliver('t', [{ title: '🔴 น้ำกำลังมา' }], [], min(0), fail);
  assert.equal(r1.outbox.length, 1);
  const sent = [];
  const r2 = await deliver('t', [{ title: 'ใหม่' }], r1.outbox, min(15), async (_, m) => sent.push(m.title));
  assert.deepEqual(sent, ['(ส่งซ้ำ) 🔴 น้ำกำลังมา', 'ใหม่']);
  assert.equal(r2.outbox.length, 0);
  const r3 = await deliver('t', [], r1.outbox, min(200), ok); // ค้างเกิน 3 ชม. → ทิ้ง
  assert.match(r3.log.join(), /ทิ้งข้อความค้าง/);
});

test('เรดาร์: กลุ่มฝนก่อตัวใหม่ใกล้บ้าน → แจ้งโดยไม่เดาเวลาถึง', () => {
  const r = run({ lastStatus: 'green' }, 'green', 0, { radar: { time: min(0), atHome: 0, nearest: { km: 8, bearing: 135, level: 3 }, trend: { trend: 'new', speed: null, etaMin: null } } });
  assert.match(r.messages[0].title, /ก่อตัวใกล้บ้าน 8 กม/);
  assert.doesNotMatch(r.messages[0].message, /นาที/);
});
