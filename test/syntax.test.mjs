// ตรวจว่าไฟล์ JS ทุกไฟล์ของหน้าเว็บ/สคริปต์ไม่มีโค้ดผิดรูปแบบ (ถ้าผิด หน้าเว็บจะโหลดไม่ขึ้น)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...readdirSync(join(ROOT, 'public')).filter((f) => f.endsWith('.js')).map((f) => join(ROOT, 'public', f)),
  ...readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.mjs')).map((f) => join(ROOT, 'src', f)),
  ...readdirSync(join(ROOT, 'src', 'sources')).map((f) => join(ROOT, 'src', 'sources', f)),
  ...readdirSync(join(ROOT, 'scripts')).map((f) => join(ROOT, 'scripts', f)),
];

for (const f of files) {
  test(`โค้ดถูกรูปแบบ: ${f.slice(ROOT.length + 1)}`, () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }));
  });
}
