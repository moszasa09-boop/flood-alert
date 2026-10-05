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
// lat/lon ของสถานี กทม. ใช้จับคู่กับ POPNIX (แหล่งสำรอง) ตามตำแหน่ง
// code/bank ใช้จับคู่กับ ThaiWater canal_waterlevel (แหล่งสำรองชั้นที่ 3) — ใช้ระดับตลิ่งของ กทม. เพราะ ThaiWater ใช้ค่าตลิ่งต่างกัน
export const NODES = [
  {
    id: 'rangsit', name: 'คลองรังสิต · ระพีพัฒน์', role: 'up', note: 'ต้นน้ำไกล (ปทุมธานี)',
    stations: [
      { src: 'tw', id: 36 },
      { src: 'tw', id: 29 },
      { src: 'bma', id: 303, lat: 13.96807, lon: 100.5535, name: 'คลองรังสิตประยูรศักดิ์ ตอนสถานีสูบน้ำปากคลองรังสิต*', code: 'WL.RPS.01' },
    ],
  },
  {
    id: 'hokwa', name: 'คลองหกวาสายล่าง', role: 'up', note: 'ต้นน้ำใกล้ (รอยต่อ กทม./ปทุมฯ)',
    stations: [
      { src: 'tw', id: 37 },
      { src: 'bma', id: 327, lat: 13.93354, lon: 100.7506, name: 'สถานีสูบน้ำกลางคลองหกวา ตอนถนนนิมิตใหม่*', code: 'WL.KHW.01' },
      { src: 'bma', id: 318, lat: 13.95869, lon: 100.8942, name: 'คลองสิบสาม ตอนสถานีสูบน้ำกลางคลองหกวาสายล่าง*', code: 'WL.SSM.02' },
    ],
  },
  {
    id: 'samwa', name: 'ต้นน้ำใกล้บ้าน · ปตร.พระยาสุเรนทร์', role: 'up', note: 'เหนือบ้าน 2–7 กม.',
    stations: [
      // ThaiWater: แนวคลองหกวาสายล่างตอนปากคลองสอง (สายไหม) — มีข้อมูลบนเว็บตลอด (สถานี กทม. 2 ตัวล่างดึงบน GitHub ไม่ได้)
      { src: 'tw', id: 8 },
      { src: 'bma', id: 20, lat: 13.92128, lon: 100.68731, name: 'ปตร.คลองพระยาสุเรนทร์', code: 'WL.PSR.01', bank: 1.4 },
      { src: 'bma', id: 325, lat: 13.92929, lon: 100.7259, name: 'คลองสามวา ตอนถนนเทศบาลลำลูกกา1*', code: 'WL.SWA.02' },
    ],
  },
  {
    id: 'home', name: 'บ้าน · คลองหนองระแหง', role: 'home', note: 'สถานีหลัก ห่างบ้าน 1 กม. (+ สำรอง ถ.จตุโชติ)',
    stations: [
      { src: 'bma', id: 126, primary: true, lat: 13.90121, lon: 100.69049, name: 'ค.พระยาสุเรนทร์ ถ.หนองระแหง', code: 'WL.PSR.02', bank: 1.6 },
      { src: 'bma', id: 125, lat: 13.87621, lon: 100.68614, name: 'ค.พระยาสุเรนทร์ ถ.จตุโชติ', code: 'WL.PSR.03', bank: 1.5 }, // คลองเดียวกัน ใต้บ้าน 4 กม. — สำรองเมื่อ 126 ไม่มีข้อมูล (POPNIX ไม่มี 126)
    ],
  },
  {
    id: 'bangchan', name: 'คลองพระยาสุเรนทร์ · บางชัน', role: 'down', note: 'ทางระบายใต้บ้าน 7–12 กม.',
    stations: [
      { src: 'bma', id: 124, lat: 13.85077, lon: 100.67829, name: 'ปตร.พระยาสุเรนทร์ ตอนคู้บอน', code: 'WL.PSR.04', bank: 1.75 },
      { src: 'bma', id: 127, lat: 13.83698, lon: 100.68803, name: 'ค.พระยาสุเรนทร์ ปัญญาอินทรา', code: 'WL.PSR.05', bank: 1.3 },
      { src: 'bma', id: 128, lat: 13.80274, lon: 100.70165, name: 'ค.พระยาสุเรนทร์ บางชัน', code: 'WL.PSR.06', bank: 1.1 },
      { src: 'bma', id: 21, lat: 13.85956, lon: 100.72931, name: 'ปตร.คลองสามวา', code: 'WL.SWA.01', bank: 1.3 },
    ],
  },
  {
    id: 'saensaep', name: 'คลองแสนแสบ', role: 'down', note: 'ทางระบายหลัก',
    stations: [
      { src: 'bma', id: 51, lat: 13.85537, lon: 100.8721, name: 'ส.คลองแสนแสบ หนองจอก', code: 'WL.SSB.12', bank: 1.75 },
      { src: 'bma', id: 25, lat: 13.82094, lon: 100.74738, name: 'ปตร.คลองแสนแสบ-ถ.ประชาร่วมใจ', code: 'WL.SSB.10', bank: 0.95 },
      { src: 'bma', id: 35, lat: 13.76509, lon: 100.64791, name: 'ค.แสนแสบ-สนข.บางกะปิ', code: 'WL.SSB.07', bank: 0.75 },
    ],
  },
  {
    id: 'prawet', name: 'คลองประเวศบุรีรมย์', role: 'down', note: 'ไปสถานีสูบน้ำ → ทะเล',
    stations: [{ src: 'bma', id: 39, lat: 13.72411, lon: 100.74987, name: 'ปตร.คลองประเวศฯ-ลาดกระบัง', code: 'WL.PWT.04', bank: 1.98 }],
  },
];

export const SOURCES = {
  bmaAll: 'https://weather.bangkok.go.th/water/PageMap/GoogleMap',
  bmaDetail: (id) => `https://weather.bangkok.go.th/water/StationDetail?id=${id}`,
  thaiwater: 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load',
  openmeteo: 'https://api.open-meteo.com/v1/forecast',
  popnix: 'https://flood.pop.in.th',
  twCanal: 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/canal_waterlevel',
};

// พยากรณ์ฝนรายวัน ≥ ค่านี้ (มม.) ใน 2 วันข้างหน้า = เฝ้าระวัง (เกณฑ์ "ฝนหนัก" ของกรมอุตุฯ คือ 35.1 มม./วัน)
export const HEAVY_RAIN_MM = 35;
