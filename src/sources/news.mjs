// ข่าวน้ำท่วมแบบใกล้เวลาจริง (อัปเดตทุกรอบ 15 นาที) จาก Google News RSS (รวมข่าวจากทุกสำนัก)
// เพจ Facebook ดึงอัตโนมัติไม่ได้ → ทำเป็นลิงก์แนะนำในหน้าเว็บแทน
import { fetchWithRetry } from './http.mjs';

const GN = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=th&gl=TH&ceid=TH:th`;

// หมวดข่าว (ค้นทีละหมวด เรียงจากใกล้บ้าน → ภาพรวม)
export const NEWS_QUERIES = [
  { cat: 'home', label: 'ใกล้บ้าน', q: '(คลองสามวา OR มีนบุรี OR หนองจอก OR ลาดกระบัง OR บางชัน OR ลำลูกกา OR สายไหม OR รามอินทรา) (น้ำ OR ฝน OR ท่วม) when:3d' },
  { cat: 'north', label: 'น้ำเหนือ/ป่าสัก', q: '(ป่าสัก OR เขื่อนพระรามหก OR ระพีพัฒน์ OR เขื่อนเจ้าพระยา OR "น้ำเหนือ" OR รังสิต) (น้ำ OR ระบาย OR ท่วม) when:2d' },
  { cat: 'bkk', label: 'กรุงเทพฯ', q: 'น้ำท่วม (กรุงเทพ OR กทม.) when:1d' },
  { cat: 'weather', label: 'เตือนภัยอากาศ', q: '(กรมอุตุนิยมวิทยา OR กรมอุตุฯ) (เตือน OR ฝนตกหนัก OR พายุ) when:2d' },
];

// คำที่บ่งบอกว่าเป็นเรื่องเร่งด่วน (ใช้ทำป้าย และแจ้งเตือนเฉพาะข่าว "ใกล้บ้าน")
export const URGENT = /(อพยพ|เร่งด่วน|ประกาศเตือน|เตือนภัย|ระดับน้ำสูง|ล้นตลิ่ง|น้ำทะลัก|คันกั้นน้ำ|แตก|วิกฤต|ปิดถนน|ท่วมสูง)/;

// ถอดรหัสอักขระ HTML — บางแหล่งเข้ารหัสซ้อน 2 ชั้น (&amp;amp;) จึงถอดซ้ำจนคงที่
const decode = (s) => { let a = decode1(s), b = decode1(a); while (a !== b) { a = b; b = decode1(b); } return b; };
const decode1 = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&')
  .trim();

// แปลง RSS → [{ title, link, source, time }]
export function parseRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const get = (tag) => decode((it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]);
    const source = get('source');
    let title = get('title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)); // ตัดชื่อสำนักท้ายหัวข้อ
    const bar = title.indexOf(' | ', 25);
    if (bar > 0) title = title.slice(0, bar); // ตัดส่วนท้ายแบบ "| 5 ต.ค. 69 | ไทยรัฐ"
    const link = get('link');
    const time = Date.parse(get('pubDate'));
    if (!title || !/^https?:\/\//.test(link) || !Number.isFinite(time)) continue;
    out.push({ title, link, source: source || '', time });
  }
  return out;
}

const norm = (t) => t.replace(/[\s"'“”‘’.,:;!?()\-–—|]/g, '').slice(0, 60);

// รวมทุกหมวด: ตัดข่าวซ้ำ (หัวข้อเดียวกัน) · ตัดข่าวเก่า · ใส่ป้ายเร่งด่วน · จำกัดจำนวน
export function mergeNews(groups, now = Date.now(), { maxAgeH = 72, perCat = 12 } = {}) {
  const seen = new Set();
  const items = [];
  for (const { cat, label, items: list } of groups) {
    let n = 0;
    for (const it of [...list].sort((a, b) => b.time - a.time)) {
      if (now - it.time > maxAgeH * 3600e3 || it.time > now + 3600e3) continue;
      const k = norm(it.title);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ ...it, cat, catLabel: label, urgent: URGENT.test(it.title) });
      if (++n >= perCat) break;
    }
  }
  return items;
}

export async function fetchNews(now = Date.now()) {
  const groups = [];
  let ok = 0;
  for (const g of NEWS_QUERIES) {
    try {
      const res = await fetchWithRetry(GN(g.q), { headers: { Accept: 'application/rss+xml' } }, { tries: 2, timeoutMs: 20000 });
      groups.push({ ...g, items: parseRss(await res.text()) });
      ok++;
    } catch {
      groups.push({ ...g, items: [] });
    }
    await new Promise((r) => setTimeout(r, 400)); // สุภาพกับผู้ให้บริการ
  }
  if (!ok) throw new Error('ดึงข่าวไม่ได้');
  return { items: mergeNews(groups, now), fetchedAt: now, ok: ok === NEWS_QUERIES.length };
}
