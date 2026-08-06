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
  bgmMode: 'retro',                  // 'retro'(기본 합성 8비트) | 'custom'(내 음악 bgm.mp3)
  skill: 0, failStreak: 0,           // 보이지 않는 동적 난이도(DDA) 지표
  missions: null,                    // 일일 미션 {date, list}
  streakDay: '', streakCount: 0,     // 연속 출석
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
// 16진수 색을 흰색 쪽으로 섞어 밝게 (랜드마크가 배경 건물보다 도드라지게)
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const L = (v) => Math.round(v + (255 - v) * amt);
  return `rgb(${L(r)},${L(g)},${L(b)})`;
}

function fitFont(txt, maxW, size, weight) {
  const wt = weight || 'bold';
  ctx.font = `${wt} ${size}px sans-serif`;
  const w = ctx.measureText(txt).width;
  // 이모지는 measureText가 실제보다 좁게 재는 경우가 많아, 이모지 수만큼 여유폭을 뺀다.
  let emoji = 0; try { emoji = (txt.match(/\p{Extended_Pictographic}/gu) || []).length; } catch (e) {}
  const eff = maxW - emoji * 7;
  if (w > eff) ctx.font = `${wt} ${Math.max(9, Math.floor(size * eff / w))}px sans-serif`;
}

/* ---------------- Sound (WebAudio 합성) ---------------- */
const Sound = {
  ac: null, musicTimer: null, nextNoteTime: 0, step: 0, bgmEl: null,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); this.applyBgm(); return; }
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.startMusic();
      this.applyBgm();
    } catch (e) {}
  },
  // 앱이 백그라운드로 가거나 화면이 꺼질 때 모든 소리를 멈춘다.
  suspend() {
    try { if (this.ac && this.ac.state === 'running') this.ac.suspend(); } catch (e) {}
    if (this.bgmEl) { try { this.bgmEl.pause(); } catch (e) {} }
  },
  // 다시 돌아왔을 때 소리를 되살린다.
  resume() {
    try { if (this.ac && this.ac.state === 'suspended') this.ac.resume(); } catch (e) {}
    if (!save.muted && save.bgmMode === 'custom' && this.bgmEl) { this.bgmEl.play().catch(() => {}); }
  },
  setMuted(m) {
    save.muted = m; persist();
    if (m) { if (this.bgmEl) { try { this.bgmEl.pause(); } catch (e) {} } }
    else { this.init(); this.applyBgm(); }
  },
  setBgmMode(mode) { save.bgmMode = mode; persist(); this.applyBgm(); },
  // 내 음악(bgm.mp3) 재생 / 파일 없거나 실패 시 기본 레트로 BGM으로 자동 폴백
  applyBgm() {
    if (save.bgmMode === 'custom') {
      if (!this.bgmEl) {
        try {
          this.bgmEl = new Audio('bgm.mp3');
          this.bgmEl.loop = true; this.bgmEl.volume = 0.5;
          this.bgmEl.addEventListener('error', () => {
            save.bgmMode = 'retro'; persist();
            if (this.bgmEl) { try { this.bgmEl.pause(); } catch (e) {} this.bgmEl = null; }
          });
        } catch (e) { save.bgmMode = 'retro'; return; }
      }
      if (!save.muted) this.bgmEl.play().catch(() => {});
    } else if (this.bgmEl) {
      try { this.bgmEl.pause(); } catch (e) {}
    }
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
      case 'fever':  [659, 784, 988, 1318, 988, 1318, 1568].forEach((f, i) => this.tone(f, 0.12, 'square', 0.09, 0, this.ac.currentTime + i * 0.07)); break;
      case 'gold':   [784, 1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.11, 0, this.ac.currentTime + i * 0.06)); break;
      case 'near':   this.tone(1568, 0.07, 'square', 0.05, 300); break;
      case 'boss':   [98, 92, 87, 82].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.16, -12, this.ac.currentTime + i * 0.3)); this.noise(0.3, 0.08); break;
      case 'throw':  this.noise(0.08, 0.09); this.tone(700, 0.12, 'triangle', 0.06, -400); break;
      case 'bossHit': this.noise(0.14, 0.18); this.tone(120, 0.2, 'sawtooth', 0.14, -70); this.tone(880, 0.1, 'square', 0.08, 200); break;
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
      // 내 음악(custom) 모드일 땐 합성 BGM은 재생하지 않는다 (효과음은 그대로).
      const useCustom = (save.bgmMode === 'custom' && this.bgmEl);
      while (this.nextNoteTime < this.ac.currentTime + 0.25) {
        if (useCustom) { this.nextNoteTime += (60 / 140 / 2); this.step++; continue; }
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

// 언어별 대표 도시: 상징 건물(landmark) 실루엣 + 간판 텍스트.
// 영어권은 뉴욕·런던·시드니를 스테이지별로 번갈아 보여준다.
const CITY = {
  ko: { marks: ['seoul'],                    signs: ['24시', '노래방', '치킨', '카페', 'PC방', '분식'] },
  en: { marks: ['nyc', 'london', 'sydney'],  signs: ['DINER', 'BAR', '24H', 'CAFÉ', 'PIZZA', 'PUB'] },
  ja: { marks: ['tokyo'],                    signs: ['居酒屋', 'ラーメン', 'カラオケ', 'コンビニ', 'カフェ', '寿司'] },
  zh: { marks: ['shanghai'],                 signs: ['火锅', '奶茶', '网吧', '便利店', '咖啡', '烧烤'] },
  es: { marks: ['barcelona'],                signs: ['TAPAS', 'BAR', 'CAFÉ', '24H', 'FÚTBOL', 'PAN'] },
  fr: { marks: ['paris'],                    signs: ['CAFÉ', 'BAR', 'BISTRO', '24H', 'TABAC', 'PAIN'] },
};
function cityData() { return CITY[save.lang] || CITY.en; }
function landmarkForTheme(theme) { const c = cityData(); return c.marks[theme % c.marks.length]; }

/* ---------------- 상태 ---------------- */
let state = 'boot';   // boot | intro | menu | shop | play | pause | over
let run = null, P = null;
let heldRun = null, heldP = null;   // 홈으로 나갔다가 '이어서 하기' 위해 보관한 판
let uiButtons = [];
let lastTime = 0;
let globalT = 0;
let firstRunEver = !save.introSeen;

/* ---------------- 게임 시작/종료 ---------------- */
function startGame() {
  ensureMissions();
  run = {
    t: 0, dist: 0, coins: 0, catches: 0, items: 0, stage: 0,
    combo: 0, comboT: 0, bestCombo: 0,
    speed: 0, spawnD: 760, // 시작 직후 조작 안내를 읽을 유예 구간 (약간 단축)

    thief: null, thiefTimer: 4.5, hurtInChase: 0,
    obstacles: [], coinsArr: [], powerups: [], particles: [], floats: [],
    slowmo: 0, shake: 0, theme: 0, hintT: firstRunEver ? 6 : 2.5,
    caughtAnim: null,
    feverT: 0, feverCd: 0,           // 피버 타임
    mercyT: 0, hitTimes: [],         // 판 내 자비 구간 (플레이어에게 비노출)
    revived: false, settled: false,  // 이어하기 / 결과 정산 여부
    bestNotified: false,             // 최고기록 돌파 배너 1회
    missionReward: 0, streakBonus: 0,
    boss: null, bossPending: 0, projectiles: [], // 보스전
    playerShots: [],                             // 원거리 무기(거미줄/새총/불꽃) 발사체
    speedBurst: 0, dodgeStreak: 0,               // 레벨업 순간 가속 / 방구 연속 회피 카운트
    policeSpawned: false, policeReady: false,    // 경찰 사이렌: 스테이지당 1회 등장 / 보관된 찬스
    stageUpT: 0, stageUpStage: 0, stageUpTheme: 0, // 스테이지 승급 연출
    smashes: 0, nearMisses: 0, feverCount: 0,    // 미션 추적
    goldCatches: 0, bossKills: 0,
    noHitDist: 0, bestNoHit: 0,                  // 노히트 거리
  };
  const maxHearts = 3 + save.up.heart;
  P = {
    y: GY(), vy: 0, ground: true, jumps: 2,
    punchT: 0, inv: 0, hurtT: 0,
    shieldT: 0, magnetT: 0, boostT: 0,
    weapon: null, weaponCharges: 0,   // 원거리 무기 장착 상태
    spinT: 0, slide: 0,               // 빙판: 빙글빙글 도는 시간 / 앞으로 밀리는 오프셋
    hearts: maxHearts, maxHearts,
  };
  state = 'play';
}

function baseSpeed() { return 340 + save.up.shoe * 22; }

// 숨겨진 동적 난이도: 연패하면 살짝 느려지고, 잘하면 살짝 빨라진다 (0.85x ~ 1.25x)
function diffMod() { return clamp(1 + save.skill * 0.035, 0.85, 1.25); }

function currentScore() {
  if (!run) return 0;
  return Math.floor(run.dist * 3 + run.coins * 20 + run.catches * 700 + run.stage * 1500 + run.bestCombo * 15);
}

/* ---------------- 일일 미션 / 출석 ---------------- */
const MISSION_DEFS = [
  { k: 'dist',   goals: [1000, 1500, 2500], rewards: [100, 150, 250] },
  { k: 'catch',  goals: [3, 5, 8],          rewards: [120, 200, 300] },
  { k: 'coins',  goals: [200, 300, 500],    rewards: [100, 150, 250] },
  { k: 'combo',  goals: [20, 30, 40],       rewards: [100, 150, 250] },
  { k: 'smash',  goals: [8, 15, 25],        rewards: [100, 150, 250] },
  { k: 'near',   goals: [3, 6, 10],         rewards: [120, 180, 280] },
  { k: 'nomiss', goals: [300, 600, 1000],   rewards: [150, 220, 350] },
  { k: 'fever',  goals: [1, 2, 3],          rewards: [120, 180, 260] },
  { k: 'gold',   goals: [1, 1, 2],          rewards: [250, 250, 400] },
  { k: 'boss',   goals: [1, 1, 1],          rewards: [300, 300, 300] },
];

// 이번 판의 성과를 미션 진행값으로 환산 (정산·게임오버 미리보기 공용)
function missionRunValue(m) {
  switch (m.k) {
    case 'dist':   return m.p + Math.floor(run.dist);
    case 'catch':  return m.p + run.catches;
    case 'coins':  return m.p + run.coins;
    case 'combo':  return Math.max(m.p, run.bestCombo);
    case 'smash':  return m.p + run.smashes;
    case 'near':   return m.p + run.nearMisses;
    case 'nomiss': return Math.max(m.p, Math.floor(run.bestNoHit));
    case 'fever':  return m.p + run.feverCount;
    case 'gold':   return m.p + run.goldCatches;
    case 'boss':   return m.p + run.bossKills;
  }
  return m.p;
}
function todayStr(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function ensureMissions() {
  const d = todayStr();
  if (!save.missions || save.missions.date !== d) {
    const tier = save.skill >= 3 ? 2 : save.skill >= 0 ? 1 : 0; // 실력에 맞는 목표 (플로우 유지)
    // 초보(tier 0)에게는 스테이지 3 도달이 필요한 보스 미션 제외
    const pool = MISSION_DEFS.filter(df => tier >= 1 || df.k !== 'boss');
    const defs = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
    save.missions = {
      date: d,
      list: defs.map(df => ({ k: df.k, goal: df.goals[tier], reward: df.rewards[tier], p: 0, done: false })),
    };
    persist();
  }
}

const REVIVE_COST = 200;

/* 광고 브리지: 네이티브 앱(Capacitor+AdMob)이 window.AdBridge를 주입하면
 * 이어하기가 "광고 보고 무료 부활"로 자동 전환된다.
 * AdBridge 규약: { isRewardedReady(): boolean, showRewarded(onReward: () => void): void } */
const Ads = {
  ready() {
    try { return !!(window.AdBridge && window.AdBridge.isRewardedReady && window.AdBridge.isRewardedReady()); }
    catch (e) { return false; }
  },
  showRewarded(onReward) {
    try { window.AdBridge.showRewarded(onReward); } catch (e) {}
  },
};

function canRevive() { return run && !run.revived && (Ads.ready() || save.bank >= REVIVE_COST); }

function doRevive() {
  run.revived = true;
  P.hearts = Math.min(P.maxHearts, 2);
  P.inv = 2.5;
  run.mercyT = 6;
  run.hitTimes = [];
  run.projectiles.length = 0;
  run.obstacles = run.obstacles.filter(o => o.x - PX() > 260);
  persist();
  Sound.sfx('power');
  vibrate(40);
  state = 'play';
  lastTime = 0;
}

// 결과 정산: 코인·기록·미션·출석·DDA 갱신 (이어하기를 위해 사망 시점과 분리, 정확히 1회 실행)
// 최고 점수/거리를 즉시 저장 — 판이 정식 정산되기 전(일시정지·백그라운드·게임오버)에도
// 최고 기록이 유실되지 않도록 한다. (친구가 8만점 찍었는데 옛 기록만 남던 문제 방지)
function recordBest() {
  if (!run) return;
  const s = currentScore();
  let changed = false;
  if (s > save.best) { save.best = s; changed = true; }
  if (run.dist > save.bestDist) { save.bestDist = Math.floor(run.dist); changed = true; }
  if (changed) persist();
}

function settleRun() {
  if (!run || run.settled) return;
  run.settled = true;
  const score = currentScore();
  save.bank += run.coins;
  save.totalCatches += run.catches;
  if (score > save.best) save.best = score;
  if (run.dist > save.bestDist) save.bestDist = Math.floor(run.dist);
  save.introSeen = true;
  firstRunEver = false;

  // 일일 미션 진행/보상
  ensureMissions();
  for (const m of save.missions.list) {
    if (m.done) continue;
    m.p = missionRunValue(m);
    if (m.p >= m.goal) {
      m.done = true;
      save.bank += m.reward;
      run.missionReward += m.reward;
    }
  }

  // 연속 출석 보너스 (하루 1회)
  const d = todayStr();
  if (save.streakDay !== d) {
    save.streakCount = (save.streakDay === todayStr(-1)) ? (save.streakCount || 0) + 1 : 1;
    save.streakDay = d;
    run.streakBonus = Math.min(50 * save.streakCount, 250);
    save.bank += run.streakBonus;
  }

  // DDA: 짧게 끝난 판이 2번 이어지면 난이도 완화, 잘 달린 판은 상향
  const perf = run.dist / 1200 + run.catches * 0.6;
  if (perf < 0.6) {
    save.failStreak = (save.failStreak || 0) + 1;
    if (save.failStreak >= 2) { save.skill = Math.max(-4, save.skill - 1); save.failStreak = 0; }
  } else {
    save.failStreak = 0;
    if (perf > 2.2) save.skill = Math.min(6, save.skill + 1);
  }
  persist();
}

function endGame() {
  Sound.sfx('over');
  state = 'over';
  recordBest();                   // 최고 기록은 즉시 저장 (이어하기 여부와 무관)
  if (!canRevive()) settleRun(); // 이어하기가 불가능하면 즉시 정산
}

/* ---------------- 입력 ---------------- */
function doJump() {
  if (P.spinT > 0) return;   // 빙판에서 빙글빙글 도는 동안엔 아무 행동 불가
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
  if (P.spinT > 0) return;   // 빙판에서 도는 동안엔 공격도 불가
  if (P.punchT <= 0) {
    P.punchT = 0.22;
    Sound.sfx('punch');
    // 원거리 무기 장착 중 + 대상(도둑/보스)이 아직 멀리 있으면 → 무기를 날려 잡는다
    if (P.weapon && P.weaponCharges > 0 && run) {
      if (run.thief && !run.thief.escaping && run.thief.dx >= 120) fireWeapon();
      else if (run.boss && !run.boss.escaping && run.boss.dx >= 120) fireWeapon();
    }
  }
}

// 무기별 빗나갈 확률 (새총=정확, 거미줄=중간, 불꽃=크게 휘두름)
function weaponMissChance(kind) {
  return kind === 'sling' ? 0.15 : kind === 'web' ? 0.30 : 0.38;
}

// 도둑이 발사를 회피 (MISS) — 폴짝 뛰며 약올리고 살짝 벌어진다. 근접 펀치로 다시 노려야 함.
function thiefDodge() {
  const th = run.thief;
  if (!th) return;
  th.dx += 55;
  if (th.y >= GY() - 2) th.vy = -640;   // 회피 점프
  th.tauntT = 0.7;                       // 약올리는 메롱
  Sound.sfx('near');
  const tx = PX() + th.dx;
  addFloat(tx, GY() - 155, T('missShot'), '#ff8fb3', 1.25);
  burst(tx, GY() - 70, 8, '#cfd6ff', 3);
}

// 거미줄/새총/불꽃 발사체를 도둑을 향해 날린다
function fireWeapon() {
  P.weaponCharges--;
  const px = PX();
  run.playerShots.push({
    kind: P.weapon, x: px + 26, y: P.y - 58,
    vx: Math.max(820, run.speed + 560), t: 0, spin: 0,
  });
  Sound.sfx(P.weapon === 'fire' ? 'throw' : 'punch');
  vibrate(25);
  if (P.weaponCharges <= 0) {
    P.weapon = null;
    addFloat(px, P.y - 132, T('weaponOut'), '#cfd6ff', 1.0);
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
  if (document.hidden) {
    if (state === 'play') { recordBest(); state = 'pause'; }
    if (state === 'over') settleRun();     // 결과 화면에서 이탈해도 보상 보존
    Sound.suspend();                        // 백그라운드/화면꺼짐 시 BGM·효과음 정지
  } else {
    Sound.resume();                         // 다시 돌아오면 소리 복원
  }
});
// 다른 앱으로 전환(blur)에도 소리를 멈추고, 복귀(focus) 시 되살린다.
window.addEventListener('blur', () => { if (state === 'play') { recordBest(); state = 'pause'; } Sound.suspend(); });
window.addEventListener('focus', () => { Sound.resume(); });
window.addEventListener('pagehide', () => { Sound.suspend(); });

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
// 코인 아치를 실제 점프 포물선(가슴 높이) 위에 정확히 배치.
// x0 지점에서 점프하면 코인이 차례로 판정 중심을 통과하도록, 현재 속도로 폭을 계산한다.
function coinJumpArc(x0, sp) {
  const g = GY();
  const air = 2 * 900 / 2400;              // 점프 물리(vy=-900, g=2400)와 동일: 체공 0.75초
  const span = sp * air;                   // 점프 수평 거리
  const n = clamp(Math.round(span / 58), 5, 9);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * air;
    const feet = 900 * t - 1200 * t * t;   // 시점 t의 발 높이 (vy=-900, g=2400)
    run.coinsArr.push({ x: x0 + t * sp, y: g - 46 - feet, ph: i });
  }
}

// 방금 놓인 코인이 장애물과 겹치면 제거 (장애물 위에 코인이 박히는 문제 방지)
function removeCoinsOverlappingObstacles() {
  const g = GY();
  run.coinsArr = run.coinsArr.filter(c => {
    for (const o of run.obstacles) {
      if (o.type === 'pit' || o.type === 'ice') continue;  // 바닥형은 코인 제거 대상 아님
      const half = o.w / 2 + 18;
      let oTop, oBot;
      if (o.type === 'pigeon' || o.type === 'drone') { oBot = g - o.yOff; oTop = oBot - o.h; }
      else { oBot = g; oTop = g - o.h; }
      // 코인(반지름 ~14)이 장애물 박스에 겹치면 탈락
      if (c.x > o.x - half && c.x < o.x + half && c.y > oTop - 20 && c.y < oBot + 6) return false;
    }
    return true;
  });
}

// 신규 장애물 다양화 — 기존 패턴과 독립된 확률로 가끔 등장 (스폰 1회당 하나)
// 반환 true면 이번 스폰은 신규 장애물로 처리되었으니 기존 패턴을 건너뛴다.
function trySpawnVariety(x, g, sp, hard, adv) {
  if (run.mercyT > 0) return false;
  if (Math.random() > 0.24) return false;          // 76%는 기존 패턴 사용
  const O = run.obstacles, C = run.coinsArr;
  const pool = ['hydrant', 'trashbags'];
  if (adv) pool.push('cart', 'ice');
  if (adv && hard > 0.2) pool.push('drone');
  const type = pool[Math.floor(Math.random() * pool.length)];
  if (type === 'hydrant') {
    // 소화전: 낮지만 펀치가 안 통한다 — 무조건 점프로 회피
    O.push({ type: 'hydrant', x, w: 30, h: 44 });
  } else if (type === 'trashbags') {
    // 쓰레기봉투 더미: 펀치로 부수거나(코인) 점프로 넘기
    O.push({ type: 'trashbags', x, w: 60, h: 64 });
    if (Math.random() < 0.6) coinJumpArc(x - Math.max(120, sp * 0.28), sp);
  } else if (type === 'cart') {
    // 폭주 카트: 스크롤보다 빠르게 굴러온다 (펀치 또는 점프)
    O.push({ type: 'cart', x: x + 180, w: 54, h: 58, vx: 80 + hard * 95, ph: rand(0, TAU) });
  } else if (type === 'drone') {
    // 택배 드론: 높이 날며 아래로 물건을 흘린다 (더블점프+펀치, 또는 아래로 통과)
    O.push({ type: 'drone', x, w: 52, h: 34, yOff: rand(150, 188), ph: rand(0, TAU) });
    for (let i = 0; i < 4; i++) C.push({ x: x - 30 + i * 40, y: g - 44, ph: i });
  } else if (type === 'ice') {
    // 바닥 빙판: 넓어서 한 번에 뛰어넘기 어렵다 — 밟으면 빙글빙글 회전
    O.push({ type: 'ice', x, w: rand(140, 220), h: 0 });
  }
  return true;
}

function spawnPattern() {
  const r = Math.random();
  const x = W + 140;
  const g = GY();
  const O = run.obstacles, C = run.coinsArr, U = run.powerups;
  const sp = Math.max(340, run.speed);
  const hard = clamp(run.t / 95, 0, 1);            // 난이도 상승을 더 완만하게 (초반 여유)
  const adv = run.stage >= 1 || run.t > 65;        // 스테이지 1: 구덩이·킥보드 해금 (더 늦게)
  const adv2 = run.stage >= 2 || run.t > 130;      // 스테이지 2: 더 빠른 킥보드

  if (trySpawnVariety(x, g, sp, hard, adv)) {
    // 신규 장애물로 처리됨 — 기존 패턴 스킵
  } else if (adv && !run.mercyT && r < 0.10) {
    // 맨홀 구덩이: 점프로만 회피 (점프 궤적을 따라가는 코인으로 점프 유도)
    O.push({ type: 'pit', x, w: 100, h: 0 });
    coinJumpArc(x - Math.max(120, sp * 0.28), sp);
  } else if (adv && !run.mercyT && r < 0.19) {
    // 폭주 킥보드: 화면 스크롤보다 빠르게 돌진 (펀치 또는 점프)
    O.push({ type: 'rider', x: x + 220, w: 44, h: 88, vx: 130 + hard * 100 + (adv2 ? 50 : 0), ph: rand(0, TAU) });
  } else if (r < 0.30) {
    O.push({ type: 'cone', x, w: 34, h: 46 });
  } else if (r < 0.41) {
    O.push({ type: 'barrier', x, w: 56, h: 62 });
    if (Math.random() < 0.5) for (let i = 0; i < 4; i++) C.push({ x: x - 60 + i * 44, y: g - 130 - Math.sin(i / 3 * Math.PI) * 46, ph: i });
  } else if (r < 0.51) {
    O.push({ type: 'boxes', x, w: 58, h: 112 });
    C.push({ x: x + 110, y: g - 44, ph: 0 });
    C.push({ x: x + 154, y: g - 44, ph: 1 });
  } else if (!run.mercyT && adv && r < 0.55 + hard * 0.07 + run.stage * 0.02) {
    // 이단 콤보 — 간격을 현재 속도로 계산해 "착지하자마자 충돌"을 없앤다:
    // 근접형(한 번의 점프로 둘 다 넘기) 또는 원거리형(착지 후 여유 뒤 재점프)
    O.push({ type: 'cone', x, w: 34, h: 46 });
    const nearPair = Math.random() < 0.45;
    const d2 = nearPair ? sp * rand(0.34, 0.46) : sp * rand(0.98, 1.15);
    if (nearPair) O.push({ type: 'cone', x: x + d2, w: 34, h: 46 });
    else O.push({ type: Math.random() < 0.5 ? 'barrier' : 'cone', x: x + d2, w: 50, h: 58 });
  } else if (!run.mercyT && adv && hard > 0.55 && run.stage >= 1 && r < 0.70) {
    // 삼단 압박: 콘 → 공중 비둘기(점프 중 펀치!) → 콘 (충분히 익숙해진 뒤에만)
    O.push({ type: 'cone', x, w: 34, h: 46 });
    O.push({ type: 'pigeon', x: x + sp * 0.35, w: 52, h: 38, yOff: rand(118, 138), ph: rand(0, TAU) });
    O.push({ type: 'cone', x: x + sp * rand(1.0, 1.15), w: 34, h: 46 });
  } else if (r < 0.75) {
    // 비둘기 떼: 아래로 지나가거나 펀치
    O.push({ type: 'pigeon', x, w: 52, h: 38, yOff: rand(118, 150), ph: rand(0, TAU) });
    for (let i = 0; i < 5; i++) C.push({ x: x - 40 + i * 44, y: g - 36, ph: i });
  } else if (r < 0.83) {
    // 코인 아치: 점프 포물선과 정확히 일치 (잘 뛰면 전부 먹힌다)
    coinJumpArc(x, sp);
  } else if (r < 0.905) {
    // 낮은 코인 줄
    for (let i = 0; i < 6; i++) C.push({ x: x + i * 46, y: g - 42, ph: i });
  } else {
    // 파워업 (하트는 체력 부족할 때만 조금 더, 넉넉하면 거의 안 나오게 — 더 랜덤하게)
    const heartBias = P.hearts <= 1 ? 0.22 : (P.hearts >= 4 ? 0.03 : 0.08);
    let type;
    if (adv && Math.random() < 0.5) {
      // 원거리 무기: 거미줄 / 새총 / 불꽃 (스테이지1+ 에서만)
      type = ['web', 'sling', 'fire'][Math.floor(rand(0, 3))];
    } else {
      const pr = Math.random();
      if (pr < heartBias) type = 'heart';
      else if (pr < heartBias + 0.30) type = 'magnet';
      else if (pr < heartBias + 0.55) type = 'shield';
      else type = 'boost';
    }
    // 한 번의 점프로 편하게 닿는 높이대(g-82 ~ g-116)에 배치 — 획득 난이도 완화
    U.push({ type, x, y: g - 82 - rand(0, 34), ph: rand(0, TAU) });
  }
  // 간격: "점프 체공 0.75초 + 반응 여유" 기반 시간 단위 (착지 지점 함정 방지)
  // DDA(실력↓ → 넓게) · 자비 구간 더 넓게 · 스테이지가 오를수록 타이트하게
  // 초반 40초는 간격을 넉넉히 벌려(1.5 → 1.0) 반응·회복 시간을 충분히 확보한다.
  const earlyMul = 1 + 0.5 * (1 - clamp(run.t / 40, 0, 1));
  const gapMul = clamp(1 - save.skill * 0.04, 0.85, 1.35)
    * earlyMul
    * (run.mercyT > 0 ? 1.4 : 1)
    * (1 - Math.min(0.18, run.stage * 0.045));
  // 착지 안전 하한(sp*1.0): 점프 수평거리(sp*0.75)보다 충분히 뒤 — 착지 즉시 충돌 불가 + 여유
  run.spawnD = Math.max((rand(170, 330) + sp * 0.72) * gapMul, sp * 1.0);
  // 이번 패턴에서 장애물과 겹친 코인 정리
  removeCoinsOverlappingObstacles();
}

/* ---------------- 도둑 ---------------- */
function spawnThief() {
  // 등장 거리를 더 가깝게(300~400px) — 몇 초 안에 따라잡을 수 있게 (진행성↑)
  const golden = Math.random() < 0.10; // ✨ 황금 도둑: 낮은 확률의 잭팟 (가변 비율 보상)
  run.thief = {
    dx: clamp(W * 0.6, 300, 400), y: GY(), vy: 0,
    jumpT: rand(0.6, 1.2), escaping: false, gone: false, golden,
  };
  run.hurtInChase = 0;
  const idx = run.items % 3;
  if (golden) {
    Sound.sfx('gold');
    addFloat(W * 0.6, GY() - 220, T('goldThief'), '#ffe066', 1.3);
  } else {
    addFloat(W * 0.6, GY() - 220, T('thiefFound', ITEM_ICONS[idx], L.items[idx]), '#ffd166', 1.15);
  }
}

function catchThief(method) {
  method = method || 'punch';
  const idx = run.items % 3;
  const golden = run.thief.golden;
  run.items++; run.catches++;
  run.combo += 15; run.comboT = 3;
  run.bestCombo = Math.max(run.bestCombo, run.combo);
  const bonus = (100 + run.stage * 50) * (golden ? 4 : 1);
  run.coins += bonus;
  run.slowmo = 0.55; run.shake = 0.35;
  Sound.sfx(golden ? 'gold' : method === 'fire' ? 'throw' : 'catch');
  vibrate(golden ? 120 : 60);
  const tx = PX() + run.thief.dx;
  const catchCol = method === 'fire' ? '#ff8a3c' : method === 'web' ? '#dfe7ff' : method === 'police' ? '#5ad1ff' : '#ffd166';
  burst(tx, GY() - 60, golden ? 40 : 26, catchCol, 4, true);
  burst(tx, GY() - 60, 14, golden ? '#fff1c4' : method === 'fire' ? '#ffb24a' : '#ff8fb3', 3, true);
  // 무기별 짤막한 한 방 문구
  if (method === 'web' || method === 'sling' || method === 'fire') addFloat(tx, GY() - 150, T(method === 'web' ? 'fxWeb' : method === 'sling' ? 'fxSling' : 'fxFire'), catchCol, 1.1);
  if (golden) {
    run.goldCatches++;
    addFloat(W / 2, H * 0.32, T('goldCatch', bonus), '#ffe066', 1.6);
    // 황금 도둑은 파워업도 떨군다
    const drop = ['magnet', 'shield', 'boost', 'heart'][Math.floor(rand(0, 4))];
    run.powerups.push({ type: drop, x: PX() + 260, y: GY() - 80, ph: 0 });
  } else {
    addFloat(W / 2, H * 0.32, T('gotItem', ITEM_ICONS[idx], L.items[idx], bonus), '#ffd166', 1.5);
  }
  // 2/3 회수 → "하나만 더 잡으면 레벨업!" 시점 안내 (레벨업 임박 표기)
  if (run.items % 3 === 2) {
    addFloat(W / 2, H * 0.32 + 46, T('oneMoreLevel'), '#7bffc8', 1.15);
  }
  run.caughtAnim = { x: tx, y: GY(), t: 0, method };
  run.thief = null;
  run.thiefTimer = rand(6, 9);   // 다음 도둑이 더 빨리 등장 (진행 기회↑)

  if (run.items % 3 === 0) {
    // 세 가지 모두 회수 → 스테이지 클리어 (성공은 곧 난이도 상승)
    run.stage++;
    run.theme = (run.theme + 1) % THEMES.length;
    P.hearts = Math.min(5, P.hearts + 1);   // 스테이지 클리어 보상 하트 (최대 5칸)
    run.coins += 300;
    save.skill = Math.min(6, save.skill + 1);
    Sound.sfx('clear');
    // 레벨업(다음 구역 진입) 시각 연출 트리거 + 잠깐의 가속(곧 가라앉음)
    run.stageUpT = 2.4;
    run.speedBurst = 120;
    run.stageUpStage = run.stage + 1;   // 표시용(1-based)
    run.stageUpTheme = run.theme;
    run.policeSpawned = false;          // 다음 스테이지에서 경찰 아이템 다시 등장 가능
    run.slowmo = Math.max(run.slowmo, 0.9);
    addFloat(W / 2, H * 0.45 + 44, T('stageClear2'), '#ffffff', 1.0);
    // 스테이지 3, 6, 9… 클리어 직후엔 도둑 두목이 직접 나선다!
    if (run.stage % 3 === 0) run.bossPending = 3.5;
  }
}

/* ---------------- 보스전: 도둑 두목 ---------------- */
function spawnBoss() {
  run.boss = {
    dx: clamp(W * 0.72, 380, 480), y: GY(), vy: 0,
    hp: 4 + Math.min(2, Math.floor(run.stage / 3)),  // 4방 → 최대 6방
    throwT: 1.4, jumpT: 1.1, staggerT: 0, hurtCount: 0, escaping: false,
  };
  run.boss.maxHp = run.boss.hp;
  run.shake = 0.35;
  Sound.sfx('boss');
  vibrate(120);
  addFloat(W / 2, H * 0.3, T('bossAppear'), '#ff6b6b', 1.5);
}

function bossDefeated() {
  const b = run.boss;
  const reward = 500 + run.stage * 100;
  run.coins += reward;
  run.catches++;
  run.bossKills++;
  run.combo += 30; run.comboT = 3;
  run.bestCombo = Math.max(run.bestCombo, run.combo);
  P.hearts = Math.min(P.maxHearts, P.hearts + 2);
  run.feverT = 8; run.feverCd = 25;
  run.slowmo = 0.8; run.shake = 0.5;
  Sound.sfx('gold');
  vibrate(150);
  const tx = PX() + b.dx;
  burst(tx, GY() - 70, 50, '#ffd166', 5, true);
  burst(tx, GY() - 70, 24, '#ff6b6b', 4, true);
  addFloat(W / 2, H * 0.32, T('bossDown', reward), '#ffe066', 1.7);
  run.caughtAnim = { x: tx, y: GY(), t: 0, boss: true };
  run.boss = null;
  run.projectiles.length = 0;
  run.thiefTimer = rand(9, 14);
}

function bossEscape() {
  run.boss.escaping = true;
  Sound.sfx('escape');
  addFloat(W * 0.6, GY() - 240, T('bossTaunt'), '#ff8fb3', 1.2);
}

// 방구를 3연속 피하면 두목이 돌부리에 걸려 스스로 넘어진다 (자기 체력 -1)
function bossTrip() {
  const b = run.boss;
  if (!b) return;
  b.hp--;
  b.staggerT = 1.0;
  b.tripT = 1.0;
  run.slowmo = 0.4; run.shake = 0.45;
  Sound.sfx('bossHit');
  vibrate(90);
  const bx = PX() + b.dx;
  burst(bx, GY() - 60, 22, '#b6d97a', 4, true);
  addFloat(bx, GY() - 185, T('bossTrip'), '#7bffc8', 1.45);
  if (b.hp <= 0) bossDefeated();
}

// 원거리 무기로 보스에게 한 방 (근접 펀치와 동일한 대미지)
function weaponHitBoss(kind) {
  const b = run.boss;
  if (!b) return;
  b.hp--;
  b.staggerT = 0.55;
  run.slowmo = 0.25; run.shake = 0.3;
  Sound.sfx('bossHit');
  vibrate(70);
  const bx = PX() + b.dx;
  const col = kind === 'fire' ? '#ff8a3c' : kind === 'web' ? '#dfe7ff' : '#8fe3ff';
  burst(bx, GY() - 70, 18, col, 4, true);
  run.coins += 20;
  run.combo += 5; run.comboT = 3;
  run.bestCombo = Math.max(run.bestCombo, run.combo);
  if (b.hp <= 0) bossDefeated();
  else {
    b.dx += 240;
    addFloat(bx, GY() - 175, ['💢', '😤', '🤬'][Math.floor(rand(0, 3))], '#ffffff', 1.3);
  }
}

// 보스전 중에는 장애물 대신 코인/회복 위주로만 스폰 (결투에 집중)
function spawnBossPattern() {
  const x = W + 140, g = GY(), C = run.coinsArr;
  for (let i = 0; i < 5; i++) C.push({ x: x + i * 46, y: g - 42, ph: i });
  // 하트는 드물게 + 체력 부족할 때만 (두목 근처 하트 남발 방지)
  if (P.hearts < 3 && Math.random() < 0.05) run.powerups.push({ type: 'heart', x: x + 280, y: g - 90, ph: 0 });
  run.spawnD = rand(500, 800) + run.speed * 0.4;
}

function thiefEscape() {
  run.thief.escaping = true;
  Sound.sfx('escape');
  addFloat(W * 0.6, GY() - 220, T('escapeTaunt'), '#ff8fb3', 1.1);
  // 레벨이 높아 도둑이 잡힐 듯 말 듯 놓쳤을 때만 '경찰 사이렌' 구원 아이템이 등장한다.
  if (run.stage >= 3 && !run.policeSpawned && Math.random() < 0.6) {
    run.policeSpawned = true;   // 판당 남발 방지 (다음 스테이지에서 리셋)
    run.powerups.push({ type: 'police', x: W + 120, y: GY() - 100 - rand(0, 26), ph: rand(0, TAU) });
    addFloat(W * 0.5, GY() - 250, T('policeChance'), '#5ad1ff', 1.2);
  }
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
  run.combo = 0; run.feverT = 0; run.shake = 0.4;
  run.noHitDist = 0;
  // 판 내 자비: 12초 안에 2번 맞으면 잠시 패턴을 느슨하게 (플레이어에게 비노출)
  run.hitTimes.push(run.t);
  run.hitTimes = run.hitTimes.filter(t => run.t - t < 12);
  if (run.hitTimes.length >= 2) { run.mercyT = 6; run.hitTimes = []; }
  Sound.sfx('hurt');
  vibrate(90);
  burst(PX(), P.y - 40, 12, '#ff6b6b', 3);
  if (run.thief && !run.thief.escaping) {
    run.thief.dx += 120;                 // 피격 시 도둑이 덜 멀어지게 (완화)
    run.hurtInChase++;
    if (run.hurtInChase >= 3) thiefEscape(); // 3번 맞아야 놓침 (기존 2 → 3, 진행 가능성↑)
  }
  if (run.boss && !run.boss.escaping) {
    run.boss.dx += 150;
    run.boss.hurtCount++;
    if (run.boss.hurtCount >= 4) bossEscape();  // 보스가 단단해진 만큼 놓치는 기준도 완화
  }
  if (P.hearts <= 0) endGame();
}

function smash(o, color) {
  o.dead = true;
  run.smashes++;
  Sound.sfx('smash');
  burst(o.x, GY() - o.h / 2 - (o.yOff || 0), 16, color || '#d9a05b', 4);
  const mult = 1 + Math.floor(run.combo / 10) + (run.feverT > 0 ? 1 : 0);
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

  // 속도 완급 조절 — "쉬어가는 리듬": 시작은 살짝 빠르게, 완만히 오르되
  // 느긋↔긴장 파도(약 15초 주기)로 중간중간 숨 돌릴 구간을 넣고,
  // 레벨업 순간엔 잠깐 빨라졌다가 다시 가라앉는다.
  run.speedBurst = Math.max(0, run.speedBurst - 42 * dt);
  const warm = clamp(run.t / 48, 0, 1);
  const ramp = 55 + 175 * warm;                     // 시작 +55 (살짝 빠르게), 최대 +230
  const wave = Math.sin(run.t / 15 * TAU) * 52;     // 쉬어가는/조여드는 리듬
  const stageAdj = run.stage * 22;
  const target = (baseSpeed() + ramp + wave + run.speedBurst + stageAdj) * diffMod() * (P.boostT > 0 ? 1.4 : 1);
  // 또렷하게 목표를 따라가 미끄러짐 없이, 리듬 변화는 부드럽게 체감
  run.speed = lerp(run.speed, target, 1 - Math.pow(0.035, dt));
  const sp = run.speed;
  run.dist += sp * dt / 10;
  run.noHitDist += sp * dt / 10;
  run.bestNoHit = Math.max(run.bestNoHit, run.noHitDist);

  // 피버 타임: 30콤보 도달 시 8초간 코인 배수 +1
  run.mercyT = Math.max(0, run.mercyT - dt);
  run.feverT = Math.max(0, run.feverT - dt);
  run.feverCd = Math.max(0, run.feverCd - dt);
  if (run.combo >= 30 && run.feverT <= 0 && run.feverCd <= 0) {
    run.feverT = 8; run.feverCd = 25;
    run.feverCount++;
    Sound.sfx('fever');
    vibrate(50);
    addFloat(W / 2, H * 0.3, T('fever'), '#ffe066', 1.5);
  }

  // 최고 기록 돌파 순간 (판당 1회)
  if (!run.bestNotified && save.best > 0 && currentScore() > save.best) {
    run.bestNotified = true;
    Sound.sfx('clear');
    addFloat(W / 2, H * 0.38, T('bestBreak'), '#7bffc8', 1.4);
  }

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
  // 빙판: 회전(행동불가) 타이머 감소, 끝나면 앞으로 밀린 위치가 서서히 원위치로
  P.spinT = Math.max(0, P.spinT - dt0);
  if (P.spinT <= 0) P.slide = Math.max(0, P.slide - 90 * dt0);
  run.comboT -= dt;
  if (run.comboT <= 0) run.combo = Math.max(0, run.combo - Math.ceil(run.combo * dt * 2));

  // 스폰 (보스전 중에는 전용 패턴)
  run.spawnD -= sp * dt;
  if (run.spawnD <= 0) {
    if (run.boss || run.bossPending > 0) spawnBossPattern();
    else spawnPattern();
  }

  const px = PX() + P.slide, g = GY();   // 빙판에서 앞으로 밀린 만큼 판정 위치도 이동
  const pTop = P.y - 82, pL = px - 17, pR = px + 17;

  // 장애물
  for (const o of run.obstacles) {
    o.x -= (sp + (o.vx || 0)) * dt;
    if (o.dead) continue;
    const oL = o.x - o.w / 2, oR = o.x + o.w / 2;

    // 빙판: 밟으면 빙글빙글 돌며 앞으로 미끄러진다. 도는 동안 행동 불가(공격·점프·회피 X).
    // 앞으로 밀려 코인을 쓸어담거나 도둑에 가까워지는 이득 ↔ 그동안 무방비인 위험 (아이러니)
    if (o.type === 'ice') {
      if (P.ground && px + 15 > oL && px - 15 < oR) {
        P.spinT = Math.min(1.4, Math.max(P.spinT, 1.05));   // 최소 1초 이상 회전
        P.slide = Math.min(80, P.slide + 190 * dt);
        if (!o.slipSfx) { Sound.sfx('near'); o.slipSfx = true; }
      }
      continue;
    }

    // 맨홀 구덩이: 지상에서 밟으면 피격 (점프로만 회피, 펀치 불가)
    if (o.type === 'pit') {
      if (!o.hit && P.ground && px > oL + 6 && px < oR - 6 && P.boostT <= 0) {
        o.hit = true;
        hurt(null);
        if (state !== 'play') return;
        P.vy = -520; P.ground = false; // 구덩이에서 튀어나오는 연출
      }
      continue;
    }

    let oTop, oBot;
    if (o.type === 'pigeon' || o.type === 'drone') {
      const bob = Math.sin(globalT * 4 + o.ph) * 8;
      oBot = g - o.yOff + bob;
      oTop = oBot - o.h;
    } else {
      oBot = g; oTop = g - o.h;
    }
    // 펀치로 부술 수 있는 것만 (점프 전용: 택배상자 boxes · 바리케이드 barrier · 소화전 hydrant · 구덩이 pit · 빙판 ice)
    if (P.punchT > 0.1 && (o.type === 'pigeon' || o.type === 'cone' || o.type === 'rider' || o.type === 'trashbags' || o.type === 'cart' || o.type === 'drone')) {
      if (oL < px + 105 && oR > px + 10 && oTop < P.y + 5 && oBot > P.y - 150) {
        const sc = o.type === 'pigeon' || o.type === 'drone' ? '#cfd6ff' : o.type === 'rider' || o.type === 'cart' ? '#8fe3ff' : '#d9a05b';
        smash(o, sc);
        continue;
      }
    }
    // 충돌
    if (oL < pR && oR > pL && oTop < P.y && oBot > pTop) {
      if (P.boostT > 0) { smash(o, '#ffd166'); continue; }
      o.nm = true; // 피격한 장애물은 니어미스 대상에서 제외
      hurt(o);
      if (state !== 'play') return;
    }
    // 니어미스 추적: 겹치는 동안 발끝~장애물 상단의 최소 간격 기록
    if (o.type !== 'pigeon' && o.type !== 'drone' && !o.nm) {
      if (oL < pR && oR > pL && P.y < oTop) {
        const c = oTop - P.y;
        o.minC = o.minC === undefined ? c : Math.min(o.minC, c);
      } else if (oR < pL && o.minC !== undefined && o.minC < 26) {
        // 아슬아슬하게 넘었다! 작은 보상 (니어미스 심리 — 긴장 → 안도 → 보상)
        o.nm = true;
        run.nearMisses++;
        run.coins += 5;
        run.combo += 3; run.comboT = 3;
        Sound.sfx('near');
        addFloat(px, P.y - 115, T('nearMiss') + ' +5', '#8fe3ff', 0.9);
      }
    }
  }
  run.obstacles = run.obstacles.filter(o => !o.dead && o.x > -160);

  // 코인 (피버 중엔 배수 +1)
  const mult = 1 + Math.floor(run.combo / 10) + (run.feverT > 0 ? 1 : 0);
  for (const c of run.coinsArr) {
    c.x -= sp * dt;
    if (P.magnetT > 0) {
      const dx = px - c.x, dy = (P.y - 46) - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 220) { c.x += dx / d * 620 * dt; c.y += dy / d * 620 * dt; }
    }
    const d2 = Math.hypot(c.x - px, c.y - (P.y - 46));
    if (d2 < 60) {
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
    if (d < 64) {
      u.dead = true;
      Sound.sfx('power');
      vibrate(30);
      if (u.type === 'magnet') { P.magnetT = 6 + save.up.magnet * 2; addFloat(px, P.y - 120, T('puMagnet'), '#8fe3ff', 1.1); }
      if (u.type === 'shield') { P.shieldT = 8 + save.up.shield * 2; addFloat(px, P.y - 120, T('puShield'), '#9fd8ff', 1.1); }
      if (u.type === 'boost')  { P.boostT = 2.6; run.shake = 0.2; addFloat(px, P.y - 120, T('puBoost'), '#ffd166', 1.2); }
      if (u.type === 'heart')  {
        // 하트는 축적 가능 — 이미 가득해도 코인 전환 없이 하나 더 쌓인다 (최대 5칸)
        P.hearts = Math.min(5, P.hearts + 1);
        addFloat(px, P.y - 120, T('puHeal'), '#ff8fb3', 1.1);
      }
      if (u.type === 'web' || u.type === 'sling' || u.type === 'fire') {
        P.weapon = u.type; P.weaponCharges = 1;   // 1발만 — 한 방을 신중하게 (너무 쉬워지지 않게)
        addFloat(px, P.y - 122, T(u.type === 'web' ? 'puWeb' : u.type === 'sling' ? 'puSling' : 'puFire'), '#dfe7ff', 1.15);
      }
      if (u.type === 'police') {
        // 경찰 출동! 보스전이면 두목 체력 -1, 아니면 (도망친) 도둑을 대신 잡아준다.
        run.policeFlash = 1.3;
        Sound.sfx('gold'); vibrate(70);
        addFloat(px, P.y - 128, T('policeGo'), '#5ad1ff', 1.3);
        if (run.boss && !run.boss.escaping) weaponHitBoss('police');
        else if (run.thief) catchThief('police');
        else run.policeReady = true;   // 지금 대상이 없으면 다음 도둑/두목에게 사용
      }
      burst(u.x, u.y, 12, '#ffffff', 3, true);
    }
  }
  run.powerups = run.powerups.filter(u => !u.dead && u.x > -60);

  // 보스 등장 대기
  if (run.bossPending > 0) {
    run.bossPending -= dt;
    if (run.bossPending <= 0 && !run.boss) spawnBoss();
  }

  // 보스전
  if (run.boss) {
    const b = run.boss;
    b.staggerT = Math.max(0, b.staggerT - dt);
    b.tripT = Math.max(0, (b.tripT || 0) - dt);
    // 보관된 경찰 찬스 → 두목 체력 -1
    if (run.policeReady && !b.escaping) { run.policeReady = false; weaponHitBoss('police'); if (state !== 'play') return; }
    const factor = b.escaping ? 1.45 : (b.staggerT > 0 ? 1.0 : 0.90);
    b.dx += (factor - 1) * sp * dt;
    // 안전장치: 두목이 플레이어 뒤로 빠져 게임이 멈추는 소프트락 방지 (앞에서 대기)
    if (!b.escaping) b.dx = Math.max(70, b.dx);
    b.jumpT -= dt;
    b.vy += 2600 * dt;
    b.y += b.vy * dt;
    if (b.y >= g) { b.y = g; b.vy = 0; if (b.jumpT <= 0 && !b.escaping) { b.vy = -rand(380, 560); b.jumpT = rand(0.9, 1.7); } }
    // 방구 발사 — 일직선(점프로 피함) 또는 높이(가만히 있어야 피함) 랜덤. "뿡/흥/칫" 텍스트 동반.
    if (!b.escaping && b.staggerT <= 0 && b.dx < W * 0.9) {
      b.throwT -= dt;
      if (b.throwT <= 0) {
        b.throwT = rand(1.1, 1.8) - Math.min(0.5, run.stage * 0.05);
        const words = ['뿡!', '흥!', '칫!'];
        const shoot = () => {
          const high = Math.random() < 0.5;             // true=머리 위(가만히), false=몸통(점프)
          run.projectiles.push({
            x: px + b.dx - 24, y: high ? g - 150 : g - 44,
            vx: -(sp * 0.45 + rand(200, 300)), vy: 0, high,
            word: words[Math.floor(rand(0, 3))], puff: rand(0, TAU), t: 0, passed: false,
          });
        };
        shoot();
        if (run.stage >= 3 && Math.random() < 0.4) shoot(); // 후반 2연발
        Sound.sfx('throw');
        addFloat(px + b.dx - 30, b.y - 96, ['뿡~💨', '흥!💨', '칫!💨'][Math.floor(rand(0, 3))], '#b6d97a', 1.1);
      }
    }
    // 펀치 타격
    if (!b.escaping && P.punchT > 0.1 && b.dx < 115 && b.staggerT <= 0) {
      b.hp--;
      b.staggerT = 0.55;
      run.slowmo = 0.25; run.shake = 0.3;
      Sound.sfx('bossHit');
      vibrate(70);
      burst(px + b.dx, g - 70, 18, '#ffd166', 4, true);
      run.coins += 20;
      run.combo += 5; run.comboT = 3;
      run.bestCombo = Math.max(run.bestCombo, run.combo);
      if (b.hp <= 0) bossDefeated();
      else {
        b.dx += 190;   // 타격 후 후퇴 (과하지 않게 — 긴 체력과 균형)
        addFloat(px + Math.min(b.dx, W * 0.7), g - 175, ['💢', '😤', '🤬'][Math.floor(rand(0, 3))], '#ffffff', 1.3);
      }
    }
    if (run.boss && run.boss.escaping && run.boss.dx > W + 300) {
      run.boss = null;
      run.projectiles.length = 0;
      run.thiefTimer = rand(8, 12);
    }
  }

  // 보스 방구 발사물 (일직선/높이 이동, 중력 없음)
  for (const pj of run.projectiles) {
    pj.t += dt;
    pj.puff += dt * 6;
    pj.x += (pj.vx - sp * 0.25) * dt;
    // 펀치로 격추 (앞쪽에서 펀치하면 흩어짐)
    if (P.punchT > 0.1 && pj.x > px + 10 && pj.x < px + 105 && pj.y > P.y - 160 && pj.y < P.y + 5) {
      pj.dead = true;
      run.coins += 5;
      Sound.sfx('smash');
      burst(pj.x, pj.y, 10, '#b6d97a', 3, true);
      addFloat(pj.x, pj.y - 20, '+5', '#ffd166', 0.8);
      continue;
    }
    // 피격
    if (Math.hypot(pj.x - px, pj.y - (P.y - 46)) < 34) {
      pj.dead = true;
      run.dodgeStreak = 0;         // 맞으면 연속 회피 초기화
      hurt(null);
      if (state !== 'play') return;
    }
    // 무사히 지나가면 연속 회피 카운트 → 3번이면 두목이 돌부리에 걸려 자빠진다
    if (!pj.passed && pj.x < px - 34) {
      pj.passed = true;
      run.dodgeStreak++;
      if (run.dodgeStreak >= 3 && run.boss && !run.boss.escaping) {
        run.dodgeStreak = 0;
        bossTrip();
        if (state !== 'play') return;
      }
    }
  }
  run.projectiles = run.projectiles.filter(p => !p.dead && p.x > -80);

  // 원거리 무기 발사체 (거미줄/새총/불꽃)
  for (const s of run.playerShots) {
    s.t += dt0;
    s.spin += dt0 * 16;
    s.x += s.vx * dt;
    // 도둑 명중 판정 → 가끔 MISS (한 방에 무조건 잡히지 않게 — 긴장감)
    if (run.thief && !run.thief.escaping) {
      if (s.x >= px + run.thief.dx - 22) {
        s.dead = true;
        if (Math.random() < weaponMissChance(s.kind)) thiefDodge();
        else catchThief(s.kind);
        continue;
      }
    } else if (run.boss && !run.boss.escaping && run.boss.staggerT <= 0) {
      if (s.x >= px + run.boss.dx - 30) {
        s.dead = true;
        weaponHitBoss(s.kind);
        continue;
      }
    }
    if (s.x > W + 90) s.dead = true;
  }
  run.playerShots = run.playerShots.filter(s => !s.dead);

  // 도둑 (보스전 중에는 일반 도둑 미등장)
  if (run.thief) {
    const th = run.thief;
    const factor = th.escaping ? 1.4 : 0.885;   // 평소 더 빨리 따라잡히게 (0.91 → 0.885)
    th.dx += (factor - 1) * sp * dt;
    // 안전장치: 추격 중 도둑이 플레이어 뒤로 빠져 사라지는 소프트락 방지 (앞에서 대기)
    if (!th.escaping) th.dx = Math.max(52, th.dx);
    // 도둑 폴짝폴짝 (연출용)
    th.jumpT -= dt;
    th.vy += 2600 * dt;
    th.y += th.vy * dt;
    if (th.y >= g) { th.y = g; th.vy = 0; if (th.jumpT <= 0) { th.vy = -rand(520, 760); th.jumpT = rand(0.7, 1.4); } }
    // 레벨이 높아지면 도둑이 약올리며 '메롱' 제스처를 한다 (플레이어 자극 → 재도전 욕구)
    th.tauntT = Math.max(0, (th.tauntT || 0) - dt);
    if (run.stage >= 2 && !th.escaping) {
      th.tauntCd = (th.tauntCd === undefined ? rand(1.4, 2.8) : th.tauntCd) - dt;
      if (th.tauntCd <= 0) {
        th.tauntT = 0.95;
        th.tauntCd = rand(2.6, 4.6);
        addFloat(px + Math.min(th.dx, W * 0.72), th.y - 150, T('tauntShout'), '#ffd166', 1.15);
        Sound.sfx('near');
      }
    }
    if (th.escaping && th.dx > W + 250) {
      run.thief = null;
      run.thiefTimer = rand(7, 11);
    }
    // 보관된 경찰 찬스가 있으면 이 도둑을 대신 잡아준다
    if (run.policeReady) { run.policeReady = false; catchThief('police'); }
    // 잡기! (근접 펀치) — 빙판에 밀려 앞으로 나간 만큼(slide) 손이 더 닿는다
    else if (!th.escaping && P.punchT > 0.1 && th.dx - P.slide < 115) {
      catchThief('punch');
    }
  } else if (!run.boss && run.bossPending <= 0) {
    run.thiefTimer -= dt;
    if (run.thiefTimer <= 0) spawnThief();
  }

  // 스테이지 승급 연출 타이머 / 경찰 사이렌 번쩍임
  run.stageUpT = Math.max(0, run.stageUpT - dt0);
  run.policeFlash = Math.max(0, (run.policeFlash || 0) - dt0);

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

  // 선택 언어의 대표 도시로 배경 전체를 구성 (연속적인 도시 풍경 + 큰 랜드마크)
  drawCityScape(landmarkForTheme(theme), dist, T);

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

/* ===== 도시 배경: 언어별 대표 도시를 가로로 연속되게 구성 ===== */
// 창문 격자
function winGrid(x, bottomY, topY, w, cols, seed, wc) {
  const rows = Math.max(2, Math.floor((bottomY - topY) / 30));
  const cw = w / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const on = ((seed * 7 + r * 13 + c * 5) % 4) < 3;
    ctx.fillStyle = on ? (wc || 'rgba(255,225,150,0.5)') : 'rgba(255,225,150,0.12)';
    ctx.fillRect(x + c * cw + cw * 0.22, topY + 10 + r * 28, cw * 0.5, 15);
  }
}
// 건물 줄을 가로로 무한 타일링 (패럴랙스 scroll)
function tileRow(scroll, tileW, fn) {
  const start = Math.floor(scroll / tileW);
  const n = Math.ceil(W / tileW) + 2;
  for (let i = start; i < start + n; i++) {
    const x = i * tileW - scroll;
    const seed = ((i * 73) % 100 + 100) % 100;
    fn(x, i, seed);
  }
}

function drawCityScape(kind, dist, T) {
  const g = GY();
  const near = lighten(T.mid, 0.05);
  const far = lighten(T.far, 0.05);

  if (kind === 'paris') {
    tileRow(dist * 0.22, 122, (x, i, seed) => { const h = 88 + (seed % 3) * 16; ctx.fillStyle = far; ctx.fillRect(x, g - h, 114, h); });
    tileRow(dist * 0.4, 108, (x, i, seed) => {
      const bh = 148 + (seed % 2) * 16;
      ctx.fillStyle = near; ctx.fillRect(x, g - bh, 100, bh);
      ctx.fillStyle = far;                     // 만사르 지붕
      ctx.beginPath(); ctx.moveTo(x - 4, g - bh); ctx.lineTo(x + 104, g - bh); ctx.lineTo(x + 94, g - bh - 24); ctx.lineTo(x + 6, g - bh - 24); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,150,0.45)';
      for (let k = 0; k < 3; k++) ctx.fillRect(x + 22 + k * 26, g - bh - 19, 8, 9);
      winGrid(x + 8, g - 16, g - bh + 14, 84, 3, seed);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 2;
      for (let r = 1; r < 4; r++) { const yy = g - bh + 14 + r * 32; ctx.beginPath(); ctx.moveTo(x + 10, yy); ctx.lineTo(x + 90, yy); ctx.stroke(); }
      ctx.fillStyle = far; ctx.fillRect(x + 72, g - bh - 40, 6, 16); ctx.fillRect(x + 82, g - bh - 44, 6, 20);
    });
  } else if (kind === 'nyc' || kind === 'shanghai' || kind === 'tokyo') {
    tileRow(dist * 0.22, 90, (x, i, seed) => { const h = 110 + (seed % 4) * 44; ctx.fillStyle = far; ctx.fillRect(x, g - h, 84, h); });
    tileRow(dist * 0.4, 98, (x, i, seed) => {
      const bh = 150 + (seed % 5) * 46;
      ctx.fillStyle = near; ctx.fillRect(x, g - bh, 90, bh);
      if (kind === 'nyc' && seed % 3 === 0) { ctx.fillStyle = far; ctx.fillRect(x + 22, g - bh - 22, 20, 22); ctx.beginPath(); ctx.moveTo(x + 20, g - bh - 22); ctx.lineTo(x + 44, g - bh - 22); ctx.lineTo(x + 32, g - bh - 34); ctx.closePath(); ctx.fill(); }
      winGrid(x + 6, g - 16, g - bh + 12, 78, 4, seed, kind === 'shanghai' ? 'rgba(140,220,255,0.5)' : undefined);
      if (kind === 'tokyo' && seed % 3 === 0) {
        const nc = T.neon[seed % T.neon.length];
        ctx.fillStyle = nc; ctx.globalAlpha = 0.7 + 0.3 * Math.sin(globalT * 5 + seed);
        rr(x + 14, g - bh - 24, 62, 18, 4); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = '#0a0a1a'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        const s = cityData().signs; ctx.fillText(s[seed % s.length], x + 45, g - bh - 11);
      }
    });
  } else if (kind === 'london') {
    tileRow(dist * 0.22, 118, (x, i, seed) => { const h = 92 + (seed % 3) * 16; ctx.fillStyle = far; ctx.fillRect(x, g - h, 110, h); });
    tileRow(dist * 0.4, 102, (x, i, seed) => {
      const bh = 126 + (seed % 2) * 22;
      ctx.fillStyle = near; ctx.fillRect(x, g - bh, 94, bh);
      ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 1;
      for (let r = 1; r < 5; r++) { const yy = g - bh + r * 24; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 94, yy); ctx.stroke(); }
      winGrid(x + 8, g - 14, g - bh + 12, 78, 3, seed);
      ctx.fillStyle = far; ctx.beginPath(); ctx.moveTo(x - 2, g - bh); ctx.lineTo(x + 96, g - bh); ctx.lineTo(x + 82, g - bh - 16); ctx.lineTo(x + 12, g - bh - 16); ctx.closePath(); ctx.fill();
    });
  } else if (kind === 'seoul') {
    ctx.fillStyle = far; ctx.beginPath(); ctx.moveTo(0, g); ctx.quadraticCurveTo(W * 0.5, g - 150, W, g); ctx.closePath(); ctx.fill();
    tileRow(dist * 0.4, 76, (x, i, seed) => {
      const bh = 120 + (seed % 4) * 42;
      ctx.fillStyle = near; ctx.fillRect(x, g - bh, 66, bh);
      winGrid(x + 6, g - 14, g - bh + 12, 54, 3, seed, 'rgba(255,225,150,0.45)');
      ctx.fillStyle = `rgba(255,90,90,${0.4 + 0.3 * Math.sin(globalT * 4 + seed)})`; ctx.fillRect(x + 30, g - bh - 6, 4, 6);
    });
  } else if (kind === 'barcelona') {
    tileRow(dist * 0.22, 112, (x, i, seed) => { const h = 90 + (seed % 3) * 14; ctx.fillStyle = far; ctx.fillRect(x, g - h, 104, h); });
    tileRow(dist * 0.4, 104, (x, i, seed) => {
      const bh = 132 + (seed % 2) * 16;
      ctx.fillStyle = near; ctx.fillRect(x, g - bh, 96, bh);
      winGrid(x + 8, g - 14, g - bh + 12, 80, 3, seed);
      ctx.fillStyle = far; ctx.beginPath(); ctx.moveTo(x - 2, g - bh);
      for (let k = 0; k <= 4; k++) ctx.quadraticCurveTo(x + k * 24 + 12, g - bh - 13, x + k * 24 + 24, g - bh);
      ctx.lineTo(x + 96, g - bh); ctx.closePath(); ctx.fill();
    });
  } else if (kind === 'sydney') {
    tileRow(dist * 0.22, 104, (x, i, seed) => { const h = 66 + (seed % 3) * 22; ctx.fillStyle = far; ctx.fillRect(x, g - h, 96, h); });
    ctx.strokeStyle = 'rgba(120,200,255,0.22)'; ctx.lineWidth = 2;
    for (let k = 0; k < 7; k++) { const wx = ((k * 170 - (dist * 8) % 170) % (W + 170)) - 40; ctx.beginPath(); ctx.moveTo(wx, g - 8 + (k % 2) * 3); ctx.lineTo(wx + 70, g - 8 + (k % 2) * 3); ctx.stroke(); }
  }

  bigLandmark(kind, dist, T);
  if (kind === 'sydney') drawGulls(dist);
}

// 큰 랜드마크 — 도시별 상징 건물 (시드니는 하버브릿지+오페라하우스로 특별 처리)
function bigLandmark(kind, dist, T) {
  const g = GY();
  const scroll = dist * 0.1;
  const col = lighten(T.mid, 0.2);
  const light = T.neon[2] || '#ffd166', light2 = T.neon[0] || '#ff6fa5';
  if (kind === 'sydney') { drawSydney(scroll, T, col, light); return; }

  const period = W * 3.0;
  const sx = W + 340 - ((((scroll + W * 0.5) % period) + period) % period);
  if (sx < -360 || sx > W + 360) return;
  ctx.save();
  ctx.translate(sx, g - 22);
  ctx.scale(1.55, 1.55);
  ctx.fillStyle = col;
  const dot = (x, y, c, r) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r || 2, 0, TAU); ctx.fill(); ctx.fillStyle = col; };

  if (kind === 'paris') {                     // 에펠탑 (아치 + 격자 + 3단)
    ctx.beginPath();
    ctx.moveTo(-46, 0); ctx.lineTo(-15, -112); ctx.lineTo(-8, -188); ctx.lineTo(-4, -238);
    ctx.lineTo(4, -238); ctx.lineTo(8, -188); ctx.lineTo(15, -112); ctx.lineTo(46, 0);
    ctx.lineTo(27, 0); ctx.lineTo(9, -104); ctx.lineTo(-9, -104); ctx.lineTo(-27, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-27, 0); ctx.quadraticCurveTo(0, -60, 27, 0); ctx.stroke();   // 밑 아치
    ctx.fillRect(-33, -48, 66, 7); ctx.fillRect(-19, -150, 38, 5); ctx.fillRect(-2, -256, 4, 20);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let yy = -20; yy > -232; yy -= 16) { const wd = 12 + 34 * (-yy / 238); ctx.beginPath(); ctx.moveTo(-wd / 2, yy); ctx.lineTo(wd / 2, yy); ctx.stroke(); }
    dot(0, -256, light, 2.4); dot(-33, -46, light, 1.4); dot(33, -46, light, 1.4);
  } else if (kind === 'tokyo') {              // 도쿄타워
    ctx.fillStyle = '#8a2f2b';
    ctx.beginPath();
    ctx.moveTo(-48, 0); ctx.lineTo(-15, -120); ctx.lineTo(-7, -196); ctx.lineTo(-4, -240);
    ctx.lineTo(4, -240); ctx.lineTo(7, -196); ctx.lineTo(15, -120); ctx.lineTo(48, 0);
    ctx.lineTo(28, 0); ctx.lineTo(9, -112); ctx.lineTo(-9, -112); ctx.lineTo(-28, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b6524a'; ctx.fillRect(-30, -60, 60, 9); ctx.fillRect(-17, -150, 34, 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    for (let yy = -20; yy > -238; yy -= 16) { const wd = 12 + 36 * (-yy / 240); ctx.beginPath(); ctx.moveTo(-wd / 2, yy); ctx.lineTo(wd / 2, yy); ctx.stroke(); }
    ctx.fillStyle = '#8a2f2b'; ctx.fillRect(-2, -262, 4, 22);
    dot(0, -262, '#ff5c4d', 2.4);
  } else if (kind === 'seoul') {              // N서울타워
    ctx.beginPath(); ctx.moveTo(-140, 0); ctx.quadraticCurveTo(0, -70, 140, 0); ctx.closePath(); ctx.fill();
    ctx.fillRect(-9, -178, 18, 122);
    ctx.beginPath(); ctx.moveTo(-22, -178); ctx.lineTo(22, -178); ctx.lineTo(15, -200); ctx.lineTo(-15, -200); ctx.closePath(); ctx.fill();
    ctx.fillRect(-15, -214, 30, 16); ctx.fillRect(-2, -268, 4, 54);
    dot(0, -268, '#ff5c4d', 2.6); dot(0, -206, light, 1.6); dot(0, -190, light2, 1.6);
  } else if (kind === 'barcelona') {          // 사그라다 파밀리아
    const sp = [[-46, 152], [-24, 206], [0, 244], [24, 210], [46, 160]];
    for (const [x, h] of sp) {
      ctx.beginPath();
      ctx.moveTo(x - 10, 0); ctx.lineTo(x - 5, -h * 0.62); ctx.lineTo(x, -h); ctx.lineTo(x + 5, -h * 0.62); ctx.lineTo(x + 10, 0);
      ctx.closePath(); ctx.fill();
      for (let yy = -h * 0.5; yy > -h + 10; yy -= 14) dot(x, yy, light, 1.4);
      dot(x, -h + 5, light2, 1.8); ctx.fillStyle = col;
    }
  } else if (kind === 'shanghai') {           // 동방명주
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 5, -64); ctx.lineTo(s * 36, 0); ctx.lineTo(s * 22, 0); ctx.lineTo(s * 3, -64); ctx.closePath(); ctx.fill(); }
    ctx.fillRect(-6, -212, 12, 150);
    ctx.beginPath(); ctx.arc(0, -100, 24, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -180, 16, 0, TAU); ctx.fill();
    ctx.fillRect(-2, -256, 4, 44);
    dot(0, -100, light2, 3.2); dot(0, -180, light2, 2.6); dot(0, -256, light, 2.2);
  } else if (kind === 'nyc') {                // 엠파이어 스테이트 빌딩
    ctx.fillRect(-42, -152, 84, 152); ctx.fillRect(-30, -204, 60, 52);
    ctx.fillRect(-18, -240, 36, 36); ctx.fillRect(-7, -270, 14, 30); ctx.fillRect(-2, -306, 4, 36);
    dot(0, -306, light, 2.4);
    ctx.fillStyle = 'rgba(255,235,170,0.5)';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2) ctx.fillRect(-34 + c * 20, -142 + r * 24, 6, 9);
    ctx.fillStyle = col;
  } else if (kind === 'london') {             // 빅벤
    ctx.fillRect(-20, -216, 40, 216);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
    for (let yy = -24; yy > -190; yy -= 22) { ctx.beginPath(); ctx.moveTo(-20, yy); ctx.lineTo(20, yy); ctx.stroke(); }
    ctx.fillStyle = light; ctx.beginPath(); ctx.arc(0, -186, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a0a1a'; ctx.fillRect(-1, -195, 2, 9); ctx.fillRect(0, -187, 8, 2);
    ctx.fillStyle = col; ctx.fillRect(-23, -244, 46, 30);
    ctx.beginPath(); ctx.moveTo(-20, -244); ctx.lineTo(0, -298); ctx.lineTo(20, -244); ctx.closePath(); ctx.fill();
    dot(0, -298, light, 2.2);
  }
  ctx.restore();
}

// 시드니: 하버브릿지(큰 아치) + 오페라하우스(조개지붕)
function drawSydney(scroll, T, col, light) {
  const g = GY();
  const cx = W * 0.5 + Math.sin(scroll * 0.0015) * 24;
  const span = Math.min(W * 0.92, 640), bh = 120;
  const lx = cx - span / 2, rx = cx + span / 2, deckY = g - 44;
  ctx.fillStyle = col;
  // 교각(파일런)
  ctx.fillRect(lx - 8, deckY - 66, 18, 66 + 44); ctx.fillRect(rx - 10, deckY - 66, 18, 66 + 44);
  // 상판
  ctx.fillRect(lx, deckY, span, 8);
  // 아치
  ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(lx, deckY); ctx.quadraticCurveTo(cx, deckY - bh, rx, deckY); ctx.stroke();
  ctx.lineWidth = 2;                          // 행어(수직선)
  for (let t = 0.08; t < 0.95; t += 0.08) {
    const hx = lx + span * t, ay = deckY - Math.sin(Math.PI * t) * bh + Math.pow(Math.abs(t - 0.5) * 2, 2) * 6;
    ctx.beginPath(); ctx.moveTo(hx, Math.min(ay, deckY)); ctx.lineTo(hx, deckY); ctx.stroke();
  }
  ctx.fillStyle = light; ctx.beginPath(); ctx.arc(lx + 1, deckY - 66, 2, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(rx - 1, deckY - 66, 2, 0, TAU); ctx.fill();
  // 오페라하우스 (다리 오른쪽 발치 앞)
  ctx.save();
  ctx.translate(rx - 40, g - 20);
  const sail = (x, w, h, f, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + w * f, -h, x + w, 0); ctx.closePath(); ctx.fill(); };
  const white = 'rgba(236,244,255,0.92)', shade = 'rgba(198,214,236,0.9)';
  sail(-70, 46, 60, 0.2, shade); sail(-52, 52, 88, 0.22, white);
  sail(-20, 46, 66, 0.25, shade); sail(6, 50, 84, 0.75, white); sail(40, 44, 58, 0.8, shade);
  ctx.restore();
}

// 갈매기 (시드니 하늘)
function drawGulls(dist) {
  ctx.strokeStyle = 'rgba(232,240,255,0.75)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const gx = ((i * W * 0.26 - (dist * 3.5) % (W * 1.1)) % (W * 1.1) + W * 1.1) % (W * 1.1) - 30;
    const gy = H * 0.16 + (i % 2) * 34 + Math.sin(globalT * 2 + i) * 6;
    const fw = 8 + (i % 2) * 3, flap = Math.sin(globalT * 6 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(gx - fw, gy - flap); ctx.quadraticCurveTo(gx, gy + 4, gx, gy);
    ctx.quadraticCurveTo(gx, gy + 4, gx + fw, gy - flap); ctx.stroke();
  }
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
      const signs = cityData().signs;
      ctx.fillText(signs[seed % signs.length], x + 49, baseY - bh - 11);
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
  ctx.translate(x, y - (o.spin ? 40 : 0));   // 회전 중엔 발끝 기준을 몸 중앙으로
  if (o.spin) ctx.rotate(o.spin);            // 빙판에서 팽이처럼 빙글빙글
  else if (o.hurt) ctx.rotate(-0.18);
  if (o.spin) ctx.translate(0, 40);
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
  ctx.fillStyle = o.boss ? '#6e1f2e' : o.golden ? '#b8862e' : '#2e2e4a';
  rr(-16, -64, 32, 38, 10); ctx.fill();
  // 훔친 가방
  ctx.fillStyle = '#c9762f';
  rr(-34, -58, 22, 18, 5); ctx.fill();
  ctx.strokeStyle = '#8a4d1a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(-23, -58, 8, Math.PI, 0); ctx.stroke();
  // 후드 머리
  ctx.fillStyle = o.boss ? '#8f2635' : o.golden ? '#dba844' : '#3a3a5c';
  ctx.beginPath(); ctx.arc(6, -76, 13, 0, TAU); ctx.fill();
  // 보스: 금목걸이 + 선글라스
  if (o.boss) {
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -58, 10, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.fillStyle = '#0a0a14';
    rr(2, -81, 16, 7, 3); ctx.fill();
  }
  // 황금 도둑 반짝임
  if (o.golden) {
    ctx.fillStyle = `rgba(255,230,120,${0.5 + 0.5 * Math.sin(globalT * 8)})`;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✨', -20 + Math.sin(globalT * 3) * 8, -95);
    ctx.fillText('✨', 18, -100 + Math.cos(globalT * 4) * 6);
  }
  // 마스크 얼굴
  ctx.fillStyle = '#12121f';
  ctx.beginPath(); ctx.arc(9, -75, 8, -0.6, 0.9); ctx.lineTo(9, -75); ctx.fill();
  if (o.taunt) {
    // 약올리는 '메롱' — 윙크 + 쭉 내민 혀
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(8, -78); ctx.lineTo(15, -77); ctx.stroke();   // 감은 눈(윙크)
    ctx.fillStyle = '#ff6b8a';
    rr(9, -71, 8, 11, 4); ctx.fill();                                          // 혀
    ctx.fillStyle = '#e0466a';
    ctx.fillRect(12, -70, 2, 8);
    // 손가락 브이 (놀리는 제스처)
    ctx.strokeStyle = o.golden ? '#dba844' : '#3a3a5c'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(20, -58); ctx.lineTo(30, -74); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, -58); ctx.lineTo(34, -66); ctx.stroke();
  } else {
    // 눈 (초조)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(11, -77, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(12, -77, 1.5, 0, TAU); ctx.fill();
  }
  // 땀방울
  if (!o.tumble && !o.taunt) {
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
  if (o.type === 'ice') {
    // 바닥 빙판 — 반투명 하늘색 + 반짝이는 광택선
    const w = o.w;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#bfe9ff';
    ctx.beginPath(); ctx.ellipse(o.x, g + 3, w / 2, 12, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#eaf7ff'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const lx = o.x - w * 0.3 + i * w * 0.3;
      ctx.beginPath(); ctx.moveTo(lx - 8, g - 1); ctx.lineTo(lx + 8, g - 5); ctx.stroke();
    }
    // 가장자리 반짝임
    ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(globalT * 5)})`;
    ctx.beginPath(); ctx.arc(o.x - w * 0.28, g - 2, 1.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(o.x + w * 0.24, g - 4, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
    return;
  }
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
  } else if (o.type === 'pit') {
    // 맨홀 구덩이
    ctx.fillStyle = '#04050f';
    rr(o.x - o.w / 2, g + 2, o.w, 26, 6); ctx.fill();
    ctx.fillStyle = '#ffb020';
    for (const side of [-1, 1]) {
      const ex = o.x + side * (o.w / 2);
      ctx.fillRect(ex - 5, g - 4, 10, 6);
    }
    ctx.strokeStyle = 'rgba(255,176,32,0.65)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(o.x - o.w / 2, g - 1); ctx.lineTo(o.x + o.w / 2, g - 1); ctx.stroke();
    ctx.setLineDash([]);
  } else if (o.type === 'rider') {
    // 폭주 킥보드
    const wob = Math.sin(globalT * 9 + o.ph) * 2;
    ctx.save();
    ctx.translate(o.x, g + wob * 0.4);
    // 속도선
    ctx.strokeStyle = 'rgba(143,227,255,0.5)';
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(24 + i * 9, -22 - i * 22); ctx.lineTo(46 + i * 9, -22 - i * 22); ctx.stroke();
    }
    // 바퀴 + 발판
    ctx.fillStyle = '#222738';
    ctx.beginPath(); ctx.arc(-16, -7, 7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(14, -7, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5ad1ff';
    rr(-20, -16, 38, 6, 3); ctx.fill();
    // 핸들
    ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-14, -14); ctx.lineTo(-18, -62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-25, -62); ctx.lineTo(-11, -62); ctx.stroke();
    // 라이더 (헬멧 쓴 실루엣)
    ctx.strokeStyle = '#3c4266'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(4, -16); ctx.lineTo(0, -44 + wob); ctx.stroke();
    ctx.fillStyle = '#3c4266';
    rr(-8, -60 + wob, 20, 24, 8); ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(-2, -68 + wob, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2b1b12';
    ctx.fillRect(-10, -71 + wob, 10, 6);
    ctx.restore();
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
  } else if (o.type === 'hydrant') {
    // 소화전 (펀치 불가 — 점프 전용)
    ctx.fillStyle = '#e23b3b';
    rr(o.x - o.w / 2, g - o.h, o.w, o.h, 8); ctx.fill();
    ctx.fillStyle = '#b32020';
    rr(o.x - o.w / 2, g - 12, o.w, 12, 4); ctx.fill();           // 받침
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath(); ctx.arc(o.x, g - o.h, o.w * 0.42, Math.PI, 0); ctx.fill(); // 둥근 머리
    // 양옆 배출구 + 앞 캡
    ctx.fillStyle = '#f4c542';
    ctx.beginPath(); ctx.arc(o.x, g - o.h * 0.55, 5, 0, TAU); ctx.fill();
    ctx.fillRect(o.x - o.w / 2 - 4, g - o.h * 0.6, 5, 9);
    ctx.fillRect(o.x + o.w / 2 - 1, g - o.h * 0.6, 5, 9);
  } else if (o.type === 'trashbags') {
    // 쓰레기봉투 더미 (펀치로 부수기)
    const cols = ['#3d4a2e', '#4a5a38', '#33402a'];
    const set = [[-14, 20, 22], [12, 22, 24], [-2, 40, 30]];
    for (let i = 0; i < set.length; i++) {
      const [dx, r2, gy] = set[i];
      ctx.fillStyle = cols[i];
      ctx.beginPath(); ctx.ellipse(o.x + dx, g - gy + 4, r2, gy, 0, 0, TAU); ctx.fill();
      // 묶은 매듭
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(o.x + dx, g - gy * 2 + 8, 5, 7, 0, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x - 20, g - 22); ctx.lineTo(o.x - 8, g - 30); ctx.stroke();
  } else if (o.type === 'cart') {
    // 폭주 쇼핑카트 (펀치 또는 점프)
    const wob = Math.sin(globalT * 12 + o.ph) * 2;
    ctx.save();
    ctx.translate(o.x, g + wob * 0.3);
    // 속도선
    ctx.strokeStyle = 'rgba(143,227,255,0.45)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(24 + i * 9, -20 - i * 12); ctx.lineTo(44 + i * 9, -20 - i * 12); ctx.stroke(); }
    // 바구니 (사다리꼴 격자)
    ctx.strokeStyle = '#cdd6e6'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-24, -o.h); ctx.lineTo(20, -o.h); ctx.lineTo(14, -14); ctx.lineTo(-18, -14); ctx.closePath(); ctx.stroke();
    for (let i = 1; i < 4; i++) { const t = i / 4; ctx.beginPath(); ctx.moveTo(-24 + t * 44, -o.h); ctx.lineTo(-18 + t * 32, -14); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-22, -o.h * 0.6); ctx.lineTo(17, -o.h * 0.6); ctx.stroke();
    // 손잡이
    ctx.beginPath(); ctx.moveTo(20, -o.h); ctx.lineTo(30, -o.h - 10); ctx.stroke();
    // 바퀴
    ctx.fillStyle = '#222738';
    ctx.beginPath(); ctx.arc(-14, -6, 6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -6, 6, 0, TAU); ctx.fill();
    ctx.restore();
  } else if (o.type === 'drone') {
    // 택배 드론 (높이 날며 아래로 통과 or 더블점프+펀치)
    const bob = Math.sin(globalT * 4 + o.ph) * 8;
    const y = g - o.yOff + bob;
    const spin = globalT * 30;
    ctx.save();
    ctx.translate(o.x, y);
    // 프로펠러 암
    ctx.strokeStyle = '#3c4266'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-22, -6); ctx.lineTo(22, -6); ctx.stroke();
    for (const px2 of [-22, 22]) {
      ctx.strokeStyle = 'rgba(143,227,255,0.7)'; ctx.lineWidth = 2;
      const c = Math.cos(spin) * 12, s = Math.sin(spin) * 3;
      ctx.beginPath(); ctx.moveTo(px2 - c, -6 - s); ctx.lineTo(px2 + c, -6 + s); ctx.stroke();
    }
    // 본체
    ctx.fillStyle = '#4a5480';
    rr(-16, -6, 32, 16, 6); ctx.fill();
    // 매단 택배 상자
    ctx.strokeStyle = '#8fa0c8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, 16); ctx.stroke();
    ctx.fillStyle = '#c98d4a';
    rr(-9, 16, 18, 15, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(0, 31); ctx.stroke();
    // 상태등
    ctx.fillStyle = `rgba(255,90,90,${0.5 + 0.5 * Math.sin(globalT * 8)})`;
    ctx.beginPath(); ctx.arc(0, 2, 2.5, 0, TAU); ctx.fill();
    ctx.restore();
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
  const icons = { magnet: '🧲', shield: '🛡️', boost: '⚡', heart: '❤️', web: '🕸️', sling: '🎯', fire: '🔥', police: '🚨' };
  const colors = { magnet: '#8fe3ff', shield: '#9fd8ff', boost: '#ffd166', heart: '#ff8fb3', web: '#dfe7ff', sling: '#b9f5c9', fire: '#ff8a3c', police: '#5ad1ff' };
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
  fitFont(label, w - 26, o.size || 20);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawHUD() {
  const pad = 14;
  // 하트 (축적 가능 — 최대 6칸까지 아이콘, 그 이상은 ×N 로 표기)
  const heartCap = 6;
  const slots = Math.min(Math.max(P.maxHearts, P.hearts), heartCap);
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'left';
  for (let i = 0; i < slots; i++) {
    ctx.globalAlpha = i < P.hearts ? 1 : 0.22;
    ctx.fillText('❤️', pad + i * 27, 36);
  }
  ctx.globalAlpha = 1;
  if (P.hearts > heartCap) {
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#ff8fb3';
    ctx.fillText('×' + P.hearts, pad + slots * 27 + 2, 34);
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
    const mult = 1 + Math.floor(run.combo / 10) + (run.feverT > 0 ? 1 : 0);
    ctx.font = `bold ${24 + Math.min(10, run.combo / 5)}px sans-serif`;
    ctx.fillStyle = run.feverT > 0 ? '#ffe066' : '#ffd166';
    ctx.fillText(`${run.combo} COMBO${mult > 1 ? `  x${mult}` : ''}`, W / 2, 74);
  }
  // 피버 표시 (은은한 골드 테두리 + FEVER 펄스)
  if (run.feverT > 0) {
    const a = 0.25 + 0.15 * Math.sin(globalT * 8);
    ctx.strokeStyle = `rgba(255,224,102,${a})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    const pulse = 1 + Math.sin(globalT * 9) * 0.1;
    ctx.save();
    ctx.translate(W / 2, 104);
    ctx.scale(pulse, pulse);
    ctx.font = '900 18px sans-serif';
    ctx.fillStyle = '#ffe066';
    ctx.fillText(`⚡ ${T('feverLbl')} ${Math.ceil(run.feverT)}s`, 0, 0);
    ctx.restore();
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

  // 장착한 원거리 무기 + 남은 발사 횟수 (펀치로 도둑을 멀리서 잡는다)
  if (P.weapon) {
    const wic = { web: '🕸️', sling: '🎯', fire: '🔥' }[P.weapon];
    const wcol = { web: '#dfe7ff', sling: '#b9f5c9', fire: '#ff8a3c' }[P.weapon];
    ctx.textAlign = 'left';
    ctx.font = '20px sans-serif';
    ctx.fillText(wic, pad, barY + 8);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = wcol;
    ctx.fillText('×' + P.weaponCharges, pad + 28, barY + 8);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(T('weaponHint'), pad + 62, barY + 8);
    barY += 24;
  }

  // 사운드 켬/끔 버튼 (게임 중 바로 토글) + 일시정지 버튼
  button(W - 108, pad, 44, 44, save.muted ? '🔇' : '🔊', () => { Sound.setMuted(!save.muted); }, { color: 'rgba(255,255,255,0.14)', size: 18 });
  button(W - 58, pad, 44, 44, '⏸', () => { recordBest(); state = 'pause'; }, { color: 'rgba(255,255,255,0.14)', size: 20 });

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

  // 보스 접근 시 펀치 안내
  if (run.boss && !run.boss.escaping && run.boss.dx < 130) {
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#ff6b6b';
    ctx.textAlign = 'center';
    const bp = 1 + Math.sin(globalT * 10) * 0.08;
    ctx.save();
    ctx.translate(W / 2, H * 0.25);
    ctx.scale(bp, bp);
    fitFont(T('promptPunch'), W * 0.86, 26);
    ctx.fillText(T('promptPunch'), 0, 0);
    ctx.restore();
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
    drawThief(PX() + run.thief.dx, run.thief.y, { phase: run.dist * 0.11, golden: run.thief.golden, taunt: run.thief.tauntT > 0 });
  }
  // 도둑 두목 (1.4배 크기 + 머리 위 HP)
  if (run.boss) {
    const b = run.boss;
    const bx = PX() + b.dx;
    ctx.save();
    ctx.translate(bx, b.y);
    ctx.scale(1.4, 1.4);
    ctx.translate(-bx, -b.y);
    const tumble = b.tripT > 0 ? Math.sin(globalT * 22) * 0.5 : (b.staggerT > 0.3 ? Math.sin(globalT * 40) * 0.12 : 0);
    drawThief(bx, b.y, { phase: run.dist * 0.1, boss: true, tumble });
    ctx.restore();
    // HP 핍
    ctx.textAlign = 'center';
    ctx.font = '15px sans-serif';
    for (let i = 0; i < b.maxHp; i++) {
      ctx.globalAlpha = i < b.hp ? 1 : 0.2;
      ctx.fillText('🔴', bx - (b.maxHp - 1) * 9 + i * 18, b.y - 158);
    }
    ctx.globalAlpha = 1;
  }
  // 보스 방구 발사물 — 초록빛 방구 바람 (구름 뭉게뭉게 + 냄새선 + 뿡/흥/칫 텍스트)
  for (const pj of run.projectiles) {
    ctx.save();
    ctx.translate(pj.x, pj.y);
    // 뭉게뭉게 방구 구름
    ctx.fillStyle = 'rgba(150,190,90,0.55)';
    for (let i = 0; i < 4; i++) {
      const a = pj.puff + i * 1.6;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 7 + 6, Math.sin(a) * 5, 8 - i, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(182,217,122,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
    // 뒤로 퍼지는 냄새선
    ctx.strokeStyle = 'rgba(150,190,90,0.5)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const yy = -6 + i * 6;
      ctx.beginPath(); ctx.moveTo(14, yy); ctx.quadraticCurveTo(26, yy - 4 + Math.sin(pj.puff + i) * 3, 34, yy); ctx.stroke();
    }
    // 방구 텍스트
    ctx.fillStyle = '#6b8f2e';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pj.word || '뿡!', -6, -14);
    ctx.restore();
  }
  // 플레이어 원거리 무기 발사체 (거미줄/새총/불꽃)
  for (const s of run.playerShots) {
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.kind === 'web') {
      // 거미줄: 손에서 이어지는 줄 + 회전하는 그물
      ctx.strokeStyle = 'rgba(223,231,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-(s.x - (PX() + 26)), 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.rotate(s.spin);
      ctx.strokeStyle = '#eef2ff'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.stroke();
    } else if (s.kind === 'sling') {
      // 새총 탄환: 작은 조약돌 + 궤적
      ctx.strokeStyle = 'rgba(185,245,201,0.6)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-6, 0); ctx.stroke();
      ctx.fillStyle = '#8a6b4a';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#b9f5c9';
      ctx.beginPath(); ctx.arc(-2, -2, 2, 0, TAU); ctx.fill();
    } else {
      // 불꽃: 타오르는 화염구
      ctx.rotate(s.spin);
      const fl = 0.7 + 0.3 * Math.sin(globalT * 20);
      ctx.fillStyle = `rgba(255,120,40,${fl})`;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,80,40,0.5)';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  // 잡힌 도둑 (나뒹굴기)
  if (run.caughtAnim) {
    const a = run.caughtAnim;
    ctx.save();
    if (a.boss) {
      const cx = a.x + a.t * 130, cy = a.y - Math.sin(Math.min(1, a.t) * Math.PI) * 90;
      ctx.translate(cx, cy); ctx.scale(1.4, 1.4); ctx.translate(-cx, -cy);
    }
    drawThief(a.x + a.t * 130, a.y - Math.sin(Math.min(1, a.t) * Math.PI) * 90, { tumble: a.t * 9, boss: a.boss });
    ctx.restore();
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

  // 주인공 (빙판에서 빙글빙글 돌며 앞으로 미끄러진다)
  drawHeroine(PX() + P.slide, P.y, {
    pose: P.ground ? 'run' : 'jump',
    phase: run.dist * 0.12,
    punch: P.punchT > 0.06,
    hurt: P.hurtT > 0,
    spin: P.spinT > 0 ? globalT * 16 : 0,
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
  drawStageUp();
  // 경찰 사이렌 번쩍임 (빨강↔파랑)
  if (run.policeFlash > 0) {
    const blue = Math.sin(globalT * 22) > 0;
    ctx.fillStyle = blue ? 'rgba(90,160,255,0.18)' : 'rgba(255,80,90,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = '40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🚨', W / 2, H * 0.16);
  }
}

// 레벨업(다음 구역 진입) 연출 오버레이
function drawStageUp() {
  if (run.stageUpT <= 0) return;
  const dur = 2.4;
  const el = dur - run.stageUpT;                 // 경과 시간
  const inA = clamp(el / 0.35, 0, 1);            // 등장 페이드
  const outA = clamp(run.stageUpT / 0.5, 0, 1);  // 퇴장 페이드
  const a = Math.min(inA, outA);
  const cy = H * 0.40;
  const slide = (1 - inA) * -46;
  ctx.save();
  ctx.globalAlpha = a;
  // 리본 배경
  ctx.fillStyle = 'rgba(10,12,30,0.55)';
  ctx.fillRect(0, cy - 70 + slide, W, 140);
  ctx.fillStyle = 'rgba(255,209,102,0.9)';
  ctx.fillRect(0, cy - 70 + slide, W, 4);
  ctx.fillRect(0, cy + 66 + slide, W, 4);
  ctx.textAlign = 'center';
  // 회수한 3종 아이콘 반짝
  ctx.font = '22px sans-serif';
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = a * (0.55 + 0.45 * Math.abs(Math.sin(globalT * 6 + i)));
    ctx.fillText(ITEM_ICONS[i], W / 2 - 34 + i * 34, cy - 44 + slide);
  }
  ctx.globalAlpha = a;
  // LEVEL UP! (초반 살짝 튀어오름)
  const pop = 1 + Math.max(0, 0.28 - el) * 2.2;
  ctx.save();
  ctx.translate(W / 2, cy - 12 + slide);
  ctx.scale(pop, pop);
  fitFont(T('levelUp'), W * 0.8, 30, '900');
  ctx.fillStyle = '#ffe066';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5;
  ctx.strokeText(T('levelUp'), 0, 0);
  ctx.fillText(T('levelUp'), 0, 0);
  ctx.restore();
  // STAGE X · 구역 이름
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(T('stageLbl', run.stageUpStage, L.themes[run.stageUpTheme]), W / 2, cy + 20 + slide);
  // 다음 구역 진행바 (차오르는 연출)
  const bw = Math.min(360, W * 0.7), bx = W / 2 - bw / 2, byy = cy + 40 + slide;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  rr(bx, byy, bw, 10, 5); ctx.fill();
  ctx.fillStyle = '#7bffc8';
  rr(bx, byy, bw * clamp(el / 1.1, 0, 1), 10, 5); ctx.fill();
  ctx.restore();
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
  let bankLine = T('bank', save.bank.toLocaleString());
  if (save.streakCount > 1) bankLine += '   ' + T('streakLbl', save.streakCount);
  fitFont(bankLine, W * 0.92, 17);
  ctx.fillText(bankLine, W / 2, ty + 100);

  // 🎯 오늘의 미션 (세로 화면: 상세 3줄 / 가로 화면: 요약 1줄)
  ensureMissions();
  const ml = save.missions.list;
  const doneCnt = ml.filter(m => m.done).length;
  if (H >= 700) {
    const pw = Math.min(340, W * 0.8);
    const mx = W / 2 - pw / 2;
    const myTop = ty + 122;
    ctx.fillStyle = 'rgba(20,22,55,0.75)';
    rr(mx, myTop, pw, 96, 12); ctx.fill();
    ctx.fillStyle = '#aab0d8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(T('missionTitle'), mx + 14, myTop + 20);
    ml.forEach((m, i) => {
      const yy = myTop + 40 + i * 20;
      ctx.font = '13px sans-serif';
      ctx.fillStyle = m.done ? '#7bffc8' : '#ffffff';
      const label = (m.done ? '✅ ' : '▫️ ') + T('m_' + m.k, m.goal) + (m.done ? '' : `  (${Math.min(m.p, m.goal)}/${m.goal})`);
      fitFont(label, pw - 90, 13, m.done ? 'bold' : 'normal');
      ctx.fillText(label, mx + 14, yy);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('💰' + m.reward, mx + pw - 12, yy);
      ctx.textAlign = 'left';
    });
    ctx.textAlign = 'center';
  } else {
    ctx.fillStyle = '#aab0d8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(T('missionSummary', doneCnt, ml.length), W / 2, ty + 124);
  }

  const bw = Math.min(320, W * 0.72);
  const bx = W / 2 - bw / 2;
  let by = H * 0.52;
  if (H >= 700) by = Math.max(by, ty + 240);
  if (heldRun) {
    button(bx, by, bw, 62, T('btnResumeRun'), () => { resumeHeld(); }, { size: 22, color: '#e8a03c' });
    by += 74;
    button(bx, by, bw, 48, T('btnNewGame'), () => { newGame(); }, { size: 19 });
    by += 60;
  } else {
    button(bx, by, bw, 62, T('btnStart'), () => { newGame(); }, { size: 24 });
    by += 76;
  }
  button(bx, by, bw, 52, T('btnShop'), () => { state = 'shop'; }, { color: '#4a55c9' });
  by += 64;
  const bw3 = (bw - 16) / 3;
  button(bx, by, bw3, 46, T('btnStory'), () => { startIntro(); }, { color: '#2a2d45', size: 15 });
  button(bx + bw3 + 8, by, bw3, 46, (save.muted ? '🔇 ' : '🔊 ') + T('btnSound'), () => {
    Sound.setMuted(!save.muted);
  }, { color: '#2a2d45', size: 15 });
  button(bx + (bw3 + 8) * 2, by, bw3, 46, '🌐 ' + (save.lang || detectLang()).toUpperCase(), () => {
    state = 'lang';
  }, { color: '#2a2d45', size: 15 });
  // 배경음악 선택 (기본 레트로 / 내 음악)
  by += 56;
  button(bx, by, bw, 44, '🎵 ' + T(save.bgmMode === 'custom' ? 'bgmCustom' : 'bgmRetro'), () => {
    Sound.setBgmMode(save.bgmMode === 'custom' ? 'retro' : 'custom');
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
  // 홈으로: 판을 버리지 않고 보관 → 메뉴에서 '이어서 하기' 가능
  button(W / 2 - bw / 2, H * 0.46 + 72, bw, 50, T('btnHome'), () => {
    recordBest();
    heldRun = run; heldP = P;
    run = null; P = null;
    state = 'menu';
  }, { color: '#2a2d45', size: 18 });
}

// 보관된 판 이어서 하기
function resumeHeld() {
  if (!heldRun) return;
  run = heldRun; P = heldP;
  heldRun = null; heldP = null;
  lastTime = 0; state = 'play';
}
// 새 판 시작 — 보관된 판이 있으면 먼저 정산해 보상/기록을 저장한 뒤 버린다.
function newGame() {
  if (heldRun) { run = heldRun; P = heldP; settleRun(); heldRun = null; heldP = null; }
  startGame();
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

  // 미션/출석 보상 알림 (미정산이면 확정 예정 보상을 미리 표시)
  let mReward = run.missionReward, sBonus = run.streakBonus;
  if (!run.settled) {
    ensureMissions();
    for (const m of save.missions.list) {
      if (m.done) continue;
      if (missionRunValue(m) >= m.goal) mReward += m.reward;
    }
    if (save.streakDay !== todayStr()) {
      const c = (save.streakDay === todayStr(-1)) ? (save.streakCount || 0) + 1 : 1;
      sBonus = Math.min(50 * c, 250);
    }
  }
  if (mReward > 0 || sBonus > 0) {
    const parts = [];
    if (mReward > 0) parts.push(T('missionDone', mReward));
    if (sBonus > 0) parts.push(T('streakBonus', sBonus));
    ctx.fillStyle = '#7bffc8';
    const bonusTxt = parts.join('   ');
    fitFont(bonusTxt, W * 0.92, 15);
    ctx.fillText(bonusTxt, W / 2, H * 0.52 + 26);
  }

  const bw = Math.min(300, W * 0.7);
  let by = H * 0.6;
  // ❤️ 이어하기 (판당 1회): 광고 브리지가 있으면 무료(광고), 없으면 코인 소모
  if (canRevive()) {
    if (Ads.ready()) {
      button(W / 2 - bw / 2, by, bw, 56, T('reviveAd'), () => {
        Ads.showRewarded(() => { doRevive(); });
      }, { color: '#e8a03c', size: 18 });
    } else {
      button(W / 2 - bw / 2, by, bw, 56, `${T('revive')}  💰${REVIVE_COST}`, () => {
        save.bank -= REVIVE_COST;
        doRevive();
      }, { color: '#e8a03c', size: 20 });
    }
    by += 66;
  }
  button(W / 2 - bw / 2, by, bw, 56, T('btnRetry'), () => { settleRun(); startGame(); }, { size: 22 });
  by += 66;
  button(W / 2 - bw / 2, by, bw, 48, T('btnMenu'), () => { settleRun(); state = 'menu'; }, { color: '#4a55c9', size: 18 });
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
