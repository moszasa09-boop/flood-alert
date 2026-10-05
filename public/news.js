// แท็บ "ข่าว": ข่าวน้ำท่วมแบบใกล้เวลาจริง (ระบบดึงทุก 15 นาที) + แหล่งติดตามแนะนำ
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m} นาทีที่แล้ว`;
  if (m < 48 * 60) return `${Math.round(m / 60)} ชม.ที่แล้ว`;
  return `${Math.round(m / 1440)} วันที่แล้ว`;
};
const hm = (t) => new Date(t).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const CATS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'home', label: '🏠 ใกล้บ้าน' },
  { id: 'north', label: '🌊 น้ำเหนือ/ป่าสัก' },
  { id: 'bkk', label: '🏙️ กรุงเทพฯ' },
  { id: 'weather', label: '🌧️ เตือนภัยอากาศ' },
];
const NEWS_STALE_MIN = 90;

// แหล่งติดตามแนะนำ (ตรวจแล้วว่าเปิดได้ 6 ต.ค. 2569)
const FOLLOW = [
  { group: 'หน่วยงานทางการ (ประกาศเตือนภัยจริง)', items: [
    ['กรมอุตุนิยมวิทยา — ประกาศเตือนภัย', 'https://www.tmd.go.th/warning-and-events/warning-storm', 'ฝนตกหนัก พายุ ประกาศฉบับล่าสุด'],
    ['สำนักการระบายน้ำ กทม. — ระดับน้ำ/เรดาร์', 'https://weather.bangkok.go.th/', 'ข้อมูลคลองและเรดาร์หนองจอก'],
    ['กรุงเทพมหานคร — ข่าวประชาสัมพันธ์', 'https://www.prbangkok.com/', 'ประกาศของ กทม.'],
    ['กรมป้องกันและบรรเทาสาธารณภัย (ปภ.)', 'https://www.disaster.go.th/', 'สถานการณ์ภัยทั่วประเทศ · สายด่วน 1784'],
    ['สำนักงานทรัพยากรน้ำแห่งชาติ (สทนช.)', 'https://www.onwr.go.th/', 'ประกาศเตือนน้ำหลาก/น้ำล้นตลิ่ง'],
    ['กรมชลประทาน — ศูนย์ปฏิบัติการน้ำอัจฉริยะ', 'https://wmsc.rid.go.th/', 'การระบายน้ำเขื่อน/ประตูน้ำ'],
  ] },
  { group: 'ข้อมูลน้ำ/สรุปสถานการณ์', items: [
    ['ThaiWater (สสน.)', 'https://www.thaiwater.net/', 'ระดับน้ำ ฝน เขื่อน ทั่วประเทศ'],
    ['POPNIX Flood — ข่าวน้ำเช้านี้', 'https://flood.pop.in.th/brief/', 'สรุปสถานการณ์น้ำ กทม. รายวัน'],
  ] },
  { group: 'สื่อ/จราจร (อัปเดตเร็ว)', items: [
    ['สวพ.FM91', 'https://www.fm91bkk.com/', 'จราจรและน้ำท่วมถนนแบบสด'],
    ['JS100', 'https://www.js100.com/', 'จราจร เหตุด่วน'],
    ['Thai PBS News', 'https://www.thaipbs.or.th/news', 'ข่าวภัยพิบัติ'],
    ['Traffy Fondue', 'https://www.traffy.in.th/', 'แจ้งปัญหาน้ำท่วม/ท่อตันถึง กทม.'],
  ] },
];
const FB_PAGES = 'ศูนย์ป้องกันวิกฤติน้ำ กรุงเทพมหานคร · กรมอุตุนิยมวิทยา · สทนช. · ปภ. · สวพ.FM91 · JS100';

let currentCat = 'all';

export function renderNews(news) {
  const box = document.querySelector('#news-body');
  if (!box) return;
  const items = news?.items || [];
  const fresh = news?.fetchedAt && Date.now() - news.fetchedAt <= NEWS_STALE_MIN * 60000;
  const list = items.filter((n) => currentCat === 'all' || n.cat === currentCat).sort((a, b) => b.time - a.time);
  const urgentHome = items.filter((n) => n.cat === 'home' && n.urgent).length;

  box.innerHTML = `
    <div class="glass card news-head">
      <div class="news-live ${fresh ? '' : 'is-stale'}"><span class="db-dot"></span>${fresh ? 'อัปเดตอัตโนมัติทุก 15 นาที' : 'ข่าวไม่อัปเดต'}${news?.fetchedAt ? ` · ล่าสุด ${hm(news.fetchedAt)}` : ''}</div>
      <h2>📰 ข่าวน้ำท่วม</h2>
      <p class="muted small">รวมข่าวจากหลายสำนักผ่าน Google News · ระบบคัดตามหมวด${urgentHome ? ` · <b class="news-urgent-count">⚠️ ข่าวด่วนใกล้บ้าน ${urgentHome} ข่าว</b>` : ''}</p>
      <div class="news-chips">${CATS.map((c) => `<button class="news-chip ${c.id === currentCat ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>`).join('')}</div>
    </div>
    <div class="news-list">
      ${list.length ? list.map((n) => `
        <a class="news-item glass ${n.urgent ? 'urgent' : ''}" href="${esc(n.link)}" target="_blank" rel="noopener">
          <div class="news-meta">${n.urgent ? '<span class="news-tag">⚠️ ด่วน</span>' : ''}<span class="news-cat">${esc(n.catLabel)}</span><span>${esc(n.source)}</span><span>· ${ago(n.time)}</span></div>
          <div class="news-title">${esc(n.title)}</div>
        </a>`).join('') : `<div class="glass card muted small">${items.length ? 'ไม่มีข่าวในหมวดนี้ช่วงนี้' : 'ยังไม่มีข่าว — ระบบจะดึงในรอบถัดไป'}</div>`}
    </div>
    <div class="glass card">
      <h2>⭐ แหล่งติดตามแนะนำ</h2>
      ${FOLLOW.map((g) => `<h3 class="muted">${esc(g.group)}</h3><div class="follow-list">${g.items.map(([name, url, note]) => `
        <a class="follow-item" href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(name)}</b><span class="muted small">${esc(note)}</span></a>`).join('')}</div>`).join('')}
      <p class="muted small">เพจ Facebook ที่ควรกดติดตาม (ระบบดึงจาก Facebook อัตโนมัติไม่ได้ — ค้นชื่อในแอป Facebook): ${esc(FB_PAGES)}</p>
    </div>
    <p class="hint">ข่าวเป็นของแต่ละสำนัก ระบบไม่ได้ตรวจสอบเนื้อหา · ประกาศทางการให้ยึดตาม กทม. / กรมอุตุฯ / ปภ.</p>`;

  box.querySelectorAll('.news-chip').forEach((b) => b.addEventListener('click', () => { currentCat = b.dataset.cat; renderNews(news); }));
}
