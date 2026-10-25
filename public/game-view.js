// 橋を渡れ！ のゲーム画面。サーバーから届いた状態を描くだけ。動きの入力はサーバーに送り、判定は全部サーバー。
// render(state) は全体の状態が届いたとき、frame(msg) はゲーム中の差分（10回/秒）が届いたときに呼ばれる。
import * as sfx from './sound.js'

const $ = s => document.querySelector(s)
const ST = { idle: 0, walk: 1, run: 2, fall: 3, done: 4, gone: 5 }
const CALLS = ['待って', '行け', '危ない']
const COLORS = ['#ff8a5b', '#5bc0ff', '#ffd25b', '#9b8cff', '#5bffb0', '#ff5b9e', '#c8ff5b', '#5bf0ff', '#ffb35b', '#d98cff', '#8cffd9', '#ff6f6f']
const FRAME_MS = 100

let W = null       // 画面側の世界（届いた状態の写し）
let send = () => {}
let built = false
let raf = 0
const input = { dx: 0, dy: 0, run: false, sentAt: 0, last: '', keys: new Set(), stick: null }

// ---------- 届いた状態を写す
function reset(g, state) {
  const n = g.roster.length
  W = {
    round: state.round, cols: g.cols, rows: g.rows, span: g.span, cap: g.cap, spanCap: g.spanCap, runWeight: g.runWeight,
    limit: g.limit, roster: g.roster, me: g.roster.findIndex(r => r[0] === state.you),
    px: new Float32Array(n), py: new Float32Array(n), ox: new Float32Array(n), oy: new Float32Array(n),
    st: new Uint8Array(n), fallAt: new Float64Array(n), k: new Uint8Array(g.k.length),
    frameAt: performance.now(), calls: new Map(), ph: -1, tm: 0, g: 0, n: 0, need: 0, w: null,
    mx: null, my: null, camY: null, goalAt: null, tmSeen: -1, collapseAt: 0, goSeenAt: 0, creakAt: 0, fresh: true
  }
  input.dx = 0; input.dy = 0; input.run = false; input.last = ''; input.stick = null; input.keys.clear()
}

function applyFull(g, state) {
  if (!W || W.round !== state.round || W.roster.length !== g.roster.length) reset(g, state)
  W.roster = g.roster
  setPlayers(g.p, false)
  for (let i = 0; i < g.k.length; i++) setPlank(i, g.k[i])
  common(g)
  W.fresh = false
}

export function frame(f) {
  if (!W) return
  setPlayers(f.p, true)
  for (let i = 0; i < f.k.length; i += 2) setPlank(f.k[i], f.k[i + 1])
  common(f)
}

function common(f) {
  W.tm = f.tm; W.g = f.g; W.n = f.n; W.need = f.need; W.w = f.w || null
  if (f.ph !== W.ph) onPhase(f.ph)
  W.ph = f.ph
  W.calls.clear()
  for (let i = 0; i < f.c.length; i += 2) W.calls.set(f.c[i], f.c[i + 1])
  W.frameAt = performance.now()
  if (W.ph === 0 && Math.ceil(W.tm / 10) !== W.tmSeen) { W.tmSeen = Math.ceil(W.tm / 10); sfx.count() }
  hud()
}

// p は差分なら [番号, x, y, 状態, ...]、全体なら [x, y, 状態, ...]
function setPlayers(p, delta) {
  const now = performance.now()
  const a = Math.min(1, (now - W.frameAt) / FRAME_MS)
  for (let i = 0; i < W.px.length; i++) { W.ox[i] = W.ox[i] + (W.px[i] - W.ox[i]) * a; W.oy[i] = W.oy[i] + (W.py[i] - W.oy[i]) * a }
  const stride = delta ? 4 : 3
  for (let j = 0; j < p.length; j += stride) {
    const i = delta ? p[j] : j / 3
    const o = delta ? 1 : 0
    const x = p[j + o] / 10, y = p[j + o + 1] / 10, st = p[j + o + 2]
    const prev = W.st[i]
    const jump = W.fresh || Math.abs(y - W.py[i]) > 2 || prev === ST.fall // 戻されたときは線を引かずに飛ぶ
    W.px[i] = x; W.py[i] = y
    if (jump) { W.ox[i] = x; W.oy[i] = y }
    if (!W.fresh && st === ST.fall && prev !== ST.fall) { W.fallAt[i] = now; if (i === W.me) sfx.splash(); else if (near(i)) sfx.splashFar() }
    if (!W.fresh && st === ST.done && prev !== ST.done && i === W.me) { W.goalAt = now; sfx.goal() }
    if (i === W.me && (jump || st === ST.fall)) { W.mx = null; W.my = null }
    W.st[i] = st
  }
}

function setPlank(i, l) {
  if (!W.fresh && W.k[i] > 0 && l === 0) sfx.crack()
  W.k[i] = l
}

function near(i) { return W.me >= 0 && Math.abs(W.py[i] - W.py[W.me]) < 6 }

function onPhase(ph) {
  if (ph === 1) { W.goSeenAt = performance.now(); if (!W.fresh) sfx.go(); sfx.bgm(true) }
  if (ph === 2) { W.collapseAt = performance.now(); sfx.collapse(); sfx.bgm(false) }
}

// ---------- 画面を組む
function build() {
  const root = $('#stage')
  root.innerHTML = `
    <div class="g-hud">
      <div class="g-pill" id="g-time" aria-label="残り時間"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 13V9M9 2h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><b>--</b></div>
      <div class="g-pill g-goal" id="g-goal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3M6 4h11l-3 4 3 4H6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg><b>0/0</b><small></small></div>
      <button class="g-icon" id="g-mute" aria-label="音"></button>
    </div>
    <div class="g-status" id="g-status"><i></i><span></span></div>
    <div class="g-field" id="g-field"><canvas id="g-canvas"></canvas><div class="g-big" id="g-big" hidden></div></div>
    <div class="g-ctrl">
      <div class="g-calls">
        <button data-k="0" class="g-call">待って</button>
        <button data-k="1" class="g-call">行け</button>
        <button data-k="2" class="g-call">危ない</button>
      </div>
      <button id="g-run" class="g-run" aria-label="走る（押している間）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h8M9 7l5 5-5 5M14 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>走る</span></button>
    </div>`
  const cv = $('#g-canvas')
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); sfx.unlock()
    try { cv.setPointerCapture(e.pointerId) } catch {}
    input.stick = { id: e.pointerId, x: e.offsetX, y: e.offsetY, cx: e.offsetX, cy: e.offsetY }
  })
  cv.addEventListener('pointermove', e => {
    const s = input.stick
    if (!s || s.id !== e.pointerId) return
    s.cx = e.offsetX; s.cy = e.offsetY
    stickToInput()
  })
  const end = e => { if (input.stick && input.stick.id === e.pointerId) { input.stick = null; input.dx = 0; input.dy = 0; pushInput(true) } }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end)
  const run = $('#g-run')
  const runOn = v => e => { e.preventDefault(); sfx.unlock(); if (input.run === v) return; input.run = v; run.classList.toggle('on', v); pushInput(true) }
  run.addEventListener('pointerdown', runOn(true))
  run.addEventListener('pointerup', runOn(false)); run.addEventListener('pointercancel', runOn(false)); run.addEventListener('pointerleave', runOn(false))
  run.addEventListener('contextmenu', e => e.preventDefault())
  for (const b of root.querySelectorAll('.g-call')) b.addEventListener('pointerdown', e => { e.preventDefault(); sfx.unlock(); send({ type: 'call', k: Number(b.dataset.k) }) })
  $('#g-mute').addEventListener('click', () => { sfx.unlock(); sfx.setMuted(!sfx.muted()); muteIcon() })
  muteIcon()
  if (!build.keys) {
    build.keys = true
    addEventListener('keydown', e => key(e, true)); addEventListener('keyup', e => key(e, false))
    addEventListener('blur', () => { input.keys.clear(); input.run = false; keysToInput() })
  }
  built = true
}

function muteIcon() {
  const m = sfx.muted()
  $('#g-mute').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${m ? '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' : '<path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'}</svg>`
  $('#g-mute').setAttribute('aria-label', m ? '音を出す' : '音を消す')
}

const KEYMAP = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' }
function key(e, down) {
  if (document.body.dataset.screen !== 'game' || !built) return
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') {
    e.preventDefault()
    if (input.run === down) return
    input.run = down; $('#g-run')?.classList.toggle('on', down); pushInput(true); return
  }
  if (down && !e.repeat && /^Digit[123]$/.test(e.code)) { send({ type: 'call', k: Number(e.code.slice(5)) - 1 }); return }
  const k = KEYMAP[e.code]
  if (!k) return
  e.preventDefault(); sfx.unlock()
  if (down) input.keys.add(k); else input.keys.delete(k)
  keysToInput()
}
function keysToInput() {
  const K = input.keys
  input.dx = (K.has('r') ? 1 : 0) - (K.has('l') ? 1 : 0)
  input.dy = (K.has('u') ? 1 : 0) - (K.has('d') ? 1 : 0)
  pushInput(true)
}
function stickToInput() {
  const s = input.stick
  let vx = s.cx - s.x, vy = s.cy - s.y
  const m = Math.hypot(vx, vy)
  if (m < 8) { vx = 0; vy = 0 } else { const r = Math.min(1, m / 48) / m; vx *= r; vy *= r }
  input.dx = vx; input.dy = -vy
  pushInput(false)
}
// 同じ内容は送らない。変化は最大 15回/秒（サーバーの上限は 40回/秒）
function pushInput(force) {
  const q = v => Math.round(v * 20) / 20
  const msg = { type: 'move', dx: q(input.dx), dy: q(input.dy), run: input.run }
  const s = JSON.stringify(msg)
  const now = performance.now()
  if (s === input.last) return
  if (!force && now - input.sentAt < 66) { clearTimeout(pushInput.t); pushInput.t = setTimeout(() => pushInput(true), 70); return }
  clearTimeout(pushInput.t)
  input.last = s; input.sentAt = now
  send(msg)
}

// ---------- 上の表示
function hud() {
  if (!built) return
  const t = Math.ceil(W.tm / 10)
  const tEl = $('#g-time')
  tEl.querySelector('b').textContent = W.ph === 0 ? '--' : String(t)
  tEl.classList.toggle('warn', W.ph === 1 && t <= 10)
  $('#g-goal b').textContent = `${W.g}/${W.n}`
  $('#g-goal small').textContent = `目標${W.need}`
  $('#g-goal').classList.toggle('ok', W.g >= W.need)
  if (W.ph === 1 && t <= 10 && t !== hud.lastT) { hud.lastT = t; sfx.tickLow() }
}

function status(text, kind) {
  const el = $('#g-status')
  if (el.dataset.k === kind && el.lastChild.textContent === text) return
  el.dataset.k = kind
  el.lastChild.textContent = text
}

// ---------- 描く
export function render(state, ctx) {
  send = ctx.send
  if (!built || !$('#g-canvas')) build()
  applyFull(state.game, state)
  if (!raf) raf = requestAnimationFrame(loop)
}

let lastT = 0
function loop(t) {
  raf = 0
  if (document.body.dataset.screen !== 'game' || !$('#g-canvas')) { sfx.bgm(false); lastT = 0; return }
  const dt = Math.min(0.1, lastT ? (t - lastT) / 1000 : 0)
  lastT = t
  draw(t, dt)
  raf = requestAnimationFrame(loop)
}

function lerpPos(i, a) { return [W.ox[i] + (W.px[i] - W.ox[i]) * a, W.oy[i] + (W.py[i] - W.oy[i]) * a] }

// 自分だけは押した瞬間に動いて見せる（サーバーの位置へ少しずつ寄せる）
function predictMe(dt, a) {
  const i = W.me
  if (i < 0) return null
  const [sx, sy] = lerpPos(i, a)
  const st = W.st[i]
  if (W.ph !== 1 || st === ST.fall || st === ST.gone) { W.mx = sx; W.my = sy; return [sx, sy] }
  if (W.mx == null) { W.mx = sx; W.my = sy }
  const m = Math.hypot(input.dx, input.dy)
  if (m > 0.05) {
    const sp = (input.run ? 3.6 : 2.0) * Math.min(1, m) / m
    W.mx = Math.min(W.cols - 0.25, Math.max(0.25, W.mx + input.dx * sp * dt))
    W.my = Math.min(W.rows + 3, Math.max(st === ST.done ? W.rows + 0.3 : -3, W.my + input.dy * sp * dt))
  }
  const ex = sx - W.mx, ey = sy - W.my
  if (Math.hypot(ex, ey) > 1.5) { W.mx = sx; W.my = sy }
  else { const c = Math.min(1, dt * (m > 0.05 ? 1.2 : 6)); W.mx += ex * c; W.my += ey * c }
  return [W.mx, W.my]
}

function draw(t, dt) {
  const cv = $('#g-canvas'), field = $('#g-field')
  const dpr = Math.min(2, devicePixelRatio || 1)
  const cw = field.clientWidth, ch = field.clientHeight
  if (!cw || !ch) return
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr) }
  const c = cv.getContext('2d')
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  const now = performance.now()
  const a = Math.min(1, (now - W.frameAt) / FRAME_MS)
  const { cols, rows } = W
  const S = Math.min((cw - 28) / (cols + 0.8), 58, ch / 10) // 横持ちでも先が10段は見えるように
  const meP = predictMe(dt, a)
  // カメラ: 自分を画面の下寄り（先が見える位置）に置く。橋全体が収まるなら真ん中に固定
  const viewH = ch / S
  const lo = -3.4 + viewH * 0.38, hi = rows + 3.4 - viewH * 0.62
  let target
  if (lo > hi) target = rows / 2 - viewH * 0.12
  else target = Math.min(hi, Math.max(lo, meP ? meP[1] : rows / 2))
  W.camY = W.camY == null ? target : W.camY + (target - W.camY) * Math.min(1, dt * 5)
  let shake = 0
  if (W.ph === 2) shake = Math.max(0, 1 - (now - W.collapseAt) / 1500) * 8
  const X0 = (cw - cols * S) / 2 - 4 + (shake ? (Math.random() - 0.5) * shake : 0)
  const sx = x => X0 + x * S
  const sy = y => ch * 0.62 - (y - W.camY) * S
  const yTop = W.camY + ch * 0.62 / S, yBot = W.camY - ch * 0.38 / S

  // 谷と川
  c.fillStyle = '#0b2530'; c.fillRect(0, 0, cw, ch)
  c.strokeStyle = 'rgba(140,220,230,0.10)'; c.lineWidth = 2
  for (let y = Math.floor(yBot); y < yTop + 1; y += 0.5) {
    const off = ((t / 1000) * 0.6 + y * 0.37) % 1
    c.beginPath()
    const xa = Math.floor(-X0 / S) - 2, xb = Math.ceil((cw - X0) / S) + 1
    for (let x = xa; x <= xb; x += 0.5) {
      const px = sx(x + off * 0.5), py = sy(y) + Math.sin(x * 2 + y * 3 + t / 600) * 2
      x === xa ? c.moveTo(px, py) : c.lineTo(px, py)
    }
    c.stroke()
  }
  // 崖（スタートとゴール）
  const cliff = (y0, y1, top, label) => {
    const ya = sy(y1), yb = sy(y0)
    if (yb < 0 || ya > ch) return
    c.fillStyle = top; c.fillRect(0, ya, cw, yb - ya)
    c.fillStyle = 'rgba(0,0,0,0.18)'
    for (let i = 0; i < 14; i++) { const rx = ((i * 97) % 100) / 100 * cw, ry = ya + ((i * 53) % 100) / 100 * (yb - ya); c.beginPath(); c.arc(rx, ry, 3 + (i % 3) * 2, 0, 7); c.fill() }
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.font = `800 ${Math.max(12, Math.min(18, S * 0.42))}px system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle'
    c.fillText(label, 10, Math.min(ch - 14, Math.max(14, (ya + yb) / 2)))
  }
  cliff(-4, 0, '#5a4a3a', 'スタート')
  cliff(rows, rows + 4, '#3f6b45', 'ゴール')
  c.fillStyle = '#2b2219'; c.fillRect(0, sy(0), cw, 4)
  c.fillStyle = '#25412a'; c.fillRect(0, sy(rows) - 4, cw, 4)

  // 板ごとの重さ（届いた位置から画面側で数える。判定はサーバー）
  const load = new Float32Array(cols * rows)
  const spanLoad = new Float32Array(Math.ceil(rows / W.span))
  const gust = W.w
  for (let i = 0; i < W.st.length; i++) {
    const st = W.st[i]
    if (st === ST.fall || st === ST.done || st === ST.gone) continue
    const y = W.py[i], x = W.px[i]
    if (y < 0 || y >= rows) continue
    const s = Math.floor(Math.floor(y) / W.span)
    let w = st === ST.run ? W.runWeight : 1
    if (gust && gust[1] === 2 && gust[0] === s && st !== ST.idle) w *= 3
    load[Math.floor(y) * cols + Math.min(cols - 1, Math.floor(x))] += w
    spanLoad[s] += w
  }
  // 橋（重い区間と突風の区間は揺れる）
  const sway = new Float32Array(spanLoad.length)
  for (let s = 0; s < sway.length; s++) {
    const r = spanLoad[s] / W.spanCap
    let amp = r > 0.75 ? Math.min(1, (r - 0.75) * 2) : 0
    if (gust && gust[1] === 2 && gust[0] === s) amp = Math.max(amp, 0.6)
    sway[s] = amp * Math.sin(t / 90 + s) * 0.08
  }
  const r0 = Math.max(0, Math.floor(yBot) - 1), r1 = Math.min(rows - 1, Math.ceil(yTop) + 1)
  c.strokeStyle = '#c9a46a'; c.lineWidth = Math.max(2, S * 0.08)
  for (const side of [-0.12, cols + 0.12]) {
    c.beginPath()
    for (let y = 0; y <= rows; y += 0.5) { const s = Math.min(sway.length - 1, Math.floor(y / W.span)); const px = sx(side + sway[s]), py = sy(y); y === 0 ? c.moveTo(px, py) : c.lineTo(px, py) }
    c.stroke()
  }
  for (let r = r0; r <= r1; r++) {
    const s = Math.floor(r / W.span)
    for (let col = 0; col < cols; col++) {
      const k = r * cols + col, l = W.k[k]
      const x = sx(col + 0.05 + sway[s]), y = sy(r + 0.92), w = S * 0.9, h = S * 0.84
      if (l === 0) {
        // 穴: ふちの割れ残りだけ
        c.fillStyle = '#5d4630'; c.fillRect(x, y, w * 0.18, h * 0.3); c.fillRect(x + w * 0.75, y + h * 0.65, w * 0.25, h * 0.35)
        continue
      }
      const ratio = load[k] / W.cap
      c.fillStyle = l >= 7 ? '#c08a52' : l >= 4 ? '#a87444' : '#8a5a36'
      c.fillRect(x, y, w, h)
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x, y + h * 0.45, w, Math.max(1, h * 0.06))
      if (l <= 6) {
        c.strokeStyle = '#3a2414'; c.lineWidth = Math.max(1, S * 0.05)
        c.beginPath(); c.moveTo(x + w * 0.2, y); c.lineTo(x + w * 0.45, y + h * 0.5); c.lineTo(x + w * 0.35, y + h); c.stroke()
        if (l <= 3) { c.beginPath(); c.moveTo(x + w, y + h * 0.3); c.lineTo(x + w * 0.6, y + h * 0.55); c.lineTo(x + w * 0.75, y + h); c.stroke() }
      }
      if (ratio >= 0.7) {
        const over = ratio > 1
        c.fillStyle = over ? `rgba(255,60,60,${0.35 + 0.25 * Math.sin(t / 80)})` : 'rgba(255,190,60,0.30)'
        c.fillRect(x, y, w, h)
        if (over && S >= 16) { c.fillStyle = '#fff'; c.font = `900 ${S * 0.5}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', x + w / 2, y + h / 2) }
      }
    }
  }
  // 支柱と区間の警告
  for (let s = 0; s <= sway.length; s++) {
    const y = sy(s * W.span)
    c.fillStyle = '#6b4a2b'
    c.fillRect(sx(-0.3) - 4, y - 5, 10, 10); c.fillRect(sx(cols + 0.3) - 6, y - 5, 10, 10)
  }
  for (let s = 0; s < spanLoad.length; s++) {
    const yc = sy(s * W.span + W.span / 2)
    if (spanLoad[s] > W.spanCap * 0.85) tag(c, sx(cols) + 6, yc, spanLoad[s] > W.spanCap ? '重すぎ' : 'ゆれ', spanLoad[s] > W.spanCap ? '#ff5b5b' : '#ffc94a', cw)
  }
  // 突風
  if (gust) {
    const [s, ph] = gust
    const ya = sy((s + 1) * W.span), yb = sy(s * W.span)
    if (ph === 1) {
      c.setLineDash([8, 6]); c.strokeStyle = '#ffd84a'; c.lineWidth = 3
      c.strokeRect(sx(-0.4), ya, (cols + 0.8) * S, yb - ya); c.setLineDash([])
      c.fillStyle = 'rgba(255,216,74,0.10)'; c.fillRect(0, ya, cw, yb - ya)
    } else {
      c.fillStyle = 'rgba(220,240,255,0.14)'; c.fillRect(0, ya, cw, yb - ya)
      c.strokeStyle = 'rgba(235,248,255,0.75)'; c.lineWidth = 2
      for (let i = 0; i < 9; i++) {
        const yy = ya + ((i * 37) % 100) / 100 * (yb - ya)
        const xx = ((t / 2.2 + i * 140) % (cw + 200)) - 100
        c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + 60, yy); c.stroke()
      }
    }
    const ly = Math.min(Math.max((ya + yb) / 2, 24), ch - 24)
    windLabel(c, cw / 2, ly, ph === 1 ? '突風が来る 止まれ' : '突風 動くと割れる')
  }

  // 人
  const r = Math.max(4, S * 0.3)
  for (let i = 0; i < W.st.length; i++) if (W.st[i] !== ST.gone && i !== W.me) person(c, i, lerpPos(i, a), sx, sy, r, now, false)
  if (W.me >= 0 && W.st[W.me] !== ST.gone && meP) person(c, W.me, meP, sx, sy, r, now, true)
  // 合図の吹き出し（自分に近い順に最大12個）
  const calls = [...W.calls.entries()].filter(([i]) => W.st[i] !== ST.gone)
  if (meP) calls.sort((A, B) => Math.abs(W.py[A[0]] - meP[1]) - Math.abs(W.py[B[0]] - meP[1]))
  for (const [i, k] of calls.slice(0, 12)) {
    const [x, y] = i === W.me && meP ? meP : lerpPos(i, a)
    bubble(c, sx(x), sy(y) - r - 8, CALLS[k], k)
  }
  if (W.calls.size > (draw.calls || 0)) sfx.call()
  draw.calls = W.calls.size

  // 右端の全体図（橋全体が画面に入らないときだけ）
  if (yTop - yBot < rows + 6) {
    const mx = cw - 8, top = 12, bot = ch - 12
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 4; c.beginPath(); c.moveTo(mx, top); c.lineTo(mx, bot); c.stroke()
    const my = y => bot - (Math.min(rows + 1, Math.max(-1, y)) + 1) / (rows + 2) * (bot - top)
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(mx - 5, my(yTop), 10, my(yBot) - my(yTop))
    for (let i = 0; i < W.st.length; i++) { if (W.st[i] === ST.gone || i === W.me) continue; c.fillStyle = COLORS[i % COLORS.length]; c.fillRect(mx - 3, my(W.py[i]) - 1, 6, 2) }
    if (meP) { c.fillStyle = '#fff'; c.beginPath(); c.arc(mx, my(meP[1]), 4, 0, 7); c.fill() }
  }

  // 自分の板の様子（音と文字）
  let myLoad = 0, myL = 10
  if (meP && W.me >= 0) {
    const st = W.st[W.me]
    if (meP[1] >= 0 && meP[1] < rows && st !== ST.fall && st !== ST.done) {
      const k = Math.floor(meP[1]) * cols + Math.min(cols - 1, Math.floor(meP[0]))
      myLoad = load[k] / W.cap; myL = W.k[k]
    }
    if (myLoad > 1 && now - W.creakAt > 450) { W.creakAt = now; sfx.creak() }
  }
  // 指のスティック
  const s = input.stick
  if (s) {
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, 48, 0, 7); c.stroke()
    const kx = s.x + input.dx * 48, ky = s.y - input.dy * 48
    c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); c.arc(kx, ky, 18, 0, 7); c.fill()
  }
  bigText(now)
  statusLine(myLoad, myL, meP)
  draw.debug = { S, cw, ch, camY: W.camY, me: meP }
}

function person(c, i, [x, y], sx, sy, r, now, me) {
  const st = W.st[i]
  const X = sx(x), Y = sy(y)
  const col = COLORS[i % COLORS.length]
  if (st === ST.fall) {
    const e = Math.min(1, (now - W.fallAt[i]) / 900)
    c.strokeStyle = `rgba(200,240,255,${1 - e})`; c.lineWidth = 2
    c.beginPath(); c.arc(X, Y, r * (1 + e * 2.2), 0, 7); c.stroke()
    if (e < 1) { c.fillStyle = col; c.globalAlpha = 1 - e; c.beginPath(); c.arc(X, Y, r * (1 - e * 0.8), 0, 7); c.fill(); c.globalAlpha = 1 }
    if (me) label(c, X, Y - r - 10, '落ちた', '#9fe3ff')
    return
  }
  if (st === ST.run) {
    const dx = W.px[i] - W.ox[i], dy = W.py[i] - W.oy[i], m = Math.hypot(dx, dy)
    if (m > 0.01) for (let j = 1; j <= 3; j++) { c.globalAlpha = 0.25 / j; c.fillStyle = col; c.beginPath(); c.arc(X - dx / m * j * r * 0.8, Y + dy / m * j * r * 0.8, r * (1 - j * 0.15), 0, 7); c.fill() }
    c.globalAlpha = 1
  }
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(X, Y + r * 0.55, r * 0.9, r * 0.4, 0, 0, 7); c.fill()
  c.fillStyle = col; c.beginPath(); c.arc(X, Y, r, 0, 7); c.fill()
  c.strokeStyle = me ? '#ffffff' : 'rgba(0,0,0,0.45)'; c.lineWidth = me ? 3 : 1.2; c.stroke()
  if (me) {
    c.fillStyle = '#fff'
    c.beginPath(); c.moveTo(X, Y - r - 4); c.lineTo(X - 6, Y - r - 13); c.lineTo(X + 6, Y - r - 13); c.closePath(); c.fill()
    if (!W.calls.has(i)) label(c, X, Y - r - 22, 'あなた', '#fff')
  }
}

function label(c, x, y, text, color) {
  c.font = '800 13px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.strokeText(text, x, y)
  c.fillStyle = color; c.fillText(text, x, y)
}

function rrect(c, x, y, w, h, r) {
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath()
}

function bubble(c, x, y, text, k) {
  c.font = '800 13px system-ui, sans-serif'
  const w = c.measureText(text).width + 14, h = 22
  c.fillStyle = k === 0 ? '#ffe08a' : k === 1 ? '#a8f0c0' : '#ffb0a8'
  c.strokeStyle = '#1b1b1b'; c.lineWidth = 1.5
  c.beginPath(); rrect(c, x - w / 2, y - h - 6, w, h, 8); c.fill(); c.stroke()
  c.beginPath(); c.moveTo(x - 5, y - 6.5); c.lineTo(x, y); c.lineTo(x + 5, y - 6.5); c.fill()
  c.fillStyle = '#1b1b1b'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y - h / 2 - 6)
}

function tag(c, x, y, text, color, cw) {
  c.font = '800 12px system-ui, sans-serif'
  const w = c.measureText(text).width + 22
  x = Math.min(x, cw - w - 14)
  c.fillStyle = 'rgba(0,0,0,0.7)'; c.beginPath(); rrect(c, x, y - 11, w, 22, 6); c.fill()
  c.fillStyle = color; c.beginPath(); c.moveTo(x + 9, y - 6); c.lineTo(x + 14, y + 5); c.lineTo(x + 4, y + 5); c.closePath(); c.fill()
  c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(text, x + 17, y)
}

function windLabel(c, x, y, text) {
  c.font = '900 15px system-ui, sans-serif'
  const w = c.measureText(text).width + 40
  c.fillStyle = 'rgba(20,24,30,0.88)'; c.beginPath(); rrect(c, x - w / 2, y - 15, w, 30, 15); c.fill()
  c.strokeStyle = '#ffd84a'; c.lineWidth = 2.5; c.lineCap = 'round'
  const lx = x - w / 2 + 10
  c.beginPath(); c.moveTo(lx, y - 4); c.lineTo(lx + 12, y - 4); c.quadraticCurveTo(lx + 18, y - 4, lx + 17, y - 9); c.moveTo(lx, y + 4); c.lineTo(lx + 16, y + 4); c.stroke()
  c.lineCap = 'butt'
  c.fillStyle = '#ffe680'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x + 10, y + 1)
}

function bigText(now) {
  const el = $('#g-big')
  let text = ''
  if (W.ph === 0) text = String(Math.max(1, Math.ceil(W.tm / 10)))
  else if (W.ph === 1 && now - W.goSeenAt < 900) text = 'わたれ！'
  else if (W.ph === 2) text = '橋が落ちた！'
  el.hidden = !text
  if (el.textContent !== text) el.textContent = text
  el.dataset.k = W.ph === 2 ? 'ng' : ''
}

function statusLine(myLoad, myL, meP) {
  const st = W.me >= 0 ? W.st[W.me] : ST.gone
  const gust = W.w
  const mySpan = meP && meP[1] >= 0 && meP[1] < W.rows ? Math.floor(meP[1] / W.span) : -1
  if (W.ph === 0) return status('ドラッグで移動。「走る」は速いが板が傷む', 'info')
  if (W.ph === 2) return status('1段まるごと抜けて橋が落ちた', 'ng')
  if (st === ST.fall) return status('落ちた！ スタートに戻ります', 'ng')
  if (st === ST.done) return status(W.g >= W.need ? 'ゴール！ チーム目標達成' : `ゴール！ あと${W.need - W.g}人でチーム成功`, 'ok')
  if (gust && gust[0] === mySpan) return status(gust[1] === 1 ? '突風が来る。止まって待つ' : '突風中。動くと板が割れる', 'warn')
  if (myLoad > 1) return status('重すぎる！ 板が割れる。離れて', 'ng')
  if (myL <= 3) return status('この板は割れかけ', 'warn')
  if (myLoad >= 0.7) return status('人が多い。散らばろう', 'warn')
  if (input.run) return status('走ると速いが、板が傷む', 'info')
  return status('同じ板に集まらない。時間内に向こう岸へ', 'info')
}

// ---------- 結果
export function renderResult(state) {
  const r = state.result
  sfx.bgm(false)
  if (renderResult.round !== state.round) { renderResult.round = state.round; r.win ? sfx.win() : sfx.lose() }
  const wrap = document.createElement('div')
  wrap.className = 'res'
  const me = r.ranking.find(x => x.id === state.you)
  wrap.innerHTML = `
    <div class="res-stamp" data-win="${r.win ? 1 : 0}">
      ${r.win ? '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="4"/><path d="M14 25l7 7 14-15" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 26h13l3-5 4 8 3-4h17" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 26v12M39 26v12" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>'}
      <div><b>ゴール ${r.goals} / ${r.n}人</b><span>目標 ${r.need}人${r.win ? ' 達成' : ' に届かず'}</span></div>
    </div>
    <div class="res-stats"><span>落ちた回数 <b>${r.falls}</b></span><span>割れた板 <b>${r.broken}</b></span></div>
    <div class="res-awards"></div>
    <ol class="res-rank"></ol>`
  const aw = wrap.querySelector('.res-awards')
  for (const x of r.awards) { const s = document.createElement('span'); s.className = 'award'; s.dataset.k = x.key; s.append(x.label + ' '); const b = document.createElement('b'); b.textContent = x.name; s.append(b); aw.append(s) }
  if (!r.awards.length) aw.remove()
  const ol = wrap.querySelector('.res-rank')
  // 背の低い画面は順位を少なく（行の途中で切れないように）
  const short = innerHeight < 560 && innerWidth > innerHeight
  const lim = short || innerHeight < 700 ? 4 : r.ranking.length > 8 ? 6 : 8
  const top = r.ranking.slice(0, lim)
  if (me && me.rank > lim) top.push(me)
  for (const p of top) {
    const li = document.createElement('li')
    if (p.id === state.you) li.className = 'me'
    const rank = document.createElement('span'); rank.className = 'rk'; rank.textContent = p.rank
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.id === state.you ? '（あなた）' : '')
    const v = document.createElement('span'); v.className = 'v'; v.textContent = p.done ? `${p.time.toFixed(1)}秒` : `${p.prog}%地点`
    const f = document.createElement('span'); f.className = 'f'; f.textContent = p.falls ? `落${p.falls}` : ''
    li.append(rank, nm, v, f)
    ol.append(li)
  }
  if (r.ranking.length > top.length) { const li = document.createElement('li'); li.className = 'more'; li.textContent = `ほか ${r.ranking.length - top.length}人`; ol.append(li) }
  return wrap
}
