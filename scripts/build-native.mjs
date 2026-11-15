// 네이티브(Capacitor) 앱용 웹 번들 생성: 루트의 GitHub Pages 파일은 그대로 두고,
// 앱에 필요한 에셋만 www/ 로 복사한다. (sw.js·README·node_modules 등은 제외)
import { existsSync, mkdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');

const FILES = [
  'index.html',
  'game.js',
  'i18n.js',
  'manifest.json',
  'icon.svg',
  'privacypolicy.html',
  'support.html',
  'bgm1.m4a',
  'bgm2.m4a',
  'bgm3.m4a',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let total = 0;
for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) {
    console.error(`✖ 필수 파일 없음: ${f}`);
    process.exit(1);
  }
  copyFileSync(src, join(out, f));
  const size = statSync(src).size;
  total += size;
  console.log(`  ✓ ${f.padEnd(20)} ${(size / 1024).toFixed(1).padStart(8)} KB`);
}
console.log(`www/ 빌드 완료: ${FILES.length}개 파일, ${(total / 1024 / 1024).toFixed(2)} MB`);
