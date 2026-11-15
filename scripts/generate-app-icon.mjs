// icon.svg → iOS App Store 아이콘 (1024×1024, 라운딩 없음, 알파 채널 없음) 생성
// 사용법: node scripts/generate-app-icon.mjs   (Playwright + Chromium, ImageMagick 필요)
// - SVG 배경 사각형의 모서리 라운딩(rx)을 제거해 꽉 찬(full-bleed) 정사각형으로 렌더링
// - iOS가 모서리 마스크를 직접 적용하므로 원본은 반드시 사각형·불투명이어야 한다.
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const svg = readFileSync(join(root, 'icon.svg'), 'utf8')
  .replace(/<rect width="512" height="512" rx="\d+"/, '<rect width="512" height="512"')
  .replace('<svg ', '<svg width="1024" height="1024" ');

const outDir = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
mkdirSync(outDir, { recursive: true });
const tmp = join(outDir, '.icon-raw.png');
const out = join(outDir, 'AppIcon-1024.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#0b0d24">${svg}</body></html>`);
await page.screenshot({ path: tmp, clip: { x: 0, y: 0, width: 1024, height: 1024 }, omitBackground: false });
await browser.close();

// 알파 채널 완전 제거 (RGB 24bit PNG, sRGB)
execFileSync('convert', [tmp, '-background', '#0b0d24', '-alpha', 'remove', '-alpha', 'off',
  '-colorspace', 'sRGB', '-strip', `PNG24:${out}`]);
execFileSync('rm', ['-f', tmp]);
console.log('✓ ' + out);
