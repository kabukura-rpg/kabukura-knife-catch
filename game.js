'use strict';
/* =========================================================
   チャートを駆けろ！ / CHART RIDER
   仕様書 v0.2（chart_rider_game_spec.md ＋ v0.2 変更）

   ・タップで軽く跳ね、離すとゆっくり落下（本家 Flappy Bird 寄りの操作感）
   ・右から左へ流れる「ローソク足」そのものが障害物。実体とヒゲに当たり判定。
   ・数値は CONFIG に集約。バランス調整はそこだけを触る。
   ・x系の値は「画面幅(F.w)の割合」、y系は「画面高(F.h)の割合」。
   ========================================================= */

/* 公開URL。X共有ではこの定数だけを使う（§22）。
   実行中のブラウザURLやローカルパスから共有URLを組み立てないこと。 */
const GAME_URL = 'https://kabukura-rpg.github.io/chart-rider/';

/* ---------------------------------------------------------
   1. 設定
--------------------------------------------------------- */
const CONFIG = {
  player: {
    xRatio: 0.24,          // プレイヤーX位置（画面幅比）
    gravity: 1.65,         // 画面高 / 秒^2（本家Flappy寄り：頂点まで約0.30秒）
    tapImpulse: -0.50,     // 画面高 / 秒（タップで縦速度をこの値へ上書き）
    maxFallSpeed: 0.62,    // 落下速度の上限（画面高 / 秒）
    collisionScale: 0.80,  // 当たり判定 ÷ 見た目（§7：見た目より小さく）
    visualRadius: 0.0252,  // 当たり判定の基準となる半径（画面高比・胴体まわりの小さな円）
    bodyDisplay: 0.0505,   // 画面上での「体（胴〜頭）」の直径（画面高比）
    poseDeadzone: 0.13     // |vy| がこれ未満なら水平飛行の絵（画面高 / 秒）
  },

  world: {
    startScrollSpeed: 0.34,   // 画面幅 / 秒（序盤は据え置き）
    maxScrollSpeed: 0.70,     // 中盤以降で約15%増
    speedRampDistance: 1400,  // m
    pixelsPerMeter: 6         // ワールド1m = 6px（DISTANCE換算）
  },

  /* 障害物＝巨大ローソク足。上下1本ずつを対で置き、そのあいだのGAPを抜ける。
     背景には通常サイズのローソク足チャートを薄く流す（当たり判定なし）。 */
  candle: {
    startPitch: 0.62,      // 障害物の間隔（画面幅比）
    minPitch: 0.42,
    pitchRampDistance: 1400,

    bodyWidth: 0.075,      // 実体の幅（画面幅比・約29px @390）
    wickWidth: 0.020,      // ヒゲの幅（画面幅比・約8px @390）
    minBodySide: 0.075,    // GAPの端から実体の端までの最小長さ（画面高比）
    bodyFillMin: 0.52,     // GAP端〜画面端のうち実体が占める割合（残りがヒゲ）
    bodyFillMax: 0.86,

    startGap: 0.165,       // 通り抜けるGAPの高さ（画面高比・844pxで約139px）
    minGap: 0.125,         // 最高難度で約105px
    gapRampDistance: 1400,
    routeMargin: 0.12,     // GAP中心が寄れる画面端からの余白（画面高比）
    reachSafety: 0.72,     // 上りの到達可能量に掛ける安全率（反応の遅れぶん）
    reachSafetyDown: 0.55, // 下りの安全率。GAP通過のブレーキが要るぶん上りより厳しくする
    reachEnterRatio: 0.12, // GAPの端まで使ってよい割合。
                           // 大きくすると「端に寄って抜けた直後の切り返し」が詰むので小さく保つ
    crossUseRatio: 0.55,   // GAPを横切るあいだに使ってよい縦幅の割合
    hitMargin: 0.005,      // 当たり判定を見た目より内側にする量（画面高比・プレイヤー有利）
    riskZoneRatio: 0.12,   // GAPの端からこの割合以内で抜けると RISK

    /* 背景チャート（見た目だけ・当たり判定なし） */
    bgPitch: 0.050,        // 間隔（画面幅比・約20px @390）
    bgBodyWidth: 0.030,
    bgWickWidth: 0.007,
    bgAmp: 0.055,          // 値動きの振れ幅（画面高比）
    bgAlpha: 0.34
  },

  difficulty: {
    volatileUnlock: 200,     // m
    crashUnlock: 500,
    narrowUnlock: 900,
    endlessUnlock: 1400
  },

  event: {
    warningSeconds: 0.6,       // 予兆（§10）
    specialCooldownSeconds: 6.0
  },

  risk: {
    points: 100              // GAPの端すれすれを抜けたときの加点
  },

  score: {
    startAsset: 1000000,
    yenPerMeter: 1800,
    yenPerRiskPoint: 40
  },

  render: {
    visionRatio: 0.82        // 標準キャラが見えるチャートの範囲（画面幅比）
  }
};

const PPM = CONFIG.world.pixelsPerMeter;

/* ---------------------------------------------------------
   2. キャラクター（§13）
--------------------------------------------------------- */
const CHARACTERS = [
  { id:'micchan', name:'みっちゃん', trait:'未来予知', diff:'★★☆',
    desc:'ローソク足の先が\n少し長く見える',
    vision:1.00,                                   // 標準0.82 → 約22%先まで見える
    hair:'#c98f5a', body:'#f6e2cb', accent:'#e6b07a' },
  { id:'nimushi', name:'にむし', trait:'冷静沈着', diff:'★☆☆',
    desc:'重力が少し弱く\n細かい修正がしやすい',
    gravityScale:0.95, impulseScale:0.96,
    hair:'#4fbf7a', body:'#c9f0d5', accent:'#7ee0a0' },
  { id:'nemupan', name:'ねむぱん', trait:'もちもちボディ', diff:'★☆☆',
    desc:'当たり判定が\n少し小さい',
    collisionScale:0.91,
    hair:'#d9a35b', body:'#ffe9c2', accent:'#ffcf8a' },
  { id:'queen', name:'女王', trait:'強欲', diff:'★★★',
    desc:'RISK BONUS ×1.5\n判定は少し大きい',
    riskMul:1.5, collisionScale:1.06,
    hair:'#9b6bff', body:'#e3d4ff', accent:'#c3a3ff' }
];
const CHAR_DEFAULT = { vision:CONFIG.render.visionRatio, gravityScale:1, impulseScale:1,
                       collisionScale:1, riskMul:1 };
CHARACTERS.forEach(c => { for (const k in CHAR_DEFAULT) if (c[k] === undefined) c[k] = CHAR_DEFAULT[k]; });
const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

/* ---------------------------------------------------------
   2.1 キャラクター画像（assets/）

   ・ファイル名は assets/ に実在する名前をそのまま使う
     （みっちゃん=micchan / にむし=nimushi / ねむぱん=nempan / 女王=ponkotsu）
   ・4キャラとも up / go / down / miss を持ち、velocityY で切り替える。
   ・ax, ay は各画像の「体（胴〜顔）の中心」を 0〜1 で指定するアンカー。
     しっぽ・杖・マント・タピオカなどの装飾は含めず、本人の体だけを見る。
   ・bodyD は「その体が画像高の何割か」。表示倍率はこれだけで決まるので、
     構図や余白が違ってもキャラの大きさは揃う。
   ・当たり判定は CONFIG.player.visualRadius の円だけで決まり、画像には一切依存しない
     （装飾は判定に含まれない）。
   ・画像が無い / 読めない場合は POSE_FALLBACK → Canvas描画 の順に自動で代替する。
--------------------------------------------------------- */
const SPRITES = {
  /* 一覧の画像は assets/ に実在するファイル名をそのまま使う。
     normal は選択画面のカード用（＆飛行画像が読めないときの保険）。 */
  micchan: {
    normal:{ file:'micchan.png',      ax:0.50, ay:0.62, bodyD:0.45 },
    up:    { file:'micchanUp.png',    ax:0.63, ay:0.44, bodyD:0.42 },
    go:    { file:'micchanGo.png',    ax:0.70, ay:0.47, bodyD:0.40 },
    down:  { file:'micchanDown.png',  ax:0.59, ay:0.53, bodyD:0.42 },
    miss:  { file:'micchanMiss.png',  ax:0.53, ay:0.45, bodyD:0.42 } },
  nimushi: {
    normal:{ file:'nimushi.png',      ax:0.50, ay:0.55, bodyD:0.45 },
    up:    { file:'nimushiUp.png',    ax:0.61, ay:0.33, bodyD:0.40 },
    go:    { file:'nimushiGo.png',    ax:0.61, ay:0.33, bodyD:0.40 },
    /* nimushiDown.png はまだ無いので go で代用される。
       ファイルを置けば自動的にこちらが使われる。 */
    down:  { file:'nimushiDown.png',  ax:0.61, ay:0.36, bodyD:0.40 },
    miss:  { file:'nimushiMiss.png',  ax:0.65, ay:0.42, bodyD:0.40 } },
  nemupan: {
    normal:{ file:'nempan.png',       ax:0.50, ay:0.58, bodyD:0.45 },
    up:    { file:'nempanUp.png',     ax:0.59, ay:0.48, bodyD:0.40 },
    go:    { file:'nempanGo.png',     ax:0.71, ay:0.51, bodyD:0.36 },
    down:  { file:'nempanDown.png',   ax:0.65, ay:0.58, bodyD:0.38 },
    miss:  { file:'nempanMiss.png',   ax:0.76, ay:0.64, bodyD:0.36 } },
  queen: {
    normal:{ file:'ponkotsu.png',     ax:0.50, ay:0.57, bodyD:0.45 },
    up:    { file:'ponkotsuUp.png',   ax:0.59, ay:0.40, bodyD:0.45 },
    go:    { file:'ponkotsuGo.png',   ax:0.74, ay:0.50, bodyD:0.42 },
    down:  { file:'ponkotsuDown.png', ax:0.57, ay:0.72, bodyD:0.40 },
    miss:  { file:'ponkotsuMiss.png', ax:0.63, ay:0.62, bodyD:0.42 } }
};

/* ポーズが無い / 画像が読めないときの代替順 */
const POSE_FALLBACK = {
  up:  ['up', 'go', 'normal'],
  go:  ['go', 'up', 'normal'],
  down:['down', 'go', 'normal'],
  miss:['miss', 'normal'],
  normal:['normal']
};

/* 上昇 / 水平 / 下降の切り替えが細かくバタつかないための最短保持時間 */
const POSE_HOLD = 0.10;   // 秒

/* 画像を差し替えたらこの数字を増やす（ブラウザのキャッシュ対策） */
const ASSET_VERSION = 2;

const Sprites = {
  map:{}, pending:0,
  /* プレイ中に使う全ポーズをタイトル表示前に先読みする（切り替えで読み込み待ちを出さない） */
  preload() {
    Object.keys(SPRITES).forEach(id => {
      ['normal','up','go','down','miss'].forEach(k => {
        const part = SPRITES[id][k];
        if (part) this.load(part.file);
      });
    });
  },
  load(file) {
    if (!file || this.map[file]) return;
    const e = { img:new Image(), ok:false };
    this.map[file] = e; this.pending++;
    e.img.onload  = () => { e.ok = e.img.naturalWidth > 0; this.pending--; onSpriteLoaded(); };
    e.img.onerror = () => { e.ok = false; this.pending--; };   // 画像が無くてもゲームは止めない
    e.img.src = 'assets/' + file + '?v=' + ASSET_VERSION;
  },
  get(file) { const e = file && this.map[file]; return e && e.ok ? e.img : null; }
};

/* 表示する画像を決める。用意が無いポーズは POSE_FALLBACK の順に代替する。 */
function spriteFor(charId, pose) {
  const sp = SPRITES[charId];
  if (!sp) return null;
  const order = POSE_FALLBACK[pose] || POSE_FALLBACK.normal;
  for (const k of order) {
    const part = sp[k];
    if (!part) continue;
    const img = Sprites.get(part.file);
    if (img) return { img, part };
  }
  return null;
}

/* velocityY から現在のポーズ名を決める。
   衝突後は必ず miss（velocityY による切り替えで上書きしない）。
   水平判定にはデッドゾーンを設け、上下の境目で絵がバタつかないようにする。 */
function poseName() {
  const p = G.player;
  if (p.miss) return 'miss';
  if (G.state !== GAME_STATE.PLAYING) return 'go';
  const dead = CONFIG.player.poseDeadzone * F.h;
  if (p.vy < -dead) return 'up';
  if (p.vy >  dead) return 'down';
  return 'go';
}

/* 称号（DISTANCEに対して） */
const RANK_TITLES = [
  [1400, '相場の支配者'], [900, 'ヘッジファンド'], [500, '専業トレーダー'],
  [200, '兼業投資家'], [80, '新規参入者'], [0, '投資初心者']
];
const rankTitle = m => (RANK_TITLES.find(r => m >= r[0]) || RANK_TITLES[5])[1];

const OVER_QUOTES = {
  candle:  ['ローソク足に弾かれました。', '実体に阻まれた。', '相場は甘くない。'],
  ground:  ['底が抜けました。', '奈落まで落ちた。', '狼狽売り。'],
  ceiling: ['天井を突き抜けました。', '上がり過ぎには気をつけろ。', '高値掴み。']
};

/* ---------------------------------------------------------
   3. セーブデータ（§29 localStorage）
--------------------------------------------------------- */
const SAVE_KEY = 'chart_rider_save_v1';
const defaultSave = () => ({
  version:1,
  bestDistance:0,
  bestAsset:0,
  selectedCharacter:'nemupan',
  tutorialSeen:false,
  soundEnabled:true
});
let SAVE = defaultSave();
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') SAVE = Object.assign(defaultSave(), d);
  } catch (e) { SAVE = defaultSave(); }
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) {} }
loadSave();

/* ---------------------------------------------------------
   4. サウンド（§23 WebAudio・音源アセット不要）
--------------------------------------------------------- */
const Sound = {
  ac:null, master:null, enabled:SAVE.soundEnabled !== false,
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
    this.enabled = on; SAVE.soundEnabled = on; persist();
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
    const n = Math.max(1, Math.floor(this.ac.sampleRate * dur));
    const buf = this.ac.createBuffer(1, n, this.ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = this.ac.createBufferSource(); src.buffer = buf;
    const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 900;
    const g = this.ac.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  },
  tap()      { this.tone(520, 0.07, 'square', 0.09, 0, 760); },
  pass()     { this.tone(700, 0.05, 'triangle', 0.07); },
  risk()     { this.tone(880, 0.08, 'triangle', 0.13); this.tone(1320, 0.10, 'triangle', 0.10, 0.05); },
  warning()  { this.tone(320, 0.12, 'sawtooth', 0.12); this.tone(320, 0.12, 'sawtooth', 0.12, 0.16); },
  crash()    { this.tone(220, 0.40, 'sawtooth', 0.16, 0, 70);  this.noise(0.35, 0.22, 500); },
  rally()    { this.tone(330, 0.35, 'square',  0.13, 0, 990); },
  over()     { this.tone(180, 0.30, 'sawtooth', 0.22, 0, 60); this.noise(0.30, 0.32, 700); },
  newBest()  { [0,0.09,0.18].forEach((d,i) => this.tone(660 * Math.pow(2, i * 4 / 12), 0.17, 'triangle', 0.14, d)); }
};

/* ---------------------------------------------------------
   5. キャンバス・フィールド（§26 論理座標＋DPR対応）
--------------------------------------------------------- */
const cv = document.getElementById('gameCanvas');
const ctx = cv.getContext('2d', { alpha:false });
const F = { w:0, h:0, ox:0, oy:0, vw:0, vh:0, dpr:1 };

/* Safe Area（ノッチ / Dynamic Island）を CSS から読む（§25） */
const safeProbe = document.createElement('div');
safeProbe.style.cssText =
  'position:absolute;visibility:hidden;pointer-events:none;' +
  'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
document.body.appendChild(safeProbe);
let SAFE = { t:0, b:0 };
function readSafeInsets() {                    // レイアウト読み取りは毎フレームやらない
  const s = getComputedStyle(safeProbe);
  SAFE = { t: parseFloat(s.paddingTop) || 0, b: parseFloat(s.paddingBottom) || 0 };
}

function resize() {
  const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  /* 基準は 9:16。実画面が縦長ならその分だけ広く使い、極端な比率だけ余白にする。 */
  let fw = vw, fh = vh;
  const MAX_TALL = 19.5 / 9, MAX_WIDE = 14 / 9;
  if (fh / fw > MAX_TALL) fh = fw * MAX_TALL;        // 縦に長すぎる端末 → 上下に余白
  else if (fh / fw < MAX_WIDE) fw = fh * 9 / 16;     // PCなど横長 → 左右に余白（9:16の縦画面）
  const oldH = F.h;
  F.w = fw; F.h = fh; F.ox = (vw - fw) / 2; F.oy = (vh - fh) / 2; F.vw = vw; F.vh = vh; F.dpr = dpr;
  readSafeInsets();
  /* 画面サイズが変わってもプレイ中の位置関係を保つ */
  if (oldH > 0 && oldH !== F.h) {
    const k = F.h / oldH;
    if (G.player) { G.player.y *= k; G.player.vy *= k; }
    Obstacles.rescaleY(k);
    BgChart.rescaleY(k);
  }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

/* ---------------------------------------------------------
   6. ヘルパ
--------------------------------------------------------- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = arr => arr[(Math.random() * arr.length) | 0];
const fmt = n => Math.floor(n).toLocaleString('en-US');
const yen = n => '¥' + fmt(n);

/* 難易度カーブ（§9）：距離[m] → 各パラメータ */
function scrollSpeed(m) {
  const t = clamp(m / CONFIG.world.speedRampDistance, 0, 1);
  return lerp(CONFIG.world.startScrollSpeed, CONFIG.world.maxScrollSpeed, t) * F.w;
}
function gapHeight(m) {
  const C = CONFIG.candle;
  const t = clamp(m / C.gapRampDistance, 0, 1);
  return lerp(C.startGap, C.minGap, t) * F.h;
}
function pitch(m) {
  const C = CONFIG.candle;
  const t = clamp(m / C.pitchRampDistance, 0, 1);
  return lerp(C.startPitch, C.minPitch, t) * F.w;
}
/* GAPの上下位置の振れ幅（画面高比） */
function volatility(m) {
  const D = CONFIG.difficulty;
  if (m < 100) return 0.06;
  if (m < D.volatileUnlock) return lerp(0.09, 0.15, (m - 100) / (D.volatileUnlock - 100));
  if (m < D.crashUnlock)    return lerp(0.15, 0.22, (m - D.volatileUnlock) / (D.crashUnlock - D.volatileUnlock));
  if (m < D.narrowUnlock)   return lerp(0.22, 0.28, (m - D.crashUnlock) / (D.narrowUnlock - D.crashUnlock));
  if (m < D.endlessUnlock)  return lerp(0.28, 0.32, (m - D.narrowUnlock) / (D.endlessUnlock - D.narrowUnlock));
  return 0.34;
}
function phaseName(m) {
  const D = CONFIG.difficulty;
  if (m < D.volatileUnlock) return 'EASY';
  if (m < D.crashUnlock)    return 'NORMAL';
  if (m < D.narrowUnlock)   return 'VOLATILE';
  if (m < D.endlessUnlock)  return 'CRASH ZONE';
  return 'ENDLESS';
}

const gravity     = () => CONFIG.player.gravity * F.h * G.char.gravityScale;
const tapImpulse  = () => CONFIG.player.tapImpulse * F.h * G.char.impulseScale;
const maxFall     = () => CONFIG.player.maxFallSpeed * F.h;

/* ---------------------------------------------------------
   到達可能範囲（§8.2 / §34）
   ここで使う gravity / tapImpulse / maxFall はすべて
   「いま選択されているキャラクター」の値。標準キャラ基準にはしない。
--------------------------------------------------------- */

/* 無入力のまま t 秒落ちたときの下降量（落下速度の上限つき）。
   vy0 が上向き（負）でも、まず減速してから落ちる分を正しく積分する。 */
function fallDistance(vy0, t) {
  const g = gravity(), vmax = maxFall();
  if (t <= 0) return 0;
  if (vy0 >= vmax) return vmax * t;
  const t1 = (vmax - vy0) / g;                       // 上限速度に達するまで
  if (t <= t1) return vy0 * t + 0.5 * g * t * t;
  return vy0 * t1 + 0.5 * g * t1 * t1 + vmax * (t - t1);
}

/* t 秒で上げられる最大量（すぐタップし、以降は頂点ごとにタップした場合）。
   タップは速度を上書きするので、開始時の vy には依存しない。 */
function riseDistance(t) {
  const g = gravity(), imp = Math.abs(tapImpulse());
  if (t <= 0) return 0;
  const T = imp / g;                                 // 1サイクル（タップ→頂点）
  const h = imp * imp / (2 * g);                     // 1サイクルの上昇量
  const n = Math.floor(t / T), r = t - n * T;
  return n * h + (imp * r - 0.5 * g * r * r);
}

/* t 秒後にプレイヤーが存在できるY範囲（上端＝最大上昇、下端＝最大下降）。
   ※ここは「その地点まで届くか」だけを見る素の物理範囲。 */
function reachableBand(y0, vy0, t) {
  return { top: y0 - riseDistance(t), bottom: y0 + fallDistance(vy0, t) };
}

/* GAPを通り抜けるあいだにも上下に動いてしまうので、
   通過時の縦速度が速すぎると GAP の中で反対側の実体に当たる。
   その「通過してよい縦速度」の上限を出す。落下速度の上限があるぶん、
   下降側はこの制限が強く効く。 */
function crossSafeSpeed(gapH, m) {
  const r = collisionR();
  const tCross = (bodyW() + 2 * r) / scrollSpeed(m);      // 障害物を横切る時間
  return Math.max(1, (gapH - 2 * r) * CONFIG.candle.crossUseRatio / tCross);
}

/* 到達時の縦速度を vSafe 以内に収めたうえでの最大下降量。
   「落ちる → 途中で1回タップして減速 → 到達」戦略を数値的に探す。
   vy0 は前のGAPを抜けた直後の縦速度の想定。 */
function maxDescent(t, vSafe, vy0) {
  const g = gravity(), imp = -Math.abs(tapImpulse());
  let best = 0;
  /* 到達時の縦速度は「速さ」で見る。上向きに速いままGAPへ突っ込むのも通れない。 */
  if (Math.abs(Math.min(maxFall(), vy0 + g * t)) <= vSafe) best = fallDistance(vy0, t);
  for (let k = 1; k <= 24; k++) {
    const t2 = t * k / 24, t1 = t - t2;                   // t2 = タップしてからの時間
    if (Math.abs(Math.min(maxFall(), imp + g * t2)) > vSafe) continue;
    best = Math.max(best, fallDistance(vy0, t1) + fallDistance(imp, t2));
  }
  return Math.max(0, best);
}

/* 到達時の縦速度を vSafe 以内に収めたうえでの最大上昇量。
   「頂点ごとにタップ → 最後のタップの位置を調整して到達」戦略を数値的に探す。
   タップは速度を上書きするので、開始時の縦速度には依存しない。 */
function maxAscent(t, vSafe) {
  const g = gravity(), imp = Math.abs(tapImpulse());
  const T = imp / g, h = imp * imp / (2 * g);
  let best = 0;
  for (let k = 0; k <= 24; k++) {
    const tau = T * k / 24;                               // 最後のタップから到達までの時間
    if (tau > t) break;
    if (Math.abs(-imp + g * tau) > vSafe) continue;       // 到達時に速すぎないこと
    const prior = Math.floor((t - tau) / T) * h;          // それ以前は頂点ごとにタップ
    best = Math.max(best, prior + imp * tau - 0.5 * g * tau * tau);
  }
  return best;
}
const playerX     = () => F.w * CONFIG.player.xRatio;
const visualR     = () => CONFIG.player.visualRadius * F.h;
const collisionR  = () => visualR() * CONFIG.player.collisionScale * G.char.collisionScale;
const visionX     = () => F.w * G.char.vision;

/* ---------------------------------------------------------
   7. 障害物（巨大ローソク足）と背景チャート

   ・Obstacles … 上下1本ずつの巨大ローソク足を対で置き、あいだのGAPを抜けさせる。
     1本は「GAP側のヒゲ → 実体 → 画面端まで伸びるヒゲ」で構成し、
     始値は前の足の終値と一致させて、連続した相場に見せる。
     GAPの高低差は必ず「次の足までにタップ操作で到達できる範囲」へ丸める（§8.2 / §34）。
   ・BgChart … 背景に流す通常サイズのローソク足チャート。見た目だけで当たり判定は持たない。
     前景の巨大ローソク足と同じ値動き（GAP中心）のまわりを歩かせ、
     同じ相場を拡大しているように見せる。
--------------------------------------------------------- */
const bodyW  = () => CONFIG.candle.bodyWidth * F.w;
const wickW  = () => CONFIG.candle.wickWidth * F.w;

const Obstacles = {
  list:[], nextX:0, lastGapY:0, prevClose:0,
  entryVy:0,                 // 前のGAPを抜けるときにプレイヤーが持っている縦速度の想定
  entryOffset:0,             // 前のGAPの中心からのずれの想定（＋が下寄り）
  lastLarge:false,           // 直前が大きい移動だったか（緩急づけ用）
  reachStates:null,          // その時点でプレイヤーが取りうる状態集合 {y, vy}
  reachX:0,                  // 上の状態集合に対応するワールドX
  trendDir:0, trendLeft:0,
  eventDir:0, eventLeft:0, lastEventX:-1e9,

  reset() {
    this.list.length = 0;
    this.lastGapY = F.h * 0.5;
    this.entryVy = 0; this.entryOffset = 0; this.lastLarge = false;
    this.reachStates = [{ y: F.h * 0.5, vy: 0 }];      // 開始時のプレイヤーの状態
    this.reachX = 0;
    this.prevClose = F.h * 0.5 + gapHeight(0) / 2 + F.h * 0.12;
    this.trendDir = 0; this.trendLeft = 0;
    this.eventDir = 0; this.eventLeft = 0; this.lastEventX = -1e9;
    this.nextX = F.w * 0.55;                 // 1本目が開始時から視界に入る位置
    this.ensure(F.w * 1.8);
  },

  /* maxCount を指定すると1回の呼び出しで作る本数を制限する。
     プレイ中は1フレーム1本までにして、生成のひっかかりを避ける。 */
  ensure(untilX, maxCount) {
    let n = 0, cap = maxCount || 60;
    while (this.nextX < untilX && n++ < cap) {
      this.list.push(this.plan(this.nextX));
      this.nextX += pitch(Math.max(0, this.nextX) / PPM);
    }
  },

  trim(minX) {
    let n = 0;
    while (n < this.list.length && this.list[n].x < minX) n++;
    if (n > 0) this.list.splice(0, n);
  },

  rescaleY(k) {
    this.lastGapY *= k; this.prevClose *= k;
    for (const o of this.list) {
      o.gapY *= k; o.gapH *= k;
      o.bodyTop *= k; o.bodyBot *= k; o.high *= k; o.low *= k;
      if (o.minEdge < 1e8) o.minEdge *= k;
    }
  },

  /* 障害物1本 ＝ 巨大なローソク足1本。
     画面の上下いっぱいに伸びる1本を作り、途中の GAP だけをくり抜く。
     GAPの上下は同じX・同じ実体幅・同じ色・同じ中心軸の「同じ1本の続き」になる。 */
  plan(x) {
    const m = Math.max(0, x) / PPM, D = CONFIG.difficulty, C = CONFIG.candle;
    const gapH = gapHeight(m);
    const lim = this.limits(m, gapH);
    const volCap = volatility(m) * F.h;          // 序盤を穏やかにするための上限
    let dir, frac = this.pickAmplitude(), event = null;

    if (this.eventLeft > 0) {                       // MARKET CRASH / RALLY の継続
      dir = this.eventDir; frac = rand(0.80, 0.95);
      this.eventLeft--;
    } else if (m >= D.crashUnlock &&
               x - this.lastEventX > scrollSpeed(m) * CONFIG.event.specialCooldownSeconds &&
               Math.random() < 0.16) {
      const crash = Math.random() < 0.55;
      this.eventDir = crash ? 1 : -1;
      this.eventLeft = 2;
      this.lastEventX = x;
      event = crash ? 'crash' : 'rally';
      dir = this.eventDir; frac = rand(0.80, 0.95);
    } else if (m < 100) {                            // 序盤は操作を覚える区間（§9）
      dir = Math.random() < 0.5 ? 1 : -1; frac *= 0.5;
    } else {
      if (this.trendLeft <= 0) {                     // 上げ / 下げ / もみ合いの流れ
        this.trendLeft = 2 + ((Math.random() * 4) | 0);
        this.trendDir = pick([-1, -1, 0, 1, 1]);
      }
      this.trendLeft--;
      dir = this.trendDir !== 0 ? this.trendDir : (Math.random() < 0.5 ? 1 : -1);
      if (Math.random() < 0.22) dir = -dir;           // ときどき逆方向へ
    }

    /* 動かす量は「振れ幅 × 緩急」で決め、実際に通れるかは物理シミュレーションで確かめる。
       届かなければ幅を詰めて再挑戦するので、必ず到達可能な配置だけが残る。 */
    const margin = C.routeMargin * F.h;
    const minS = C.minBodySide * F.h;
    const fillT = rand(C.bodyFillMin, C.bodyFillMax), fillB = rand(C.bodyFillMin, C.bodyFillMax);
    /* 実体は GAP をまたぐ1本。始値側の端を前の足の終値へ寄せて、
       足から足へ値が繋がって見えるようにする（chart らしさ）。 */
    const make = (gy) => {
      const gapTop = gy - gapH / 2, gapBot = gy + gapH / 2;
      const availT = Math.max(minS * 1.4, gapTop), availB = Math.max(minS * 1.4, F.h - gapBot);
      const bull = gy <= this.lastGapY;
      let sideT, sideB;
      if (bull) {                                   // 陽線：始値＝下端、終値＝上端
        sideB = clamp(this.prevClose - gapBot, availB * C.bodyFillMin, availB * C.bodyFillMax);
        sideT = availT * fillT;
      } else {                                      // 陰線：始値＝上端、終値＝下端
        sideT = clamp(gapTop - this.prevClose, availT * C.bodyFillMin, availT * C.bodyFillMax);
        sideB = availB * fillB;
      }
      const bodyTop = gapTop - Math.max(minS, sideT);
      const bodyBot = gapBot + Math.max(minS, sideB);
      return { x, gapY:gy, gapH, bodyTop, bodyBot,
               high: Math.min(bodyTop - F.h * 0.01, -F.h * 0.04),
               low:  Math.max(bodyBot + F.h * 0.01,  F.h * 1.04),
               bull: gy <= this.lastGapY, event, fillT, fillB,
               passed:false, minEdge:1e9, warned:false, fired:false };
    };

    const enterX = x - bodyW() / 2 - collisionR() - 4;
    const from = this.advanceTo(enterX) || { states:this.reachStates, x:this.reachX };
    let want = dir * volCap * frac;
    let cand = null, sim = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const gy = clamp(this.lastGapY + want, margin + gapH / 2, F.h - margin - gapH / 2);
      cand = make(gy);
      sim = this.crossCheck(cand, from);
      if (sim) break;
      want *= 0.55;                                  // 届かないので控えめにして再挑戦
      if (Math.abs(want) < F.h * 0.004) want = 0;
    }
    if (!sim) {                                      // 最後の手段：前と同じ高さ
      cand = make(this.lastGapY);
      sim = this.crossCheck(cand, from) || from;
    }
    this.reachStates = sim.states; this.reachX = sim.x;
    this.commit(cand.gapY - this.lastGapY, lim);     // 解析モデル側の状態も更新（画面外の再検証用）
    this.lastGapY = cand.gapY;
    this.prevClose = cand.bull ? cand.bodyTop : cand.bodyBot;
    return cand;
  },

  /* 次のGAPを動かしてよい範囲（上り／下り別）。
     選択キャラの実物理・GAP通過中の移動・前の足から引き継いだ状態をすべて見る。 */
  limits(m, gapH) {
    const t = pitch(m) / scrollSpeed(m);
    const r = collisionR(), C = CONFIG.candle;
    const vSafe = crossSafeSpeed(gapH, m);
    const s2 = Math.max(0, gapH / 2 - r);
    const enter = s2 * C.reachEnterRatio;
    const off = clamp(this.entryOffset, -s2, s2);
    const baseUp   = maxAscent(t, vSafe)                  * C.reachSafety     + enter;
    const baseDown = maxDescent(t, vSafe, this.entryVy)   * C.reachSafetyDown + enter;
    return { up:Math.max(0, baseUp - off), down:Math.max(0, baseDown + off),
             baseUp, baseDown, vSafe, s2 };
  },

  /* 実際に動かす量を確定し、次の足へ引き継ぐ状態を更新する */
  commit(delta, lim) {
    const out = clamp(delta, -lim.up, lim.down);
    const usedDown = lim.baseDown > 1 ? clamp(out / lim.baseDown, 0, 1) : 0;
    const usedUp   = lim.baseUp   > 1 ? clamp(-out / lim.baseUp,  0, 1) : 0;
    /* 大きく下げた直後はブレーキで上向きの速度が残り、GAPの端寄りに居ることになる */
    this.entryVy     = out > 0 ? -lim.vSafe * usedDown : 0;
    this.entryOffset = out > 0 ? lim.s2 * usedDown : -lim.s2 * usedUp;
    return out;
  },

  reachableDelta(delta, m, gapH) { return this.commit(delta, this.limits(m, gapH)); },

  /* 到達可能性の検証（§8.2 / §34）
     ゲーム本体と同じ更新式で「タップする / しない」を毎フレーム分岐させ、
     プレイヤーが取りうる状態集合を持ち回す。生き残る状態が1つでもあれば通過可能。
     格子で間引くので、残った状態は必ず本当に到達できる（＝安全側）。

     障害物の手前までは候補の位置に関係なく同じなので、
     「手前まで進める」→「通過部分だけ候補ごとに試す」に分けて軽くしている。 */
  GRID_Y: 8, GRID_V: 30, STATE_CAP: 90,

  step(states, wx, rects) {
    const dt = 1 / 60, g = gravity(), vmax = maxFall(), imp = tapImpulse(), r = collisionR();
    const next = new Map();
    for (const st of states) {
      for (let k = 0; k < 2; k++) {
        const vy = k ? imp : Math.min(st.vy + g * dt, vmax);
        const y = st.y + vy * dt;
        if (y - r <= 0 || y + r >= F.h) continue;               // 天井・床は即アウト
        if (rects) {
          let bad = false;
          for (const q of rects) if (circleRect(wx, y, r, q[0], q[1], q[2], q[3])) { bad = true; break; }
          if (bad) continue;
        }
        const key = ((y / this.GRID_Y) | 0) + ':' + ((vy / this.GRID_V) | 0);
        if (!next.has(key)) next.set(key, { y, vy });
      }
    }
    let out = [...next.values()];
    if (out.length > this.STATE_CAP) out = out.filter((_, i) => i % 2 === 0);
    return out;
  },

  /* 状態集合を fromX から toX まで進める（rects があれば当たり判定つき） */
  propagate(states, fromX, toX, rects, limit) {
    const dt = 1 / 60;
    let wx = fromX, guard = 0;
    while (wx < toX && guard++ < (limit || 900)) {
      wx += scrollSpeed(Math.max(0, wx) / PPM) * dt;
      states = this.step(states, wx, rects);
      if (!states.length) return null;
    }
    return { states, x: wx };
  },

  /* 障害物に触れない区間を進める（候補の位置に依存しないので使い回せる） */
  advanceTo(targetX) { return this.propagate(this.reachStates, this.reachX, targetX, null); },

  /* 候補の障害物を通過できるか（当たり判定のある区間だけを試す） */
  crossCheck(o, from) {
    return this.propagate(from.states, from.x, o.x + bodyW() / 2 + collisionR() + 2,
                          this.rects(o), 200);
  },

  /* 移動量の緩急。毎回めいっぱい動かすと単調になるので、
     小・中・大を混ぜ、大きい移動が連続しないようにする。 */
  pickAmplitude() {
    const r = Math.random();
    let cls = r < 0.40 ? 0 : (r < 0.76 ? 1 : 2);          // 小 / 中 / 大
    if (cls === 2 && this.lastLarge) cls = 1;
    this.lastLarge = (cls === 2);
    return cls === 0 ? rand(0.08, 0.32) : cls === 1 ? rand(0.38, 0.62) : rand(0.70, 0.86);
  },

  /* 生成済みの障害物のGAP位置だけを動かし、実体・ヒゲを同じ比率で作り直す。
     画面外の障害物にしか使わない（通路の瞬間移動を作らないため／§34）。 */
  moveGap(o, gapY) {
    const C = CONFIG.candle, gapH = o.gapH;
    const margin = C.routeMargin * F.h;
    o.gapY = clamp(gapY, margin + gapH / 2, F.h - margin - gapH / 2);
    const gapTop = o.gapY - gapH / 2, gapBot = o.gapY + gapH / 2;
    const minS = C.minBodySide * F.h;
    const availT = Math.max(minS * 1.4, gapTop);
    const availB = Math.max(minS * 1.4, F.h - gapBot);
    o.bodyTop = gapTop - Math.max(minS, availT * o.fillT);
    o.bodyBot = gapBot + Math.max(minS, availB * o.fillB);
    o.high = Math.min(o.bodyTop - F.h * 0.01, -F.h * 0.04);
    o.low  = Math.max(o.bodyBot + F.h * 0.01,  F.h * 1.04);
  },

  /* 当たり判定に使う矩形（ワールドX × 画面Y）。
     1本のローソク足から GAP の帯を抜いた4つの部分。
     GAP側の端だけ hitMargin ぶん内側で判定するのでプレイヤー有利（§7）。 */
  rects(o) {
    const mg = CONFIG.candle.hitMargin * F.h;
    const bw = bodyW() / 2 - mg, ww = wickW() / 2;
    const gapTop = o.gapY - o.gapH / 2, gapBot = o.gapY + o.gapH / 2;
    return [
      [o.x - ww, o.high,      o.x + ww, o.bodyTop],       // 上ヒゲ
      [o.x - bw, o.bodyTop,   o.x + bw, gapTop - mg],     // 実体（GAPより上）
      [o.x - bw, gapBot + mg, o.x + bw, o.bodyBot],       // 実体（GAPより下）
      [o.x - ww, o.bodyBot,   o.x + ww, o.low]            // 下ヒゲ
    ];
  }
};

/* 背景チャート（当たり判定なし） */
const BgChart = {
  list:[], nextX:0, prevClose:0, drift:0,

  reset() {
    this.list.length = 0;
    this.prevClose = F.h * 0.5;
    this.drift = Math.random() * Math.PI * 2;
    this.nextX = -F.w * 0.5;
    this.ensure(F.w * 1.6);
  },

  /* その地点の「相場の中心」＝前後の巨大ローソク足のGAP中心を補間したもの */
  level(x) {
    const L = Obstacles.list;
    if (!L.length) return F.h * 0.5;
    let a = L[0], b = L[L.length - 1];
    for (let i = 0; i < L.length - 1; i++) {
      if (L[i].x <= x && x <= L[i + 1].x) { a = L[i]; b = L[i + 1]; break; }
    }
    if (b.x === a.x) return a.gapY;
    const t = clamp((x - a.x) / (b.x - a.x), 0, 1);
    return lerp(a.gapY, b.gapY, t * t * (3 - 2 * t));
  },

  ensure(untilX) {
    const C = CONFIG.candle;
    const step = C.bgPitch * F.w;
    let guard = 0;
    while (this.nextX < untilX && guard++ < 400) {
      const x = this.nextX;
      const amp = C.bgAmp * F.h;
      const target = this.level(x) + Math.sin(x / F.w * 2.2 + this.drift) * amp * 0.8;
      const open = this.prevClose;
      const close = lerp(open, target, 0.34) + rand(-amp, amp) * 0.55;
      const bt = Math.min(open, close), bb = Math.max(open, close);
      this.list.push({ x, o:open, c:close,
                       h: bt - rand(0.006, 0.024) * F.h,
                       l: bb + rand(0.006, 0.024) * F.h,
                       bull: close < open });
      this.prevClose = close;
      this.nextX += step;
    }
  },

  trim(minX) {
    let n = 0;
    while (n < this.list.length && this.list[n].x < minX) n++;
    if (n > 0) this.list.splice(0, n);
  },

  rescaleY(k) {
    this.prevClose *= k;
    for (const c of this.list) { c.o *= k; c.c *= k; c.h *= k; c.l *= k; }
  }
};

/* いまのプレイヤーの位置・速度から、この先のGAPに本当に届くかを検証する。
   生成時と同じ物理シミュレーションで、実際のプレイヤーの状態から先を辿り、
   届かないGAPは「まだ画面に入っていないものだけ」届く位置へ寄せ直す。
   画面内の障害物は絶対に動かさない（通路の瞬間移動を作らないため／§34）。 */
let revalidateFixes = 0;                 // 寄せ直した回数（テスト・調整用）
let revalidateTimer = 0;
function revalidateAhead(dt) {
  revalidateTimer -= dt;
  if (revalidateTimer > 0) return;
  revalidateTimer = 0.30;                          // 0.3秒ごとに見直す
  const camRight = G.wx - playerX() + F.w;
  const bw = bodyW(), r = collisionR();
  let states = [{ y:G.player.y, vy:G.player.vy }], wx = G.wx, checked = 0;
  for (const o of Obstacles.list) {
    if (o.x <= wx) continue;
    const adv = Obstacles.propagate(states, wx, o.x - bw / 2 - r - 4, null);
    if (!adv) return;                              // すでに詰んでいる（操作ミス）→ 触らない
    let res = Obstacles.crossCheck(o, adv);
    if (!res && o.x > camRight) {                  // 画面外のものだけ、届く位置へ寄せる
      const ys = adv.states.map(st => st.y).sort((a, b) => a - b);
      const mid = ys[ys.length >> 1];
      for (const cand of [mid, mid - F.h * 0.04, mid + F.h * 0.04]) {
        Obstacles.moveGap(o, cand);
        res = Obstacles.crossCheck(o, adv);
        if (res) { revalidateFixes++; break; }
      }
    }
    if (!res) return;                              // 直せない（画面内など）
    states = res.states; wx = res.x;
    if (++checked >= 3 || wx > camRight + F.w * 1.2) return;   // 先の3本まで見れば十分
  }
}

function circleRect(cx, cy, r, x0, y0, x1, y1) {
  if (x1 <= x0 || y1 <= y0) return false;
  const nx = clamp(cx, x0, x1), ny = clamp(cy, y0, y1);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/* ---------------------------------------------------------
   8. ゲーム状態（§31）
--------------------------------------------------------- */
const GAME_STATE = {
  TITLE: 'title',
  SELECT: 'select',
  TUTORIAL: 'tutorial',
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'game_over'
};

const G = {
  state: GAME_STATE.TITLE,
  char: charById(SAVE.selectedCharacter),
  time: 0, real: 0,
  wx: 0,                   // プレイヤーのワールドX
  dist: 0,                 // m
  asset: CONFIG.score.startAsset,
  riskPoints: 0,
  candles: 0,              // 抜けた本数
  player: { y:0, vy:0, miss:false, pose:'go', poseT:0 },
  freeze: 0, shake: 0, flash: 0, flashColor: '#ffffff',
  overT: 0, overReason: '', overKind: 'candle',
  newBest: false, bestHinted: false,
  banner: null, bannerT: 0,
  toasts: [], particles: []
};

/* ---------------------------------------------------------
   9. 実行制御
--------------------------------------------------------- */
function resetRun() {
  G.time = 0; G.wx = 0; G.dist = 0;
  G.asset = CONFIG.score.startAsset;
  G.riskPoints = 0; G.candles = 0; G.riskTime = 0; G.riskCd = 0;
  G.freeze = 0; G.shake = 0; G.flash = 0;
  G.overT = 0; G.newBest = false; G.bestHinted = false;
  G.banner = null; G.bannerT = 0;
  G.toasts.length = 0; G.particles.length = 0;
  Obstacles.reset();
  BgChart.reset();
  G.player.y = F.h * 0.5; G.player.vy = 0; G.player.miss = false;
  G.player.pose = poseName(); G.player.poseT = 0;
}

function goReady() {
  resetRun();
  G.state = GAME_STATE.READY;
  showScreen(null);
}

function beginPlay() {
  G.state = GAME_STATE.PLAYING;
  flap();
}

function flap() {
  G.player.vy = tapImpulse();
  Sound.tap();
  burst(playerX() - visualR() * 0.5, G.player.y + visualR() * 0.5, 4, '#9fd7ff', F.h * 0.04);
}

function gameOver(kind) {
  if (G.state === GAME_STATE.GAME_OVER) return;
  G.state = GAME_STATE.GAME_OVER;
  G.overKind = kind;
  G.overReason = pick(OVER_QUOTES[kind] || OVER_QUOTES.candle);
  G.player.miss = true; G.player.pose = 'miss';
  G.player.vy = tapImpulse() * 0.35;          // 軽く跳ねてから落ちる
  G.freeze = 0.045;                            // ヒットストップ（§20）
  G.shake = F.h * 0.020;
  G.flash = 0.35; G.flashColor = '#ff4d5e';
  G.overT = 0;
  Sound.over();
  burst(playerX(), G.player.y, 16, '#ff8a95', F.h * 0.13);
  commitScore();
}

function commitScore() {
  const m = Math.floor(G.dist);
  if (m > SAVE.bestDistance) { SAVE.bestDistance = m; G.newBest = true; }
  if (G.asset > SAVE.bestAsset) SAVE.bestAsset = Math.floor(G.asset);
  persist();
}

/* ---------------------------------------------------------
   10. 演出（軽量・プレイを邪魔しない／§24）
--------------------------------------------------------- */
function addToast(text, color) {
  G.toasts.push({ text, color: color || '#ffd45e', t: 0, life: 1.0,
                  x: playerX() + F.w * 0.10, y: G.player.y - visualR() * 1.6 });
}
function showBanner(text, sub, color, life) {
  G.banner = { text, sub, color: color || '#ffd45e' };
  G.bannerT = life || 1.1;
}
function burst(x, y, n, color, power) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = power * rand(0.25, 1);
    G.particles.push({ x, y, vx:Math.cos(a) * s, vy:Math.sin(a) * s,
                       life:rand(0.25, 0.55), t:0, color, r:F.h * rand(0.003, 0.007) });
  }
}
/* ポーズの切り替え。最短保持時間でバタつきを抑える（タップ直後の上昇だけ即時） */
function updatePose(dt) {
  const p = G.player;
  if (p.miss) { p.pose = 'miss'; return; }      // 衝突後は miss 固定（上書きしない）
  p.poseT += dt;
  const want = poseName();
  if (want === p.pose) return;
  /* タップ直後の up は即時。それ以外は最短保持時間を置いてバタつきを止める */
  if (want === 'up' || p.poseT >= POSE_HOLD) { p.pose = want; p.poseT = 0; }
}
function updateEffects(dt) {
  updatePose(dt);
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += F.h * 0.5 * dt;
    if (p.t >= p.life) G.particles.splice(i, 1);
  }
  for (let i = G.toasts.length - 1; i >= 0; i--) {
    const t = G.toasts[i];
    t.t += dt; t.y -= F.h * 0.05 * dt;
    if (t.t >= t.life) G.toasts.splice(i, 1);
  }
  if (G.riskTime > 0) G.riskTime = Math.max(0, G.riskTime - dt);
  if (G.bannerT > 0) G.bannerT = Math.max(0, G.bannerT - dt);
  if (G.shake > 0)   G.shake = Math.max(0, G.shake - F.h * 0.12 * dt);
  if (G.flash > 0)   G.flash = Math.max(0, G.flash - dt * 1.6);
}

/* ---------------------------------------------------------
   11. 更新
--------------------------------------------------------- */
function update(dt) {
  G.real += dt;

  if (G.state === GAME_STATE.READY) {
    /* 開始前はふわふわ浮かせて待つ */
    G.player.y = F.h * 0.5 + Math.sin(G.real * 2.2) * F.h * 0.012;
    G.player.vy = Math.cos(G.real * 2.2) * F.h * 0.026;
    updateEffects(dt);
    return;
  }

  if (G.state === GAME_STATE.GAME_OVER) {
    G.overT += dt;
    const p = G.player;
    p.vy = Math.min(p.vy + gravity() * dt, maxFall() * 1.6);
    p.y += p.vy * dt;
    p.y = Math.min(p.y, F.h + visualR() * 3);
    updateEffects(dt);
    if (G.overT > 0.85 && scResult.classList.contains('hidden')) showResult();
    return;
  }

  if (G.state !== GAME_STATE.PLAYING) { updateEffects(dt); return; }

  G.time += dt;

  /* --- ワールド前進 --- */
  const spd = scrollSpeed(G.dist);
  G.wx += spd * dt;
  G.dist = Math.max(0, G.wx) / PPM;
  const genCount = Obstacles.list.length;
  Obstacles.ensure(G.wx - playerX() + F.w * 1.8, 1);   // 1フレーム1本まで
  const generated = Obstacles.list.length > genCount;
  Obstacles.trim(G.wx - playerX() - bodyW() * 2);
  BgChart.ensure(G.wx - playerX() + F.w * 1.8);
  BgChart.trim(G.wx - playerX() - F.w * 0.1);
  if (!generated) revalidateAhead(dt);   // 生成したフレームには重ねない

  /* --- プレイヤー（タップで跳ね、ゆっくり落ちる）--- */
  const p = G.player, r = collisionR();
  p.vy = Math.min(p.vy + gravity() * dt, maxFall());       // 落下速度に上限
  p.y += p.vy * dt;

  /* 画面の上端・下端に触れたら一発アウト（Flappy系なのですべて即終了） */
  if (p.y - r <= 0)   { p.y = r;       gameOver('ceiling'); return; }
  if (p.y + r >= F.h) { p.y = F.h - r; gameOver('ground');  return; }

  /* --- 巨大ローソク足との判定・通過処理（当たり判定はこれだけ）--- */
  const bw = bodyW(), zone = CONFIG.candle.riskZoneRatio;
  for (const o of Obstacles.list) {
    const dx = G.wx - o.x;
    if (dx < -(bw / 2 + r + 4)) break;                     // これ以降はまだ遠い
    if (o.passed) continue;

    if (Math.abs(dx) <= bw / 2 + r) {                      // 通過中：GAPの端との距離
      const gapTop = o.gapY - o.gapH / 2, gapBot = o.gapY + o.gapH / 2;
      o.minEdge = Math.min(o.minEdge, (p.y - r) - gapTop, gapBot - (p.y + r));
    }
    for (const q of Obstacles.rects(o)) {
      if (circleRect(G.wx, p.y, r, q[0], q[1], q[2], q[3])) { gameOver('candle'); return; }
    }
    if (dx > bw / 2 + r) {                                 // 抜けた
      o.passed = true;
      G.candles++;
      if (o.minEdge <= o.gapH * zone) {                    // RISK BONUS（§12）
        const pt = Math.round(CONFIG.risk.points * G.char.riskMul);
        G.riskPoints += pt;
        G.riskTime = 0.4;                                  // オーラ表示用
        addToast('RISK BONUS +' + pt, '#ffd45e');
        burst(playerX(), p.y, 8, '#ffd45e', F.h * 0.07);
        Sound.risk();
      } else {
        Sound.pass();
      }
    }
  }

  /* --- ASSET（§11.2）--- */
  G.asset = CONFIG.score.startAsset
          + G.dist * CONFIG.score.yenPerMeter
          + G.riskPoints * CONFIG.score.yenPerRiskPoint;

  /* --- MARKET CRASH / RALLY の予兆（§10）--- */
  const warnAhead = spd * CONFIG.event.warningSeconds;
  for (const c of Obstacles.list) {
    if (!c.event) continue;
    if (!c.warned && G.wx >= c.x - warnAhead) {
      c.warned = true;
      if (c.event === 'crash') {
        showBanner('MARKET CRASH', '暴落', '#ff4d5e', 1.2);
        G.flash = 0.28; G.flashColor = '#ff4d5e'; G.shake = F.h * 0.012;
      } else {
        showBanner('MARKET RALLY', '急騰', '#2ecc71', 1.2);
        G.flash = 0.22; G.flashColor = '#2ecc71'; G.shake = F.h * 0.008;
      }
      Sound.warning();
    }
    if (c.warned && !c.fired && G.wx >= c.x) {
      c.fired = true;
      G.shake = F.h * 0.014;
      if (c.event === 'crash') Sound.crash(); else Sound.rally();
    }
  }

  /* --- BEST演出（§19）--- */
  const best = SAVE.bestDistance;
  if (best > 120 && !G.bestHinted && G.dist >= best - 100 && G.dist < best) {
    G.bestHinted = true;
    showBanner('BESTまであと100m', '', '#6fc3ff', 1.0);
  }
  if (best > 0 && !G.newBest && G.dist >= best) {
    G.newBest = true;
    showBanner('NEW BEST!', '', '#ffd45e', 0.9);
    burst(playerX(), p.y, 14, '#ffd45e', F.h * 0.10);
    Sound.newBest();
  }

  updateEffects(dt);
}

/* ---------------------------------------------------------
   12. 描画
   すべて F（9:16フィールド）内のゲーム座標で描く。
--------------------------------------------------------- */
const COL = {
  bgTop:'#0c1522', bgBottom:'#05080e',
  grid:'rgba(120,160,220,.07)',
  up:'#2ecc71', upDark:'#14603a',
  down:'#ff4d5e', downDark:'#7a1f2a',
  text:'#e8eef7', muted:'#8ba0bd', gold:'#ffd45e'
};
const FONT = 'system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
const font = (px, w) => (w || 700) + ' ' + Math.round(px) + 'px ' + FONT;

function render() {
  const g = ctx;
  g.fillStyle = '#05080e';
  g.fillRect(0, 0, F.vw, F.vh);

  g.save();
  const sx = G.shake ? rand(-G.shake, G.shake) : 0;
  const sy = G.shake ? rand(-G.shake, G.shake) : 0;
  g.translate(F.ox + sx, F.oy + sy);
  g.beginPath(); g.rect(-sx, -sy, F.w, F.h); g.clip();

  const camX = G.wx - playerX();
  const vEnd = visionX();
  drawBackground(camX);
  drawBgChart(camX, vEnd);
  drawCandles(camX, vEnd);
  drawFog(vEnd);
  drawParticles();
  drawPlayer();
  drawHud();
  drawOverlayText();

  if (G.flash > 0) {
    g.globalAlpha = Math.min(0.40, G.flash * 0.7);
    g.fillStyle = G.flashColor;
    g.fillRect(-sx, -sy, F.w, F.h);
    g.globalAlpha = 1;
  }
  g.restore();
}

function drawBackground(camX) {
  const g = ctx;
  const grd = g.createLinearGradient(0, 0, 0, F.h);
  grd.addColorStop(0, COL.bgTop); grd.addColorStop(1, COL.bgBottom);
  g.fillStyle = grd; g.fillRect(0, 0, F.w, F.h);

  /* 横グリッド＋価格表示（背景・当たり判定なし） */
  g.strokeStyle = COL.grid; g.lineWidth = 1;
  g.font = font(F.h * 0.0115, 500); g.fillStyle = 'rgba(139,160,189,.32)';
  g.textAlign = 'left'; g.textBaseline = 'bottom';
  for (let i = 1; i <= 7; i++) {
    const y = Math.round(F.h * i / 8) + 0.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(F.w, y); g.stroke();
    const price = 38000 + (F.h / 2 - y) / F.h * 4200 + G.dist * 4;
    g.fillText(fmt(price), F.w * 0.012, y - 2);
  }
  /* 縦グリッド（時間軸） */
  const p = F.w * 0.16;
  g.strokeStyle = 'rgba(120,160,220,.045)';
  for (let x = -((camX % p) + p) % p; x < F.w; x += p) {
    g.beginPath(); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, F.h); g.stroke();
  }
}

/* 背景チャート（薄い通常サイズのローソク足）。当たり判定は持たない。 */
function drawBgChart(camX, vEnd) {
  const g = ctx, C = CONFIG.candle;
  const bw = C.bgBodyWidth * F.w, ww = C.bgWickWidth * F.w;
  const list = BgChart.list;
  if (!list.length) return;

  g.save();
  g.globalAlpha = C.bgAlpha;

  /* 終値をつないだ株価ライン */
  g.beginPath();
  let started = false;
  for (const c of list) {
    const x = c.x - camX;
    if (x < -bw || x > vEnd + bw) continue;
    if (!started) { g.moveTo(x, c.c); started = true; } else g.lineTo(x, c.c);
  }
  if (started) {
    g.strokeStyle = 'rgba(150,180,220,.45)';
    g.lineWidth = Math.max(1, F.w * 0.003);
    g.stroke();
  }

  for (const c of list) {
    const x = c.x - camX;
    if (x + bw < -4 || x - bw > vEnd + 4) continue;
    const col = c.bull ? COL.up : COL.down;
    const bt = Math.min(c.o, c.c), bb = Math.max(c.o, c.c);
    g.fillStyle = col;
    g.fillRect(x - ww / 2, c.h, ww, c.l - c.h);
    g.fillRect(x - bw / 2, bt, bw, Math.max(1.5, bb - bt));
  }
  g.restore();
}

/* 障害物＝1本の巨大ローソク足。GAPの帯だけをくり抜いて描く。
   上下は「別々の足」ではなく同じ1本の続きなので、
   X・実体幅・色・中心軸・グラデーションをすべて共有する。 */
function drawCandles(camX, vEnd) {
  const g = ctx, bw = bodyW(), ww = wickW();
  for (const o of Obstacles.list) {
    const x = o.x - camX;
    if (x + bw < -4 || x - bw > vEnd + 4) continue;
    const col  = o.bull ? COL.up : COL.down;
    const dark = o.bull ? COL.upDark : COL.downDark;
    const gapTop = o.gapY - o.gapH / 2, gapBot = o.gapY + o.gapH / 2;

    /* 同じ1本に見えるよう、実体のグラデーションは上下で共通のものを使う */
    const grd = g.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
    grd.addColorStop(0, dark); grd.addColorStop(0.42, col); grd.addColorStop(1, dark);

    g.save();
    /* ヒゲ（GAPの外側だけ） */
    g.fillStyle = col; g.globalAlpha = 0.95;
    if (o.bodyTop > o.high)  g.fillRect(x - ww / 2, o.high, ww, o.bodyTop - o.high);
    if (o.low > o.bodyBot)   g.fillRect(x - ww / 2, o.bodyBot, ww, o.low - o.bodyBot);
    g.globalAlpha = 1;

    /* 実体（GAPの上側・下側）。同じ幅・同じ中心軸・同じ色。 */
    const piece = (y0, y1) => {
      if (y1 - y0 <= 0) return;
      g.fillStyle = grd;
      g.fillRect(x - bw / 2, y0, bw, y1 - y0);
      g.strokeStyle = 'rgba(255,255,255,.42)';
      g.lineWidth = Math.max(1, F.w * 0.003);
      /* 左右と外側だけ枠線を描き、切り口には枠を入れない（1本の続きに見せる） */
      g.beginPath();
      g.moveTo(x - bw / 2, y1); g.lineTo(x - bw / 2, y0);
      g.lineTo(x + bw / 2, y0); g.lineTo(x + bw / 2, y1);
      g.stroke();
    };
    piece(o.bodyTop, Math.min(gapTop, o.bodyBot));
    piece(Math.max(gapBot, o.bodyTop), o.bodyBot);

    /* 切り口（GAPのふち）。抜ける場所が分かるよう、内側に光を置く */
    g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = F.w * 0.025;
    g.lineWidth = Math.max(2, F.w * 0.005); g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(x - bw / 2, gapTop); g.lineTo(x + bw / 2, gapTop);
    g.moveTo(x - bw / 2, gapBot); g.lineTo(x + bw / 2, gapBot);
    g.stroke();
    g.restore();
  }
}

/* 視界の限界（みっちゃんだけ先まで見える／§13） */
function drawFog(vEnd) {
  if (vEnd >= F.w - 1) return;
  const g = ctx;
  const grd = g.createLinearGradient(vEnd, 0, F.w, 0);
  grd.addColorStop(0, 'rgba(5,8,14,0)');
  grd.addColorStop(0.35, 'rgba(5,8,14,.85)');
  grd.addColorStop(1, 'rgba(5,8,14,1)');
  g.fillStyle = grd; g.fillRect(vEnd, 0, F.w - vEnd + 1, F.h);
}

function drawParticles() {
  const g = ctx;
  for (const p of G.particles) {
    g.globalAlpha = Math.max(0, 1 - p.t / p.life);
    g.fillStyle = p.color;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

function drawPlayer() {
  const g = ctx, p = G.player, x = playerX(), r = visualR();

  /* 判定の目安（見た目と判定の一致を助ける薄いオーラ）。
     隙間の端に近いほど金色に光り、RISK ZONE が視覚的に分かる。 */
  const risky = G.state === GAME_STATE.PLAYING && G.riskTime > 0.05;
  const aura = g.createRadialGradient(x, p.y, r * 0.2, x, p.y, r * 1.35);
  const auraCol = risky ? '255,212,94' : '111,195,255';
  aura.addColorStop(0, 'rgba(' + auraCol + ',' + (risky ? 0.32 : 0.16) + ')');
  aura.addColorStop(1, 'rgba(' + auraCol + ',0)');
  g.fillStyle = aura;
  g.beginPath(); g.arc(x, p.y, r * 1.35, 0, Math.PI * 2); g.fill();

  /* 画像自体に飛行姿勢が描かれているので、Canvas側では回転させない。
     体（胴〜顔）の直径が常に同じ大きさになるよう bodyD で倍率を決め、
     体の中心（ax, ay）をプレイヤー座標に合わせて置くだけ。 */
  const s = spriteFor(G.char.id, p.pose);
  if (s) {
    const part = s.part;
    const ih = (CONFIG.player.bodyDisplay * F.h) / (part.bodyD || 0.45);
    const iw = ih * s.img.naturalWidth / s.img.naturalHeight;
    g.drawImage(s.img, x - part.ax * iw, p.y - part.ay * ih, iw, ih);
  } else {
    drawCharacter(g, G.char, x, p.y, r, p.miss);
  }
}

/* 画像が無いときのフォールバック描画 */
function drawCharacter(g, ch, x, y, r, miss) {
  g.save();
  g.fillStyle = ch.body; g.strokeStyle = ch.accent; g.lineWidth = r * 0.16;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = ch.hair;
  g.beginPath(); g.arc(x, y - r * 0.35, r * 0.78, Math.PI, 0); g.fill();
  g.fillStyle = '#2a2118';
  const ey = y - r * 0.05, ex = r * 0.32;
  if (miss) {
    g.strokeStyle = '#2a2118'; g.lineWidth = r * 0.10;
    [-1, 1].forEach(s => {
      g.beginPath();
      g.moveTo(x + s * ex - r * 0.13, ey - r * 0.13); g.lineTo(x + s * ex + r * 0.13, ey + r * 0.13);
      g.moveTo(x + s * ex + r * 0.13, ey - r * 0.13); g.lineTo(x + s * ex - r * 0.13, ey + r * 0.13);
      g.stroke();
    });
  } else {
    [-1, 1].forEach(s => { g.beginPath(); g.arc(x + s * ex, ey, r * 0.11, 0, Math.PI * 2); g.fill(); });
  }
  g.restore();
}

/* ゲーム中UI（§18）：情報を増やしすぎない */
function drawHud() {
  if (G.state === GAME_STATE.TITLE || G.state === GAME_STATE.SELECT ||
      G.state === GAME_STATE.TUTORIAL) return;
  const g = ctx;
  const top = Math.max(0, SAFE.t - F.oy) + F.h * 0.022;
  const padX = F.w * 0.055;

  g.save();
  g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 6;
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = COL.muted; g.font = font(F.h * 0.0105, 700);
  g.fillText('DISTANCE', padX, top);
  g.fillStyle = COL.text; g.font = font(F.h * 0.032, 800);
  g.fillText(fmt(G.dist) + 'm', padX, top + F.h * 0.015);
  g.fillStyle = 'rgba(255,212,94,.75)'; g.font = font(F.h * 0.0115, 700);
  g.fillText('ASSET ' + yen(G.asset), padX, top + F.h * 0.050);

  g.textAlign = 'right';
  g.fillStyle = COL.muted; g.font = font(F.h * 0.0105, 700);
  g.fillText('BEST', F.w - padX, top);
  g.fillStyle = COL.gold; g.font = font(F.h * 0.018, 800);
  g.fillText(fmt(SAVE.bestDistance) + 'm', F.w - padX, top + F.h * 0.015);
  g.fillStyle = 'rgba(139,160,189,.7)'; g.font = font(F.h * 0.010, 700);
  g.fillText(phaseName(G.dist), F.w - padX, top + F.h * 0.038);
  g.restore();
}

function drawOverlayText() {
  const g = ctx;

  if (G.bannerT > 0 && G.banner) {
    const a = Math.min(1, G.bannerT * 2.2);
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = G.banner.color; g.shadowBlur = F.w * 0.06;
    g.fillStyle = G.banner.color; g.font = font(F.h * 0.026, 900);
    g.fillText(G.banner.text, F.w / 2, F.h * 0.155);
    if (G.banner.sub) {
      g.shadowBlur = 0; g.font = font(F.h * 0.016, 700); g.fillStyle = 'rgba(232,238,247,.85)';
      g.fillText(G.banner.sub, F.w / 2, F.h * 0.190);
    }
    g.restore();
  }

  for (const t of G.toasts) {
    const a = Math.max(0, 1 - t.t / t.life);
    g.save();
    g.globalAlpha = a; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = t.color; g.font = font(F.h * 0.015, 800);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 5;
    g.fillText(t.text, Math.min(t.x, F.w * 0.62), t.y);
    g.restore();
  }

  if (G.state === GAME_STATE.READY) {
    const pulse = 0.65 + 0.35 * Math.sin(G.real * 4);
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    /* チャートの上でも読めるように、うっすら下地を敷く */
    g.fillStyle = 'rgba(5,8,14,.62)';
    g.fillRect(0, F.h * 0.70, F.w, F.h * 0.13);
    g.globalAlpha = pulse;
    g.fillStyle = COL.text; g.font = font(F.h * 0.028, 900);
    g.fillText('TAP TO START', F.w / 2, F.h * 0.745);
    g.globalAlpha = 0.85;
    g.fillStyle = COL.muted; g.font = font(F.h * 0.016, 600);
    g.fillText('タップで上昇／ローソク足の隙間を抜けろ', F.w / 2, F.h * 0.795);
    g.restore();
  }
}

/* ---------------------------------------------------------
   13. メインループ（§27）
   物理は delta time ベース。極端に大きな dt は上限で切る。
--------------------------------------------------------- */
let lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const now = ts / 1000;
  let dt = lastTs ? now - lastTs : 0;
  lastTs = now;
  dt = Math.min(dt, 0.033);
  if (G.freeze > 0) { G.freeze -= dt; render(); return; }   // ヒットストップ
  update(dt);
  render();
}

/* ---------------------------------------------------------
   14. 入力（§4）：UI以外はどこをタップしても同じ操作
--------------------------------------------------------- */
function isUiTarget(e) {
  const t = e.target;
  return !!(t && t.closest && t.closest('.screen'));
}
window.addEventListener('pointerdown', e => {
  if (isUiTarget(e)) return;
  Sound.ensure();
  if (G.state === GAME_STATE.READY) beginPlay();
  else if (G.state === GAME_STATE.PLAYING) flap();
  else if (G.state === GAME_STATE.PAUSED) resumeGame();
}, { passive:true });

window.addEventListener('keydown', e => {
  if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
  e.preventDefault();
  if (e.repeat) return;
  Sound.ensure();
  if (G.state === GAME_STATE.READY) beginPlay();
  else if (G.state === GAME_STATE.PLAYING) flap();
  else if (G.state === GAME_STATE.PAUSED) resumeGame();
}, { passive:false });

/* ブラウザ標準操作の誤発火防止（§25。ゲーム領域に限定する） */
cv.addEventListener('touchmove', e => e.preventDefault(), { passive:false });
cv.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => { if (!isUiTarget(e)) e.preventDefault(); }, { passive:false });

/* ---------------------------------------------------------
   15. バックグラウンド移行（§28）：復帰までは物理を進めない
--------------------------------------------------------- */
function pauseGame() {
  if (G.state !== GAME_STATE.PLAYING) return;
  G.state = GAME_STATE.PAUSED;
  showScreen(scPause);
}
function resumeGame() {
  if (G.state !== GAME_STATE.PAUSED) return;
  Sound.ensure();
  lastTs = 0;
  G.state = GAME_STATE.PLAYING;
  showScreen(null);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
window.addEventListener('blur', pauseGame);
window.addEventListener('pagehide', pauseGame);

/* ---------------------------------------------------------
   16. 画面遷移（§15）
--------------------------------------------------------- */
const $ = id => document.getElementById(id);
const scTitle = $('scTitle'), scSelect = $('scSelect'), scTutorial = $('scTutorial'),
      scResult = $('scResult'), scPause = $('scPause');
const screens = [scTitle, scSelect, scTutorial, scResult, scPause];

function showScreen(el) {
  screens.forEach(s => s.classList.toggle('hidden', s !== el));
}

function goTitle() {
  G.state = GAME_STATE.TITLE;
  resetRun();
  $('titleBest').textContent = fmt(SAVE.bestDistance) + 'm';
  $('titleAsset').textContent = yen(Math.max(SAVE.bestAsset, CONFIG.score.startAsset));
  $('btnSound').textContent = Sound.enabled ? '🔊 SOUND ON' : '🔇 SOUND OFF';
  showScreen(scTitle);
}

function goSelect() {
  G.state = GAME_STATE.SELECT;
  buildCharList();
  showScreen(scSelect);
}

function buildCharList() {
  const list = $('charList');
  list.innerHTML = '';
  CHARACTERS.forEach(ch => {
    const card = document.createElement('div');
    card.className = 'char-card' + (ch.id === G.char.id ? ' sel' : '');
    card.dataset.id = ch.id;
    const cnv = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cnv.width = 78 * dpr; cnv.height = 96 * dpr;
    const g = cnv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCardArt(g, ch, 78, 96);
    card.appendChild(cnv);
    const name = document.createElement('div');
    name.className = 'cc-name'; name.textContent = ch.name; card.appendChild(name);
    const trait = document.createElement('div');
    trait.className = 'cc-trait'; trait.textContent = ch.trait; card.appendChild(trait);
    const desc = document.createElement('div');
    desc.className = 'cc-desc'; desc.textContent = ch.desc; card.appendChild(desc);
    const diff = document.createElement('div');
    diff.className = 'cc-diff'; diff.textContent = ch.diff; card.appendChild(diff);
    card.addEventListener('click', () => {
      G.char = ch;
      SAVE.selectedCharacter = ch.id; persist();
      [].forEach.call(list.children, el => el.classList.toggle('sel', el.dataset.id === ch.id));
    });
    list.appendChild(card);
  });
}

function drawCardArt(g, ch, w, h) {
  g.clearRect(0, 0, w, h);
  const sp = SPRITES[ch.id], img = sp && Sprites.get(sp.normal.file);
  if (img) {
    const r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * r, dh = img.naturalHeight * r;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    drawCharacter(g, ch, w / 2, h * 0.55, Math.min(w, h) * 0.34, false);
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

function goTutorial() { G.state = GAME_STATE.TUTORIAL; showScreen(scTutorial); }

/* キャラ選択後：初回だけ操作説明（§17） */
function afterSelect() {
  if (!SAVE.tutorialSeen) goTutorial();
  else goReady();
}

/* ---------------------------------------------------------
   17. リザルト（§21）
--------------------------------------------------------- */
function showResult() {
  const m = Math.floor(G.dist);
  $('resDistance').textContent = fmt(m) + 'm';
  $('resBest').textContent = fmt(SAVE.bestDistance) + 'm';
  $('resAsset').textContent = yen(G.asset);
  $('resRisk').textContent = fmt(G.riskPoints);
  $('resultReason').textContent = G.overReason;
  $('resultTitleName').textContent = rankTitle(m);
  $('resultChar').textContent = '使用キャラ: ' + G.char.name + '　ローソク足 ' + G.candles + '本';
  $('resultNewBest').classList.toggle('hidden', !G.newBest);
  showScreen(scResult);
}

/* ---------------------------------------------------------
   18. ボタン
--------------------------------------------------------- */
$('btnStart').addEventListener('click', () => { Sound.ensure(); goSelect(); });
$('btnHowto').addEventListener('click', () => { Sound.ensure(); goTutorial(); });
$('btnSound').addEventListener('click', () => {
  Sound.ensure();
  Sound.setEnabled(!Sound.enabled);
  $('btnSound').textContent = Sound.enabled ? '🔊 SOUND ON' : '🔇 SOUND OFF';
});
$('btnBackTitle').addEventListener('click', goTitle);
$('btnGo').addEventListener('click', () => { Sound.ensure(); afterSelect(); });
$('btnTutorialGo').addEventListener('click', () => {
  Sound.ensure();
  SAVE.tutorialSeen = true; persist();
  goReady();
});
/* GAME OVER → RETRY → 即再開（タイトルへは戻さない／§15） */
$('btnRetry').addEventListener('click', () => { Sound.ensure(); goReady(); });
$('btnChangeChar').addEventListener('click', goSelect);
$('btnResume').addEventListener('click', resumeGame);
$('btnShare').addEventListener('click', () => {
  const text =
    '📈 CHART RIDER\n\n' +
    'DISTANCE：' + fmt(G.dist) + 'm\n' +
    'ASSET：' + yen(G.asset) + '\n\n' +
    '相場についていけ。\n\n#株クラRPG';
  const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) +
              '&url=' + encodeURIComponent(GAME_URL);
  window.open(url, '_blank', 'noopener');
});

/* ---------------------------------------------------------
   19. 起動
--------------------------------------------------------- */
resize();
Sprites.preload();
goTitle();
requestAnimationFrame(frame);
