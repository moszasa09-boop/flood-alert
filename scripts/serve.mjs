// เซิร์ฟเวอร์ทดสอบบนเครื่อง (ไม่ต้องติดตั้งอะไรเพิ่ม): npm run serve → http://localhost:5173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw Object.assign(new Error('forbidden'), { code: 'ENOENT' });
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ไม่พบไฟล์');
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`มีเซิร์ฟเวอร์เปิดอยู่ที่พอร์ต ${PORT} แล้ว → เปิด http://localhost:${PORT} ในเบราว์เซอร์ได้เลย`);
    console.log(`(ถ้าต้องการเปิดพอร์ตอื่น: PORT=5174 npm run serve)`);
    process.exit(0);
  }
  throw err;
}).listen(PORT, () => console.log(`เปิดเว็บแอปที่ http://localhost:${PORT}`));
