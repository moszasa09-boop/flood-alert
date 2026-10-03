// ตัวตรวจความสดของหน้าเว็บ (public/fresh.js) — เกณฑ์รับงานจากรายงานทดสอบซ้ำ 4 ต.ค. (P1-01, P1-02, P1-03)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riverView, rainView, radarView, riverStatus } from '../public/fresh.js';

const NOW = Date.UTC(2026, 9, 4, 13, 30);
const H = 3600e3;

test('P1-01: แม่น้ำทุกสถานีเก่า 24 ชม. (แม้ไฟล์ใหม่) → เทา ไม่มีจุดล้น ไม่มีสถานีสด', () => {
  const river = {
    stations: [{ code: '80', name: 'ธรรมจักร', diff: 1.2, time: NOW - 24 * H, status: 'red' }, { code: '49', name: 'บางปะอิน', diff: 0.7, time: NOW - 24 * H, status: 'red' }],
    front: { overflow: { name: 'บางปะอิน' }, overflowCount: 2 }, // ค่าเก่าที่ฝังมากับไฟล์ ต้องไม่ถูกใช้
    damRelease: { flow: 2500, time: NOW - 24 * H },
  };
  const v = riverView(river, NOW);
  assert.deepEqual(v.stations.map((s) => s.status), ['stale', 'stale']);
  assert.equal(v.front.overflow, null);
  assert.equal(v.liveCount, 0);
  assert.equal(v.dam.fresh, false);
});

test('P1-01: all-unknown → ไม่มีสถานีสด (หน้าเว็บต้องขึ้น "ไม่พร้อม" ไม่ใช่ "ปกติ")', () => {
  const v = riverView({ stations: [{ code: '1', diff: null, time: NOW }, { code: '2', diff: NaN, time: NOW }] }, NOW);
  assert.equal(v.liveCount, 0);
  assert.deepEqual(v.stations.map((s) => s.status), ['unknown', 'unknown']);
});

test('P1-01: สถานีสดยังคิดจุดล้นได้ปกติ และข้ามสถานีเก่า', () => {
  const v = riverView({ stations: [
    { code: 'a', name: 'ชัยนาท', diff: 1.2, time: NOW - 20 * 60000 },
    { code: 'b', name: 'อยุธยา', diff: 0.5, time: NOW - 30 * H },   // เก่า → ข้าม
    { code: 'c', name: 'นนทบุรี', diff: -0.5, time: NOW - 20 * 60000 },
  ] }, NOW);
  assert.equal(v.front.overflow.name, 'ชัยนาท');
  assert.equal(v.liveCount, 2);
});

test('P1-03 (หน้าเว็บ): NaN / Infinity / เวลาอนาคต → unknown', () => {
  assert.equal(riverStatus(NaN, NOW, NOW), 'unknown');
  assert.equal(riverStatus(Infinity, NOW, NOW), 'unknown');
  assert.equal(riverStatus(-2, NOW + H, NOW), 'unknown');
  assert.equal(riverStatus(-2, null, NOW), 'unknown');
});

test('P1-02: พยากรณ์ล่ม / ว่าง / หมดอายุ → ไม่ ok · สำเร็จและไม่มีฝน → ok + window null', () => {
  assert.equal(rainView({ ok: false, window: null }, NOW).ok, false);                       // ดึงไม่ได้
  assert.equal(rainView(null, NOW).ok, false);                                                // ไม่มีข้อมูลเลย
  assert.equal(rainView({ ok: true, fetchedAt: null, window: null }, NOW).ok, false);        // ไม่มีเวลา
  assert.equal(rainView({ ok: true, fetchedAt: NOW - 5 * H, window: null }, NOW).ok, false); // หมดอายุ
  const fine = rainView({ ok: true, fetchedAt: NOW - 10 * 60000, window: null }, NOW);       // สำเร็จ ไม่มีฝน
  assert.equal(fine.ok, true);
  assert.equal(fine.window, null);
});

test('เรดาร์: เก่าเกิน 40 นาทีถือว่าไม่พร้อม', () => {
  assert.equal(radarView({ time: NOW - 60 * 60000, atHome: 3 }, NOW), null);
  assert.equal(radarView({ time: NOW - 10 * 60000, atHome: 3 }, NOW).atHome, 3);
  assert.equal(radarView(null, NOW), null);
});

// regression: หน้าสรุปทั้งหน้า (render จริงด้วย DOM จำลอง) ต้องไม่มีคำว่า "ปกติ"/"ไม่มีฝน" เมื่อข้อมูลแม่น้ำเก่าและพยากรณ์ล่ม
test('หน้าสรุป: แม่น้ำเก่า + พยากรณ์ล่ม → ไม่แสดงเหมือนสถานการณ์ปกติ', async () => {
  const box = { innerHTML: '', querySelector: () => null };
  globalThis.document = { querySelector: (sel) => (sel === '#dash-body' ? box : null) };
  const { renderDashboard } = await import('../public/dashboard.js');
  const now = Date.now();
  renderDashboard({
    generatedAt: now, sources: { bma: { ok: false }, tw: { ok: false }, rain: { ok: false } },
    overall: { status: 'yellow', reasons: [] },
    nodes: [{ id: 'home', role: 'home', name: 'บ้าน', status: 'yellow', stations: [{ key: 'k', name: 'ถ.จตุโชติ', primary: true, status: 'yellow', wl: 1.3, bank: 1.5, margin: 0.2, rate: 0, time: now - 5 * 60000 }] }],
    river: { stations: [{ code: '80', name: 'ธรรมจักร', diff: 1.2, time: now - 24 * H, status: 'red' }], front: { overflow: { name: 'ธรรมจักร', province: 'ชัยนาท' }, overflowCount: 1 }, damRelease: { flow: 2500, time: now - 24 * H } },
    rain: { ok: false, window: null }, radar: null,
  }, {}, {});
  const html = box.innerHTML;
  assert.match(html, /ไม่มีข้อมูลสด/);
  assert.match(html, /พยากรณ์ไม่พร้อม/);
  assert.match(html, /ใช้ค่าล่าสุด \(รอบนี้ดึงข้อมูลไม่ได้\)/);
  assert.doesNotMatch(html, /ยังไม่ล้นตลิ่ง/);
  assert.doesNotMatch(html, /ใน 12 ชม\. ข้างหน้า/);
  delete globalThis.document;
});
