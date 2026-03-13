'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const LEVELS = [
  { name: 'Level 1', desc: 'Rookie Keeper',  lerpSpeed: 0.025, patrolSpeed: 0.007, reactionDelay: 650,  fakeMove: false, scoreNeeded: 3 },
  { name: 'Level 2', desc: 'Pro Keeper',     lerpSpeed: 0.042, patrolSpeed: 0.011, reactionDelay: 460,  fakeMove: false, scoreNeeded: 4 },
  { name: 'Level 3', desc: 'Elite Keeper',   lerpSpeed: 0.056, patrolSpeed: 0.016, reactionDelay: 310,  fakeMove: true,  scoreNeeded: 5 },
  { name: 'Level 4', desc: 'World Class',    lerpSpeed: 0.060, patrolSpeed: 0.022, reactionDelay: 200,  fakeMove: true,  scoreNeeded: Infinity },
];

// accuracy: aim variance (0–1, higher = tighter)
// power:    base shot speed for Zones mode; also scales keeper reaction time
// curve:    lateral bezier offset multiplier (higher = more bend)
const SHOOTERS = [
  { name: 'Clinical',  accuracy: 0.93, power: 0.72, curve: 0.12, color: '#4ade80', desc: 'Precise & consistent' },
  { name: 'Rocket',    accuracy: 0.70, power: 1.00, curve: 0.22, color: '#f87171', desc: 'Raw power, lower accuracy' },
  { name: 'Magician',  accuracy: 0.82, power: 0.80, curve: 0.55, color: '#a78bfa', desc: 'Curve master & flair' },
];

const FLIGHT_NORMAL  = 720;    // ms at power=1
const FLIGHT_SLOW    = 1150;   // ms (slow pace setting)
const MAX_CHARGE_MS  = 1500;   // ms to reach full charge

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  screen: 'start',
  levelIdx: 0,
  streak: 0,
  bestStreak: 0,
  levelGoals: 0,
  phase: 'aim',        // 'aim' | 'flying' | 'result' | 'wait'

  // Aim (used by Charge mode reticle)
  aimX: 0.5, aimY: 0.4,
  aimLocked: false,
  aimActive: false,

  // Ball
  ballX: 0, ballY: 0,
  ballTargetX: 0, ballTargetY: 0,
  ballProgress: 0,
  ballFlying: false,
  flightDuration: FLIGHT_NORMAL,
  curveOffset: 0,    // lateral bezier offset in canvas px
  power: 1.0,

  // Keeper
  keeperX: 0.5,
  keeperDir: 1,
  keeperReacting: false,
  keeperTargetX: 0.5,
  fakePhase: 0,

  // Control modes
  controlMode: 'charge',  // 'swipe' | 'charge' | 'zones'
  shooterIdx: 0,

  // Swipe state
  swipeActive: false,
  swipeStartX: 0, swipeStartY: 0,
  swipeCurX: 0,   swipeCurY: 0,

  // Charge state
  chargeActive: false,
  chargeStartTime: 0,
  chargePower: 0,

  // Zone state
  hoveredZone: null,   // {col, row} or null

  // Misc
  animId: null,
  lastTime: 0,
  msgTimeout: null,
  goalFlash: 0,
  settings: { pace: 'normal', keeperDiff: 'standard' },
  settingsOpen: false,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const canvas      = document.getElementById('gameCanvas');
const ctx         = canvas.getContext('2d');
const aimEl       = document.getElementById('aim-indicator');
const msgEl       = document.getElementById('msg-overlay');
const msgText     = document.getElementById('msg-text');
const hudLevel    = document.getElementById('hud-level');
const hudStreak   = document.getElementById('hud-streak');
const hudBest     = document.getElementById('hud-best');
const levelName   = document.getElementById('level-name');
const levelDesc   = document.getElementById('level-desc');
const shooterBadge = document.getElementById('shooter-badge');
const goStreak    = document.getElementById('go-streak');
const goBest      = document.getElementById('go-best');
const goLevel     = document.getElementById('go-level');
const goTitle     = document.getElementById('go-title');
const bestDisp    = document.getElementById('best-display');
const settingsBtn  = document.getElementById('settings-btn');
const settingsPnl  = document.getElementById('settings-panel');
const modeBadgeEl  = document.getElementById('mode-badge');

// ── Utility ────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t)    { return a + (b - a) * t; }
function easeOut(t)        { return 1 - Math.pow(1 - t, 3); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  state.screen = id;
}

function loadBest() { return parseInt(localStorage.getItem('pks_best') || '0', 10); }
function saveBest(v) { localStorage.setItem('pks_best', v); }

const MODE_LABELS = { swipe: 'A · Swipe', charge: 'B · Charge', zones: 'C · Zones' };

function updateHUD() {
  hudLevel.textContent  = state.levelIdx + 1;
  hudStreak.textContent = state.streak;
  hudBest.textContent   = state.bestStreak;
  levelName.textContent = LEVELS[state.levelIdx].name;
  levelDesc.textContent = LEVELS[state.levelIdx].desc;
  const s = SHOOTERS[state.shooterIdx];
  shooterBadge.textContent = s.name;
  shooterBadge.style.color = s.color;
  modeBadgeEl.textContent  = MODE_LABELS[state.controlMode] || '';
}

function updateShooterStats() {
  const s = SHOOTERS[state.shooterIdx];
  const bars = [
    { id: 'stat-accuracy', val: s.accuracy },
    { id: 'stat-power',    val: s.power },
    { id: 'stat-curve',    val: Math.min(1, s.curve / 0.55) },
  ];
  bars.forEach(({ id, val }) => {
    const el = document.getElementById(id);
    if (el) { el.style.width = (val * 100) + '%'; el.style.background = s.color; }
  });
  const descEl = document.getElementById('shooter-desc-text');
  if (descEl) descEl.textContent = s.desc;
}

// ── Canvas sizing ──────────────────────────────────────────────────────────
function resizeCanvas() {
  const pitch = document.getElementById('pitch');
  canvas.width  = pitch.clientWidth;
  canvas.height = pitch.clientHeight;
  state.ballX = canvas.width / 2;
  state.ballY = canvas.height * 0.84;
}

window.addEventListener('resize', () => {
  resizeCanvas();
  if (state.screen === 'game') drawFrame(0);
});

// ── Goal geometry ──────────────────────────────────────────────────────────
function goalRect() {
  const W = canvas.width, H = canvas.height;
  const gw = W * 0.72;
  const gh = H * 0.30;
  const gx = (W - gw) / 2;
  const gy = H * 0.06;
  return { x: gx, y: gy, w: gw, h: gh };
}

// ── Swipe / Zone helpers ───────────────────────────────────────────────────
function getMaxSwipeLength() {
  return Math.max(canvas.width, canvas.height) * 0.28;
}

function swipeToTarget(dx, dy) {
  const g = goalRect();
  const goalCX = g.x + g.w / 2;
  const goalCY = g.y + g.h / 2;
  const maxSwipe = getMaxSwipeLength();
  const sensX = (g.w * 0.44) / maxSwipe;
  const sensY = (g.h * 0.46) / maxSwipe;
  const tx = clamp(goalCX + dx * sensX, g.x + g.w * 0.05, g.x + g.w * 0.95);
  const ty = clamp(goalCY + dy * sensY, g.y + g.h * 0.05, g.y + g.h * 0.95);
  return { tx, ty };
}

function zoneToTarget(col, row) {
  const g = goalRect();
  return {
    tx: g.x + g.w * (col + 0.5) / 3,
    ty: g.y + g.h * (row + 0.5) / 3,
  };
}

function getZoneAtPos(pos) {
  const g = goalRect();
  if (pos.x < g.x || pos.x > g.x + g.w || pos.y < g.y || pos.y > g.y + g.h) return null;
  return {
    col: Math.min(2, Math.floor((pos.x - g.x) / (g.w / 3))),
    row: Math.min(2, Math.floor((pos.y - g.y) / (g.h / 3))),
  };
}

// ── Drawing ────────────────────────────────────────────────────────────────
function drawPitch() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.52);
  sky.addColorStop(0, '#060e20');
  sky.addColorStop(0.55, '#0e2444');
  sky.addColorStop(1, '#0f2e18');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.55);

  const glowGrd = ctx.createRadialGradient(W * 0.5, H * 0.28, 0, W * 0.5, H * 0.28, W * 0.55);
  glowGrd.addColorStop(0, 'rgba(180,210,255,0.09)');
  glowGrd.addColorStop(1, 'rgba(180,210,255,0)');
  ctx.fillStyle = glowGrd;
  ctx.fillRect(0, 0, W, H * 0.55);

  const grass = ctx.createLinearGradient(0, H * 0.52, 0, H);
  grass.addColorStop(0, '#30a348');
  grass.addColorStop(0.45, '#289040');
  grass.addColorStop(1, '#1e6b2e');
  ctx.fillStyle = grass;
  ctx.fillRect(0, H * 0.52, W, H * 0.48);

  ctx.save();
  const stripeH = H * 0.48 / 9;
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = i % 2 === 0 ? 0.07 : 0.0;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, H * 0.52 + i * stripeH, W, stripeH);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  const bw = W * 0.70, bh = H * 0.22;
  ctx.strokeRect((W - bw) / 2, H * 0.60, bw, bh);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo((W - W * 0.72) / 2, H * 0.52);
  ctx.lineTo((W + W * 0.72) / 2, H * 0.52);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(W / 2, H * 0.78, 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(W / 2, H * 0.78, H * 0.19, Math.PI * 1.1, Math.PI * 1.9);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawGoal() {
  const { x, y, w, h } = goalRect();
  const postW = 10;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + postW, y + postW, w - postW * 2, h - postW);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 0.9;
  const nx0 = x + postW, nw = w - postW * 2;
  const ny0 = y + postW, nh = h - postW;
  const cols = 18, rows = 9;
  for (let c = 0; c <= cols; c++) {
    const nx = nx0 + c * nw / cols;
    ctx.beginPath(); ctx.moveTo(nx, ny0); ctx.lineTo(nx, ny0 + nh); ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    const ny = ny0 + r * nh / rows;
    ctx.beginPath(); ctx.moveTo(nx0, ny); ctx.lineTo(nx0 + nw, ny); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x + 4, y + 4, postW, h + postW);
  ctx.fillRect(x + w - postW + 4, y + 4, postW, h + postW);
  ctx.fillRect(x + 4, y + 4, w, postW);
  ctx.restore();

  const pg = ctx.createLinearGradient(x, 0, x + postW * 2, 0);
  pg.addColorStop(0, '#e0b840');
  pg.addColorStop(0.4, '#f8d870');
  pg.addColorStop(1, '#c08820');
  ctx.fillStyle = pg;
  ctx.fillRect(x, y, postW, h + postW);
  ctx.fillRect(x + w - postW, y, postW, h + postW);
  ctx.fillRect(x, y, w, postW);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x + 2, y + 1, 3, h + postW);
  ctx.fillRect(x + w - postW + 2, y + 1, 3, h + postW);
  ctx.fillRect(x + 1, y + 2, w, 3);
}

function drawKeeper() {
  const { x: gx, y: gy, w: gw, h: gh } = goalRect();
  const kw = gw * 0.12;
  const kh = gh * 0.86;
  const kx = gx + 10 + state.keeperX * (gw - 20) - kw / 2;
  const ky = gy + gh - kh + 8;

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.ellipse(kx + kw / 2, ky + kh + 3, kw * 0.6, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#e63946';
  ctx.beginPath();
  ctx.roundRect(kx + kw * 0.08, ky + kh * 0.24, kw * 0.84, kh * 0.52, 5);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(kx + kw * 0.34, ky + kh * 0.24, kw * 0.14, kh * 0.52);

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(9, kw * 0.40)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('1', kx + kw / 2, ky + kh * 0.50);

  ctx.fillStyle = '#1d3557';
  ctx.fillRect(kx + kw * 0.12, ky + kh * 0.74, kw * 0.30, kh * 0.14);
  ctx.fillRect(kx + kw * 0.58, ky + kh * 0.74, kw * 0.30, kh * 0.14);

  ctx.fillStyle = '#ddd';
  ctx.fillRect(kx + kw * 0.16, ky + kh * 0.86, kw * 0.24, kh * 0.14);
  ctx.fillRect(kx + kw * 0.60, ky + kh * 0.86, kw * 0.24, kh * 0.14);

  ctx.fillStyle = '#f4a261';
  ctx.beginPath();
  ctx.arc(kx + kw / 2, ky + kh * 0.14, kw * 0.36, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#3a1a00';
  ctx.beginPath();
  ctx.arc(kx + kw / 2, ky + kh * 0.10, kw * 0.28, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = '#f5c518';
  const gy2 = ky + kh * 0.40;
  ctx.beginPath();
  ctx.ellipse(kx - kw * 0.04, gy2, kw * 0.22, kh * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(kx + kw * 1.04, gy2, kw * 0.22, kh * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Zone grid (Zones mode, drawn on goal) ──────────────────────────────────
function drawZoneGrid() {
  if (state.controlMode !== 'zones' || state.phase !== 'aim') return;
  const { x: gx, y: gy, w: gw, h: gh } = goalRect();
  const cellW = gw / 3;
  const cellH = gh / 3;

  ctx.save();
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = gx + col * cellW;
      const cy = gy + row * cellH;
      const isHov = state.hoveredZone &&
                    state.hoveredZone.col === col &&
                    state.hoveredZone.row === row;

      ctx.fillStyle = isHov ? 'rgba(245,197,24,0.38)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.rect(cx, cy, cellW, cellH);
      ctx.fill();

      ctx.strokeStyle = isHov ? 'rgba(245,197,24,0.92)' : 'rgba(255,255,255,0.30)';
      ctx.lineWidth = isHov ? 2.5 : 1;
      ctx.stroke();
    }
  }

  // Row labels inside left column
  const rowLabels = ['HIGH', 'MID', 'LOW'];
  ctx.font = `bold ${Math.max(8, cellH * 0.22)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < 3; row++) {
    const isHovRow = state.hoveredZone && state.hoveredZone.row === row;
    ctx.fillStyle = isHovRow ? 'rgba(245,197,24,0.9)' : 'rgba(255,255,255,0.40)';
    ctx.fillText(rowLabels[row], gx + gw * 0.5, gy + (row + 0.5) * cellH);
  }

  // "TAP ZONE" hint when nothing hovered
  if (!state.hoveredZone) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `${Math.max(10, canvas.width * 0.028)}px Arial`;
    ctx.fillText('↑ Tap a goal zone', canvas.width / 2, gy + gh + Math.max(12, canvas.height * 0.03));
  }
  ctx.restore();
}

// ── Swipe arrow (Swipe mode) ───────────────────────────────────────────────
function drawSwipeArrow() {
  if (state.controlMode !== 'swipe' || !state.swipeActive || state.phase !== 'aim') return;
  const sx = state.swipeStartX, sy = state.swipeStartY;
  const ex = state.swipeCurX,   ey = state.swipeCurY;
  const dx = ex - sx, dy = ey - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 5) return;

  const power = Math.min(1, len / getMaxSwipeLength());
  const alpha = 0.5 + power * 0.4;

  ctx.save();
  ctx.strokeStyle = `rgba(255,200,60,${alpha})`;
  ctx.lineWidth = 2.5 + power * 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead
  const angle = Math.atan2(dy, dx);
  const headLen = 14 + power * 6;
  ctx.strokeStyle = `rgba(255,200,60,${alpha + 0.1})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle - 0.42), ey - headLen * Math.sin(angle - 0.42));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle + 0.42), ey - headLen * Math.sin(angle + 0.42));
  ctx.stroke();

  // Origin pulse ring
  ctx.fillStyle = `rgba(255,200,60,${0.18 + power * 0.32})`;
  ctx.beginPath();
  ctx.arc(sx, sy, 10 + power * 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,200,60,0.85)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Power label
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `bold ${Math.max(11, canvas.width * 0.028)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.round(power * 100)}%`, sx, sy - 16);
  ctx.restore();

  // Hint when barely swiped
  if (!state.swipeActive) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.max(11, canvas.width * 0.030)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⬆ Swipe toward the goal', canvas.width / 2, canvas.height * 0.63);
    ctx.restore();
  }
}

// ── Power meter (Charge mode) ─────────────────────────────────────────────
function drawPowerMeter() {
  if (state.controlMode !== 'charge' || !state.chargeActive || state.phase !== 'aim') return;
  const W = canvas.width, H = canvas.height;
  const barW = Math.min(220, W * 0.52);
  const barH = 18;
  const bx = (W - barW) / 2;
  const by = H * 0.76;
  const power = state.chargePower;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(bx - 10, by - 10, barW + 20, barH + 28, 10);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.roundRect(bx, by, barW, barH, barH / 2);
  ctx.fill();

  if (power > 0) {
    // green → yellow → red
    const hue = power < 0.5 ? 120 : power < 0.8 ? 60 : 0;
    ctx.fillStyle = `hsl(${hue},90%,55%)`;
    ctx.beginPath();
    ctx.roundRect(bx, by, barW * power, barH, barH / 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.roundRect(bx, by + 2, barW * power, barH * 0.38, [barH / 2, barH / 2, 0, 0]);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`POWER  ${Math.round(power * 100)}%`, W / 2, by + barH + 5);
  ctx.restore();
}

// ── Swipe-mode idle hint ───────────────────────────────────────────────────
function drawSwipeHint() {
  if (state.controlMode !== 'swipe' || state.swipeActive || state.phase !== 'aim') return;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.48)';
  ctx.font = `${Math.max(12, canvas.width * 0.030)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⬆  Swipe toward the goal', canvas.width / 2, canvas.height * 0.63);
  ctx.restore();
}

// ── Trajectory arc (shared) ────────────────────────────────────────────────
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawArcTrajectory(startX, startY, endX, endY, curveOffset, color) {
  const cpX = (startX + endX) / 2 + (curveOffset || 0);
  const cpY = (startY + endY) / 2 - canvas.height * 0.15;
  const col = color || '#ffe650';

  ctx.save();
  ctx.setLineDash([5, 10]);
  ctx.strokeStyle = hexToRgba(col, 0.58);
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = hexToRgba(col, 0.32);
  ctx.shadowBlur  = 6;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(cpX, cpY, endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.shadowBlur  = 10;
  ctx.strokeStyle = hexToRgba(col, 0.85);
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(endX, endY, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTrajectory() {
  if (state.phase !== 'aim') return;
  const bx = canvas.width / 2, by = canvas.height * 0.84;
  const shooter = SHOOTERS[state.shooterIdx];
  const col  = shooter.color;
  const mode = state.controlMode;

  if (mode === 'swipe' && state.swipeActive) {
    const dx = state.swipeCurX - state.swipeStartX;
    const dy = state.swipeCurY - state.swipeStartY;
    if (Math.sqrt(dx*dx + dy*dy) < 15) return;
    const { tx, ty } = swipeToTarget(dx, dy);
    const curveOff = dx * 0.18 * shooter.curve;
    drawArcTrajectory(bx, by, tx, ty, curveOff, col);

  } else if (mode === 'charge' && (state.aimActive || state.chargeActive)) {
    const dx = state.aimX - bx;
    const curveOff = dx * 0.05 * shooter.curve;
    drawArcTrajectory(bx, by, state.aimX, state.aimY, curveOff, col);

  } else if (mode === 'zones' && state.hoveredZone) {
    const { tx, ty } = zoneToTarget(state.hoveredZone.col, state.hoveredZone.row);
    drawArcTrajectory(bx, by, tx, ty, 0, col);
  }
}

function drawBall() {
  const r  = Math.max(9, canvas.width * 0.024);
  const bx = state.ballX, by = state.ballY;
  const t  = state.ballFlying ? state.ballProgress : 0;
  const scale = state.ballFlying ? lerp(1, 0.36, easeOut(t)) : 1;
  const ar = r * scale;

  ctx.save();
  ctx.globalAlpha = lerp(0.38, 0.04, easeOut(t));
  ctx.beginPath();
  ctx.ellipse(bx, by + ar + 2, ar * 0.88, ar * 0.27, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, ar, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = ar * 0.11;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(bx - ar * 0.28, by - ar * 0.28, ar * 0.21, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fill();

  ctx.fillStyle = '#222';
  const penta = (cx, cy, pr) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
      i === 0 ? ctx.moveTo(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr)
              : ctx.lineTo(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr);
    }
    ctx.closePath();
    ctx.fill();
  };
  penta(bx, by, ar * 0.34);
  if (ar > 7) {
    const off = ar * 0.57;
    [[0,-1],[0.95,-0.31],[0.59,0.81],[-0.59,0.81],[-0.95,-0.31]].forEach(([dx, dy]) => {
      penta(bx + dx * off, by + dy * off, ar * 0.20);
    });
  }
  ctx.restore();
}

function drawGoalFlash() {
  if (state.goalFlash <= 0) return;
  const alpha = Math.min(0.35, state.goalFlash / 8) * (state.goalFlash / 12);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#f5c518';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  state.goalFlash--;
}

// ── Main draw loop ─────────────────────────────────────────────────────────
function drawFrame(ts) {
  if (state.screen !== 'game') return;
  const dt = (ts > 0 && state.lastTime > 0) ? Math.min(50, ts - state.lastTime) : 16;
  state.lastTime = ts > 0 ? ts : state.lastTime;

  // Update charge power continuously
  if (state.chargeActive && state.phase === 'aim') {
    state.chargePower = Math.min(1, (ts - state.chargeStartTime) / MAX_CHARGE_MS);
  }

  updateKeeper(dt);
  if (state.ballFlying) updateBall(dt);

  drawPitch();
  drawGoal();
  drawZoneGrid();
  drawKeeper();
  drawTrajectory();
  drawSwipeArrow();
  drawSwipeHint();
  drawBall();
  drawPowerMeter();
  drawGoalFlash();

  state.animId = requestAnimationFrame(drawFrame);
}

// ── Keeper AI ──────────────────────────────────────────────────────────────
function updateKeeper(dt) {
  const level = LEVELS[state.levelIdx];
  const { w } = goalRect();
  const margin = 14 / w;

  let paceMult = state.settings.pace === 'slow' ? 0.58 : 1.0;
  let diffMult = state.settings.keeperDiff === 'relaxed' ? 0.62 : 1.0;
  const totalMult = paceMult * diffMult;

  if (state.keeperReacting) {
    const factor = Math.min(1, level.lerpSpeed * totalMult * (dt / 16));
    state.keeperX = lerp(state.keeperX, state.keeperTargetX, factor);
  } else {
    const step = level.patrolSpeed * totalMult * (dt / 16);

    if (level.fakeMove && state.fakePhase > 0) {
      if (state.fakePhase === 1) {
        state.keeperX += state.keeperDir * step * 1.5;
        if (state.keeperX < margin || state.keeperX > 1 - margin) {
          state.keeperDir *= -1;
          state.fakePhase = 2;
        }
      } else if (state.fakePhase === 2) {
        state.keeperX -= state.keeperDir * step;
        if (Math.abs(state.keeperX - 0.5) < 0.06) state.fakePhase = 0;
      }
    } else {
      state.keeperX += state.keeperDir * step;
      if (state.keeperX >= 1 - margin) { state.keeperX = 1 - margin; state.keeperDir = -1; }
      if (state.keeperX <= margin)      { state.keeperX = margin;     state.keeperDir =  1; }
      if (!state.ballFlying && level.fakeMove && Math.random() < 0.004) state.fakePhase = 1;
    }
  }
  state.keeperX = clamp(state.keeperX, margin, 1 - margin);
}

// ── Ball physics ───────────────────────────────────────────────────────────
function updateBall(dt) {
  state.ballProgress += dt / state.flightDuration;
  if (state.ballProgress >= 1) {
    state.ballProgress = 1;
    state.ballFlying   = false;
    evaluateShot();
    return;
  }
  const t    = easeOut(state.ballProgress);
  const arcH = canvas.height * 0.11;
  const baseX = lerp(canvas.width / 2, state.ballTargetX, t);
  // Lateral curve: peaks at mid-flight (sin(π × progress)), zero at start/end
  state.ballX = baseX + Math.sin(state.ballProgress * Math.PI) * state.curveOffset;
  const baseY = lerp(canvas.height * 0.84, state.ballTargetY, t);
  state.ballY = baseY - Math.sin(state.ballProgress * Math.PI) * arcH;
}

// ── Shot: apply accuracy variance, power, curve, then fire ────────────────
function shoot(rawTx, rawTy, power, rawCurveOffset) {
  if (state.phase !== 'aim') return;
  power = clamp(power !== undefined ? power : 1.0, 0.3, 1.0);
  rawCurveOffset = rawCurveOffset || 0;

  const shooter = SHOOTERS[state.shooterIdx];
  const g = goalRect();

  // Accuracy variance: Rocket misses more, Clinical barely drifts
  const varR  = (1 - shooter.accuracy) * g.w * 0.30;
  const varAng = Math.random() * Math.PI * 2;
  const varD   = Math.random() * varR;
  const tx = rawTx + Math.cos(varAng) * varD;
  const ty = rawTy + Math.sin(varAng) * varD;

  state.phase        = 'flying';
  state.aimLocked    = false;
  state.chargeActive = false;
  state.swipeActive  = false;
  state.chargePower  = 0;
  state.hoveredZone  = null;
  aimEl.classList.remove('visible', 'locked');

  state.power       = power;
  // curveOffset: scaled by shooter curve stat; stored in canvas px
  state.curveOffset = rawCurveOffset * shooter.curve;

  // Higher power → shorter flight duration (faster ball)
  const baseDuration = state.settings.pace === 'slow' ? FLIGHT_SLOW : FLIGHT_NORMAL;
  state.flightDuration = clamp(baseDuration / power, baseDuration * 0.72, baseDuration * 1.9);

  state.ballTargetX  = tx;
  state.ballTargetY  = ty;
  state.ballFlying   = true;
  state.ballProgress = 0;

  const paceRatio     = state.settings.pace === 'slow' ? FLIGHT_SLOW / FLIGHT_NORMAL : 1;
  const adjustedDelay = Math.round(LEVELS[state.levelIdx].reactionDelay * paceRatio);

  setTimeout(() => {
    if (!state.ballFlying) return;
    state.keeperReacting = true;
    const { x: gx, w: gw } = goalRect();
    state.keeperTargetX = clamp((tx - gx - 10) / (gw - 20), 0, 1);
  }, adjustedDelay);
}

// ── Shot evaluation ────────────────────────────────────────────────────────
function evaluateShot() {
  const { x: gx, y: gy, w: gw, h: gh } = goalRect();
  const postW = 10;

  const inGoal = (
    state.ballTargetX > gx + postW &&
    state.ballTargetX < gx + gw - postW &&
    state.ballTargetY > gy + postW &&
    state.ballTargetY < gy + gh
  );

  const keeperCentreX = gx + 10 + state.keeperX * (gw - 20);
  const keeperHalf    = gw * 0.063;
  const keeperBlocks  = Math.abs(state.ballTargetX - keeperCentreX) < keeperHalf;

  const scored = inGoal && !keeperBlocks;

  if (scored) {
    state.streak++;
    state.levelGoals++;
    state.goalFlash = 12;
    if (state.streak > state.bestStreak) {
      state.bestStreak = state.streak;
      saveBest(state.bestStreak);
    }
    showMsg('GOAL! ⚽', '#f5c518');
    updateHUD();
    const needed = LEVELS[state.levelIdx].scoreNeeded;
    const isLastLevel = state.levelIdx === LEVELS.length - 1;
    if (!isLastLevel && state.levelGoals >= needed) {
      setTimeout(levelUp, 1800);
    } else {
      setTimeout(nextAttempt, 2000);
    }
  } else {
    showMsg(!inGoal ? 'MISS!' : 'SAVED!', '#e63946');
    updateHUD();
    setTimeout(gameOver, 2000);
  }
  state.phase = 'result';
}

// ── Level up ───────────────────────────────────────────────────────────────
function levelUp() {
  if (state.levelIdx < LEVELS.length - 1) {
    state.levelIdx++;
    state.levelGoals = 0;
    updateHUD();
    showMsg(LEVELS[state.levelIdx].name + '! ▲', '#2dc653');
    setTimeout(nextAttempt, 2400);
  }
}

// ── Next attempt ───────────────────────────────────────────────────────────
function nextAttempt() {
  hideMsg();
  state.ballX = canvas.width / 2;
  state.ballY = canvas.height * 0.84;
  state.ballFlying    = false;
  state.ballProgress  = 0;
  state.keeperReacting = false;
  state.aimActive     = false;
  state.swipeActive   = false;
  state.chargeActive  = false;
  state.chargePower   = 0;
  state.hoveredZone   = null;
  state.curveOffset   = 0;
  state.phase         = 'aim';
  aimEl.classList.remove('locked', 'visible');
}

// ── Game over ──────────────────────────────────────────────────────────────
function gameOver() {
  cancelAnimationFrame(state.animId);
  hideMsg();
  goStreak.textContent = state.streak;
  goBest.textContent   = state.bestStreak;
  goLevel.textContent  = LEVELS[state.levelIdx].name;
  goTitle.textContent  = state.streak >= 10 ? 'LEGEND! 🏆' : state.streak >= 5 ? 'GREAT RUN! ⭐' : 'GAME OVER';
  showScreen('gameover');
}

// ── Messages ───────────────────────────────────────────────────────────────
function showMsg(text, color) {
  msgText.textContent = text;
  msgText.style.color = color;
  msgEl.classList.remove('hidden');
  void msgEl.offsetWidth;
  msgText.style.animation = 'none';
  void msgText.offsetWidth;
  msgText.style.animation = '';
  clearTimeout(state.msgTimeout);
}

function hideMsg() { msgEl.classList.add('hidden'); }

// ── Settings ───────────────────────────────────────────────────────────────
function toggleSettings(e) {
  if (e) e.stopPropagation();
  state.settingsOpen = !state.settingsOpen;
  settingsPnl.classList.toggle('hidden', !state.settingsOpen);
}

function applySettingToggle(btn) {
  btn.stopPropagation && btn.stopPropagation();
  const key = btn.dataset.setting;
  const val = btn.dataset.value;

  if (key === 'controlMode') {
    state.controlMode  = val;
    state.swipeActive  = false;
    state.chargeActive = false;
    state.chargePower  = 0;
    state.hoveredZone  = null;
    aimEl.classList.remove('visible', 'locked');
    state.aimActive = false;
    updateHUD();
  } else if (key === 'shooter') {
    state.shooterIdx = parseInt(val, 10);
    updateHUD();
    updateShooterStats();
  } else {
    state.settings[key] = val;
  }

  settingsPnl.querySelectorAll(`[data-setting="${key}"]`).forEach(b => {
    b.classList.toggle('tog-active', b === btn);
  });
}

// ── Input helpers ──────────────────────────────────────────────────────────
function getCanvasPos(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const src    = e.touches ? e.touches[0] || e.changedTouches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
    clientX: src.clientX,
    clientY: src.clientY,
  };
}

// ── Pointer Down ───────────────────────────────────────────────────────────
function handlePointerDown(e) {
  e.preventDefault();
  if (state.settingsOpen) {
    state.settingsOpen = false;
    settingsPnl.classList.add('hidden');
    return;
  }
  if (state.screen !== 'game' || state.phase !== 'aim') return;

  const pos  = getCanvasPos(e);
  const mode = state.controlMode;

  if (mode === 'swipe') {
    state.swipeStartX = pos.x;
    state.swipeStartY = pos.y;
    state.swipeCurX   = pos.x;
    state.swipeCurY   = pos.y;
    state.swipeActive = true;

  } else if (mode === 'charge') {
    // Tap position locks aim; hold charges power
    state.aimX          = pos.x;
    state.aimY          = pos.y;
    state.aimActive     = true;
    state.chargeActive  = true;
    state.chargeStartTime = performance.now();
    state.chargePower   = 0;
    aimEl.style.left = pos.clientX + 'px';
    aimEl.style.top  = pos.clientY + 'px';
    aimEl.classList.add('visible', 'locked');

  } else if (mode === 'zones') {
    const zone = getZoneAtPos(pos);
    if (zone) {
      const { tx, ty } = zoneToTarget(zone.col, zone.row);
      shoot(tx, ty, SHOOTERS[state.shooterIdx].power, 0);
    }
  }
}

// ── Pointer Move ───────────────────────────────────────────────────────────
function handlePointerMove(e) {
  if (state.screen !== 'game' || state.settingsOpen) return;
  if (state.phase !== 'aim') return;

  const pos  = getCanvasPos(e);
  const mode = state.controlMode;

  if (mode === 'swipe') {
    if (state.swipeActive) {
      state.swipeCurX = pos.x;
      state.swipeCurY = pos.y;
    }

  } else if (mode === 'charge') {
    if (!state.chargeActive) {
      // Free aim before press
      state.aimX = pos.x;
      state.aimY = pos.y;
      state.aimActive = true;
      aimEl.style.left = pos.clientX + 'px';
      aimEl.style.top  = pos.clientY + 'px';
      aimEl.classList.add('visible');
      aimEl.classList.remove('locked');
    }
    // While charging: aim is locked, ignore moves

  } else if (mode === 'zones') {
    const zone = getZoneAtPos(pos);
    state.hoveredZone = zone;
    if (zone) {
      const { tx, ty } = zoneToTarget(zone.col, zone.row);
      state.aimX = tx;
      state.aimY = ty;
    }
  }
}

// ── Pointer Up ────────────────────────────────────────────────────────────
function handlePointerUp(e) {
  if (state.screen !== 'game') return;
  if (state.phase !== 'aim') return;

  const mode = state.controlMode;

  if (mode === 'swipe' && state.swipeActive) {
    const dx  = state.swipeCurX - state.swipeStartX;
    const dy  = state.swipeCurY - state.swipeStartY;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len > 18) {
      const power      = Math.min(1, len / getMaxSwipeLength());
      const { tx, ty } = swipeToTarget(dx, dy);
      // rawCurveOffset: lateral component drives curve; shooter.curve scales it in shoot()
      shoot(tx, ty, power, dx * 0.15);
    } else {
      // Too short — cancel
      state.swipeActive = false;
    }

  } else if (mode === 'charge' && state.chargeActive) {
    const elapsed       = performance.now() - state.chargeStartTime;
    const power         = Math.max(0.3, Math.min(1, elapsed / MAX_CHARGE_MS));
    const dx            = state.aimX - canvas.width / 2;
    shoot(state.aimX, state.aimY, power, dx * 0.06);
    // state.chargeActive reset inside shoot()
    state.aimActive = false;
    aimEl.classList.remove('visible', 'locked');
  }
}

// ── Start game ─────────────────────────────────────────────────────────────
function startGame() {
  state.levelIdx       = 0;
  state.streak         = 0;
  state.levelGoals     = 0;
  state.phase          = 'wait';
  state.bestStreak     = loadBest();
  state.keeperX        = 0.5;
  state.keeperDir      = 1;
  state.keeperReacting = false;
  state.fakePhase      = 0;
  state.ballFlying     = false;
  state.aimLocked      = false;
  state.aimActive      = false;
  state.swipeActive    = false;
  state.chargeActive   = false;
  state.chargePower    = 0;
  state.hoveredZone    = null;
  state.curveOffset    = 0;
  state.power          = 1.0;
  state.goalFlash      = 0;
  state.settingsOpen   = false;
  settingsPnl.classList.add('hidden');
  hideMsg();
  updateHUD();
  showScreen('game');
  resizeCanvas();
  state.ballX    = canvas.width / 2;
  state.ballY    = canvas.height * 0.84;
  state.lastTime = performance.now();
  cancelAnimationFrame(state.animId);
  state.animId = requestAnimationFrame(drawFrame);
  setTimeout(nextAttempt, 600);
}

// ── Event listeners ────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);
document.getElementById('btn-menu').addEventListener('click', () => {
  cancelAnimationFrame(state.animId);
  showScreen('start');
  bestDisp.textContent = state.bestStreak > 0 ? `Best streak: ${state.bestStreak}` : '';
});

settingsBtn.addEventListener('click', toggleSettings);
settingsBtn.addEventListener('touchend', (e) => { e.preventDefault(); toggleSettings(e); });

settingsPnl.querySelectorAll('.tog').forEach(btn => {
  btn.addEventListener('click', (e) => { e.stopPropagation(); applySettingToggle(btn); });
  btn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); applySettingToggle(btn); });
});

// Canvas input: down + move on canvas, up on window (catches out-of-canvas releases)
canvas.addEventListener('mousedown',  handlePointerDown);
canvas.addEventListener('mousemove',  handlePointerMove, { passive: true });
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handlePointerDown(e); }, { passive: false });
canvas.addEventListener('touchmove',  (e) => { e.preventDefault(); handlePointerMove(e); }, { passive: false });
canvas.addEventListener('mouseleave', () => {
  if (state.controlMode === 'charge' && !state.chargeActive) {
    aimEl.classList.remove('visible');
  }
  if (state.controlMode === 'zones') state.hoveredZone = null;
});

// mouseup on window so drag-and-release outside canvas still fires
window.addEventListener('mouseup', handlePointerUp);
canvas.addEventListener('touchend', (e) => { e.preventDefault(); handlePointerUp(e); }, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────
(function init() {
  const best = loadBest();
  if (best > 0) bestDisp.textContent = `Best streak: ${best}`;
  hudBest.textContent = best;
  state.bestStreak = best;

  updateShooterStats();

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
      r = Array.isArray(r) ? r[0] : r;
      r = Math.min(r, w / 2, h / 2);
      this.beginPath();
      this.moveTo(x + r, y);
      this.lineTo(x + w - r, y);
      this.quadraticCurveTo(x + w, y, x + w, y + r);
      this.lineTo(x + w, y + h - r);
      this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      this.lineTo(x + r, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - r);
      this.lineTo(x, y + r);
      this.quadraticCurveTo(x, y, x + r, y);
      this.closePath();
    };
  }
})();
