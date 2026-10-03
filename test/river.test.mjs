import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riverStatus, riverFront, normalizeRiver } from '../src/sources/river.mjs';

test('สถานะสถานีแม่น้ำ', () => {
  assert.equal(riverStatus(1.23, 10), 'red');
  assert.equal(riverStatus(0, 10), 'red');
  assert.equal(riverStatus(-0.18, 10), 'orange');
  assert.equal(riverStatus(-0.69, 10), 'yellow');
  assert.equal(riverStatus(-3.2, 10), 'green');
  assert.equal(riverStatus(-0.1, 60 * 30), 'stale'); // อยุธยา: ข้อมูลค้างตั้งแต่เมื่อวาน
});

test('น้ำเหนือมาถึงไหน: เอาจุดใต้สุดที่ล้นตลิ่ง (ข้าม stale)', () => {
  const s = (name, status) => ({ name, status });
  const f = riverFront([s('ชัยนาท', 'red'), s('อ่างทอง', 'orange'), s('อยุธยา', 'stale'), s('บางปะอิน', 'red'), s('นนทบุรี', 'orange'), s('กทม.', 'yellow')]);
  assert.equal(f.overflow.name, 'บางปะอิน');
  assert.equal(f.near.name, 'นนทบุรี');
  assert.equal(f.overflowCount, 2);
  assert.equal(riverFront([s('a', 'green')]).overflow, null);
});

test('แปลงข้อมูล api_river (ค่าจริง 3 ต.ค.)', () => {
  const now = Date.UTC(2026, 9, 3, 13, 30);
  const r = normalizeRiver({
    stations: [
      { code: '26', name: 'สะพานนวลฉวี', river: 'แม่น้ำเจ้าพระยา', order: 15, wl: 2.54, bank: 2.5, diff: 0.04, trend: 'up', measured_at: '2026-10-03 20:10:00', lat: 13.94, lng: 100.5 },
      { code: '80', name: 'สะพานธรรมจักร', river: 'แม่น้ำเจ้าพระยา', order: 4, wl: 18.77, bank: 17.54, diff: 1.23, measured_at: '2026-10-03 20:10:00' },
      { code: '37', name: 'คลองหกวา', river: 'คลองหกวา', order: null, diff: -0.79, measured_at: '2026-10-03 20:10:00' },
    ],
    notes: { dam_release: { v: '2500', as_of: '2026-10-03 19:00:00', src: 'C.13' } },
  }, now);
  assert.deepEqual(r.stations.map((s) => s.province), ['ชัยนาท', 'นนทบุรี']); // เรียงเหนือ→ใต้, ตัดคลองออก
  assert.equal(r.front.overflow.name, 'สะพานนวลฉวี');
  assert.equal(r.damRelease.flow, 2500);
});
