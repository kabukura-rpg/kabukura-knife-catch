'use strict';
/* =========================================================
   落ちるナイフを掴め / CATCH THE FALLING KNIFE
   仕様書 v0.3 準拠 MVP 実装
   ========================================================= */

/* 公開URL。X共有では必ずこの定数だけを使う。
   実行中のブラウザURLやローカルパスから共有URLを組み立てないこと。 */
const GAME_URL = 'https://kabukura-rpg.github.io/kabukura-knife-catch/';

/* ---------------------------------------------------------
   1. 設定（暫定値：バランス調整はここだけを触る）
   x系の値は「画面幅(F.w)の割合」、y系は「画面高(F.h)の割合」
--------------------------------------------------------- */
const CONFIG = {
  player: {
    startSpeed: 0.45,        // 画面幅 / 秒
    maxSpeed: 0.75,          // 画面幅 / 秒
    accelTime: 0.70,         // 同方向維持で最大速度に達するまでの秒数
    marginX: 0.085,          // 移動可能域（ミニキャラが端で見切れない幅）
    turnTime: 0.08,          // 方向転換の慣性（標準キャラ）
    speedGrowth: 0.004,      // CATCHごとの速度上昇
    speedGrowthMax: 0.22,
    wallBehavior: 'stop',    // 端では停止。反射しない
    visualScale: 0.90,       // 仮キャラ（Canvas描画）の表示サイズ
    catchFxDuration: 260     // キャッチ成功エフェクトの表示時間（ms・実時間）
  },
  knife: {
    initialFallSpeed: 0.55,  // 画面高 / 秒
    maxFallSpeed: 1.20,
    fallRampCatches: 40,     // 何CATCHで最高速に達するか
    spawnPreview: 0.15,      // 次ナイフ予告（標準キャラ）
    minSpawnInterval: 0.22,
    startInterval: 0.34,
    intervalDecay: 0.006,
    /* 次ナイフを「前ナイフの落下時間 × frac」後に出す。
       1.0未満 = 前のナイフをキャッチする前に次が出現する */
    gapEarly: 1.15,          // 0〜2 CATCH
    gapMid: 0.98,            // 3 CATCH
    gapPreOverlap: 0.78,     // 複数ナイフ解禁直前
    overlapStart: 0.76,      // 複数ナイフ帯の開始
    overlapMin: 0.52
  },
  judgement: { perfectRatio: 0.20, greatRatio: 0.60 },
  score: { GOOD: 100, GREAT: 120, PERFECT: 150 },
  difficulty: { diagonalUnlock: 6, rotateUnlock: 12, swayUnlock: 20, overlapUnlock: 30 },
  layout: {
    handY: 0.70,             // 手（キャッチ判定）の高さ
    handHalfW: 0.056,        // キャッチ横判定 半幅（画面幅比）
    catchWidthMultiplier: 0.93, // キャッチ幅の全体倍率（キャラ縮小に合わせて縮小）
    handHalfH: 0.020,        // キャッチ縦判定 半高
    bodyGap: 0.085,          // 手から体の上端までの距離
    dangerHalfW: 0.068,      // 体の危険判定 半幅（見た目の約91%）
    dangerH: 0.150           // 体の危険判定 高さ
  },
  geo: {
    handleLen: 0.050,        // 柄の長さ（画面高比）
    bladeLen: 0.062,         // 刃の長さ
    knifeW: 0.021,           // ナイフの幅（画面幅比）
    bladeHitScale: 0.88      // 刃の当たり判定は見た目の88%（プレイヤー有利）
  }
};

/* ---------------------------------------------------------
   2. キャラクター
--------------------------------------------------------- */
const CHARACTERS = [
  { id:'micchan', name:'みっちゃん', trait:'未来予知', desc:'次のナイフの予告が\nいちばん早く見える', diff:'★★☆',
    preview:0.40, hair:'#f2779b', body:'#ffd7e3', accent:'#ff9ec2', accessory:'star' },
  { id:'nimushi', name:'にむし', trait:'冷静沈着', desc:'方向転換の慣性が小さく\n切り返しが素早い', diff:'★★★',
    turnTime:0.04, hair:'#4fbf7a', body:'#c9f0d5', accent:'#7ee0a0', accessory:'antenna' },
  { id:'nemupan', name:'ねむぱん', trait:'もちもちキャッチ', desc:'柄を掴める判定が\n少し広い（115%）', diff:'★☆☆',
    catchScale:1.15, hair:'#d9a35b', body:'#ffe9c2', accent:'#ffcf8a', accessory:'sleep' },
  { id:'queen', name:'女王', trait:'強欲', desc:'PERFECTが広いが\n危険判定も広い', diff:'★★★',
    perfectRatio:0.30, dangerScale:1.08, hair:'#9b6bff', body:'#e3d4ff', accent:'#c3a3ff', accessory:'crown' }
];
const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

/* ---------------------------------------------------------
   2.1 キャラクター画像（assets/）

   ・ファイル名は assets/ に実在する名前をそのまま使う
     （みっちゃん=micchan / にむし=nimushi / ねむぱん=nempan / 女王=ponkotsu）
   ・ax, ay は「画像内のどこをキャッチ位置に合わせるか」を 0〜1 で指定する。
     みっちゃん・女王は杖先、ねむぱんは両肉球の中間。
     ゲーム側の座標・当たり判定はこの値の影響を受けない（画像を座標へ合わせるだけ）。
   ・footY は通常画像の足元の位置（0〜1）。表示倍率はこれだけで決まり、
     Get / Miss も同じ倍率で描くのでポーズが変わってもサイズは変化しない。
   ・offsetX（画面幅比）/ offsetY（画面高比）は微調整用。
   ・画像が無い / 読めない場合は 通常画像 → Canvas描画 の順に自動フォールバックする。
   ・プレイ中に使うのは normal と miss だけ（プリロード対象も SPRITE_PRELOAD の2つ）。
     get は将来のリザルト演出用に定義だけ残してある（読み込みはしない）。
     キャッチ成功はキャラを差し替えず、通常画像の上にエフェクトを重ねて見せる。

   新しいキャラの画像を追加するとき（例: にむし）:
     assets/ に nimushi.png / nimushiGet.png / nimushiMiss.png を置き、
     下の nimushi の行のコメントを外して ax・ay・footY を合わせるだけでよい。
--------------------------------------------------------- */
const SPRITES = {
  nimushi: {
    footY: 0.985, offsetX: 0, offsetY: 0,
    normal: { file:'nimushi.png',     ax:0.490, ay:0.075 },  // 両手のひらの中間
    get:    { file:'nimushiGet.png',  ax:0.490, ay:0.075 },  // 未使用（将来のリザルト演出用）
    miss:   { file:'nimushiMiss.png', ax:0.490, ay:0.075 }
  },
  micchan: {
    footY: 0.985, offsetX: 0, offsetY: 0,
    normal: { file:'micchan.png',     ax:0.310, ay:0.060 },  // 杖先（葉の付け根）
    get:    { file:'micchanGet.png',  ax:0.385, ay:0.075 },
    miss:   { file:'micchanMiss.png', ax:0.500, ay:0.105 }   // 転倒ポーズは中央基準
  },
  nemupan: {
    footY: 0.950, offsetX: 0, offsetY: 0,
    normal: { file:'nempan.png',      ax:0.490, ay:0.130 },  // 両肉球の中間
    get:    { file:'nempanGet.png',   ax:0.430, ay:0.130 },  // ナイフを掴んだ肉球
    miss:   { file:'nempanMiss.png',  ax:0.500, ay:0.180 }
  },
  queen: {
    footY: 0.985, offsetX: 0, offsetY: 0,
    normal: { file:'ponkotsu.png',    ax:0.535, ay:0.055 },  // 杖先（宝珠）
    get:    { file:'ponkotsuGet.png', ax:0.600, ay:0.100 },
    miss:   { file:'ponkotsuMiss.png',ax:0.470, ay:0.070 }
  }
};

/* プレイ中に実際に使うポーズだけ先読みする（get は未使用なので読み込まない） */
const SPRITE_PRELOAD = ['normal', 'miss'];

/* 画像ローダー。タイトル表示前に全ポーズを先読みするので、
   キャッチした瞬間に Get 画像が未読込で消える、ということが起きない。 */
const Sprites = {
  map:{}, pending:0, done:0,
  preload() {
    Object.keys(SPRITES).forEach(id => {
      const sp = SPRITES[id];
      SPRITE_PRELOAD.forEach(k => { if (sp[k] && sp[k].file) this.load(sp[k].file); });
    });
  },
  load(file) {
    if (this.map[file]) return;
    const e = { img:new Image(), ok:false };
    this.map[file] = e; this.pending++;
    e.img.onload  = () => { e.ok = e.img.naturalWidth > 0; this.done++; onSpriteLoaded(); };
    e.img.onerror = () => { e.ok = false; this.done++; };   // 未提供でもゲームは止めない
    e.img.src = 'assets/' + file;
  },
  get(file) { const e = file && this.map[file]; return e && e.ok ? e.img : null; },
  ready(id) { const sp = SPRITES[id]; return !!(sp && this.get(sp.normal.file)); }
};

/* 表示する画像を決める。
   プレイ中は常に通常画像、ゲームオーバー時だけ Miss 画像。
   （キャッチ成功はキャラを差し替えずエフェクトで見せる）
   miss が無ければ通常画像へ、通常画像も無ければ null で Canvas 描画へフォールバック。 */
function spriteFor(charId, pose) {
  const sp = SPRITES[charId];
  if (!sp) return null;
  const key = pose === 3 ? 'miss' : 'normal';
  let part = sp[key] || sp.normal;
  let img = Sprites.get(part.file);
  if (!img) { part = sp.normal; img = Sprites.get(part.file); }
  return img ? { img, ax:part.ax, ay:part.ay, sp } : null;
}


const RANK_TITLES = [
  [50, '市場の狂人'], [30, '落ちるナイフ職人'], [20, '逆張り投資家'],
  [10, '握力強者'], [5, 'ナイフ見習い'], [0, '投資初心者']
];
const rankTitle = c => (RANK_TITLES.find(r => c >= r[0]) || RANK_TITLES[5])[1];

/* GET率 = GREAT + PERFECT を出した割合。
   「CATCH数 ÷ 全試行数」だとCATCH数だけで決まってしまうため、精度の指標にする。 */
function getRate() {
  if (!G.catches) return 0;
  return Math.round(((G.grades.GREAT + G.grades.PERFECT) / G.catches) * 100);
}

const OVER_QUOTES = {
  blade: ['落ちるナイフを掴むな。', '無理な逆張りは怪我のもと。', '刃に触れた。損切りは早めに。'],
  drop:  ['落ちるナイフを掴むな。', '取り逃した。次の下落を待とう。', '手が届かなかった。']
};

/* ---------------------------------------------------------
   3. セーブデータ（localStorage）
--------------------------------------------------------- */
const SAVE_KEY = 'falling_knife_save_v1';
function defaultSave() {
  const chars = {};
  CHARACTERS.forEach(c => chars[c.id] = { catch:0, score:0 });
  return { version:1, tutorialSeen:false, lastCharacter:'nimushi', sound:true,
           best:{ catch:0, score:0 }, characters:chars };
}
let SAVE = defaultSave();
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return;
    SAVE = Object.assign(defaultSave(), d);
    SAVE.best = Object.assign({ catch:0, score:0 }, d.best || {});
    SAVE.characters = Object.assign(defaultSave().characters, d.characters || {});
  } catch (e) { SAVE = defaultSave(); }
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) {} }
loadSave();

/* ---------------------------------------------------------
   4. サウンド（WebAudio・アセット不要）
--------------------------------------------------------- */
const Sound = {
  ac:null, master:null, enabled:SAVE.sound !== false,
  bgmOn:false, bgmNext:0, bgmStep:0,
  ensure() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(this.ac.destination);
  },
  setEnabled(on) {
    this.enabled = on; SAVE.sound = on; persist();
    if (this.master) this.master.gain.value = on ? 0.9 : 0;
  },
  tone(freq, dur, type, vol, delay, slideTo) {
    if (!this.ac || !this.enabled) return;
    const t0 = this.ac.currentTime + (delay || 0);
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
  },
  noise(dur, vol, freq) {
    if (!this.ac || !this.enabled) return;
    const n = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, n, this.ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = this.ac.createBufferSource(); src.buffer = buf;
    const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 900;
    const g = this.ac.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  },
  catchSE(grade, combo) {
    if (grade === 'PERFECT') {
      const step = Math.min(7, Math.floor(combo / 3));
      const base = 880 * Math.pow(2, step / 12);
      this.tone(base, 0.09, 'square', 0.15);
      this.tone(base * 1.5, 0.13, 'triangle', 0.13, 0.03);
    } else if (grade === 'GREAT') {
      this.tone(700, 0.08, 'square', 0.13);
      this.tone(950, 0.08, 'triangle', 0.08, 0.02);
    } else {
      this.tone(520, 0.07, 'square', 0.11);
    }
    this.noise(0.05, 0.10, 2600);
  },
  bladeSE() { this.tone(180, 0.28, 'sawtooth', 0.22, 0, 60); this.noise(0.3, 0.35, 700); },
  dropSE()  { this.tone(120, 0.35, 'sine', 0.22, 0, 55); this.noise(0.22, 0.30, 400); },
  countSE(last) { this.tone(last ? 900 : 560, last ? 0.2 : 0.1, 'square', 0.14); },
  newBestSE() { [0,0.09,0.18].forEach((d,i)=>this.tone(700*Math.pow(2,i*2/12+i*0.05),0.16,'triangle',0.14,d)); },
  /* --- 簡易BGM（テンポは難易度で上昇） --- */
  startBgm() { if (!this.ac) return; this.bgmOn = true; this.bgmNext = this.ac.currentTime + 0.05; this.bgmStep = 0; },
  stopBgm() { this.bgmOn = false; },
  tickBgm(catches) {
    if (!this.bgmOn || !this.ac || !this.enabled) return;
    const bpm = 104 + Math.min(46, catches * 1.1);
    const spb = 60 / bpm / 2;
    const bass = [0, 0, 7, 0, 5, 5, 3, 0];
    while (this.bgmNext < this.ac.currentTime + 0.25) {
      const t = this.bgmNext, s = this.bgmStep % 8;
      const f = 98 * Math.pow(2, bass[s] / 12);
      this.tone(f, spb * 0.9, 'triangle', 0.055, t - this.ac.currentTime);
      if (s % 2 === 0) this.noise(0.03, 0.035, 5000);
      if (catches >= 20 && (s === 2 || s === 6))
        this.tone(f * 4, spb * 0.5, 'square', 0.028, t - this.ac.currentTime);
      this.bgmNext += spb; this.bgmStep++;
    }
  }
};

/* ---------------------------------------------------------
   5. キャンバス・フィールド
--------------------------------------------------------- */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d', { alpha:false });
const F = { w:0, h:0, ox:0, oy:0, vw:0, vh:0, dpr:1 };

function resize() {
  const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let fh = vh, fw = fh * 9 / 16;
  if (fw > vw) { fw = vw; fh = Math.min(vh, fw * 16 / 9); }
  const old = F.w;
  F.w = fw; F.h = fh; F.ox = (vw - fw) / 2; F.oy = (vh - fh) * 0.78; F.vw = vw; F.vh = vh; F.dpr = dpr;
  if (old > 0 && G.player) G.player.x *= F.w / old;   // 画面サイズ変化に追従
  const hudEl = document.getElementById('hud');        // HUDをプレイ領域の幅に合わせる
  if (hudEl) { hudEl.style.left = F.ox + 'px'; hudEl.style.right = F.ox + 'px'; }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

/* ---------------------------------------------------------
   6. 幾何ヘルパ
--------------------------------------------------------- */
function segAabb(x1, y1, x2, y2, minx, miny, maxx, maxy) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minx, maxx - x1, y1 - miny, maxy - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
function closestOnSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (l2 === 0) return { x:x1, y:y1 };
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x:x1 + dx * t, y:y1 + dy * t };
}
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------------------------------------------------------
   7. ゲーム状態
--------------------------------------------------------- */
const G = {
  state:'title',           // title | select | tutorial | count | play | over | pause
  time:0, last:0,
  char:charById(SAVE.lastCharacter),
  player:{ x:0, v:0, dir:-1, dirTime:0, pose:0, poseT:0, pop:0, popMax:1 },
  knives:[], pending:null, spawnAt:null, lastLanding:-1, lastGap:0,
  catches:0, score:0, combo:0, maxCombo:0,
  grades:{ GOOD:0, GREAT:0, PERFECT:0 },
  practice:false, practiceDone:false,
  countT:0, countLen:3.2, countShown:-1,
  overT:0, overKind:'drop', overQuote:'',
  hitstop:0, shake:0, flash:0, crash:false, crashT:0,
  particles:[], floats:[], rings:[], banner:null, bannerT:0,
  bestFlag:{ near:false, tie:false, neu:false },
  input:new Set(), keyDown:false,
  resumeState:null
};
const pressed = () => G.input.size > 0 || G.keyDown;

/* --- キャラ特性の反映 --- */
function turnTime()      { return G.char.turnTime || CONFIG.player.turnTime; }
function previewTime()   { return G.char.preview  || CONFIG.knife.spawnPreview; }
function catchHalfW()    { return CONFIG.layout.handHalfW * CONFIG.layout.catchWidthMultiplier * (G.char.catchScale || 1) * F.w; }
function dangerHalfW()   { return CONFIG.layout.dangerHalfW * (G.char.dangerScale || 1) * F.w; }
function perfectRatio()  { return G.char.perfectRatio || CONFIG.judgement.perfectRatio; }
function handY()         { return CONFIG.layout.handY * F.h; }
function floorY()        { return handY() + 0.237 * F.h * CONFIG.player.visualScale; }
function bodyTop()       { return handY() + CONFIG.layout.bodyGap * F.h; }

function phaseOf(c) {
  if (c < 3) return 1;   // 操作確認（直線のみ・中央付近）
  if (c < 6) return 2;   // 速度上昇・左右全域
  if (c < 12) return 3;  // 斜め
  if (c < 20) return 4;  // 回転
  if (c < 30) return 5;  // 揺れ・高速
  return 6;              // 複数ナイフ
}
function fallSpeed() {
  const K = CONFIG.knife;
  const t = Math.min(1, G.catches / K.fallRampCatches);
  return (K.initialFallSpeed + (K.maxFallSpeed - K.initialFallSpeed) * t) * F.h;
}
function playerMaxSpeed() {
  const P = CONFIG.player;
  const s = 1 + Math.min(P.speedGrowthMax, G.catches * P.speedGrowth);
  return { base:P.startSpeed * s * F.w, max:P.maxSpeed * s * F.w };
}
function spawnInterval() {
  const K = CONFIG.knife;
  return Math.max(K.minSpawnInterval, K.startInterval - G.catches * K.intervalDecay);
}
/* 次のナイフを出すまでの待ち時間。
   前ナイフの落下時間に対する比率で決め、CATCHが進むほど詰めていく。
   比率が1.0を下回ると「前のナイフをキャッチする前に次が出る」状態になる。 */
function nextSpawnDelay(k) {
  const K = CONFIG.knife, D = CONFIG.difficulty, c = G.catches;
  let frac;
  if (c < 3) frac = K.gapEarly;
  else if (c < D.overlapUnlock) {
    const t = Math.min(1, (c - 3) / (D.overlapUnlock - 3));
    frac = K.gapMid + (K.gapPreOverlap - K.gapMid) * t;
  } else {
    const t = Math.min(1, (c - D.overlapUnlock) / 25);
    frac = K.overlapStart + (K.overlapMin - K.overlapStart) * t;
  }
  return Math.max(k.fallTime * frac, K.minSpawnInterval + previewTime());
}

/* ---------------------------------------------------------
   8. ゲーム開始・リセット
--------------------------------------------------------- */
function resetRun(practice) {
  G.knives.length = 0; G.particles.length = 0; G.floats.length = 0; G.rings.length = 0;
  G.pending = null; G.spawnAt = null; G.lastLanding = -1; G.lastGap = 0;
  G.catches = 0; G.score = 0; G.combo = 0; G.maxCombo = 0;
  G.grades = { GOOD:0, GREAT:0, PERFECT:0 };
  G.practice = !!practice; G.practiceDone = false;
  G.hitstop = 0; G.shake = 0; G.flash = 0; G.crash = false; G.crashT = 0;
  G.banner = null; G.overT = 0;
  G.bestFlag = { near:false, tie:false, neu:false };
  G.player.x = F.w * 0.5; G.player.v = 0; G.player.dir = -1; G.player.dirTime = 0;
  G.player.pose = 0; G.player.poseT = 0; G.player.pop = 0;
  updateHud();
}
function startCountdown(len) {
  G.state = 'count'; G.countT = 0; G.countLen = len; G.countShown = -1;
  hud.classList.remove('hidden');
}
function beginPlay() {
  G.state = 'play';
  G.spawnAt = G.time + (G.practice ? 0.35 : 0.45) + previewTime();
  Sound.ensure(); Sound.startBgm();
}

/* ---------------------------------------------------------
   9. ナイフ生成
--------------------------------------------------------- */
function pickType() {
  const c = G.catches, D = CONFIG.difficulty;
  if (G.practice || c < 2) return 'straight';
  const pool = ['straight', 'straight', 'straight'];
  if (c >= D.diagonalUnlock) pool.push('diagonal', 'diagonal');
  if (c >= D.rotateUnlock)   pool.push('rotate', 'rotate');
  if (c >= D.swayUnlock)     pool.push('sway', 'fast');
  if (c >= D.overlapUnlock)  pool.push('rotate', 'sway', 'diagonal', 'fast');
  return pool[Math.floor(Math.random() * pool.length)];
}

/* 現在の速度・入力方向・慣性・加速を考慮して、t秒で sign 方向へ進める距離を求める。
   updatePlayer と同じ運動モデルを数値積分するので、実際の挙動とズレない。 */
function reachDist(t, sign) {
  const P = CONFIG.player, sp = playerMaxSpeed();
  const rate = (2 * sp.max) / turnTime();
  let v = G.player.v, x = 0;
  let dirTime = (G.player.dir === sign) ? G.player.dirTime : 0;   // 逆向きなら加速はやり直し
  const steps = 16, dt = t / steps;
  for (let i = 0; i < steps; i++) {
    dirTime += dt;
    const target = sign * (sp.base + (sp.max - sp.base) * Math.min(1, dirTime / P.accelTime));
    if (v < target) v = Math.min(target, v + rate * dt);
    else            v = Math.max(target, v - rate * dt);
    x += v * dt;
  }
  return Math.max(0, sign * x);
}

/* 「移動に必要な平均速度 ÷ 最大速度」の上限。CATCHが進むほど忙しくする（§43） */
function travelRatioCap(c) {
  if (c < 5)  return 0.42;                                  // 1〜5 CATCH: 操作に慣れる
  if (c < 20) return 0.42 + (0.58 - 0.42) * ((c - 5) / 15); // 6〜19 CATCH: 徐々に増やす
  if (c < 40) return 0.58 + (0.64 - 0.58) * ((c - 20) / 20);// 20〜39 CATCH: 55〜60%帯
  return 0.64;                                              // 高難度帯の上限
}

/* 到達可能なX範囲から着弾点を選ぶ（§19）
   ・範囲は「実際に届く距離 × 0.92」と「要求速度の上限」の小さい方で決める
   ・近い位置と遠い位置を混ぜ、遠い場合は進行方向と逆側を優先して切り返しを要求する */
function chooseLanding(lead) {
  const sp = playerMaxSpeed(), px = G.player.x, half = catchHalfW();
  const c = G.catches, ph = phaseOf(c);
  let lo = CONFIG.player.marginX * F.w, hi = (1 - CONFIG.player.marginX) * F.w;
  if (ph === 1) { lo = F.w * 0.30; hi = F.w * 0.70; }        // 操作確認の2本だけ中央付近

  let cap = travelRatioCap(c) * lead * sp.max;
  if (ph === 1) cap *= 0.6;
  const canR = Math.max(F.w * 0.05, Math.min(cap, reachDist(lead,  1) * 0.92));
  const canL = Math.max(F.w * 0.05, Math.min(cap, reachDist(lead, -1) * 0.92));
  hi = Math.min(hi, px + canR);
  lo = Math.max(lo, px - canL);
  if (hi < lo) { const m = clamp((lo + hi) / 2, half, F.w - half); lo = hi = m; }

  const dir = G.player.v >= 0 ? 1 : -1;                      // 今の進行方向
  let best = null;
  for (let i = 0; i < 16; i++) {                             // 同じ位置に偏らせない
    let x;
    if (ph >= 3 && Math.random() < 0.45) {                   // 「すぐ動かないと間に合わない」配置
      const side = Math.random() < 0.7 ? -dir : dir;         // 主に進行方向と逆側＝切り返し
      const edge = side > 0 ? hi : lo;
      x = Math.abs(edge - px) < F.w * 0.12 ? rand(lo, hi)    // その側に余裕がなければ通常抽選
                                           : px + (edge - px) * rand(0.72, 1.0);
    } else {
      x = rand(lo, hi);
    }
    const d = G.lastLanding < 0 ? 99 : Math.abs(x - G.lastLanding);
    if (d > F.w * 0.13) { best = x; break; }
    if (best === null || d > Math.abs(best - G.lastLanding)) best = x;
  }
  return clamp(best, half * 0.6, F.w - half * 0.6);
}

function buildKnife() {
  const type = pickType();
  const g = CONFIG.geo;
  const k = {
    type, t:0, ang:0, angVel:0, vx:0, swayAmp:0, swayW:0, swayPh:0, baseX:0,
    handleLen:g.handleLen * F.h, bladeLen:g.bladeLen * F.h, w:g.knifeW * F.w,
    stuck:false
  };
  k.total = k.handleLen + k.bladeLen;
  const startY = -k.total * 0.6 - F.h * 0.02;
  k.vy = fallSpeed() * (type === 'fast' ? 1.28 : 1) * (G.practice ? 0.55 : (G.catches < 2 ? 0.88 : 1));
  k.y = startY;
  const T = (handY() - startY) / k.vy;                          // 落下時間
  k.fallTime = T;
  /* 実際に動ける時間 = min(前ナイフをキャッチしてからの間隔, 予告が出てからの時間)。
     予告が長いキャラ（みっちゃん）が不利にならないよう min を取る。 */
  const lead = Math.min(G.lastGap || Infinity, previewTime() + T);
  const landing = G.practice
    ? clamp(G.player.x + rand(-F.w * 0.06, F.w * 0.06), F.w * 0.2, F.w * 0.8)
    : chooseLanding(lead);
  G.lastLanding = landing;

  if (type === 'diagonal') {
    const dir = Math.random() < 0.5 ? -1 : 1;
    let vx = dir * rand(0.10, 0.20) * F.w;
    let sx = landing - vx * T;
    const lo = F.w * 0.07, hi = F.w * 0.93;
    if (sx < lo || sx > hi) { vx = -vx; sx = landing - vx * T; }
    if (sx < lo || sx > hi) { vx = (landing - clamp(sx, lo, hi)) / T; sx = landing - vx * T; }
    k.vx = vx; k.x = clamp(sx, lo, hi);
  } else if (type === 'sway') {
    k.swayAmp = rand(0.05, 0.085) * F.w;
    k.swayW = Math.PI * 2 * rand(0.55, 0.85);
    k.swayPh = rand(0, Math.PI * 2);
    k.baseX = clamp(landing - k.swayAmp * Math.sin(k.swayW * T + k.swayPh), F.w * 0.08, F.w * 0.92);
    k.x = k.baseX + k.swayAmp * Math.sin(k.swayPh);
  } else {
    k.x = landing;
    if (type === 'rotate') {
      k.angVel = (Math.random() < 0.5 ? -1 : 1) * rand(1.1, 2.0);
      k.ang = rand(-0.5, 0.5);
    }
  }
  k.spawnX = k.x;
  return k;
}

function knifePoints(k) {
  const top = -k.total / 2, jun = top + k.handleLen, tip = top + k.total;
  const c = Math.cos(k.ang), s = Math.sin(k.ang);
  const tr = (lx, ly) => ({ x:k.x + lx * c - ly * s, y:k.y + lx * s + ly * c });
  return { top:tr(0, top), jun:tr(0, jun), tip:tr(0, tip),
           hitEnd:tr(0, jun + k.bladeLen * CONFIG.geo.bladeHitScale), c, s };
}

function onSpawn(k) {
  if (G.practice) { G.spawnAt = null; return; }
  G.lastGap = nextSpawnDelay(k);
  G.spawnAt = G.time + G.lastGap;           // 出した時点で次を予約＝キャッチ後に間が空かない
}

/* ---------------------------------------------------------
   10. 更新処理
--------------------------------------------------------- */
function updatePlayer(dt) {
  const P = CONFIG.player, sp = playerMaxSpeed(), pl = G.player;
  const dir = pressed() ? 1 : -1;
  if (dir !== pl.dir) { pl.dir = dir; pl.dirTime = 0; }
  pl.dirTime += dt;
  const accel = Math.min(1, pl.dirTime / P.accelTime);
  const target = dir * (sp.base + (sp.max - sp.base) * accel);
  const rate = (2 * sp.max) / turnTime();                       // 弱い慣性（§9.1）
  if (pl.v < target) pl.v = Math.min(target, pl.v + rate * dt);
  else               pl.v = Math.max(target, pl.v - rate * dt);
  pl.x += pl.v * dt;
  const lo = P.marginX * F.w, hi = (1 - P.marginX) * F.w;
  if (pl.x <= lo) { pl.x = lo; if (pl.v < 0) pl.v = 0; }        // 端では停止・反射しない
  if (pl.x >= hi) { pl.x = hi; if (pl.v > 0) pl.v = 0; }
}

function addFloat(text, x, y, color, size, life) {
  G.floats.push({ text, x, y, color, size, t:0, life:life || 0.75 });
}
function burst(x, y, n, color, power, star) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * (power || 1) * F.h;
    G.particles.push({ x, y, vx:Math.cos(a) * s, vy:Math.sin(a) * s - F.h * 0.15,
      life:rand(0.28, 0.62), t:0, color, star:!!star, spin:rand(-8, 8),
      r:rand(1.5, 4) * (F.w / 400) * (star ? 2.2 : 1) });
  }
}
function ring(x, y, r0, r1, color, life, width) {
  G.rings.push({ x, y, r0, r1, color, t:0, life:life || 0.26, w:width || F.w * 0.008 });
}

/* キャッチ成功エフェクト（§40）。キャラ画像は差し替えず、上に重ねるだけ。
   GOOD    : 小さい光
   GREAT   : 光 ＋ リング
   PERFECT : 光 ＋ 二重リング ＋ 星 ＋ 少し大きい文字 */
function catchFx(x, y, grade) {
  const fx = CONFIG.player.catchFxDuration / 1000;
  const col = grade === 'PERFECT' ? '#ffd45e' : grade === 'GREAT' ? '#6fc3ff' : '#e8eef7';
  const size = grade === 'PERFECT' ? 0.048 : grade === 'GREAT' ? 0.038 : 0.030;
  addFloat(grade === 'PERFECT' ? 'PERFECT!' : grade, x, y - F.h * 0.045, col, size, fx + 0.10);
  if (grade === 'PERFECT') {
    burst(x, y, 18, col, 0.7);
    burst(x, y, 6, '#fff3c4', 0.5, true);            // 星
    ring(x, y, F.w * 0.02, F.w * 0.20, col, fx, F.w * 0.010);
    ring(x, y, F.w * 0.02, F.w * 0.13, '#ffffff', fx * 0.75, F.w * 0.006);
  } else if (grade === 'GREAT') {
    burst(x, y, 12, col, 0.55);
    ring(x, y, F.w * 0.02, F.w * 0.15, col, fx, F.w * 0.007);
  } else {
    burst(x, y, 7, col, 0.45);
  }
  G.player.pop = fx;                                  // ごく軽いバウンド
  G.player.popMax = fx;
}
function showBanner(text, color, life) { G.banner = { text, color }; G.bannerT = life || 1.0; }

function doCatch(k, grade, ratio) {
  const S = CONFIG.score;
  G.knives.splice(G.knives.indexOf(k), 1);
  G.grades[grade]++;
  if (G.practice) {
    G.practiceDone = true;
    addFloat('OK!', k.x, handY() - F.h * 0.04, '#ffd45e', 0.055, 0.8);
    burst(k.x, handY(), 16, '#ffd45e', 0.6);
    ring(k.x, handY(), F.w * 0.02, F.w * 0.18, '#ffd45e', 0.3, F.w * 0.008);
    Sound.catchSE('PERFECT', 0); G.hitstop = 0.05;
    G.player.pop = CONFIG.player.catchFxDuration / 1000;
    G.player.popMax = G.player.pop;
    setTimeout(() => { if (G.state === 'play' && G.practice) finishTutorial(); }, 520);
    return;
  }
  G.catches++;
  if (grade === 'GREAT') G.combo += 1;
  else if (grade === 'PERFECT') G.combo += 2;
  G.maxCombo = Math.max(G.maxCombo, G.combo);
  const c = G.combo;
  const mul = c >= 30 ? 1.5 : c >= 20 ? 1.3 : c >= 10 ? 1.2 : c >= 5 ? 1.1 : 1.0;
  G.score += Math.round(S[grade] * mul);

  catchFx(k.x, handY(), grade);                      // キャラは通常画像のまま
  G.hitstop = grade === 'PERFECT' ? 0.035 : 0.018;   // テンポを止めない（変更なし）
  G.shake = Math.max(G.shake, grade === 'PERFECT' ? 5 : 2.5);
  Sound.catchSE(grade, G.combo);
  if (grade === 'PERFECT' && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }

  /* BEST目前演出（§45） */
  const best = SAVE.best.catch;
  if (best >= 5) {
    if (!G.bestFlag.neu && G.catches === best + 1) { G.bestFlag.neu = true; showBanner('NEW BEST!', '#ffd45e', 1.4); Sound.newBestSE(); }
    else if (!G.bestFlag.tie && G.catches === best) { G.bestFlag.tie = true; showBanner('BEST TIE!', '#6fc3ff', 1.1); }
    else if (!G.bestFlag.near && G.catches === best - 2) { G.bestFlag.near = true; showBanner('BESTまであと2！', '#8ba0bd', 1.0); }
  }
  if (!G.crash && G.catches >= CONFIG.difficulty.overlapUnlock - 1) {
    G.crash = true; showBanner('MARKET CRASH', '#ff4d5e', 1.5); G.flash = 0.5;
  }
  if (G.spawnAt === null) G.spawnAt = G.time + spawnInterval() + previewTime();  // 保険
  updateHud();
}

function gameOver(kind, k) {
  if (G.state !== 'play') return;
  if (G.practice) {                                             // 練習では終了しない
    if (k) { G.knives.splice(G.knives.indexOf(k), 1); }
    addFloat('もう一度！', F.w / 2, handY() - F.h * 0.06, '#ff4d5e', 0.038, 0.9);
    Sound.dropSE();
    G.spawnAt = G.time + 0.7 + previewTime();
    return;
  }
  G.state = 'over'; G.overT = 0; G.overKind = kind;
  const qs = OVER_QUOTES[kind]; G.overQuote = qs[Math.floor(Math.random() * qs.length)];
  G.shake = kind === 'blade' ? 14 : 9; G.flash = kind === 'blade' ? 0.6 : 0.3;
  G.player.pose = 3; G.player.poseT = Infinity; G.player.pop = 0;   // 即座にMissへ
  Sound.stopBgm();
  if (kind === 'blade') { Sound.bladeSE(); burst(G.player.x, bodyTop(), 20, '#ff4d5e', 0.7); }
  else { Sound.dropSE(); if (k) { k.stuck = true; k.vy = 0; k.vx = 0; k.angVel = 0; k.ang = 0; k.y = floorY() + k.bladeLen * 0.35 - k.total / 2; } }
  if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
  commitScore();
}

function updateKnives(dt) {
  const hx = G.player.x, hy = handY();
  const chw = catchHalfW(), chh = CONFIG.layout.handHalfH * F.h;
  const dhw = dangerHalfW(), bt = bodyTop(), bb = bt + CONFIG.layout.dangerH * F.h;

  for (let i = G.knives.length - 1; i >= 0; i--) {
    const k = G.knives[i];
    if (k.stuck) continue;
    k.t += dt;
    k.y += k.vy * dt;
    if (k.type === 'sway') k.x = k.baseX + k.swayAmp * Math.sin(k.swayW * k.t + k.swayPh);
    else if (k.vx) {
      k.x += k.vx * dt;
      if (k.x < F.w * 0.04) { k.x = F.w * 0.04; k.vx = Math.abs(k.vx); }
      if (k.x > F.w * 0.96) { k.x = F.w * 0.96; k.vx = -Math.abs(k.vx); }
    }
    if (k.angVel) k.ang += k.angVel * dt;

    const P = knifePoints(k);
    /* キャッチ判定（柄 × 手） */
    if (segAabb(P.top.x, P.top.y, P.jun.x, P.jun.y, hx - chw, hy - chh, hx + chw, hy + chh)) {
      const cp = closestOnSeg(hx, hy, P.top.x, P.top.y, P.jun.x, P.jun.y);
      const ratio = Math.abs(cp.x - hx) / chw;
      const grade = ratio <= perfectRatio() ? 'PERFECT'
                  : ratio <= CONFIG.judgement.greatRatio ? 'GREAT' : 'GOOD';
      doCatch(k, grade, ratio);
      continue;
    }
    /* 刃 × 体の危険判定 */
    if (segAabb(P.jun.x, P.jun.y, P.hitEnd.x, P.hitEnd.y, hx - dhw, bt, hx + dhw, bb)) {
      gameOver('blade', k); return;
    }
    /* 取り逃し */
    if (Math.min(P.top.y, P.tip.y) > F.h) { gameOver('drop', k); return; }
  }
}

function updateSpawn(dt) {
  if (G.spawnAt === null) return;
  const pv = previewTime();
  if (!G.pending && G.time >= G.spawnAt - pv) G.pending = buildKnife();
  if (G.pending && G.time >= G.spawnAt) {
    const k = G.pending; G.pending = null;
    G.knives.push(k);
    onSpawn(k);
  }
}

function updateEffects(dt) {
  /* キャッチ演出のタイマーはヒットストップとは別管理・実時間。
     ゲーム進行（落下・生成・入力）は一切止めない。
     連続キャッチのたびに catchFx が再設定するので、その時点から数え直しになる。 */
  const pl = G.player;
  if (pl.pop > 0) pl.pop = Math.max(0, pl.pop - dt);
  if (pl.pose !== 3 && pl.poseT > 0) { pl.poseT -= dt; if (pl.poseT <= 0) pl.pose = 0; }
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i]; p.t += dt;
    if (p.t >= p.life) { G.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += F.h * 1.6 * dt; p.vx *= 0.97;
  }
  for (let i = G.rings.length - 1; i >= 0; i--) {
    const r = G.rings[i]; r.t += dt;
    if (r.t >= r.life) G.rings.splice(i, 1);
  }
  for (let i = G.floats.length - 1; i >= 0; i--) {
    const f = G.floats[i]; f.t += dt;
    if (f.t >= f.life) G.floats.splice(i, 1); else f.y -= F.h * 0.05 * dt;
  }
  if (G.bannerT > 0) { G.bannerT -= dt; if (G.bannerT <= 0) G.banner = null; }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 45);
  if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 2.2);
  if (G.crash) G.crashT += dt;
}

function update(dt) {
  G.time += dt;
  updateEffects(dt);
  if (G.state === 'count') {
    updatePlayer(dt);
    G.countT += dt;
    const rem = Math.ceil(G.countLen - G.countT);
    if (rem !== G.countShown && rem > 0) { G.countShown = rem; Sound.countSE(false); }
    if (G.countT >= G.countLen) { Sound.countSE(true); beginPlay(); }
    return;
  }
  if (G.state === 'play') {
    if (G.hitstop > 0) { G.hitstop -= dt; return; }
    updatePlayer(dt);
    updateSpawn(dt);
    updateKnives(dt);
    Sound.tickBgm(G.catches);
    return;
  }
  if (G.state === 'over') {
    G.overT += dt;
    if (G.overT > 0.7 && scResult.classList.contains('hidden')) showResult();
  }
}

/* ---------------------------------------------------------
   11. 描画
--------------------------------------------------------- */
function drawBackground() {
  const g = ctx;
  const crash = G.crash ? Math.min(1, G.crashT * 1.2) : 0;
  const grad = g.createLinearGradient(0, 0, 0, F.h);
  grad.addColorStop(0, crash ? '#2a0e14' : '#101a26');
  grad.addColorStop(1, crash ? '#160a10' : '#0b1119');
  g.fillStyle = grad; g.fillRect(0, 0, F.w, F.h);

  /* 背景のローソク足（株テーマ・視認性を落とさない濃度） */
  g.save(); g.globalAlpha = 0.16;
  const n = 16, bw = F.w / n, scroll = (G.time * 14) % bw;
  for (let i = 0; i < n + 2; i++) {
    const idx = Math.floor((G.time * 14) / bw) + i;
    const r1 = Math.abs(Math.sin(idx * 12.9898) * 43758.5453) % 1;
    const r2 = Math.abs(Math.sin(idx * 78.233) * 12345.678) % 1;
    const up = G.crash ? r1 > 0.72 : r1 > 0.42;
    const cx = i * bw - scroll + bw / 2;
    const mid = F.h * (0.30 + 0.34 * r2);
    const hgt = F.h * (0.03 + 0.10 * r1);
    g.strokeStyle = g.fillStyle = up ? '#2ecc71' : '#ff4d5e';
    g.lineWidth = Math.max(1, F.w * 0.004);
    g.beginPath(); g.moveTo(cx, mid - hgt * 0.9); g.lineTo(cx, mid + hgt * 0.9); g.stroke();
    g.fillRect(cx - bw * 0.26, mid - hgt * 0.5, bw * 0.52, hgt);
  }
  g.restore();

  /* 床（ミニキャラの足元に合わせる） */
  const fy = floorY();
  g.fillStyle = '#161f2c'; g.fillRect(0, fy, F.w, F.h - fy + 2);
  g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, fy, F.w, 1.5);
}

function drawKnife(k, alpha) {
  const g = ctx;
  g.save(); g.translate(k.x, k.y); g.rotate(k.ang);
  if (alpha !== undefined) g.globalAlpha = alpha;
  const w = k.w, hl = k.handleLen, bl = k.bladeLen, top = -k.total / 2, jun = top + hl;
  /* 柄（掴む部分・目立たせる） */
  const grip = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  grip.addColorStop(0, '#8a5a2b'); grip.addColorStop(0.45, '#d79a53'); grip.addColorStop(1, '#7a4d22');
  g.fillStyle = grip;
  g.beginPath();
  const r = w * 0.42;
  g.moveTo(-w / 2, top + r); g.quadraticCurveTo(-w / 2, top, -w / 2 + r, top);
  g.lineTo(w / 2 - r, top); g.quadraticCurveTo(w / 2, top, w / 2, top + r);
  g.lineTo(w / 2, jun); g.lineTo(-w / 2, jun); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = Math.max(1, w * 0.08);
  for (let i = 1; i <= 3; i++) {
    const y = top + hl * (i / 4);
    g.beginPath(); g.moveTo(-w / 2, y); g.lineTo(w / 2, y); g.stroke();
  }
  /* 掴む位置のハイライト */
  g.fillStyle = 'rgba(255,212,94,.55)';
  g.fillRect(-w / 2, top + hl * 0.44, w, hl * 0.12);
  /* 鍔 */
  g.fillStyle = '#c9d3e0';
  g.fillRect(-w * 0.85, jun - w * 0.10, w * 1.7, w * 0.30);
  /* 刃 */
  const blade = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  blade.addColorStop(0, '#7e8ea3'); blade.addColorStop(0.4, '#eef4ff'); blade.addColorStop(1, '#93a3b8');
  g.fillStyle = blade;
  g.beginPath();
  g.moveTo(-w * 0.52, jun + w * 0.2); g.lineTo(w * 0.52, jun + w * 0.2);
  g.lineTo(w * 0.30, top + hl + bl * 0.72); g.lineTo(0, top + hl + bl);
  g.lineTo(-w * 0.30, top + hl + bl * 0.72); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, jun + w * 0.3); g.lineTo(0, top + hl + bl * 0.9); g.stroke();
  g.restore();
}

/* キャラクター描画（ゲーム内・選択画面 共用）
   u = 基準単位。手の位置(cx, hy)を基準に組み立てる */
function drawCharacter(g, ch, cx, hy, u, opt) {
  opt = opt || {};
  const lean = opt.lean || 0, pose = opt.pose || 0;
  const bt = hy + 0.085 * u;
  const headR = 0.042 * u, headC = bt + headR;
  g.save();
  g.translate(cx, bt); g.rotate(lean); g.translate(-cx, -bt);

  /* 影 */
  g.fillStyle = 'rgba(0,0,0,.28)';
  g.beginPath(); g.ellipse(cx, bt + 0.178 * u, 0.055 * u, 0.013 * u, 0, 0, Math.PI * 2); g.fill();

  /* 脚 */
  g.strokeStyle = ch.hair; g.lineWidth = 0.016 * u; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 0.018 * u, bt + 0.135 * u); g.lineTo(cx - 0.024 * u, bt + 0.172 * u);
  g.moveTo(cx + 0.018 * u, bt + 0.135 * u); g.lineTo(cx + 0.024 * u, bt + 0.172 * u); g.stroke();

  /* 胴 */
  g.fillStyle = ch.accent;
  const bw = 0.070 * u, byT = bt + 0.070 * u, byB = bt + 0.142 * u, br = 0.020 * u;
  g.beginPath();
  g.moveTo(cx - bw / 2 + br, byT); g.lineTo(cx + bw / 2 - br, byT);
  g.quadraticCurveTo(cx + bw / 2, byT, cx + bw / 2, byT + br);
  g.lineTo(cx + bw / 2, byB - br); g.quadraticCurveTo(cx + bw / 2, byB, cx + bw / 2 - br, byB);
  g.lineTo(cx - bw / 2 + br, byB); g.quadraticCurveTo(cx - bw / 2, byB, cx - bw / 2, byB - br);
  g.lineTo(cx - bw / 2, byT + br); g.quadraticCurveTo(cx - bw / 2, byT, cx - bw / 2 + br, byT);
  g.closePath(); g.fill();

  /* 腕（キャッチポーズで少し内側に寄る） */
  const inw = pose ? 0.006 * u : 0;
  g.strokeStyle = ch.body; g.lineWidth = 0.015 * u;
  g.beginPath();
  g.moveTo(cx - 0.030 * u, bt + 0.085 * u); g.quadraticCurveTo(cx - 0.046 * u, bt + 0.03 * u, cx - 0.026 * u + inw, hy + 0.004 * u);
  g.moveTo(cx + 0.030 * u, bt + 0.085 * u); g.quadraticCurveTo(cx + 0.046 * u, bt + 0.03 * u, cx + 0.026 * u - inw, hy + 0.004 * u);
  g.stroke();

  /* 頭 */
  g.fillStyle = ch.body;
  g.beginPath(); g.arc(cx, headC, headR, 0, Math.PI * 2); g.fill();
  /* 髪 */
  g.fillStyle = ch.hair;
  g.beginPath(); g.arc(cx, headC - headR * 0.12, headR * 1.03, Math.PI * 1.03, Math.PI * 1.97); g.fill();
  g.beginPath(); g.ellipse(cx - headR * 0.92, headC + headR * 0.1, headR * 0.26, headR * 0.55, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx + headR * 0.92, headC + headR * 0.1, headR * 0.26, headR * 0.55, 0, 0, Math.PI * 2); g.fill();

  /* 目・口 */
  g.fillStyle = '#2a2233';
  const ey = headC + headR * 0.12, ex = headR * 0.38;
  if (pose === 3) {                                  // 驚き
    g.beginPath(); g.arc(cx - ex, ey, headR * 0.17, 0, Math.PI * 2);
    g.arc(cx + ex, ey, headR * 0.17, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx, ey + headR * 0.45, headR * 0.16, headR * 0.20, 0, 0, Math.PI * 2); g.fill();
  } else if (ch.accessory === 'sleep') {             // ねむぱん：とろ目
    g.lineWidth = headR * 0.13; g.strokeStyle = '#2a2233'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - ex - headR * 0.16, ey); g.lineTo(cx - ex + headR * 0.16, ey);
    g.moveTo(cx + ex - headR * 0.16, ey); g.lineTo(cx + ex + headR * 0.16, ey); g.stroke();
  } else {
    g.beginPath(); g.ellipse(cx - ex, ey, headR * 0.11, headR * (pose === 2 ? 0.10 : 0.16), 0, 0, Math.PI * 2);
    g.ellipse(cx + ex, ey, headR * 0.11, headR * (pose === 2 ? 0.10 : 0.16), 0, 0, Math.PI * 2); g.fill();
  }
  if (pose !== 3) {
    g.strokeStyle = '#2a2233'; g.lineWidth = headR * 0.09; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, ey + headR * 0.30, headR * 0.16, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
  /* ほっぺ */
  g.fillStyle = 'rgba(255,120,150,.35)';
  g.beginPath(); g.arc(cx - headR * 0.62, ey + headR * 0.28, headR * 0.16, 0, Math.PI * 2);
  g.arc(cx + headR * 0.62, ey + headR * 0.28, headR * 0.16, 0, Math.PI * 2); g.fill();

  /* アクセサリ */
  const topY = headC - headR;
  if (ch.accessory === 'crown') {
    g.fillStyle = '#ffd45e';
    g.beginPath();
    g.moveTo(cx - headR * 0.62, topY + headR * 0.08); g.lineTo(cx - headR * 0.62, topY - headR * 0.42);
    g.lineTo(cx - headR * 0.31, topY - headR * 0.10); g.lineTo(cx, topY - headR * 0.52);
    g.lineTo(cx + headR * 0.31, topY - headR * 0.10); g.lineTo(cx + headR * 0.62, topY - headR * 0.42);
    g.lineTo(cx + headR * 0.62, topY + headR * 0.08); g.closePath(); g.fill();
  } else if (ch.accessory === 'antenna') {
    g.strokeStyle = ch.hair; g.lineWidth = headR * 0.10;
    g.beginPath();
    g.moveTo(cx - headR * 0.3, topY + headR * 0.1); g.quadraticCurveTo(cx - headR * 0.7, topY - headR * 0.5, cx - headR * 0.5, topY - headR * 0.72);
    g.moveTo(cx + headR * 0.3, topY + headR * 0.1); g.quadraticCurveTo(cx + headR * 0.7, topY - headR * 0.5, cx + headR * 0.5, topY - headR * 0.72);
    g.stroke();
    g.fillStyle = '#ffd45e';
    g.beginPath(); g.arc(cx - headR * 0.5, topY - headR * 0.78, headR * 0.13, 0, Math.PI * 2);
    g.arc(cx + headR * 0.5, topY - headR * 0.78, headR * 0.13, 0, Math.PI * 2); g.fill();
  } else if (ch.accessory === 'star') {
    g.fillStyle = 'rgba(255,212,94,' + (0.55 + 0.45 * Math.sin(G.time * 4)) + ')';
    const sr = headR * 0.34, sy = topY - headR * 0.45;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? sr * 0.45 : sr;
      const px = cx + Math.cos(a) * rr, py = sy + Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  } else if (ch.accessory === 'sleep') {
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.font = '600 ' + (headR * 0.7) + 'px sans-serif'; g.textAlign = 'center';
    g.fillText('z', cx + headR * 1.1, topY + headR * 0.1);
  }

  /* 手（キャッチ判定の位置） */
  g.fillStyle = ch.body; g.strokeStyle = 'rgba(0,0,0,.15)'; g.lineWidth = 1;
  const hr = 0.019 * u, hoff = 0.026 * u - inw;
  g.beginPath(); g.arc(cx - hoff, hy, hr, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath(); g.arc(cx + hoff, hy, hr, 0, Math.PI * 2); g.fill(); g.stroke();
  g.restore();
}

function drawPlayer() {
  const pl = G.player, sp = playerMaxSpeed();
  const lean = clamp(pl.v / sp.max, -1, 1) * 0.14;
  /* キャッチ判定の目安（薄く表示して「見た目と判定の一致」を助ける） */
  const g = ctx, hy = handY(), chw = catchHalfW();
  /* キャッチ演出の強さ（0→1→0）。画像の差し替えではなくこの値で見せる */
  const env = pl.pop > 0 ? Math.sin(Math.PI * Math.pow(1 - pl.pop / pl.popMax, 0.55)) : 0;
  if (pl.pose !== 3) {                                  // ゲームオーバー中は出さない
    g.save();
    g.globalAlpha = 0.28 + 0.45 * env;
    g.strokeStyle = '#ffd45e'; g.lineWidth = Math.max(1.2, F.w * 0.005);
    g.lineCap = 'round';
    const cap = F.h * 0.010;
    g.beginPath();
    g.moveTo(pl.x - chw, hy); g.lineTo(pl.x + chw, hy);
    g.moveTo(pl.x - chw, hy - cap); g.lineTo(pl.x - chw, hy + cap);
    g.moveTo(pl.x + chw, hy - cap); g.lineTo(pl.x + chw, hy + cap);
    g.stroke();
    g.restore();
  }

  /* ごく軽い拡大＋上下バウンド（キャラ画像自体は差し替えない） */
  g.save();
  if (env > 0) {
    g.translate(pl.x, hy + F.h * 0.10);
    g.scale(1 + 0.05 * env, 1 + 0.05 * env);
    g.translate(-pl.x, -(hy + F.h * 0.10));
    g.translate(0, -F.h * 0.014 * env);
  }
  const s = spriteFor(G.char.id, pl.pose);
  if (s) drawPlayerSprite(s, pl.x, hy);
  else   drawCharacter(ctx, G.char, pl.x, hy, F.h * CONFIG.player.visualScale, { lean, pose: pl.pose });
  g.restore();
}

/* 画像は「ゲーム内座標に合わせて置くだけ」。
   高さ = 手の位置〜足元の距離 ÷ (footY - 通常画像のay) なので、
   ポーズが変わっても倍率は一定。当たり判定・リーチは画像に一切影響されない。 */
function drawPlayerSprite(s, cx, hy) {
  const h = (floorY() - hy) / (s.sp.footY - s.sp.normal.ay);
  const w = h * s.img.naturalWidth / s.img.naturalHeight;
  const x = cx + (s.sp.offsetX || 0) * F.w - s.ax * w;
  const y = hy + (s.sp.offsetY || 0) * F.h - s.ay * h;
  ctx.drawImage(s.img, x, y, w, h);
}

function drawPreview() {
  if (!G.pending || G.state !== 'play') return;
  const k = G.pending, g = ctx;
  const rest = Math.max(0, G.spawnAt - G.time), pv = previewTime();
  const a = 0.62 + 0.38 * Math.sin(G.time * 14);
  const col = G.char.id === 'micchan' ? '#9be7ff' : '#ffd45e';
  const x = k.spawnX, y = F.h * 0.030, s = F.w * 0.030;
  g.save();
  /* 上端の光 */
  const beam = g.createLinearGradient(0, 0, 0, F.h * 0.11);
  beam.addColorStop(0, col); beam.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = a * 0.30; g.fillStyle = beam;
  g.fillRect(x - F.w * 0.035, 0, F.w * 0.070, F.h * 0.11);
  /* ▼ */
  g.globalAlpha = a; g.fillStyle = col;
  g.shadowColor = col; g.shadowBlur = F.w * 0.05;
  g.beginPath(); g.moveTo(x - s, y - s * 0.85); g.lineTo(x + s, y - s * 0.85); g.lineTo(x, y + s * 0.85); g.closePath(); g.fill();
  g.shadowBlur = 0;
  if (k.type === 'diagonal') {                       // 斜めは向きを示す
    const d = Math.sign(k.vx);
    g.beginPath(); g.moveTo(x + d * s * 1.5, y + s * 0.1); g.lineTo(x + d * s * 2.7, y - s * 0.35);
    g.lineTo(x + d * s * 1.5, y - s * 0.8); g.closePath(); g.fill();
  }
  /* 予告時間が長いキャラ（みっちゃん）は半透明ナイフも見せる */
  if (pv >= 0.35 && rest > 0.05) {
    g.globalAlpha = 0.22 * Math.min(1, rest / pv);
    const ghost = Object.assign({}, k, { x:k.spawnX, y:F.h * 0.135, ang:k.ang });
    drawKnife(ghost);
  }
  g.restore();
}

function drawStar(g, x, y, r, rot) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath(); g.fill();
}
function drawEffects() {
  const g = ctx;
  G.rings.forEach(r => {                       // 広がるリング
    const k = r.t / r.life;
    g.globalAlpha = Math.max(0, 1 - k) * 0.9;
    g.strokeStyle = r.color;
    g.lineWidth = r.w * (1 - k * 0.65);
    g.beginPath(); g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2)), 0, Math.PI * 2);
    g.stroke();
  });
  g.globalAlpha = 1;
  G.particles.forEach(p => {
    g.globalAlpha = Math.max(0, 1 - p.t / p.life);
    g.fillStyle = p.color;
    if (p.star) drawStar(g, p.x, p.y, p.r, p.t * p.spin);
    else { g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill(); }
  });
  g.globalAlpha = 1;
  G.floats.forEach(f => {
    const k = f.t / f.life;
    g.globalAlpha = Math.max(0, 1 - k * k);
    const sc = 1 + 0.25 * Math.min(1, f.t * 9) - 0.1 * k;
    g.save();
    g.font = '900 ' + (f.size * F.h) + 'px -apple-system,BlinkMacSystemFont,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const half = g.measureText(f.text).width * sc / 2 + F.w * 0.02;   // 画面外にはみ出さない
    g.translate(clamp(f.x, half, F.w - half), f.y); g.scale(sc, sc);
    g.lineWidth = f.size * F.h * 0.18; g.strokeStyle = 'rgba(0,0,0,.55)';
    g.strokeText(f.text, 0, 0);
    g.fillStyle = f.color; g.fillText(f.text, 0, 0);
    g.restore();
  });
  g.globalAlpha = 1;
}

function drawOverlayText() {
  const g = ctx;
  if (G.state === 'count') {
    const rem = G.countLen - G.countT;
    const n = Math.ceil(rem);
    const txt = n <= 0 ? 'START!' : String(n);
    const frac = 1 - (rem - Math.floor(rem));
    const sc = 1 + 0.35 * (1 - Math.min(1, frac * 3));
    g.save();
    g.translate(F.w / 2, F.h * 0.42); g.scale(sc, sc);
    g.font = '900 ' + (F.h * 0.11) + 'px -apple-system,BlinkMacSystemFont,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = F.h * 0.018; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(txt, 0, 0);
    g.fillStyle = '#ffd45e'; g.fillText(txt, 0, 0);
    g.restore();
    if (G.practice) hint(g, '押す→右 / 離す→左');
  }
  if (G.state === 'play' && G.practice) hint(g, '練習：柄を掴んでみよう');
  if (G.banner) {
    const a = Math.min(1, G.bannerT * 3);
    g.save(); g.globalAlpha = a;
    g.font = '900 ' + (F.h * 0.038) + 'px -apple-system,BlinkMacSystemFont,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const y = F.h * 0.30;
    g.lineWidth = F.h * 0.010; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(G.banner.text, F.w / 2, y);
    g.fillStyle = G.banner.color; g.fillText(G.banner.text, F.w / 2, y);
    g.restore();
  }
  if (G.state === 'over' && G.overT < 0.75) {
    g.save();
    g.globalAlpha = Math.min(1, G.overT * 4);
    g.font = '900 ' + (F.h * 0.05) + 'px -apple-system,BlinkMacSystemFont,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ff4d5e'; g.fillText('GAME OVER', F.w / 2, F.h * 0.40);
    g.restore();
  }
}
function hint(g, text) {
  g.save();
  g.globalAlpha = 0.75;
  g.font = '700 ' + (F.h * 0.021) + 'px -apple-system,BlinkMacSystemFont,sans-serif';
  g.textAlign = 'center'; g.fillStyle = '#8ba0bd';
  g.fillText(text, F.w / 2, F.h * 0.60);
  g.restore();
}

function render() {
  ctx.setTransform(F.dpr, 0, 0, F.dpr, 0, 0);
  ctx.fillStyle = '#080b10';
  ctx.fillRect(0, 0, F.vw, F.vh);
  const sx = G.shake ? rand(-G.shake, G.shake) : 0;
  const sy = G.shake ? rand(-G.shake, G.shake) : 0;
  ctx.save();
  ctx.translate(F.ox + sx, F.oy + sy);
  ctx.beginPath(); ctx.rect(-F.ox - 40, -F.oy - 40, F.w + F.ox * 2 + 80, F.h + F.oy * 2 + 80); ctx.clip();
  drawBackground();
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, F.w, F.h); ctx.clip();
  drawPreview();
  G.knives.forEach(k => drawKnife(k));
  if (G.state !== 'title' && G.state !== 'select') drawPlayer();
  drawEffects();
  drawOverlayText();
  ctx.restore();
  if (G.flash > 0) {
    ctx.fillStyle = 'rgba(255,80,90,' + (G.flash * 0.42) + ')';
    ctx.fillRect(0, 0, F.w, F.h);
  }
  ctx.restore();
  /* フィールド外（PC等）のマスク */
  ctx.fillStyle = '#080b10';
  if (F.ox > 0) {
    ctx.fillRect(0, 0, F.ox, F.vh);
    ctx.fillRect(F.ox + F.w, 0, F.vw - F.ox - F.w + 2, F.vh);
  }
  if (F.oy > 0) ctx.fillRect(0, 0, F.vw, F.oy);
  if (F.oy + F.h < F.vh) ctx.fillRect(0, F.oy + F.h, F.vw, F.vh - F.oy - F.h + 2);
}

/* ---------------------------------------------------------
   12. メインループ
--------------------------------------------------------- */
function frame(ts) {
  if (!G.last) G.last = ts;
  let dt = (ts - G.last) / 1000; G.last = ts;
  dt = Math.min(dt, 1 / 20);                          // タブ復帰などの巨大dt対策
  update(dt);
  render();
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------
   13. 入力（§36 / §37）
--------------------------------------------------------- */
function isUiTarget(e) {
  const t = e.target;
  return t && t.closest && t.closest('.screen');
}
window.addEventListener('pointerdown', e => {
  Sound.ensure();
  if (isUiTarget(e)) return;
  G.input.add(e.pointerId);
  if (G.state === 'pause') resumeGame();
  e.preventDefault();
}, { passive:false });
const release = e => { G.input.delete(e.pointerId); };
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('pointerout', e => { if (e.pointerType === 'mouse') release(e); });
window.addEventListener('blur', () => { G.input.clear(); G.keyDown = false; });
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); Sound.ensure(); G.keyDown = true; if (G.state === 'pause') resumeGame(); }
}, { passive:false });
window.addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); G.keyDown = false; } }, { passive:false });
window.addEventListener('contextmenu', e => { if (!isUiTarget(e)) e.preventDefault(); });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => { if (!isUiTarget(e)) e.preventDefault(); }, { passive:false });

/* バックグラウンド時は自動一時停止（§54） */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (G.state === 'play' || G.state === 'count')) {
    G.resumeState = G.state; G.state = 'pause';
    G.input.clear(); G.keyDown = false;
    Sound.stopBgm();
    scPause.classList.remove('hidden');
  }
});
function resumeGame() {
  if (G.state !== 'pause') return;
  scPause.classList.add('hidden');
  G.state = G.resumeState || 'play';
  G.last = 0;
  if (G.state === 'play') { Sound.ensure(); Sound.startBgm(); }
}

/* ---------------------------------------------------------
   14. 画面遷移・UI
--------------------------------------------------------- */
const $ = id => document.getElementById(id);
const hud = $('hud'), scTitle = $('scTitle'), scSelect = $('scSelect'),
      scTutorial = $('scTutorial'), scResult = $('scResult'), scPause = $('scPause');
const screens = [scTitle, scSelect, scTutorial, scResult, scPause];
function showScreen(el) {
  screens.forEach(s => s.classList.toggle('hidden', s !== el));
  hud.classList.toggle('hidden', el !== null);
  if (el === null) hud.classList.remove('hidden');
}
function updateHud() {
  $('hudCatch').textContent = G.catches;
  $('hudScore').textContent = G.score.toLocaleString();
  $('hudCombo').textContent = G.combo;
  $('hudBest').textContent = SAVE.best.catch;
  const el = $('hudCatch');
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}

function goTitle() {
  G.state = 'title';
  showScreen(scTitle); hud.classList.add('hidden');
  $('titleBestCatch').textContent = SAVE.best.catch;
  $('titleBestScore').textContent = SAVE.best.score.toLocaleString();
  $('btnSound').textContent = Sound.enabled ? '🔊 SOUND ON' : '🔇 SOUND OFF';
  Sound.stopBgm();
}
function goSelect() {
  G.state = 'select';
  buildCharList();
  showScreen(scSelect); hud.classList.add('hidden');
}
function buildCharList() {
  const list = $('charList');
  list.innerHTML = '';
  CHARACTERS.forEach(ch => {
    const card = document.createElement('div');
    card.className = 'char-card' + (ch.id === G.char.id ? ' sel' : '');
    card.dataset.id = ch.id;
    const cnv = document.createElement('canvas');
    const w = 78, h = 96, dpr = Math.min(window.devicePixelRatio || 1, 3);
    cnv.width = w * dpr; cnv.height = h * dpr;
    const g = cnv.getContext('2d'); g.scale(dpr, dpr);
    drawCardArt(g, ch, w, h);
    const best = SAVE.characters[ch.id] || { catch:0, score:0 };
    card.appendChild(cnv);
    const html = document.createElement('div');
    html.innerHTML =
      '<div class="cc-name">' + ch.name + '</div>' +
      '<div class="cc-trait">' + ch.trait + '</div>' +
      '<div class="cc-desc">' + ch.desc.replace(/\n/g, '<br>') + '</div>' +
      '<div class="cc-diff">難易度 ' + ch.diff + '</div>' +
      '<div class="cc-best">BEST ' + best.catch + ' CATCH</div>';
    card.appendChild(html);
    card.addEventListener('click', () => {
      G.char = ch; SAVE.lastCharacter = ch.id; persist();
      [].forEach.call(list.children, c => c.classList.toggle('sel', c.dataset.id === ch.id));
    });
    list.appendChild(card);
  });
}
/* 選択カードの絵。画像が未読込のうちは仮キャラを描き、読み込めたら描き直す */
function drawCardArt(g, ch, w, h) {
  g.clearRect(0, 0, w, h);
  const sp = SPRITES[ch.id], img = sp && Sprites.get(sp.normal.file);
  if (img) {
    const r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * r, dh = img.naturalHeight * r;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    drawCharacter(g, ch, w / 2, h * 0.14, h * 3.05, {});
  }
}
/* 画像が届いたら、開いているキャラ選択画面を描き直す */
function onSpriteLoaded() {
  if (!scSelect || scSelect.classList.contains('hidden')) return;
  [].forEach.call(document.querySelectorAll('.char-card'), card => {
    const ch = charById(card.dataset.id), cnv = card.querySelector('canvas');
    if (!cnv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const g = cnv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCardArt(g, ch, cnv.width / dpr, cnv.height / dpr);
  });
}

function goTutorial() { G.state = 'tutorial'; showScreen(scTutorial); hud.classList.add('hidden'); }
function startPractice() {
  showScreen(null);
  resetRun(true);
  startCountdown(2.2);
}
function finishTutorial() {
  SAVE.tutorialSeen = true; persist();
  startGame(2.2);
}
function startGame(countLen) {
  showScreen(null);
  resetRun(false);
  startCountdown(countLen === undefined ? 3.2 : countLen);
}
function afterSelect() {
  if (!SAVE.tutorialSeen) goTutorial();
  else startGame(3.2);
}

function commitScore() {
  const cs = SAVE.characters[G.char.id] || (SAVE.characters[G.char.id] = { catch:0, score:0 });
  let newBest = false;
  if (G.catches > SAVE.best.catch || (G.catches === SAVE.best.catch && G.score > SAVE.best.score)) {
    if (G.catches > SAVE.best.catch) newBest = true;
    SAVE.best.catch = Math.max(SAVE.best.catch, G.catches);
    SAVE.best.score = Math.max(SAVE.best.score, G.score);
  }
  if (G.catches > cs.catch || (G.catches === cs.catch && G.score > cs.score)) {
    cs.catch = Math.max(cs.catch, G.catches);
    cs.score = Math.max(cs.score, G.score);
  }
  persist();
  G.newBest = newBest;
}
function showResult() {
  $('resCatch').textContent = G.catches;
  $('resScore').textContent = G.score.toLocaleString();
  $('resRate').textContent = getRate() + '%';
  $('resBest').textContent = SAVE.best.catch;
  $('resPerfect').textContent = G.grades.PERFECT;
  $('resGreat').textContent = G.grades.GREAT;
  $('resGood').textContent = G.grades.GOOD;
  $('resultTitleName').textContent = rankTitle(G.catches);
  $('resultChar').textContent = '使用キャラ: ' + G.char.name;
  $('resultReason').textContent = G.overQuote;
  $('resultNewBest').classList.toggle('hidden', !G.newBest);
  scResult.classList.remove('hidden');
}

/* ---- ボタン ---- */
$('btnStart').addEventListener('click', () => { Sound.ensure(); goSelect(); });
$('btnHowto').addEventListener('click', () => { Sound.ensure(); goTutorial(); });
$('btnSound').addEventListener('click', () => {
  Sound.ensure(); Sound.setEnabled(!Sound.enabled);
  $('btnSound').textContent = Sound.enabled ? '🔊 SOUND ON' : '🔇 SOUND OFF';
});
$('btnBackTitle').addEventListener('click', goTitle);
$('btnGo').addEventListener('click', () => { Sound.ensure(); afterSelect(); });
$('btnTutorialGo').addEventListener('click', () => { Sound.ensure(); startPractice(); });
$('btnTutorialSkip').addEventListener('click', () => { SAVE.tutorialSeen = true; persist(); startGame(3.2); });
$('btnRetry').addEventListener('click', () => { Sound.ensure(); startGame(1.2); });   // 1タップ即再開（§30）
$('btnChangeChar').addEventListener('click', goSelect);
$('btnResume').addEventListener('click', resumeGame);
$('btnShare').addEventListener('click', () => {
  /* 本文にURLまで含めて渡す（url パラメータは使わない＝実行中のURLが混ざる余地をなくす） */
  const text = '🔪 落ちるナイフを掴め！\n\nSCORE：' + G.score.toLocaleString() +
               '\nGET率：' + getRate() + '%\n\n#株クラRPG\n\n' + GAME_URL;
  /* X の Web Intent。ゲーム側はログイン情報もAPIキーも持たない */
  window.open('https://x.com/intent/post?text=' + encodeURIComponent(text), '_blank', 'noopener');
});

/* ---------------------------------------------------------
   15. 起動
--------------------------------------------------------- */
Sprites.preload();          // タイトル表示前に全ポーズを先読み
resize();
G.player.x = F.w * 0.5;
goTitle();
requestAnimationFrame(frame);
