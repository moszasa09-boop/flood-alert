import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPixel, denoise, analyze, approach, firstRainWindow, pxKm, lonLatToPixel, dirName } from '../public/rain-core.js';

test('แปลงสีเรดาร์เป็นระดับฝน (ค่าสีจริงจาก RainViewer)', () => {
  assert.equal(classifyPixel(0, 0, 0, 0), 0);
  assert.equal(classifyPixel(206, 192, 134, 150), 1);
  assert.equal(classifyPixel(136, 221, 238, 255), 2);
  assert.equal(classifyPixel(0, 119, 170, 255), 3);
  assert.equal(classifyPixel(255, 238, 0, 255), 4);
  assert.equal(classifyPixel(255, 170, 0, 255), 4);
  assert.equal(classifyPixel(255, 0, 0, 255), 5);
});

test('หากลุ่มฝนใกล้สุด', () => {
  const km = 1;
  // ฝนปานกลางที่ห่างไปทางตะวันออก 10 พิกเซล
  const levelAt = (x, y) => (x === 110 && y === 100 ? 3 : 0);
  const r = analyze(levelAt, 100, 100, km, 50);
  assert.equal(r.atHome, 0);
  assert.equal(Math.round(r.nearest.km), 10);
  assert.equal(dirName(r.nearest.bearing), 'ตะวันออก');
  assert.equal(r.maxNear, 3);
  // ฝนเหนือบ้าน
  assert.equal(analyze((x, y) => (x === 100 && y === 100 ? 4 : 0), 100, 100, km, 50).atHome, 4);
  // ไม่มีฝน
  assert.equal(analyze(() => 0, 100, 100, km, 50).nearest, null);
});

test('ประมาณการเข้าใกล้', () => {
  const a = approach({ nearest: { km: 30 } }, { nearest: { km: 20 } }, 30); // 20 กม./ชม.
  assert.equal(a.trend, 'closer');
  assert.equal(a.etaMin, 60);
  assert.equal(approach({ nearest: { km: 20 } }, { nearest: { km: 30 } }, 30).trend, 'away');
  assert.equal(approach({ nearest: { km: 20 } }, { nearest: { km: 20.5 } }, 30).trend, 'steady');
  assert.equal(approach(null, { nearest: { km: 5 } }, 30), null);
  // ค่าจริง 4 ต.ค. 02:10: 46 → 11 กม. ใน 30 นาที (= 70 กม./ชม.) = กลุ่มฝนก่อตัวใหม่ ไม่ใช่วิ่งเข้ามา
  assert.deepEqual(approach({ nearest: { km: 46 } }, { nearest: { km: 11 } }, 30), { trend: 'new', speed: null, etaMin: null });
});

test('ช่วงฝนแรกจากพยากรณ์', () => {
  const t = ['00', '01', '02', '03', '04', '05'];
  const r = firstRainWindow(t, [10, 20, 60, 80, 30, 70], [0, 0, 1, 3, 0, 2], 0, 6);
  assert.deepEqual(r, { found: true, start: '02', end: '03', maxProb: 80, totalMm: 4 });
  assert.deepEqual(firstRainWindow(t, [10, 20, 30, 0, 0, 0], [0, 0, 1, 0, 0, 0], 0, 6), { found: false, maxProb: 30 });
});

test('พิกัด → พิกเซล', () => {
  assert.ok(Math.abs(pxKm(7, 13.9) - 1.187) < 0.01);
  const p = lonLatToPixel(100.70, 13.91, 7);
  assert.equal(Math.floor(p.x / 256), 99);
  // บ้านอยู่ชิดขอบบนของไทล์ 59 (y ≈ 59.0) → ต้องโหลดไทล์รอบข้างด้วย
  assert.ok(Math.abs(p.y / 256 - 59) < 0.05);
});

test('ตัดจุดฝนเดี่ยว แต่เก็บกลุ่มฝน', () => {
  const lone = denoise((x, y) => (x === 5 && y === 5 ? 3 : 0));
  assert.equal(lone(5, 5), 0);
  const cell = new Set(['5,5', '6,5', '5,6', '6,6']); // กลุ่ม 2x2 (ขนาดจริงที่เจอ 3 ต.ค.)
  const grp = denoise((x, y) => (cell.has(`${x},${y}`) ? 2 : 0));
  assert.equal(grp(5, 5), 2);
});

import { rainWindowAhead } from '../src/sources/openmeteo.mjs';
test('ช่วงฝนจากพยากรณ์รายชั่วโมง', () => {
  const now = Date.UTC(2026, 9, 3, 5, 30); // 12:30 ไทย
  const h = (hh, mm, prob) => ({ t: Date.UTC(2026, 9, 3, hh - 7, 0), mm, prob });
  const w = rainWindowAhead([h(12, 0, 10), h(14, 1.2, 60), h(15, 6, 80), h(16, 0.6, 55), h(17, 0, 20), h(18, 3, 90)], now);
  assert.equal(w.start, Date.UTC(2026, 9, 3, 7, 0));
  assert.equal(w.end, Date.UTC(2026, 9, 3, 9, 0));
  assert.equal(w.totalMm, 7.8);
  assert.equal(w.peakMm, 6);
  assert.equal(w.maxProb, 80);
  assert.equal(rainWindowAhead([h(14, 5, 30)], now), null);
});
