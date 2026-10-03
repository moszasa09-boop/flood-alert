import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riverStatus, riverFront, normalizeRiver, refreshRiver } from '../src/sources/river.mjs';

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

test('P1-03: ค่าเพี้ยน/เวลาอนาคต → unknown ไม่ใช่เขียว', () => {
  assert.equal(riverStatus(NaN, 0), 'unknown');
  assert.equal(riverStatus(Infinity, 0), 'unknown');
  assert.equal(riverStatus(-2, -60), 'unknown');  // เวลาจากอนาคต 60 นาที
  assert.equal(riverStatus(-2, null), 'unknown'); // ไม่มีเวลา
  const now = Date.UTC(2026, 9, 3, 13, 30);
  const r = normalizeRiver({ stations: [
    { code: '1', name: 'a', river: 'แม่น้ำเจ้าพระยา', order: 1, wl: 'abc', bank: 2, diff: 'x', measured_at: '2026-10-03 20:10:00' },
    { code: '2', name: 'b', river: 'แม่น้ำเจ้าพระยา', order: 2, wl: 3, bank: 2.5, diff: null, measured_at: 'bad' },
  ] }, now);
  assert.deepEqual(r.stations.map((s) => s.status), ['unknown', 'unknown']);
  assert.equal(r.stations[0].wl, null); // ไม่มี NaN ลง JSON
  assert.equal(r.front.overflow, null);
  assert.equal(JSON.stringify(r).includes('NaN'), false);
});

test('P1-01: ข้อมูลแม่น้ำที่ยกมาจากรอบก่อน (เก่า 24 ชม.) ต้องเป็น stale และไม่มีจุดล้น', () => {
  const now = Date.UTC(2026, 9, 4, 13, 30);
  const old = now - 24 * 3600e3;
  const prev = { stations: [{ code: '80', name: 'ธรรมจักร', diff: 1.2, time: old, status: 'red' }, { code: '26', name: 'นวลฉวี', diff: 0.04, time: old, status: 'red' }],
    front: { overflow: { name: 'นวลฉวี' }, overflowCount: 2 }, damRelease: { flow: 2500, time: old } };
  const r = refreshRiver(prev, now);
  assert.deepEqual(r.stations.map((s) => s.status), ['stale', 'stale']);
  assert.equal(r.front.overflow, null);
  assert.equal(r.liveCount, 0);
  assert.equal(r.damRelease.stale, true);
});
