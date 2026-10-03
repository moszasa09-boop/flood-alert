// ค่าตั้งค่าหลักของระบบ — แก้ที่ไฟล์นี้ไฟล์เดียว

export const HOME = {
  // พิกัดปัดเป็นทศนิยม 2 ตำแหน่ง (คลาดราว 1 กม.) เพราะโค้ดและเว็บเป็นสาธารณะ
  // ละเอียดพอสำหรับเลือกสถานี (ห่าง ~1 กม.) และเรดาร์ (ละเอียด ~1.2 กม.)
  name: 'บ้าน · เขตคลองสามวา',
  lat: 13.91,
  lon: 100.70,
};

// เกณฑ์สถานะของแต่ละสถานี (หน่วยเมตร / เมตรต่อชั่วโมง)
export const THRESHOLDS = {
  orangeMargin: 0.2,   // เหลือถึงตลิ่งน้อยกว่านี้ = ส้ม
  watchMargin: 0.5,    // เหลือถึงตลิ่งน้อยกว่านี้ = เหลือง (หรือส้มถ้ากำลังขึ้น)
  risingRate: 0.02,    // ขึ้นเร็วกว่านี้ถือว่า "กำลังขึ้น"
  fastRate: 0.05,      // ขึ้นเร็วกว่านี้ = เหลือง แม้ยังห่างตลิ่ง
  rateWindowH: 3,      // คิดอัตราขึ้น-ลงจากช่วงกี่ชั่วโมงล่าสุด
};

// ข้อมูลเก่ากว่านี้ (นาที) ถือว่า "ขัดข้อง" ไม่เอามาตัดสินสถานะ
export const STALE_MIN = { bma: 90, thaiwater: 180 };

export const HISTORY_HOURS = 48;

// แผนผังสายน้ำ (บนลงล่าง) — role: up = ต้นน้ำ, home = บ้าน, down = ทางระบาย
// สถานี: src 'bma' = สำนักการระบายน้ำ กทม. (water_id), 'tw' = ThaiWater (station.id)
export const NODES = [
  {
    id: 'rangsit', name: 'คลองรังสิต · ระพีพัฒน์', role: 'up', note: 'ต้นน้ำไกล (ปทุมธานี)',
    stations: [
      { src: 'tw', id: 36 },
      { src: 'tw', id: 29 },
      { src: 'bma', id: 303 },
    ],
  },
  {
    id: 'hokwa', name: 'คลองหกวาสายล่าง', role: 'up', note: 'ต้นน้ำใกล้ (รอยต่อ กทม./ปทุมฯ)',
    stations: [
      { src: 'tw', id: 37 },
      { src: 'bma', id: 327 },
      { src: 'bma', id: 318 },
    ],
  },
  {
    id: 'samwa', name: 'คลองสามวา · ปตร.พระยาสุเรนทร์', role: 'up', note: 'เหนือบ้าน 2–4 กม.',
    stations: [
      { src: 'bma', id: 20 },
      { src: 'bma', id: 325 },
    ],
  },
  {
    id: 'home', name: 'บ้าน · คลองหนองระแหง', role: 'home', note: 'สถานีหลัก ห่างบ้าน 1 กม.',
    stations: [
      { src: 'bma', id: 126, primary: true },
    ],
  },
  {
    id: 'bangchan', name: 'คลองพระยาสุเรนทร์ · บางชัน', role: 'down', note: 'ทางระบายใต้บ้าน 4–12 กม.',
    stations: [
      { src: 'bma', id: 125 },
      { src: 'bma', id: 124 },
      { src: 'bma', id: 127 },
      { src: 'bma', id: 128 },
      { src: 'bma', id: 21 },
    ],
  },
  {
    id: 'saensaep', name: 'คลองแสนแสบ', role: 'down', note: 'ทางระบายหลัก',
    stations: [
      { src: 'bma', id: 51 },
      { src: 'bma', id: 25 },
      { src: 'bma', id: 35 },
    ],
  },
  {
    id: 'prawet', name: 'คลองประเวศบุรีรมย์', role: 'down', note: 'ไปสถานีสูบน้ำ → ทะเล',
    stations: [{ src: 'bma', id: 39 }],
  },
];

export const SOURCES = {
  bmaAll: 'https://weather.bangkok.go.th/water/PageMap/GoogleMap',
  bmaDetail: (id) => `https://weather.bangkok.go.th/water/StationDetail?id=${id}`,
  thaiwater: 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load',
  openmeteo: 'https://api.open-meteo.com/v1/forecast',
};

// พยากรณ์ฝนรายวัน ≥ ค่านี้ (มม.) ใน 2 วันข้างหน้า = เฝ้าระวัง (เกณฑ์ "ฝนหนัก" ของกรมอุตุฯ คือ 35.1 มม./วัน)
export const HEAVY_RAIN_MM = 35;
