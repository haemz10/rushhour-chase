/* ============================================================
 * 퇴근길 대추격전 (Rush Hour Chase)
 * 지친 퇴근길, 지하철에서 잠든 사이 사라진 가방과 휴대폰.
 * 그녀는 자신의 물건을 되찾기 위해 도시의 밤을 달린다!
 *
 * - 왼쪽 탭 : 점프 (공중에서 한 번 더 탭하면 더블점프)
 * - 오른쪽 탭 : 펀치 (장애물 부수기 / 도둑 잡기)
 * ============================================================ */
'use strict';

/* ---------------- Canvas & Scaling ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let DPR = 1, SCALE = 1, W = 960, H = 540;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  canvas.width = Math.round(vw * DPR);
  canvas.height = Math.round(vh * DPR);
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
  if (vw >= vh) {           // 가로: 세로 540 기준
    SCALE = canvas.height / 540;
    H = 540; W = canvas.width / SCALE;
  } else {                  // 세로: 가로 540 기준
    SCALE = canvas.width / 540;
    W = 540; H = canvas.height / SCALE;
  }
}
window.addEventListener('resize', resize);
resize();

const GY = () => (H > W ? H * 0.72 : H - 80);  // 지면 y (세로모드는 액션을 중앙으로)
const PX = () => Math.min(W * 0.24, 230);      // 플레이어 화면상 x

/* ---------------- Utils ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function rr(x, y, w, h, r) { // rounded rect path
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

/* ---------------- Save Data ---------------- */
const SAVE_KEY = 'rushhour_chase_v1';
const save = {
  best: 0, bestDist: 0, bank: 0, totalCatches: 0,
  up: { shoe: 0, magnet: 0, shield: 0, heart: 0 },
  muted: false, introSeen: false,
};
try {
  const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
  Object.assign(save, raw);
  save.up = Object.assign({ shoe: 0, magnet: 0, shield: 0, heart: 0 }, raw.up || {});
} catch (e) {}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

/* ---------------- 다국어 ---------------- */
function detectLang() {
  const n = (navigator.language || 'en').toLowerCase();
  for (const [code] of LANG_LIST) if (n.startsWith(code)) return code;
  return 'en';
}
let L = LANGS[save.lang] || LANGS[detectLang()] || LANGS.en;
function setLang(code) {
  save.lang = code;
  L = LANGS[code];
  document.title = L.title;
  document.documentElement.lang = code;
  persist();
}
function T(key, ...a) {
  const s = (L[key] !== undefined ? L[key] : LANGS.en[key]);
  if (typeof s !== 'string') return key;
  return s.replace(/\{(\d)\}/g, (m, i) => a[+i]);
}
if (save.lang) { document.title = L.title; document.documentElement.lang = save.lang; }

// 길면 자동 축소되는 텍스트 폰트 설정
function fitFont(txt, maxW, size, weight) {
  ctx.font = `${weight || 'bold'} ${size}px sans-serif`;
  const w = ctx.measureText(txt).width;
  if (w > maxW) ctx.font = `${weight || 'bold'} ${Math.max(10, Math.floor(size * maxW / w))}px sans-serif`;
}

/* ---------------- Sound (WebAudio 합성) ---------------- */
const Sound = {
  ac: null, musicTimer: null, nextNoteTime: 0, step: 0,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.startMusic();
    } catch (e) {}
  },
  tone(freq, dur, type, vol, slide, when) {
    if (!this.ac || save.muted) return;
    const t0 = when || this.ac.currentTime;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  noise(dur, vol) {
    if (!this.ac || save.muted) return;
    const t0 = this.ac.currentTime;
    const len = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ac.createBufferSource();
    const g = this.ac.createGain();
    g.gain.setValueAtTime(vol || 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.buffer = buf; src.connect(g); g.connect(this.ac.destination);
    src.start(t0);
  },
  sfx(name) {
    if (!this.ac || save.muted) return;
    switch (name) {
      case 'jump':   this.tone(320, 0.18, 'square', 0.08, 260); break;
      case 'jump2':  this.tone(420, 0.2, 'square', 0.08, 380); break;
      case 'coin':   this.tone(1046, 0.06, 'square', 0.07); this.tone(1568, 0.14, 'square', 0.07, 0, this.ac.currentTime + 0.06); break;
      case 'punch':  this.noise(0.09, 0.14); this.tone(140, 0.1, 'square', 0.1, -60); break;
      case 'smash':  this.noise(0.16, 0.16); this.tone(90, 0.16, 'sawtooth', 0.12, -40); break;
      case 'hurt':   this.tone(220, 0.25, 'sawtooth', 0.14, -140); this.noise(0.2, 0.1); break;
      case 'catch':  [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'square', 0.1, 0, this.ac.currentTime + i * 0.08)); break;
      case 'power':  this.tone(392, 0.1, 'triangle', 0.12, 200); this.tone(784, 0.2, 'triangle', 0.1, 200, this.ac.currentTime + 0.09); break;
      case 'shield': this.tone(600, 0.25, 'triangle', 0.12, -300); break;
      case 'over':   [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.12, 0, this.ac.currentTime + i * 0.22)); break;
      case 'click':  this.tone(660, 0.05, 'square', 0.06); break;
      case 'buy':    this.tone(784, 0.08, 'square', 0.09); this.tone(1175, 0.15, 'square', 0.09, 0, this.ac.currentTime + 0.07); break;
      case 'clear':  [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.2, 'square', 0.1, 0, this.ac.currentTime + i * 0.1)); break;
      case 'escape': this.tone(500, 0.2, 'sawtooth', 0.1, -250); break;
    }
  },
  // 심플한 8비트풍 BGM 루프
  MELODY: [440, 0, 523, 587, 659, 0, 587, 523, 440, 0, 392, 440, 523, 587, 659, 784,
           659, 0, 587, 523, 440, 523, 587, 659, 784, 0, 659, 587, 523, 440, 392, 0],
  BASS:   [110, 110, 131, 131, 147, 147, 131, 131, 110, 110, 98, 98, 131, 131, 147, 147,
           110, 110, 131, 131, 147, 147, 165, 165, 147, 147, 131, 131, 110, 110, 98, 98],
  startMusic() {
    if (this.musicTimer) return;
    this.nextNoteTime = this.ac.currentTime + 0.1;
    this.step = 0;
    const SPB = 60 / 140 / 2; // 140bpm 8분음표
    this.musicTimer = setInterval(() => {
      if (!this.ac || save.muted) return;
      while (this.nextNoteTime < this.ac.currentTime + 0.25) {
        const i = this.step % 32;
        const playing = (state === 'play' || state === 'intro');
        const vol = playing ? 1 : 0.55;
        const m = this.MELODY[i];
        if (m) this.tone(m, SPB * 0.9, 'square', 0.035 * vol, 0, this.nextNoteTime);
        const b = this.BASS[i];
        if (b && i % 2 === 0) this.tone(b, SPB * 1.6, 'triangle', 0.055 * vol, 0, this.nextNoteTime);
        this.nextNoteTime += SPB;
        this.step++;
      }
    }, 90);
  },
};

/* ---------------- 상점 정의 ---------------- */
const SHOP = [
  { key: 'shoe',   icon: '👟', max: 5, costs: [100, 250, 500, 1000, 2000] },
  { key: 'magnet', icon: '🧲', max: 5, costs: [80, 200, 450, 900, 1800] },
  { key: 'shield', icon: '🛡️', max: 5, costs: [80, 200, 450, 900, 1800] },
  { key: 'heart',  icon: '❤️', max: 2, costs: [400, 1500] },
];

const ITEM_ICONS = ['📱', '👛', '👜'];

const THEMES = [
  { name: '지하철 승강장', sky1: '#0b0d24', sky2: '#1b1f4b', far: '#141637', mid: '#232655', accent: '#4a55c9', neon: ['#ff6fa5', '#5ad1ff', '#ffd166'] },
  { name: '도심 네온거리', sky1: '#160b24', sky2: '#3a1b4b', far: '#2a1440', mid: '#44225f', accent: '#a04ac9', neon: ['#ff5c8a', '#c86bff', '#5ad1ff'] },
  { name: '새벽 한강공원', sky1: '#071a20', sky2: '#0f3a40', far: '#0d2b33', mid: '#1a4650', accent: '#2fa8a0', neon: ['#7bffc8', '#5ad1ff', '#ffd166'] },
];

/* ---------------- 상태 ---------------- */
let state = 'boot';   // boot | intro | menu | shop | play | pause | over
let run = null, P = null;
let uiButtons = [];
let lastTime = 0;
let globalT = 0;
let firstRunEver = !save.introSeen;

/* ---------------- 게임 시작/종료 ---------------- */
function startGame() {
  run = {
    t: 0, dist: 0, coins: 0, catches: 0, items: 0, stage: 0,
    combo: 0, comboT: 0, bestCombo: 0,
    speed: 0, spawnD: 900, // 시작 직후 조작 안내를 읽을 유예 구간

    thief: null, thiefTimer: 4.5, hurtInChase: 0,
    obstacles: [], coinsArr: [], powerups: [], particles: [], floats: [],
    slowmo: 0, shake: 0, theme: 0, hintT: firstRunEver ? 6 : 2.5,
    caughtAnim: null,
  };
  const maxHearts = 3 + save.up.heart;
  P = {
    y: GY(), vy: 0, ground: true, jumps: 2,
    punchT: 0, inv: 0, hurtT: 0,
    shieldT: 0, magnetT: 0, boostT: 0,
    hearts: maxHearts, maxHearts,
  };
  state = 'play';
}

function baseSpeed() { return 340 + save.up.shoe * 22; }

function currentScore() {
  if (!run) return 0;
  return Math.floor(run.dist * 3 + run.coins * 20 + run.catches * 700 + run.stage * 1500 + run.bestCombo * 15);
}

function endGame() {
  const score = currentScore();
  save.bank += run.coins;
  save.totalCatches += run.catches;
  if (score > save.best) save.best = score;
  if (run.dist > save.bestDist) save.bestDist = Math.floor(run.dist);
  save.introSeen = true;
  firstRunEver = false;
  persist();
  Sound.sfx('over');
  state = 'over';
}

/* ---------------- 입력 ---------------- */
function doJump() {
  if (P.ground) {
    P.vy = -900; P.ground = false; P.jumps = 1;
    Sound.sfx('jump');
    burst(PX(), GY(), 6, '#cfd6ff', 2);
  } else if (P.jumps > 0) {
    P.vy = -800; P.jumps--;
    Sound.sfx('jump2');
    burst(PX(), P.y, 10, '#8fe3ff', 3);
    addFloat(PX(), P.y - 90, T('whoosh'), '#8fe3ff', 0.8);
  }
}
function doPunch() {
  if (P.punchT <= 0) {
    P.punchT = 0.22;
    Sound.sfx('punch');
  }
}

function onTap(x, y) {
  Sound.init();
  // UI 버튼 우선
  for (let i = uiButtons.length - 1; i >= 0; i--) {
    const b = uiButtons[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      Sound.sfx('click');
      b.cb();
      return;
    }
  }
  if (state === 'intro') { introTap(); return; }
  if (state === 'menu') return;
  if (state === 'over') return;
  if (state === 'play') {
    if (x < W * 0.45) doJump(); else doPunch();
  }
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  onTap(e.clientX * DPR / SCALE, e.clientY * DPR / SCALE);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  Sound.init();
  if (state === 'play') {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); doJump(); }
    if (e.code === 'KeyF' || e.code === 'KeyX' || e.code === 'ArrowRight') doPunch();
    if (e.code === 'KeyP' || e.code === 'Escape') state = 'pause';
  } else if (state === 'pause' && (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Space')) {
    state = 'play';
  } else if (state === 'intro' && (e.code === 'Space' || e.code === 'Enter')) {
    introTap();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') state = 'pause';
});

/* ---------------- 파티클/플로팅 텍스트 ---------------- */
function burst(x, y, n, color, size, up) {
  for (let i = 0; i < n; i++) {
    run.particles.push({
      x, y,
      vx: rand(-160, 160), vy: rand(up ? -320 : -160, up ? -80 : 60),
      life: rand(0.4, 0.8), t: 0, color, size: rand(size * 0.6, size * 1.5),
    });
  }
}
function addFloat(x, y, txt, color, scale) {
  run.floats.push({ x, y, txt, color, t: 0, scale: scale || 1 });
}

/* ---------------- 스폰 ---------------- */
function spawnPattern() {
  const r = Math.random();
  const x = W + 140;
  const g = GY();
  const O = run.obstacles, C = run.coinsArr, U = run.powerups;
  const hard = clamp(run.t / 90, 0, 1); // 시간에 따른 난이도

  if (r < 0.16) {
    O.push({ type: 'cone', x, w: 34, h: 46 });
  } else if (r < 0.30) {
    O.push({ type: 'barrier', x, w: 56, h: 62 });
    if (Math.random() < 0.5) for (let i = 0; i < 4; i++) C.push({ x: x - 60 + i * 44, y: g - 130 - Math.sin(i / 3 * Math.PI) * 46, ph: i });
  } else if (r < 0.42) {
    O.push({ type: 'boxes', x, w: 58, h: 112 });
    C.push({ x: x + 110, y: g - 44, ph: 0 });
    C.push({ x: x + 154, y: g - 44, ph: 1 });
  } else if (r < 0.52 + hard * 0.06) {
    // 이단 콤보: 콘 + 뒤이어 장애물
    O.push({ type: 'cone', x, w: 34, h: 46 });
    O.push({ type: Math.random() < 0.5 ? 'barrier' : 'cone', x: x + 250 + rand(0, 80), w: 50, h: 58 });
  } else if (r < 0.66) {
    // 비둘기 떼: 아래로 지나가거나 펀치
    O.push({ type: 'pigeon', x, w: 52, h: 38, yOff: rand(118, 150), ph: rand(0, TAU) });
    for (let i = 0; i < 5; i++) C.push({ x: x - 40 + i * 44, y: g - 36, ph: i });
  } else if (r < 0.80) {
    // 코인 아치
    const n = 7;
    for (let i = 0; i < n; i++) C.push({ x: x + i * 46, y: g - 50 - Math.sin(i / (n - 1) * Math.PI) * 105, ph: i });
  } else if (r < 0.90) {
    // 낮은 코인 줄
    for (let i = 0; i < 6; i++) C.push({ x: x + i * 46, y: g - 42, ph: i });
  } else {
    // 파워업
    const pr = Math.random();
    let type = 'magnet';
    if (pr < 0.34) type = 'magnet';
    else if (pr < 0.62) type = 'shield';
    else if (pr < 0.86) type = 'boost';
    else type = 'heart';
    U.push({ type, x, y: g - 70 - rand(0, 60), ph: rand(0, TAU) });
  }
  run.spawnD = rand(300, 560) + run.speed * 0.38;
}

/* ---------------- 도둑 ---------------- */
function spawnThief() {
  // 등장 거리는 화면 폭과 무관하게 380~480px로 제한 (가로모드에서 추격이 늘어지지 않게)
  run.thief = {
    dx: clamp(W * 0.72, 380, 480), y: GY(), vy: 0,
    jumpT: rand(0.6, 1.2), escaping: false, gone: false,
  };
  run.hurtInChase = 0;
  const idx = run.items % 3;
  addFloat(W * 0.6, GY() - 220, T('thiefFound', ITEM_ICONS[idx], L.items[idx]), '#ffd166', 1.15);
}

function catchThief() {
  const idx = run.items % 3;
  run.items++; run.catches++;
  run.combo += 15; run.comboT = 3;
  run.bestCombo = Math.max(run.bestCombo, run.combo);
  const bonus = 100 + run.stage * 50;
  run.coins += bonus;
  run.slowmo = 0.55; run.shake = 0.35;
  Sound.sfx('catch');
  vibrate(60);
  const tx = PX() + run.thief.dx;
  burst(tx, GY() - 60, 26, '#ffd166', 4, true);
  burst(tx, GY() - 60, 14, '#ff8fb3', 3, true);
  addFloat(W / 2, H * 0.32, T('gotItem', ITEM_ICONS[idx], L.items[idx], bonus), '#ffd166', 1.5);
  run.caughtAnim = { x: tx, y: GY(), t: 0 };
  run.thief = null;
  run.thiefTimer = rand(9, 14);

  if (run.items % 3 === 0) {
    // 세 가지 모두 회수 → 스테이지 클리어
    run.stage++;
    run.theme = (run.theme + 1) % THEMES.length;
    P.hearts = Math.min(P.maxHearts, P.hearts + 1);
    run.coins += 300;
    Sound.sfx('clear');
    addFloat(W / 2, H * 0.45, T('stageClear'), '#7bffc8', 1.4);
    addFloat(W / 2, H * 0.45 + 44, T('stageClear2'), '#ffffff', 1.0);
  }
}

function thiefEscape() {
  run.thief.escaping = true;
  Sound.sfx('escape');
  addFloat(W * 0.6, GY() - 220, T('escapeTaunt'), '#ff8fb3', 1.1);
}

/* ---------------- 피격/획득 ---------------- */
function hurt(obs) {
  if (P.inv > 0 || P.boostT > 0) return;
  if (P.shieldT > 0) {
    P.shieldT = 0; P.inv = 1.0;
    Sound.sfx('shield');
    if (obs) smash(obs, '#9fd8ff');
    addFloat(PX(), P.y - 110, T('shieldSaved'), '#9fd8ff', 1);
    return;
  }
  P.hearts--;
  P.inv = 1.6; P.hurtT = 0.5;
  run.combo = 0; run.shake = 0.4;
  Sound.sfx('hurt');
  vibrate(90);
  burst(PX(), P.y - 40, 12, '#ff6b6b', 3);
  if (run.thief && !run.thief.escaping) {
    run.thief.dx += 200;
    run.hurtInChase++;
    if (run.hurtInChase >= 2) thiefEscape();
  }
  if (P.hearts <= 0) endGame();
}

function smash(o, color) {
  o.dead = true;
  Sound.sfx('smash');
  burst(o.x, GY() - o.h / 2 - (o.yOff || 0), 16, color || '#d9a05b', 4);
  const mult = 1 + Math.floor(run.combo / 10);
  run.coins += 3 * mult;
  run.combo += 2; run.comboT = 3;
  addFloat(o.x, GY() - o.h - 20 - (o.yOff || 0), `+${3 * mult}`, '#ffd166', 0.9);
}

/* ---------------- 업데이트 ---------------- */
function updatePlay(dt0) {
  const ts = run.slowmo > 0 ? 0.35 : 1;
  const dt = dt0 * ts;
  run.slowmo = Math.max(0, run.slowmo - dt0);
  run.shake = Math.max(0, run.shake - dt0);
  run.t += dt;
  run.hintT = Math.max(0, run.hintT - dt0);

  // 속도
  const target = (baseSpeed() + Math.min(430, run.t * 7) + run.stage * 25) * (P.boostT > 0 ? 1.55 : 1);
  run.speed = lerp(run.speed, target, 1 - Math.pow(0.001, dt));
  const sp = run.speed;
  run.dist += sp * dt / 10;

  // 플레이어 물리
  P.vy += 2400 * dt;
  P.y += P.vy * dt;
  if (P.y >= GY()) {
    if (!P.ground && P.vy > 500) burst(PX(), GY(), 4, '#cfd6ff', 2);
    P.y = GY(); P.vy = 0; P.ground = true; P.jumps = 2;
  }
  P.punchT = Math.max(0, P.punchT - dt0);
  P.inv = Math.max(0, P.inv - dt0);
  P.hurtT = Math.max(0, P.hurtT - dt0);
  P.shieldT = Math.max(0, P.shieldT - dt);
  P.magnetT = Math.max(0, P.magnetT - dt);
  P.boostT = Math.max(0, P.boostT - dt);
  run.comboT -= dt;
  if (run.comboT <= 0) run.combo = Math.max(0, run.combo - Math.ceil(run.combo * dt * 2));

  // 스폰
  run.spawnD -= sp * dt;
  if (run.spawnD <= 0) spawnPattern();

  const px = PX(), g = GY();
  const pTop = P.y - 82, pL = px - 17, pR = px + 17;

  // 장애물
  for (const o of run.obstacles) {
    o.x -= sp * dt;
    if (o.dead) continue;
    let oTop, oBot;
    if (o.type === 'pigeon') {
      const bob = Math.sin(globalT * 4 + o.ph) * 8;
      oBot = g - o.yOff + bob;
      oTop = oBot - o.h;
    } else {
      oBot = g; oTop = g - o.h;
    }
    const oL = o.x - o.w / 2, oR = o.x + o.w / 2;
    // 펀치 히트
    if (P.punchT > 0.1 && (o.type === 'boxes' || o.type === 'pigeon' || o.type === 'cone')) {
      if (oL < px + 105 && oR > px + 10 && oTop < P.y + 5 && oBot > P.y - 150) {
        smash(o, o.type === 'pigeon' ? '#cfd6ff' : '#d9a05b');
        continue;
      }
    }
    // 충돌
    if (oL < pR && oR > pL && oTop < P.y && oBot > pTop) {
      if (P.boostT > 0) { smash(o, '#ffd166'); continue; }
      hurt(o);
      if (state !== 'play') return;
    }
  }
  run.obstacles = run.obstacles.filter(o => !o.dead && o.x > -120);

  // 코인
  const mult = 1 + Math.floor(run.combo / 10);
  for (const c of run.coinsArr) {
    c.x -= sp * dt;
    if (P.magnetT > 0) {
      const dx = px - c.x, dy = (P.y - 46) - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 220) { c.x += dx / d * 620 * dt; c.y += dy / d * 620 * dt; }
    }
    const d2 = Math.hypot(c.x - px, c.y - (P.y - 46));
    if (d2 < 42) {
      c.dead = true;
      run.coins += mult;
      run.combo++; run.comboT = 3;
      run.bestCombo = Math.max(run.bestCombo, run.combo);
      Sound.sfx('coin');
      burst(c.x, c.y, 4, '#ffd166', 2, true);
      if (mult > 1) addFloat(c.x, c.y - 24, `+${mult}`, '#ffd166', 0.8);
    }
  }
  run.coinsArr = run.coinsArr.filter(c => !c.dead && c.x > -60);

  // 파워업
  for (const u of run.powerups) {
    u.x -= sp * dt;
    const d = Math.hypot(u.x - px, u.y - (P.y - 46));
    if (d < 52) {
      u.dead = true;
      Sound.sfx('power');
      vibrate(30);
      if (u.type === 'magnet') { P.magnetT = 6 + save.up.magnet * 2; addFloat(px, P.y - 120, T('puMagnet'), '#8fe3ff', 1.1); }
      if (u.type === 'shield') { P.shieldT = 8 + save.up.shield * 2; addFloat(px, P.y - 120, T('puShield'), '#9fd8ff', 1.1); }
      if (u.type === 'boost')  { P.boostT = 2.6; run.shake = 0.2; addFloat(px, P.y - 120, T('puBoost'), '#ffd166', 1.2); }
      if (u.type === 'heart')  {
        if (P.hearts < P.maxHearts) { P.hearts++; addFloat(px, P.y - 120, T('puHeal'), '#ff8fb3', 1.1); }
        else { run.coins += 30; addFloat(px, P.y - 120, T('puHeartFull'), '#ffd166', 1); }
      }
      burst(u.x, u.y, 12, '#ffffff', 3, true);
    }
  }
  run.powerups = run.powerups.filter(u => !u.dead && u.x > -60);

  // 도둑
  if (run.thief) {
    const th = run.thief;
    const factor = th.escaping ? 1.4 : 0.91;
    th.dx += (factor - 1) * sp * dt;
    // 도둑 폴짝폴짝 (연출용)
    th.jumpT -= dt;
    th.vy += 2600 * dt;
    th.y += th.vy * dt;
    if (th.y >= g) { th.y = g; th.vy = 0; if (th.jumpT <= 0) { th.vy = -rand(520, 760); th.jumpT = rand(0.7, 1.4); } }
    if (th.escaping && th.dx > W + 250) {
      run.thief = null;
      run.thiefTimer = rand(7, 11);
    }
    // 잡기!
    if (!th.escaping && P.punchT > 0.1 && th.dx < 115) {
      catchThief();
    }
  } else {
    run.thiefTimer -= dt;
    if (run.thiefTimer <= 0) spawnThief();
  }

  // 잡힌 도둑 연출
  if (run.caughtAnim) {
    const a = run.caughtAnim;
    a.t += dt0;
    a.x -= sp * dt * 0.4;
    if (a.t > 1.6) run.caughtAnim = null;
  }

  // 파티클/플로팅
  for (const p of run.particles) {
    p.t += dt0;
    p.x += p.vx * dt0 - sp * dt * 0.5;
    p.y += p.vy * dt0;
    p.vy += 800 * dt0;
  }
  run.particles = run.particles.filter(p => p.t < p.life);
  for (const f of run.floats) f.t += dt0;
  run.floats = run.floats.filter(f => f.t < 1.6);
}

/* ============================================================
 * 그리기
 * ============================================================ */

function drawBackground(theme, dist, dim) {
  const T = THEMES[theme];
  const g = GY();
  // 하늘
  const grad = ctx.createLinearGradient(0, 0, 0, g);
  grad.addColorStop(0, T.sky1);
  grad.addColorStop(1, T.sky2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, g);

  // 별
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 40; i++) {
    const sx = ((i * 137.3 + 50) % (W + 100)) - 50;
    const sy = (i * 71.7) % (g * 0.55);
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(globalT * 1.5 + i));
    ctx.globalAlpha = tw * 0.8;
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;

  // 달
  ctx.fillStyle = '#fff7d6';
  ctx.beginPath(); ctx.arc(W * 0.82, H * 0.14, 26, 0, TAU); ctx.fill();
  ctx.fillStyle = T.sky1;
  ctx.beginPath(); ctx.arc(W * 0.82 + 10, H * 0.14 - 6, 22, 0, TAU); ctx.fill();

  // 원경 스카이라인 (패럴랙스 0.15)
  drawSkyline(dist * 0.15, g - 150, 130, T.far, 97, false);
  // 중경 건물 + 네온 (패럴랙스 0.4)
  drawSkyline(dist * 0.4, g - 60, 190, T.mid, 53, true, T.neon);

  // 지면
  ctx.fillStyle = '#101226';
  ctx.fillRect(0, g, W, H - g);
  ctx.fillStyle = T.accent;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, g, W, 4);
  ctx.globalAlpha = 1;
  // 점자블록/타일 스크롤
  const tileW = 90;
  const off = (dist * 10) % tileW;
  ctx.fillStyle = 'rgba(255,209,102,0.16)';
  for (let x = -off; x < W; x += tileW) ctx.fillRect(x, g + 10, tileW * 0.55, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = -off * 1.5 % 140; x < W; x += 140) ctx.fillRect(x, g + 30, 2, H - g - 30);

  if (dim) { ctx.fillStyle = `rgba(4,5,16,${dim})`; ctx.fillRect(0, 0, W, H); }
}

function drawSkyline(scroll, baseY, maxH, color, seedStep, neonOn, neonColors) {
  ctx.fillStyle = color;
  const bw = 110;
  const start = Math.floor(scroll / bw);
  for (let i = start; i < start + Math.ceil(W / bw) + 2; i++) {
    const seed = ((i * seedStep) % 89 + 89) % 89;
    const bh = 60 + (seed / 89) * maxH;
    const x = i * bw - scroll;
    ctx.fillRect(x, baseY - bh, bw - 12, bh + 160);
    // 창문
    ctx.fillStyle = 'rgba(255,235,170,0.22)';
    for (let wy = 0; wy < 3; wy++) for (let wx = 0; wx < 3; wx++) {
      if ((seed + wx * 7 + wy * 13) % 4 < 2) ctx.fillRect(x + 12 + wx * 28, baseY - bh + 14 + wy * 30, 14, 16);
    }
    // 네온 간판
    if (neonOn && seed % 3 === 0 && neonColors) {
      const nc = neonColors[seed % neonColors.length];
      ctx.fillStyle = nc;
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(globalT * 5 + seed);
      rr(x + 16, baseY - bh - 26, 66, 20, 5); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0a0a1a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(['24시', '노래방', '분식', '카페', 'PC방', '편의점'][seed % 6], x + 49, baseY - bh - 11);
    }
    ctx.fillStyle = color;
  }
}

/* ----- 주인공 (수진) ----- */
function drawHeroine(x, y, opt) {
  // opt: {pose:'run'|'jump'|'sit'|'stand', phase, punch, hurt, blink}
  const o = opt || {};
  if (o.blink && Math.floor(globalT * 12) % 2 === 0) ctx.globalAlpha = 0.35;
  ctx.save();
  ctx.translate(x, y);
  if (o.hurt) ctx.rotate(-0.18);
  const ph = o.phase || 0;
  const runc = o.pose === 'run';
  const legA = runc ? Math.sin(ph) * 0.9 : (o.pose === 'jump' ? 0.5 : 0.1);
  const legB = runc ? Math.sin(ph + Math.PI) * 0.9 : (o.pose === 'jump' ? -0.7 : -0.1);

  ctx.lineCap = 'round';
  // 뒷다리
  drawLeg(legB, '#26314f', o.pose === 'jump');
  // 몸통 (자켓)
  ctx.fillStyle = '#ff5c8a';
  rr(-14, -62, 30, 34, 9); ctx.fill();
  ctx.fillStyle = '#e84a77';
  rr(-14, -62, 30, 12, 6); ctx.fill();
  // 앞다리
  drawLeg(legA, '#2e3a5c', o.pose === 'jump');
  // 뒷팔
  const armPh = runc ? Math.sin(ph + Math.PI) * 0.8 : 0.2;
  if (!o.punch) drawArm(armPh - 0.4, '#ff7ba0');
  // 머리
  ctx.fillStyle = '#ffd9b8';
  ctx.beginPath(); ctx.arc(6, -76, 13, 0, TAU); ctx.fill();
  // 머리카락 + 포니테일
  ctx.fillStyle = '#4a2f22';
  ctx.beginPath(); ctx.arc(4, -80, 13, Math.PI * 0.85, Math.PI * 1.95); ctx.fill();
  const tailWob = Math.sin((o.phase || globalT * 6) * 1.1) * 6;
  ctx.strokeStyle = '#4a2f22';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-6, -84);
  ctx.quadraticCurveTo(-24, -78 + tailWob, -30, -60 + tailWob * 1.6);
  ctx.stroke();
  // 눈
  if (o.eyesClosed) {
    ctx.strokeStyle = '#3a2418'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(9, -77); ctx.lineTo(15, -77); ctx.stroke();
  } else {
    ctx.fillStyle = '#2b1b12';
    ctx.beginPath(); ctx.arc(12, -78, 2.4, 0, TAU); ctx.fill();
  }
  // 홍조
  ctx.fillStyle = 'rgba(255,120,140,0.5)';
  ctx.beginPath(); ctx.arc(13, -71, 3, 0, TAU); ctx.fill();
  // 앞팔 / 펀치
  if (o.punch) {
    ctx.strokeStyle = '#ffd9b8';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(6, -50); ctx.lineTo(46, -56); ctx.stroke();
    ctx.fillStyle = '#ffd9b8';
    ctx.beginPath(); ctx.arc(50, -56, 7, 0, TAU); ctx.fill();
    // 스매시 이펙트
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(58, -56, 18, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(58, -56, 28, -0.6, 0.6); ctx.stroke();
  } else {
    drawArm(armPh + Math.PI * 0.9 + 0.4, '#ffd9b8');
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  function drawLeg(a, color, tuck) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 9;
    const hx = 0, hy = -32;
    const kx = hx + Math.sin(a) * 13, ky = hy + Math.cos(a) * 13;
    const fx = kx + Math.sin(a + (tuck ? 1.4 : 0.3)) * 14, fy = ky + Math.cos(a + (tuck ? 1.4 : 0.3)) * 14;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    // 운동화
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(fx + 3, fy, 5, 0, TAU); ctx.fill();
  }
  function drawArm(a, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    const sx = 2, sy = -56;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.sin(a) * 16, sy + Math.cos(a) * 16);
    ctx.stroke();
  }
}

/* ----- 도둑 ----- */
function drawThief(x, y, opt) {
  const o = opt || {};
  ctx.save();
  ctx.translate(x, y);
  if (o.tumble) ctx.rotate(o.tumble);
  const ph = o.phase || 0;
  ctx.lineCap = 'round';
  // 다리
  ctx.strokeStyle = '#1c1c2e';
  ctx.lineWidth = 9;
  for (const s of [0, Math.PI]) {
    const a = Math.sin(ph + s) * 1.0;
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(Math.sin(a) * 15, -30 + Math.cos(a) * 15);
    ctx.lineTo(Math.sin(a) * 15 + Math.sin(a + 0.4) * 14, -30 + Math.cos(a) * 15 + Math.cos(a + 0.4) * 14);
    ctx.stroke();
  }
  // 후드 몸통
  ctx.fillStyle = '#2e2e4a';
  rr(-16, -64, 32, 38, 10); ctx.fill();
  // 훔친 가방
  ctx.fillStyle = '#c9762f';
  rr(-34, -58, 22, 18, 5); ctx.fill();
  ctx.strokeStyle = '#8a4d1a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(-23, -58, 8, Math.PI, 0); ctx.stroke();
  // 후드 머리
  ctx.fillStyle = '#3a3a5c';
  ctx.beginPath(); ctx.arc(6, -76, 13, 0, TAU); ctx.fill();
  // 마스크 얼굴
  ctx.fillStyle = '#12121f';
  ctx.beginPath(); ctx.arc(9, -75, 8, -0.6, 0.9); ctx.lineTo(9, -75); ctx.fill();
  // 눈 (초조)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(11, -77, 3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(12, -77, 1.5, 0, TAU); ctx.fill();
  // 땀방울
  if (!o.tumble) {
    ctx.fillStyle = '#8fe3ff';
    const sw = (globalT * 3) % 1;
    ctx.globalAlpha = 1 - sw;
    ctx.beginPath(); ctx.arc(18, -88 - sw * 14, 3, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ----- 오브젝트 ----- */
function drawObstacle(o) {
  const g = GY();
  if (o.type === 'cone') {
    ctx.fillStyle = '#ff7f45';
    ctx.beginPath();
    ctx.moveTo(o.x, g - o.h);
    ctx.lineTo(o.x - o.w / 2, g);
    ctx.lineTo(o.x + o.w / 2, g);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(o.x - o.w * 0.28, g - o.h * 0.45, o.w * 0.56, 7);
  } else if (o.type === 'barrier') {
    ctx.fillStyle = '#d8d8e6';
    rr(o.x - o.w / 2, g - o.h, o.w, o.h, 6); ctx.fill();
    ctx.fillStyle = '#ffb020';
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.beginPath();
      rr(o.x - o.w / 2, g - o.h, o.w, o.h, 6);
      ctx.clip();
      ctx.translate(o.x - o.w / 2 + i * 24 - 8, g - o.h);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(12, 0); ctx.lineTo(24, o.h); ctx.lineTo(12, o.h);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  } else if (o.type === 'boxes') {
    for (let i = 0; i < 3; i++) {
      const bw = o.w - i * 8, bh = 36;
      ctx.fillStyle = ['#b07a3e', '#c98d4a', '#a06c34'][i];
      rr(o.x - bw / 2, g - 36 * (i + 1), bw, bh - 3, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x - bw / 2 + 6, g - 36 * (i + 1) + 6, bw - 12, bh - 15);
    }
    ctx.fillStyle = '#5b3d1e';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('택배', o.x, g - 52);
  } else if (o.type === 'pigeon') {
    const bob = Math.sin(globalT * 4 + o.ph) * 8;
    const y = g - o.yOff + bob;
    const flap = Math.sin(globalT * 16 + o.ph) * 12;
    ctx.fillStyle = '#9aa2b8';
    ctx.beginPath(); ctx.ellipse(o.x, y - 16, 17, 12, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(o.x + 14, y - 24, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.moveTo(o.x + 20, y - 24); ctx.lineTo(o.x + 27, y - 22); ctx.lineTo(o.x + 20, y - 20);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c3c9d9';
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(o.x - 2, y - 20); ctx.quadraticCurveTo(o.x - 12, y - 30 - flap, o.x - 22, y - 26 - flap); ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(o.x + 16, y - 26, 1.6, 0, TAU); ctx.fill();
  }
}

function drawCoin(c) {
  const s = Math.abs(Math.cos(globalT * 5 + c.ph * 0.7));
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(Math.max(0.15, s), 1);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e6a93c';
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff1c4';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('₩', 0, 1);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

function drawPowerup(u) {
  const bob = Math.sin(globalT * 3 + u.ph) * 6;
  const icons = { magnet: '🧲', shield: '🛡️', boost: '⚡', heart: '❤️' };
  const colors = { magnet: '#8fe3ff', shield: '#9fd8ff', boost: '#ffd166', heart: '#ff8fb3' };
  ctx.save();
  ctx.translate(u.x, u.y + bob);
  ctx.fillStyle = colors[u.type];
  ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors[u.type];
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke();
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(icons[u.type], 0, 2);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

/* ---------------- HUD & UI ---------------- */
function button(x, y, w, h, label, cb, opt) {
  const o = opt || {};
  uiButtons.push({ x, y, w, h, cb });
  ctx.fillStyle = o.disabled ? '#2a2d45' : (o.color || '#ff5c8a');
  rr(x, y, w, h, h / 2 > 16 ? 16 : h / 2); ctx.fill();
  if (!o.disabled) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(x, y, w, h / 2, 16); ctx.fill();
  }
  ctx.fillStyle = o.disabled ? '#6b6f8f' : '#ffffff';
  fitFont(label, w - 18, o.size || 20);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawHUD() {
  const pad = 14;
  // 하트
  for (let i = 0; i < P.maxHearts; i++) {
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'left';
    ctx.globalAlpha = i < P.hearts ? 1 : 0.22;
    ctx.fillText('❤️', pad + i * 30, 36);
    ctx.globalAlpha = 1;
  }
  // 코인 + 거리
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#ffd166';
  ctx.fillText(`💰 ${run.coins}`, pad, 68);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${Math.floor(run.dist)}m`, pad, 96);

  // 점수 (중앙 상단)
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(currentScore().toLocaleString(), W / 2, 40);

  // 콤보
  if (run.combo >= 5) {
    const mult = 1 + Math.floor(run.combo / 10);
    ctx.font = `bold ${24 + Math.min(10, run.combo / 5)}px sans-serif`;
    ctx.fillStyle = '#ffd166';
    ctx.fillText(`${run.combo} COMBO${mult > 1 ? `  x${mult}` : ''}`, W / 2, 74);
  }

  // 되찾은 물건 슬롯 (우측 상단)
  const sx = W - pad - 3 * 40;
  ctx.font = '24px sans-serif';
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = i < (run.items % 3 === 0 && run.items > 0 ? 3 : run.items % 3) ? 1 : 0.22;
    ctx.textAlign = 'left';
    ctx.fillText(ITEM_ICONS[i], sx + i * 40, 76);
  }
  ctx.globalAlpha = 1;
  if (run.stage > 0) {
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#7bffc8';
    ctx.textAlign = 'left';
    ctx.fillText(T('stageLbl', run.stage + 1, L.themes[run.theme]), sx - 10, 100);
  }

  // 파워업 잔여시간 바
  let barY = 118;
  const bars = [
    ['🧲', P.magnetT, 6 + save.up.magnet * 2, '#8fe3ff'],
    ['🛡️', P.shieldT, 8 + save.up.shield * 2, '#9fd8ff'],
    ['⚡', P.boostT, 2.6, '#ffd166'],
  ];
  for (const [ic, t, max, col] of bars) {
    if (t > 0) {
      ctx.font = '16px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(ic, pad, barY + 6);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      rr(pad + 26, barY - 6, 90, 10, 5); ctx.fill();
      ctx.fillStyle = col;
      rr(pad + 26, barY - 6, 90 * clamp(t / max, 0, 1), 10, 5); ctx.fill();
      barY += 22;
    }
  }

  // 일시정지 버튼
  button(W - 58, pad, 44, 44, '⏸', () => { state = 'pause'; }, { color: 'rgba(255,255,255,0.14)', size: 20 });

  // 조작 힌트
  if (run.hintT > 0) {
    ctx.globalAlpha = clamp(run.hintT, 0, 1) * 0.9;
    ctx.fillStyle = '#0b0d24';
    rr(W * 0.06, H - 64, W * 0.36, 44, 12); ctx.fill();
    rr(W * 0.58, H - 64, W * 0.36, 44, 12); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    fitFont(T('hintJump'), W * 0.33, W < 700 ? 14 : 17);
    ctx.fillText(T('hintJump'), W * 0.24, H - 36);
    fitFont(T('hintPunch'), W * 0.33, W < 700 ? 14 : 17);
    ctx.fillText(T('hintPunch'), W * 0.76, H - 36);
    ctx.globalAlpha = 1;
  }

  // 도둑 추격 안내
  if (run.thief && !run.thief.escaping) {
    if (run.thief.dx < 130) {
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = '#ffd166';
      ctx.textAlign = 'center';
      const pulse = 1 + Math.sin(globalT * 10) * 0.08;
      ctx.save();
      ctx.translate(W / 2, H * 0.25);
      ctx.scale(pulse, pulse);
      fitFont(T('promptPunch'), W * 0.86, 26);
      ctx.fillText(T('promptPunch'), 0, 0);
      ctx.restore();
    } else if (run.thief.dx > W * 0.6) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'center';
      fitFont(T('promptChase'), W * 0.9, 18);
      ctx.fillText(T('promptChase'), W / 2, H * 0.25);
    }
  }
}

function drawFloats() {
  for (const f of run.floats) {
    const p = f.t / 1.6;
    ctx.globalAlpha = p < 0.8 ? 1 : (1 - (p - 0.8) / 0.2);
    ctx.font = `bold ${Math.round(20 * f.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.txt, f.x, f.y - p * 46);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x, f.y - p * 46);
  }
  ctx.globalAlpha = 1;
}

function drawPlayScene() {
  // 흔들림
  ctx.save();
  if (run.shake > 0) ctx.translate(rand(-1, 1) * run.shake * 14, rand(-1, 1) * run.shake * 14);

  drawBackground(run.theme, run.dist, 0);

  for (const c of run.coinsArr) drawCoin(c);
  for (const u of run.powerups) drawPowerup(u);
  for (const o of run.obstacles) drawObstacle(o);

  // 도둑
  if (run.thief) {
    drawThief(PX() + run.thief.dx, run.thief.y, { phase: run.dist * 0.11 });
  }
  // 잡힌 도둑 (나뒹굴기)
  if (run.caughtAnim) {
    const a = run.caughtAnim;
    drawThief(a.x + a.t * 130, a.y - Math.sin(Math.min(1, a.t) * Math.PI) * 90, { tumble: a.t * 9 });
    if (a.t < 0.5) {
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💥', a.x + 20, a.y - 80);
    }
  }

  // 부스터 잔상
  if (P.boostT > 0) {
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.14 * (4 - i);
      drawHeroine(PX() - i * 26, P.y, { pose: P.ground ? 'run' : 'jump', phase: run.dist * 0.12 - i });
    }
    ctx.globalAlpha = 1;
  }

  // 주인공
  drawHeroine(PX(), P.y, {
    pose: P.ground ? 'run' : 'jump',
    phase: run.dist * 0.12,
    punch: P.punchT > 0.06,
    hurt: P.hurtT > 0,
    blink: P.inv > 0 && P.boostT <= 0,
  });

  // 방패 이펙트
  if (P.shieldT > 0) {
    ctx.strokeStyle = `rgba(159,216,255,${0.5 + 0.3 * Math.sin(globalT * 6)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(PX(), P.y - 45, 52, 0, TAU); ctx.stroke();
  }
  // 자석 이펙트
  if (P.magnetT > 0) {
    ctx.strokeStyle = `rgba(143,227,255,${0.25 + 0.15 * Math.sin(globalT * 8)})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(PX(), P.y - 45, 90, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  // 파티클
  for (const p of run.particles) {
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  drawFloats();
  ctx.restore();

  drawHUD();
}

/* ---------------- 메뉴 ---------------- */
function drawMenu() {
  drawBackground(0, globalT * 26, 0.25);
  // 달리는 주인공 데모
  drawHeroine(W * 0.2, GY(), { pose: 'run', phase: globalT * 13 });
  drawThief(W * 0.75, GY(), { phase: globalT * 13 + 1 });

  ctx.textAlign = 'center';
  const ty = H * 0.24;
  fitFont(T('title'), W * 0.92, Math.min(58, W * 0.085), '900');
  ctx.fillStyle = '#ffd166';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 8;
  ctx.strokeText(T('title'), W / 2, ty);
  ctx.fillText(T('title'), W / 2, ty);
  ctx.fillStyle = '#cfd6ff';
  fitFont(T('subtitle'), W * 0.88, Math.min(19, W * 0.035));
  ctx.fillText(T('subtitle'), W / 2, ty + 36);

  // 기록
  const recTxt = T('records', save.best.toLocaleString(), save.bestDist, save.totalCatches);
  ctx.fillStyle = '#ffffff';
  fitFont(recTxt, W * 0.92, 17);
  ctx.fillText(recTxt, W / 2, ty + 72);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(T('bank', save.bank.toLocaleString()), W / 2, ty + 100);

  const bw = Math.min(320, W * 0.72);
  const bx = W / 2 - bw / 2;
  let by = H * 0.52;
  button(bx, by, bw, 62, T('btnStart'), () => { startGame(); }, { size: 24 });
  by += 76;
  button(bx, by, bw, 52, T('btnShop'), () => { state = 'shop'; }, { color: '#4a55c9' });
  by += 64;
  const bw3 = (bw - 16) / 3;
  button(bx, by, bw3, 46, T('btnStory'), () => { startIntro(); }, { color: '#2a2d45', size: 15 });
  button(bx + bw3 + 8, by, bw3, 46, (save.muted ? '🔇 ' : '🔊 ') + T('btnSound'), () => {
    save.muted = !save.muted; persist();
  }, { color: '#2a2d45', size: 15 });
  button(bx + (bw3 + 8) * 2, by, bw3, 46, '🌐 ' + (save.lang || detectLang()).toUpperCase(), () => {
    state = 'lang';
  }, { color: '#2a2d45', size: 15 });
}

/* ---------------- 언어 선택 ---------------- */
let langFirstBoot = false;
function drawLangSelect() {
  drawBackground(0, globalT * 20, 0.35);
  ctx.textAlign = 'center';
  ctx.font = '900 36px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('🌐 Language', W / 2, H * 0.18);
  const bw = Math.min(230, W * 0.42);
  const cols = W > bw * 2.4 ? 2 : 1;
  const rows = Math.ceil(LANG_LIST.length / cols);
  const totalW = cols * bw + (cols - 1) * 16;
  const startX = W / 2 - totalW / 2;
  const startY = H * 0.26;
  const bh = Math.min(56, (H * 0.62) / rows - 10);
  LANG_LIST.forEach(([code, name], i) => {
    const cx = startX + (i % cols) * (bw + 16);
    const cy = startY + Math.floor(i / cols) * (bh + 12);
    const active = (save.lang || detectLang()) === code;
    button(cx, cy, bw, bh, name, () => {
      setLang(code);
      if (langFirstBoot) { langFirstBoot = false; startIntro(); }
      else state = 'menu';
    }, { color: active ? '#ff5c8a' : '#2a2d45', size: 19 });
  });
  if (!langFirstBoot) {
    button(W / 2 - 90, startY + rows * (bh + 12) + 12, 180, 46, T('back'), () => { state = 'menu'; }, { color: '#4a55c9', size: 17 });
  }
}

/* ---------------- 상점 ---------------- */
function drawShop() {
  drawBackground(1, globalT * 12, 0.45);
  ctx.textAlign = 'center';
  fitFont(T('btnShop'), W * 0.9, 34, '900');
  ctx.fillStyle = '#ffffff';
  ctx.fillText(T('btnShop'), W / 2, 56);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#ffd166';
  ctx.fillText(T('bank', save.bank.toLocaleString()), W / 2, 90);

  const rw = Math.min(560, W * 0.92);
  const rx = W / 2 - rw / 2;
  let ry = 116;
  const rh = Math.min(86, (H - 210) / 4 - 8);
  for (const item of SHOP) {
    const lvl = save.up[item.key];
    const maxed = lvl >= item.max;
    const cost = maxed ? 0 : item.costs[lvl];
    ctx.fillStyle = 'rgba(20,22,55,0.85)';
    rr(rx, ry, rw, rh, 14); ctx.fill();
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.icon, rx + 16, ry + rh / 2 + 10);
    const [iName, iDesc] = L.shop[item.key];
    ctx.fillStyle = '#ffffff';
    fitFont(iName, rw - 200, 18);
    ctx.fillText(iName, rx + 62, ry + 28);
    ctx.fillStyle = '#aab0d8';
    fitFont(iDesc, rw - 200, 13, 'normal');
    ctx.fillText(iDesc, rx + 62, ry + 48);
    // 레벨 핍
    for (let i = 0; i < item.max; i++) {
      ctx.fillStyle = i < lvl ? '#ffd166' : 'rgba(255,255,255,0.15)';
      rr(rx + 62 + i * 22, ry + rh - 22, 16, 8, 4); ctx.fill();
    }
    // 구매 버튼
    const canBuy = !maxed && save.bank >= cost;
    button(rx + rw - 118, ry + rh / 2 - 21, 104, 42,
      maxed ? 'MAX' : `💰${cost}`,
      () => {
        if (maxed || save.bank < cost) return;
        save.bank -= cost;
        save.up[item.key]++;
        persist();
        Sound.sfx('buy');
      },
      { color: canBuy ? '#ff5c8a' : undefined, disabled: !canBuy && !maxed || maxed, size: 16 });
    ry += rh + 10;
  }
  button(W / 2 - 90, H - 66, 180, 50, T('back'), () => { state = 'menu'; }, { color: '#4a55c9' });
}

/* ---------------- 일시정지 / 게임오버 ---------------- */
function drawPause() {
  drawPlayScene();
  uiButtons = [];
  ctx.fillStyle = 'rgba(4,5,16,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  fitFont(T('pauseTitle'), W * 0.92, 42, '900');
  ctx.fillStyle = '#ffffff';
  ctx.fillText(T('pauseTitle'), W / 2, H * 0.35);
  const bw = Math.min(300, W * 0.7);
  button(W / 2 - bw / 2, H * 0.46, bw, 58, T('btnResume'), () => { state = 'play'; lastTime = 0; }, { size: 22 });
  button(W / 2 - bw / 2, H * 0.46 + 72, bw, 50, T('btnGiveUp'), () => { endGame(); state = 'menu'; }, { color: '#2a2d45', size: 18 });
}

function drawOver() {
  drawBackground(run.theme, run.dist, 0.55);
  drawHeroine(W * 0.16, GY(), { pose: 'stand', eyesClosed: true });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff8fb3';
  const title = run.catches > 0 ? T('overWin') : T('overLose');
  fitFont(title, W * 0.94, 40, '900');
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 7;
  ctx.strokeText(title, W / 2, H * 0.2);
  ctx.fillText(title, W / 2, H * 0.2);

  ctx.fillStyle = '#cfd6ff';
  const flavor = run.catches >= 3 ? T('flavorLegend')
    : run.catches > 0 ? T('flavorSome', run.catches)
    : T('flavorNone');
  fitFont(flavor, W * 0.92, 17);
  ctx.fillText(flavor, W / 2, H * 0.2 + 34);

  const score = currentScore();
  const isBest = score >= save.best && score > 0;
  ctx.font = '900 52px sans-serif';
  ctx.fillStyle = '#ffd166';
  ctx.fillText(score.toLocaleString(), W / 2, H * 0.42);
  if (isBest) {
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#7bffc8';
    ctx.fillText(T('newBest'), W / 2, H * 0.42 + 32);
  }

  const statsTxt = T('overStats', Math.floor(run.dist), run.coins, run.catches, run.bestCombo);
  ctx.fillStyle = '#ffffff';
  fitFont(statsTxt, W * 0.94, 17);
  ctx.fillText(statsTxt, W / 2, H * 0.52);

  const bw = Math.min(300, W * 0.7);
  button(W / 2 - bw / 2, H * 0.6, bw, 60, T('btnRetry'), () => { startGame(); }, { size: 23 });
  button(W / 2 - bw / 2, H * 0.6 + 74, bw, 50, T('btnMenu'), () => { state = 'menu'; }, { color: '#4a55c9', size: 18 });
}

/* ============================================================
 * 인트로 컷씬
 * ============================================================ */
let cut = { i: 0, t: 0 };
function startIntro() { cut = { i: 0, t: 0 }; state = 'intro'; }
function finishIntro() {
  save.introSeen = true; persist();
  state = 'menu';
}
function introTap() {
  cut.i++; cut.t = 0;
  if (cut.i >= CUT.length) finishIntro();
}

function capBox(text, sub) {
  const y = H - 92;
  ctx.fillStyle = 'rgba(4,5,16,0.85)';
  rr(W * 0.06, y, W * 0.88, 64, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(255,209,102,0.4)';
  ctx.lineWidth = 2;
  rr(W * 0.06, y, W * 0.88, 64, 12); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  fitFont(text, W * 0.82, Math.min(19, W * 0.034));
  ctx.fillText(text, W / 2, y + (sub ? 27 : 38));
  if (sub) {
    ctx.fillStyle = '#aab0d8';
    fitFont(sub, W * 0.82, Math.min(14, W * 0.027), 'normal');
    ctx.fillText(sub, W / 2, y + 50);
  }
}

function drawSubwayInterior(shake) {
  ctx.save();
  if (shake) ctx.translate(rand(-2, 2), rand(-1, 1));
  // 벽/바닥
  ctx.fillStyle = '#d8dce8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#9aa2b8';
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  // 창문 + 흐르는 불빛
  ctx.fillStyle = '#10122a';
  rr(W * 0.08, H * 0.1, W * 0.36, H * 0.3, 14); ctx.fill();
  rr(W * 0.56, H * 0.1, W * 0.36, H * 0.3, 14); ctx.fill();
  ctx.save();
  ctx.beginPath();
  rr(W * 0.08, H * 0.1, W * 0.36, H * 0.3, 14); ctx.rect(W * 0.56, H * 0.1, W * 0.36, H * 0.3);
  ctx.clip();
  for (let i = 0; i < 14; i++) {
    const lx = (W + ((i * 173 - globalT * 700) % (W * 1.4)) + W * 1.4) % (W * 1.4) - W * 0.2;
    ctx.fillStyle = ['#ffd166', '#5ad1ff', '#ff8fb3'][i % 3];
    ctx.globalAlpha = 0.7;
    ctx.fillRect(lx, H * (0.14 + (i % 4) * 0.06), 26, 5);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // 좌석
  ctx.fillStyle = '#3f6fb5';
  rr(W * 0.1, H * 0.55, W * 0.8, H * 0.1, 10); ctx.fill();
  ctx.fillStyle = '#35619f';
  for (let i = 0; i < 6; i++) ctx.fillRect(W * (0.1 + i * 0.133), H * 0.55, 3, H * 0.1);
  // 손잡이
  for (let i = 0; i < 5; i++) {
    const hx = W * (0.15 + i * 0.18);
    const sw = Math.sin(globalT * 2 + i) * 5;
    ctx.strokeStyle = '#7a8298';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx + sw, H * 0.09); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx + sw, H * 0.09 + 12, 12, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

function drawSittingHeroine(x, y, headBob, eyesClosed) {
  ctx.save();
  ctx.translate(x, y);
  // 다리 (앉음)
  ctx.strokeStyle = '#2e3a5c';
  ctx.lineWidth = 10; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(22, -26); ctx.lineTo(24, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -28); ctx.lineTo(14, -24); ctx.lineTo(16, 2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(26, 4, 6, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(18, 4, 6, 0, TAU); ctx.fill();
  // 몸통
  ctx.fillStyle = '#ff5c8a';
  rr(-16, -66, 32, 40, 10); ctx.fill();
  // 머리 (꾸벅꾸벅)
  ctx.save();
  ctx.translate(0, -66);
  ctx.rotate(headBob);
  ctx.fillStyle = '#ffd9b8';
  ctx.beginPath(); ctx.arc(4, -10, 14, 0, TAU); ctx.fill();
  ctx.fillStyle = '#4a2f22';
  ctx.beginPath(); ctx.arc(2, -14, 14, Math.PI * 0.8, Math.PI * 1.98); ctx.fill();
  ctx.strokeStyle = '#4a2f22'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(-8, -18); ctx.quadraticCurveTo(-22, -8, -20, 8); ctx.stroke();
  if (eyesClosed) {
    ctx.strokeStyle = '#3a2418'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(7, -9); ctx.lineTo(13, -9); ctx.stroke();
  } else {
    ctx.fillStyle = '#2b1b12';
    ctx.beginPath(); ctx.arc(10, -10, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(11, -11, 1.2, 0, TAU); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function drawBagProp(x, y) {
  ctx.fillStyle = '#c9762f';
  rr(x - 16, y - 26, 34, 26, 6); ctx.fill();
  ctx.strokeStyle = '#8a4d1a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x + 1, y - 26, 12, Math.PI, 0); ctx.stroke();
  // 휴대폰
  ctx.fillStyle = '#222';
  rr(x + 22, y - 20, 12, 20, 3); ctx.fill();
  ctx.fillStyle = '#5ad1ff';
  rr(x + 24, y - 17, 8, 12, 2); ctx.fill();
}

const CUT = [
  { // 1. 도시 야경 + 달리는 지하철
    d: 4.2,
    draw(t) {
      drawBackground(0, 30 + t * 40, 0);
      const trainX = lerp(-W * 0.4, W * 1.1, t / 4.2);
      const ty = H * 0.52;
      ctx.fillStyle = '#3d4470';
      rr(trainX, ty, W * 0.55, 64, 12); ctx.fill();
      ctx.fillStyle = '#ffd166';
      for (let i = 0; i < 6; i++) rr(trainX + 20 + i * W * 0.085, ty + 14, W * 0.05, 24, 4), ctx.fill();
      ctx.fillStyle = '#5ad1ff';
      rr(trainX + W * 0.55 - 14, ty + 8, 10, 20, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, ty + 70, W, 4);
      capBox(T('c1a'), T('c1b'));
    },
  },
  { // 2. 꾸벅꾸벅 조는 수진
    d: 4.5,
    draw(t) {
      drawSubwayInterior(false);
      const bob = Math.sin(globalT * 1.6) * 0.22 + 0.15;
      drawSittingHeroine(W * 0.42, H * 0.66, bob, true);
      drawBagProp(W * 0.55, H * 0.66);
      // Zzz
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = '#8fe3ff';
      ctx.textAlign = 'center';
      for (let i = 0; i < 3; i++) {
        const zt = (globalT * 0.7 + i * 0.33) % 1;
        ctx.globalAlpha = 1 - zt;
        ctx.fillText('Z', W * 0.47 + i * 22 + zt * 18, H * 0.5 - zt * 60 - i * 12);
      }
      ctx.globalAlpha = 1;
      capBox(T('c2a'), T('c2b'));
    },
  },
  { // 3. 화들짝! 가방이 없다!
    d: 4,
    draw(t) {
      drawSubwayInterior(t < 0.6);
      drawSittingHeroine(W * 0.42, H * 0.66, -0.12, false);
      // 가방 없음! 점선 자리
      ctx.strokeStyle = 'rgba(255,90,90,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 7]);
      rr(W * 0.55 - 18, H * 0.66 - 28, 40, 28, 6); ctx.stroke();
      ctx.setLineDash([]);
      if (t < 0.5) { ctx.fillStyle = `rgba(255,255,255,${1 - t * 2})`; ctx.fillRect(0, 0, W, H); }
      // !! 이펙트
      const p = 1 + Math.sin(globalT * 14) * 0.12;
      ctx.save();
      ctx.translate(W * 0.42, H * 0.34);
      ctx.scale(p, p);
      ctx.font = '900 64px sans-serif';
      ctx.fillStyle = '#ff5252';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 10;
      ctx.textAlign = 'center';
      ctx.strokeText('!!', 0, 0);
      ctx.fillText('!!', 0, 0);
      ctx.restore();
      capBox(T('c3a'), T('c3b'));
    },
  },
  { // 4. 승강장 추격 시작
    d: 4.2,
    draw(t) {
      drawBackground(0, 100 + t * 130, 0);
      const p = clamp(t / 4.2, 0, 1);
      drawThief(lerp(W * 0.55, W * 0.92, p), GY(), { phase: globalT * 14 });
      drawHeroine(lerp(W * 0.05, W * 0.3, p), GY(), { pose: 'run', phase: globalT * 14 });
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6;
      const shout = T('shout');
      fitFont(shout, W * 0.9, 30);
      ctx.strokeText(shout, W / 2, H * 0.28);
      ctx.fillText(shout, W / 2, H * 0.28);
      capBox(T('c4a'), T('c4b'));
    },
  },
  { // 5. 타이틀 카드
    d: 6,
    draw(t) {
      drawBackground(1, 200, 0.3);
      const s = Math.min(1, t * 2.2);
      ctx.save();
      ctx.translate(W / 2, H * 0.4);
      ctx.scale(0.6 + s * 0.4, 0.6 + s * 0.4);
      ctx.globalAlpha = s;
      ctx.textAlign = 'center';
      fitFont(T('title'), W * 0.92, Math.min(64, W * 0.1), '900');
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 10;
      ctx.strokeText(T('title'), 0, 0);
      ctx.fillText(T('title'), 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      fitFont(T('c5sub'), W * 0.9, Math.min(20, W * 0.036));
      ctx.fillText(T('c5sub'), W / 2, H * 0.4 + 44);
      if (t > 0.8) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(globalT * 4);
        ctx.font = 'bold 18px sans-serif';
        ctx.fillStyle = '#8fe3ff';
        ctx.fillText(T('tap'), W / 2, H * 0.62);
        ctx.globalAlpha = 1;
      }
    },
  },
];

function drawIntro(dt) {
  cut.t += dt;
  const scene = CUT[cut.i];
  if (cut.t > scene.d) {
    cut.i++;
    cut.t = 0;
    if (cut.i >= CUT.length) { finishIntro(); return; }
  }
  CUT[cut.i].draw(cut.t);
  // 진행 점
  ctx.textAlign = 'center';
  for (let i = 0; i < CUT.length; i++) {
    ctx.fillStyle = i === cut.i ? '#ffd166' : 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(W / 2 - (CUT.length - 1) * 9 + i * 18, 22, 4, 0, TAU); ctx.fill();
  }
  button(W - 122, 14, 108, 40, T('skip'), () => finishIntro(), { color: 'rgba(255,255,255,0.15)', size: 15 });
}

/* ---------------- 메인 루프 ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (!lastTime) { lastTime = now; return; }
  let dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  globalT += dt;

  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  uiButtons = [];

  switch (state) {
    case 'boot':
      if (!save.lang) {
        langFirstBoot = true;
        state = 'lang';
      } else if (firstRunEver) {
        startIntro();
      } else {
        state = 'menu';
      }
      break;
    case 'lang':
      drawLangSelect();
      break;
    case 'intro':
      drawIntro(dt);
      break;
    case 'menu':
      drawMenu();
      break;
    case 'shop':
      drawShop();
      break;
    case 'play':
      updatePlay(dt);
      if (state === 'play' || state === 'over') {
        if (state === 'play') drawPlayScene();
        else drawOver();
      }
      break;
    case 'pause':
      drawPause();
      break;
    case 'over':
      drawOver();
      break;
  }
}
requestAnimationFrame(frame);
