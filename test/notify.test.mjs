import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, homeLine } from '../src/notify.mjs';

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

test('ฝนหนักใกล้มา วันละครั้ง', () => {
  let r = run({ lastStatus: 'green' }, 'green', 0, { rainSoon: { mm: 12, prob: 70, at: '13:00' } });
  assert.equal(r.messages.length, 1);
  r = run(r.state, 'green', 15, { rainSoon: { mm: 12, prob: 70, at: '13:00' } });
  assert.equal(r.messages.length, 0);
});

test('ข้อความคลองใกล้บ้าน', () => {
  assert.equal(homeLine(home), 'คลองใกล้บ้าน 1.32 ม. ต่ำกว่าตลิ่ง 28 ซม. (ขึ้น 3 ซม./ชม.)');
  assert.equal(homeLine({ wl: 1.7, bank: 1.6, rate: 0 }), 'คลองใกล้บ้าน 1.70 ม. เกินตลิ่ง 10 ซม.');
});
