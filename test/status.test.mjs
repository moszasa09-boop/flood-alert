import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationStatus, overallStatus, risingRate, worst } from '../src/status.mjs';
import { parseBmaDetailSeries, parseDotNetDate, normalizeBma } from '../src/sources/bma.mjs';
import { parseThaiTime } from '../src/sources/thaiwater.mjs';

const NOW = Date.UTC(2026, 9, 3, 11, 30);
const fresh = (wl, bank) => ({ wl, bank, time: NOW - 5 * 60000 });

test('สถานะสถานีตามระยะห่างจากตลิ่ง', () => {
  assert.equal(stationStatus(fresh(1.0, 2.0), 0, 90, NOW).status, 'green');
  assert.equal(stationStatus(fresh(1.32, 1.6), -0.01, 90, NOW).status, 'yellow'); // ค่าจริง 3 ต.ค.
  assert.equal(stationStatus(fresh(1.32, 1.6), 0.03, 90, NOW).status, 'orange'); // ใกล้ + กำลังขึ้น
  assert.equal(stationStatus(fresh(1.45, 1.6), 0, 90, NOW).status, 'orange');
  assert.equal(stationStatus(fresh(1.6, 1.6), 0, 90, NOW).status, 'red');
  assert.equal(stationStatus(fresh(1.0, 2.0), 0.06, 90, NOW).status, 'yellow'); // ขึ้นเร็ว
});

test('ข้อมูลเก่า/ไม่มีข้อมูล ไม่ถูกนับเป็นปลอดภัย', () => {
  assert.equal(stationStatus({ wl: 1, bank: 2, time: NOW - 3 * 3600e3 }, 0, 90, NOW).status, 'stale');
  assert.equal(stationStatus({ wl: null, bank: 2, time: NOW }, 0, 90, NOW).status, 'unknown');
  assert.equal(worst(['stale', 'unknown']), 'unknown');
  assert.equal(worst(['stale', 'green', 'yellow']), 'yellow');
});

test('อัตราขึ้น-ลง', () => {
  const h = [];
  for (let i = 0; i <= 36; i++) h.push([NOW - (36 - i) * 5 * 60000, 1.0 + i * 0.005]); // ขึ้น 6 ซม./ชม.
  assert.ok(Math.abs(risingRate(h) - 0.06) < 1e-9);
  assert.equal(risingRate(h.slice(-3)), null); // ข้อมูลสั้นเกิน
});

test('สถานะรวม', () => {
  assert.equal(overallStatus({ up: 'green', home: 'green', down: 'green' }).status, 'green');
  assert.equal(overallStatus({ up: 'orange', home: 'green', down: 'green' }).status, 'yellow');
  assert.equal(overallStatus({ up: 'orange', home: 'green', down: 'red' }).status, 'orange');
  // แดงต้องเห็นติดกัน 2 รอบ
  const first = overallStatus({ up: 'green', home: 'red', down: 'green' }, false);
  assert.equal(first.status, 'orange');
  assert.equal(first.candidateRed, true);
  assert.equal(overallStatus({ up: 'green', home: 'red', down: 'green' }, true).status, 'red');
  // ไม่มีข้อมูลบ้าน = unknown ไม่ใช่เขียว
  assert.equal(overallStatus({ up: 'green', home: 'stale', down: 'green' }).status, 'unknown');
});

test('แปลงเวลา', () => {
  assert.equal(parseDotNetDate('/Date(1791026400000)/'), 1791026400000);
  assert.equal(parseThaiTime('2026-10-03 18:00'), Date.UTC(2026, 9, 3, 11, 0));
});

test('อ่านกราฟจากหน้า กทม. เฉพาะน้ำด้านใน', () => {
  const html = `series: [ { type: 'spline', name: series1, data: [
    [Date.UTC(2026, 9, 3, 18, 15, 0),0.91] , [Date.UTC(2026, 9, 3, 18, 20, 0),null] , [Date.UTC(2026, 9, 3, 18, 25, 0),0.90]
    ],tooltip: {} } , { type: 'spline', name: wl_out, data: [ [Date.UTC(2026, 9, 3, 18, 25, 0),1.36] ] } ]`;
  const s = parseBmaDetailSeries(html);
  assert.deepEqual(s, [
    [Date.UTC(2026, 9, 3, 11, 15), 0.91],
    [Date.UTC(2026, 9, 3, 11, 25), 0.9],
  ]);
});

test('ประตูน้ำ: ใช้น้ำด้านในเทียบตลิ่ง', () => {
  const s = normalizeBma({ water_id: 21, wl_in: 0.9, wl_out01: 1.36, left_bank: 1.3, right_bank: 1.7, site_timestamp: '/Date(1)/' });
  assert.equal(s.wl, 0.9);
  assert.equal(s.wlOut, 1.36);
  assert.equal(s.bank, 1.3);
  assert.equal(normalizeBma({ water_id: 23, wl_in: -99, wl_out01: 0.04 }).wl, 0.04);
});

test('ระยะห่างตลิ่งปัดเป็น ซม. (1.5-1.3 ต้องได้ 20 ซม. = เหลือง ไม่ใช่ส้ม)', () => {
  assert.equal(stationStatus(fresh(1.3, 1.5), 0, 90, NOW).status, 'yellow');
});

test('พยากรณ์ฝนหนัก → อย่างน้อยเหลือง', () => {
  const g = { up: 'green', home: 'green', down: 'green' };
  assert.equal(overallStatus(g, false, { heavy: true, mm: 52 }).status, 'yellow');
  assert.equal(overallStatus(g, false, { heavy: false, mm: 10 }).status, 'green');
  assert.equal(overallStatus(g, false, null).status, 'green');
});
