// Service worker: เปิดแอปได้แม้เน็ตหลุด (แสดงข้อมูลล่าสุดที่เคยโหลด)
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'rain.js', 'rain-core.js', 'river.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ข้อมูลระดับน้ำ: เอาของใหม่จากเน็ตก่อน ถ้าไม่ได้ค่อยใช้ของเก่า
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    const key = url.origin + url.pathname; // ตัด ?t= ออก
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(RUNTIME).then((c) => c.put(key, res.clone()));
        return res;
      }).catch(() => caches.match(key).then((r) => r || Response.error())),
    );
    return;
  }

  // หน้าแอป: ใช้เน็ตก่อน (ได้เวอร์ชันใหม่) ถ้าไม่ได้ใช้แคช
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  // ไลบรารี/ฟอนต์จาก CDN: ใช้แคชก่อน แล้วอัปเดตเบื้องหลัง (ไม่แคชภาพแผนที่ กันพื้นที่เครื่องเต็ม)
  if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }),
    );
  }
});

// แตะแจ้งเตือน → เปิดแอป
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
