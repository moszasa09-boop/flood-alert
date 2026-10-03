// อ่านภาพเรดาร์ RainViewer ฝั่ง server (ไม่ใช้ไลบรารีเพิ่ม) แล้ววิเคราะห์ฝนรอบบ้านด้วยตรรกะเดียวกับในแอป
import { inflateSync } from 'node:zlib';
import { HOME } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';
import { classifyPixel, denoise, analyze, approach, pxKm, lonLatToPixel } from '../../public/rain-core.js';

const API = 'https://api.rainviewer.com/public/weather-maps.json';
const Z = 7;

// ถอดรหัส PNG 8 บิต (RGBA / RGB / palette) แบบไม่ interlace → Uint8Array RGBA
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('ไม่ใช่ไฟล์ PNG');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`PNG แบบนี้ยังไม่รองรับ (depth ${depth}, interlace ${interlace})`);
  const bpp = { 6: 4, 2: 3, 3: 1, 0: 1, 4: 2 }[type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0, i = 0; y < h; y++) {
    const f = raw[i++];
    const line = raw.subarray(i, i + stride).slice();
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 6) out.set(line.subarray(x * 4, x * 4 + 4), o);
      else if (type === 2) { out.set(line.subarray(x * 3, x * 3 + 3), o); out[o + 3] = 255; }
      else if (type === 3) {
        const k = line[x];
        out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2];
        out[o + 3] = trns && k < trns.length ? trns[k] : 255;
      } else if (type === 0) { out[o] = out[o + 1] = out[o + 2] = line[x]; out[o + 3] = 255; }
      else if (type === 4) { out[o] = out[o + 1] = out[o + 2] = line[x * 2]; out[o + 3] = line[x * 2 + 1]; }
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

async function loadGrid(host, path) {
  const p = lonLatToPixel(HOME.lon, HOME.lat, Z);
  const tx = Math.floor(p.x / 256), ty = Math.floor(p.y / 256);
  const grid = new Uint8Array(768 * 768 * 4);
  await Promise.all([-1, 0, 1].flatMap((dy) => [-1, 0, 1].map(async (dx) => {
    const res = await fetchWithRetry(`${host}${path}/256/${Z}/${tx + dx}/${ty + dy}/2/0_0.png`, {}, { tries: 2, timeoutMs: 20000 });
    const { w, h, rgba } = decodePng(Buffer.from(await res.arrayBuffer()));
    for (let y = 0; y < h; y++) grid.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), (((dy + 1) * 256 + y) * 768 + (dx + 1) * 256) * 4);
  })));
  const levelAt = (x, y) => {
    if (x < 0 || y < 0 || x >= 768 || y >= 768) return 0;
    const i = (y * 768 + x) * 4;
    return classifyPixel(grid[i], grid[i + 1], grid[i + 2], grid[i + 3]);
  };
  return { levelAt: denoise(levelAt), hx: p.x - (tx - 1) * 256, hy: p.y - (ty - 1) * 256 };
}

// → { time, atHome, nearest:{km,bearing,level}, maxNear, trend:{trend,speed,etaMin} }
export async function fetchRadarNow() {
  const meta = await (await fetchWithRetry(API, {}, { tries: 2 })).json();
  const past = meta.radar?.past || [];
  if (!past.length) throw new Error('ไม่มีภาพเรดาร์');
  const now = past.at(-1);
  const before = past[Math.max(0, past.length - 4)];
  const km = pxKm(Z, HOME.lat);
  const [gNow, gBefore] = await Promise.all([loadGrid(meta.host, now.path), loadGrid(meta.host, before.path)]);
  const aNow = analyze(gNow.levelAt, gNow.hx, gNow.hy, km);
  const aBefore = analyze(gBefore.levelAt, gBefore.hx, gBefore.hy, km);
  return { time: now.time * 1000, ...aNow, trend: approach(aBefore, aNow, (now.time - before.time) / 60) };
}
