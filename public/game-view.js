// 橋を渡れ！ のゲーム画面。サーバーから届いた状態を描くだけ。動きの入力はサーバーに送り、判定は全部サーバー。
// render(state) は全体の状態が届いたとき、frame(msg) はゲーム中の差分（10回/秒）が届いたときに呼ばれる。
// 描画は 3D（view3d.js）。WebGL が使えない端末は 2D（draw2d.js）に戻す（?2d を付けると 2D で確かめられる）。
import * as sfx from './sound.js'
import { layout, logsFor, logX, FLAG, CALLS, PLAYER_COLORS, THEMES, COURSES } from './courses.js'
import { ICON, TITLE_ICON, TITLE_LABEL } from './icons.js'
import { record, loadCareer, careerTitle } from './records.js'
import { draw2d } from './draw2d.js'

const $ = s => document.querySelector(s)
export const ST = { idle: 0, walk: 1, run: 2, fall: 3, done: 4, gone: 5, hit: 6 }
const FRAME_MS = 100
const LV = '0123456789a'
const CALL_ICON = [ICON.wait, ICON.go, ICON.warn]

let W = null       // 画面側の世界（届いた状態の写し）
let ui = null      // 画面の部品
let send = () => {}
let raf = 0
const input = { dx: 0, dy: 0, run: false, keyRun: false, sentAt: 0, last: '', keys: new Set(), stick: null, auto: null }
let create3D = null // view3d.js は読み込みに失敗しても 2D で遊べるように、関数の中で読む
const want3d = !new URLSearchParams(location.search).has('2d')
const load3d = want3d ? import('./view3d.js').then(m => { create3D = m.createView3D }).catch(e => { console.warn('3D を読めないので 2D で描く', e) }) : Promise.resolve()

// ---------- 届いた状態を写す
function reset(g, state) {
  const n = g.roster.length
  const L = layout(g.course)
  W = {
    round: state.round, course: g.course, L, cols: g.cols, rows: g.rows, span: g.span, cap: g.cap, spanCap: g.spanCap, runWeight: g.runWeight, iceGrip: g.iceGrip || 1.6,
    limit: g.limit, roster: g.roster, me: g.roster.findIndex(r => r[0] === state.you),
    px: new Float32Array(n), py: new Float32Array(n), ox: new Float32Array(n), oy: new Float32Array(n), face: new Float32Array(n),
    st: new Uint8Array(n), stAt: new Float64Array(n), why: new Uint8Array(n),
    k: new Uint8Array(g.k.length), f: Uint8Array.from(g.f, ch => Number(ch)), coins: [], rocks: [], logs: g.logs ? logsFor(g.course, g.cols).filter(l => l.row < g.rows) : [],
    frameAt: performance.now(), ck: 0, ckAt: performance.now(), calls: new Map(), ph: -1, tm: 0, g: 0, n: 0, need: 0, w: null, cr: -1,
    mx: null, my: null, mvx: 0, mvy: 0, goalAt: null, tmSeen: -1, collapseAt: 0, goSeenAt: 0, creakAt: 0, cp: -1, myCoins: 0, fresh: true,
    events: []
  }
  for (let j = 0; j < g.coins.length; j += 3) W.coins.push({ x: g.coins[j] / 10, y: g.coins[j + 1] / 10, owner: g.coins[j + 2], at: 0 })
  input.dx = 0; input.dy = 0; input.run = false; input.keyRun = false; input.last = ''; input.stick = null; input.keys.clear(); input.auto = null
}

function applyFull(g, state) {
  const fresh = !W || W.round !== state.round || W.roster.length !== g.roster.length
  if (fresh) reset(g, state)
  W.roster = g.roster
  setPlayers(g.p, false)
  for (let i = 0; i < g.k.length; i++) setPlank(i, LV.indexOf(g.k[i]))
  for (let j = 0; j < W.coins.length; j++) W.coins[j].owner = g.coins[j * 3 + 2]
  common(g)
  W.fresh = false
  return fresh
}

export function frame(f) {
  if (!W) return
  setPlayers(f.p, true)
  for (let i = 0; i < f.k.length; i += 2) setPlank(f.k[i], f.k[i + 1])
  if (f.co) for (let i = 0; i < f.co.length; i += 2) takeCoin(f.co[i], f.co[i + 1])
  common(f)
}

function common(f) {
  W.tm = f.tm; W.g = f.g; W.n = f.n; W.need = f.need; W.w = f.w || null
  if (f.ck != null && f.ck !== W.ck) { W.ck = f.ck; W.ckAt = performance.now() }
  const rk = f.r || []
  const nr = []
  for (let i = 0; i < rk.length; i += 4) nr.push({ x: rk[i] / 10, y: rk[i + 1] / 10, ph: rk[i + 2], left: rk[i + 3] / 10 })
  for (const r of nr) if (r.ph === 2 && !W.rocks.some(o => o.ph === 2 && Math.abs(o.x - r.x) < 0.05 && Math.abs(o.y - r.y) < 0.05)) { W.events.push({ k: 'rock', x: r.x, y: r.y }); if (nearMe(r.y, 7)) sfx.thud() }
  for (const r of nr) if (r.ph === 1 && !W.rocks.some(o => Math.abs(o.x - r.x) < 0.05 && Math.abs(o.y - r.y) < 0.05) && nearMe(r.y, 8)) sfx.rockWarn()
  W.rocks = nr
  if (f.cr != null) W.cr = f.cr
  if (f.ph !== W.ph) onPhase(f.ph)
  W.ph = f.ph
  const before = W.calls.size
  W.calls.clear()
  for (let i = 0; i < f.c.length; i += 2) W.calls.set(f.c[i], f.c[i + 1])
  if (W.calls.size > before) sfx.call()
  W.frameAt = performance.now()
  if (W.ph === 0 && Math.ceil(W.tm / 10) !== W.tmSeen) { W.tmSeen = Math.ceil(W.tm / 10); sfx.count() }
  if (W.w && W.w[1] === 1 && W.gustSeen !== W.w[0] + ':' + W.round + ':' + W.tm) { if (!W.gustOn) sfx.gustWarn(); W.gustOn = true } else if (!W.w) W.gustOn = false
  if (W.w && W.w[1] === 2 && !W.blowing) { W.blowing = true; sfx.gust() } else if (!W.w || W.w[1] !== 2) W.blowing = false
  hud()
}

const nearMe = (y, d) => W.me < 0 || Math.abs(y - W.py[W.me]) < d

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
    const jump = W.fresh || Math.abs(y - W.py[i]) > 2.5 || (prev === ST.fall && st !== ST.fall) // 戻されたときは線を引かずに飛ぶ
    W.px[i] = x; W.py[i] = y
    if (jump) { W.ox[i] = x; W.oy[i] = y }
    if (st !== prev) {
      W.stAt[i] = now
      if (!W.fresh) onState(i, prev, st, x, y)
    }
    if (i === W.me && (jump || st === ST.fall || st === ST.hit)) { W.mx = null; W.my = null; W.mvx = 0; W.mvy = 0 }
    W.st[i] = st
  }
}

function onState(i, prev, st, x, y) {
  const me = i === W.me
  if (st === ST.fall) {
    const why = W.cr >= 0 ? 3 : prev === ST.hit && (x <= 0.2 || x >= W.cols - 0.2) ? 2 : 1
    W.why[i] = why
    W.events.push({ k: 'fall', i, x, y, why })
    if (me) { sfx.scream(); setTimeout(() => sfx.splash(THEMES[themeAt(y)].belowKind), 750) } else if (nearMe(y, 6)) sfx.splashFar()
    if (me || nearMe(y, 4)) floater(i, why === 2 ? '場外！' : 'ドボン！', '#9fe3ff')
  }
  if (st === ST.hit) {
    W.events.push({ k: 'hit', i, x, y })
    const rocky = W.rocks.some(r => Math.hypot(r.x - x, r.y - y) < 1.4)
    if (me || nearMe(y, 5)) { sfx.whack(); floater(i, rocky ? 'ぺしゃんこ！' : 'ふっとび！', '#ffd23f') }
  }
  if (st === ST.done && me) { W.goalAt = performance.now(); sfx.goal(); floater(i, 'ゴール！', '#8dffb8') }
  else if (st === ST.done && nearMe(y, 5)) sfx.goalFar()
  if (me && prev === ST.fall && st !== ST.fall && y >= 0) floater(i, 'やぐらから再開', '#fff')
}

function setPlank(i, l) {
  if (!W.fresh && W.k[i] > 0 && l === 0) {
    const y = Math.floor(i / W.cols)
    if (nearMe(y, 8)) sfx.crack()
    W.events.push({ k: 'plank', i })
  }
  W.k[i] = l
}

function takeCoin(j, owner) {
  const o = W.coins[j]
  if (!o || o.owner >= 0) return
  o.owner = owner; o.at = performance.now()
  W.events.push({ k: 'coin', j, owner })
  if (owner === W.me) { W.myCoins++; sfx.coin(); floater(owner, '+1 お守り', '#ffd23f') }
}

function onPhase(ph) {
  const th = W.L.course.sections[0].th
  if (ph === 1) { W.goSeenAt = performance.now(); if (!W.fresh) sfx.go(); sfx.bgm(true, th) }
  if (ph === 2) { W.collapseAt = performance.now(); sfx.collapse(); sfx.bgm(false) }
}

const themeAt = y => { const s = W.L.sections[Math.max(0, Math.min(W.L.sections.length - 1, Math.floor(Math.max(0, y) / W.span)))]; return s ? s.th : 'forest' }
export const playT = () => (W ? W.ck / 10 + (W.ph === 1 ? Math.min(0.3, (performance.now() - W.ckAt) / 1000) : 0) : 0)

// ---------- 画面を組む
function build() {
  const root = $('#stage')
  root.innerHTML = `
    <div class="play" id="g-wrap">
      <canvas id="g-cv"></canvas>
      <div class="labels" id="g-labels" aria-hidden="true"></div>
      <div class="hud-top">
        <div class="chip" id="g-time" aria-label="残り時間">${ICON.clock}<b>--</b></div>
        <div class="chip" id="g-goal" aria-label="ゴールした人数">${ICON.flag}<b>0/0</b><small></small></div>
        <div class="chip coin" id="g-coin" aria-label="お守り">${ICON.coin}<b>0</b></div>
      </div>
      <div class="side-btns">
        <button class="icon-btn" id="g-mute" aria-label="音"></button>
        <button class="icon-btn" id="g-zoom" aria-label="カメラを引く" aria-pressed="false">${ICON.zoom}</button>
      </div>
      <div class="route" aria-hidden="true"><canvas id="g-route"></canvas></div>
      <div class="status" id="g-status"><i></i><span></span></div>
      <div class="big" id="g-big" hidden><span></span></div>
      <div class="pad-hint" id="g-hint">${ICON.drag}</div>
      <div class="pad" id="g-pad"><div class="knob" id="g-knob"></div></div>
      <div class="ctrl">
        <div class="calls" role="group" aria-label="合図">${CALLS.map((t, k) => `<button type="button" class="call" data-k="${k}" aria-label="${t}">${CALL_ICON[k]}<span>${t}</span></button>`).join('')}</div>
        <button type="button" id="g-run" class="run" aria-label="走る（押すと切り替え）" aria-pressed="false">${ICON.run}<span>走る</span></button>
      </div>
    </div>`
  ui = { cv: $('#g-cv'), labels: $('#g-labels'), tags: [], bubbles: [], stags: [], v3: null, ctx: null, mode: null, routeAt: 0 }
  const wrap = $('#g-wrap')
  // 画面のどこでも指を置いた所がスティックの中心になる（ボタンの上は除く）
  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('button, .ctrl, .hud-top')) return
    e.preventDefault(); sfx.unlock()
    try { wrap.setPointerCapture(e.pointerId) } catch {}
    const r = wrap.getBoundingClientRect()
    input.stick = { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX - r.left, cy: e.clientY - r.top }
    const pad = $('#g-pad'); pad.style.left = input.stick.x + 'px'; pad.style.top = input.stick.y + 'px'; pad.classList.add('on')
    $('#g-knob').style.transform = ''
    $('#g-hint').hidden = true
  })
  wrap.addEventListener('pointermove', e => {
    const s = input.stick
    if (!s || s.id !== e.pointerId) return
    const r = wrap.getBoundingClientRect()
    s.cx = e.clientX - r.left; s.cy = e.clientY - r.top
    stickToInput()
  })
  const end = e => { if (input.stick && input.stick.id === e.pointerId) { input.stick = null; input.dx = 0; input.dy = 0; $('#g-pad').classList.remove('on'); pushInput(true) } }
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end)
  wrap.addEventListener('contextmenu', e => e.preventDefault())
  // 走るは切り替え式（1回押すと入りっぱなし、もう1回で切れる）
  const run = $('#g-run')
  run.addEventListener('pointerdown', e => { e.preventDefault(); sfx.unlock(); setRun(!input.run) })
  run.addEventListener('click', e => { if (e.detail === 0) setRun(!input.run) }) // キーボードで押したとき
  for (const b of root.querySelectorAll('.call')) b.addEventListener('pointerdown', e => { e.preventDefault(); sfx.unlock(); send({ type: 'call', k: Number(b.dataset.k) }) })
  $('#g-mute').addEventListener('click', () => { sfx.unlock(); sfx.setMuted(!sfx.muted()); muteIcon() })
  $('#g-zoom').addEventListener('click', () => { const far = ui.v3 ? ui.v3.toggleZoom() : false; $('#g-zoom').setAttribute('aria-pressed', far ? 'true' : 'false') })
  muteIcon()
  if (!build.keys) {
    build.keys = true
    addEventListener('keydown', e => key(e, true)); addEventListener('keyup', e => key(e, false))
    addEventListener('blur', () => { input.keys.clear(); if (input.keyRun) { input.keyRun = false; setRun(false) } keysToInput() })
  }
}

// 3D か 2D の描き手を、その回の橋で作り直す
function setupRenderer() {
  if (ui.v3) { ui.v3.dispose(); ui.v3 = null }
  // canvas は一度 webgl を取ると 2d を取れないので作り直す
  const old = ui.cv, cv = document.createElement('canvas'); cv.id = 'g-cv'; old.replaceWith(cv); ui.cv = cv
  ui.ctx = null
  if (create3D) { try { ui.v3 = create3D(cv, W) } catch (e) { console.warn('3D を使えないので 2D で描く', e); ui.v3 = null } }
  if (!ui.v3) { const c2 = document.createElement('canvas'); c2.id = 'g-cv'; cv.replaceWith(c2); ui.cv = c2; ui.ctx = c2.getContext('2d') }
  ui.mode = ui.v3 ? '3d' : '2d'
  $('#g-wrap').dataset.mode = ui.mode
  $('#g-zoom').hidden = !ui.v3
}

function setRun(v) {
  input.run = v
  const b = $('#g-run'); if (b) { b.classList.toggle('on', v); b.setAttribute('aria-pressed', v ? 'true' : 'false') }
  pushInput(true)
}

function muteIcon() {
  const m = sfx.muted()
  $('#g-mute').innerHTML = m ? ICON.mute : ICON.sound
  $('#g-mute').setAttribute('aria-label', m ? '音を出す' : '音を消す')
}

const KEYMAP = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' }
function key(e, down) {
  if (document.body.dataset.screen !== 'game' || !ui) return
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') {
    e.preventDefault()
    if (e.repeat) return
    // PC の定番どおり Shift は押している間だけ走る
    input.keyRun = down; setRun(down); return
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
  if ($('#g-hint') && (input.dx || input.dy)) $('#g-hint').hidden = true
  pushInput(true)
}
function stickToInput() {
  const s = input.stick
  let vx = s.cx - s.x, vy = s.cy - s.y
  const m = Math.hypot(vx, vy)
  const R = 50
  if (m < 8) { vx = 0; vy = 0 } else { const r = Math.min(1, m / R) / m; vx *= r; vy *= r }
  $('#g-knob').style.transform = `translate(${vx * 36}px, ${vy * 36}px)`
  input.dx = vx; input.dy = -vy
  pushInput(false)
}
// 同じ内容は送らない。変化は最大 15回/秒（サーバーの上限は 40回/秒）
function pushInput(force) {
  const q = v => Math.round(v * 20) / 20
  const dx = input.auto ? input.auto[0] : input.dx, dy = input.auto ? input.auto[1] : input.dy
  const msg = { type: 'move', dx: q(dx), dy: q(dy), run: input.run }
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
  if (!ui) return
  const t = Math.ceil(W.tm / 10)
  const tEl = $('#g-time')
  tEl.querySelector('b').textContent = W.ph === 0 ? '--' : String(t)
  tEl.classList.toggle('warn', W.ph === 1 && t <= 10)
  $('#g-goal b').textContent = `${W.g}/${W.n}`
  $('#g-goal small').textContent = `目標${W.need}`
  $('#g-goal').classList.toggle('ok', W.g >= W.need)
  $('#g-coin b').textContent = String(W.myCoins)
  if (W.ph === 1 && t <= 10 && t !== hud.lastT) { hud.lastT = t; sfx.tickLow() }
}

function status(text, kind) {
  const el = $('#g-status')
  if (el.dataset.k === kind && el.lastChild.textContent === text) return
  el.dataset.k = kind
  el.lastChild.textContent = text
}

function floater(i, text, color) {
  if (!ui) return
  const el = document.createElement('div')
  el.className = 'floater'; el.textContent = text; el.style.color = color
  el.dataset.i = i; el.dataset.at = performance.now()
  ui.labels.append(el)
  setTimeout(() => el.remove(), 1150)
}

// ---------- 描く
export function render(state, ctx) {
  send = ctx.send
  if (!ui || !$('#g-cv')) build()
  const fresh = applyFull(state.game, state)
  const go = () => { if (fresh || !ui.mode) setupRenderer(); if (!raf) raf = requestAnimationFrame(loop) }
  if (want3d && !create3D) load3d.then(() => { if (W && W.round === state.round && ui) go() })
  else go()
  window.__bc = { // e2e と検証用の読み取り口
    W: () => W, mode: () => ui && ui.mode, push: (x, y) => { input.auto = x == null ? null : [x, y]; pushInput(true) }, run: v => setRun(v),
    variance: () => (ui && ui.v3 ? ui.v3.variance() : ui && ui.ctx ? var2d() : 0), fps: () => (ui && ui.v3 ? ui.v3.fps() : fpsNow()), tier: () => (ui && ui.v3 ? ui.v3.tier : null),
    me: () => (W && W.me >= 0 ? { x: W.px[W.me], y: W.py[W.me], st: W.st[W.me] } : null), T: () => playT()
  }
}

function var2d() {
  const c = ui.cv; const d = ui.ctx.getImageData(0, 0, c.width, c.height).data
  let s = 0, s2 = 0, n = 0
  for (let i = 0; i < d.length; i += 400) { const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; s += v; s2 += v * v; n++ }
  return s2 / n - (s / n) ** 2
}
const fpsLog = []
const fpsNow = () => (fpsLog.length ? fpsLog.length / fpsLog.reduce((a, b) => a + b, 0) : 0)

let lastT = 0
function loop(t) {
  raf = 0
  if (document.body.dataset.screen !== 'game' || !ui || !$('#g-cv')) { sfx.bgm(false); lastT = 0; return }
  const now = performance.now()
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0)
  lastT = now
  fpsLog.push(dt || 0.016); if (fpsLog.length > 90) fpsLog.shift()
  try { draw(now, dt) } catch (e) { console.error(e) }
  raf = requestAnimationFrame(loop)
}

export function lerpPos(i, a) { return [W.ox[i] + (W.px[i] - W.ox[i]) * a, W.oy[i] + (W.py[i] - W.oy[i]) * a] }

// 自分だけは押した瞬間に動いて見せる（サーバーの位置へ少しずつ寄せる）。凍った板ではサーバーと同じようにすべらせる
function predictMe(dt, a) {
  const i = W.me
  if (i < 0) return null
  const [sx, sy] = lerpPos(i, a)
  const st = W.st[i]
  if (W.ph !== 1 || st === ST.fall || st === ST.gone || st === ST.hit) { W.mx = sx; W.my = sy; return [sx, sy] }
  if (W.mx == null) { W.mx = sx; W.my = sy }
  const dx = input.auto ? input.auto[0] : input.dx, dy = input.auto ? input.auto[1] : input.dy
  const m = Math.hypot(dx, dy)
  const sp = m < 0.05 ? 0 : (input.run ? 3.6 : 2.0) * Math.min(1, m) / m
  const tx = dx * sp, ty = dy * sp
  const k = W.my >= 0 && W.my < W.rows ? Math.floor(W.my) * W.cols + Math.min(W.cols - 1, Math.max(0, Math.floor(W.mx))) : -1
  if (st !== ST.done && k >= 0 && W.k[k] > 0 && (W.f[k] & FLAG.ice)) { const c = Math.min(1, W.iceGrip * dt); W.mvx += (tx - W.mvx) * c; W.mvy += (ty - W.mvy) * c }
  else { W.mvx = tx; W.mvy = ty }
  if (Math.hypot(W.mvx, W.mvy) >= 0.05) {
    W.mx = Math.min(W.cols - 0.25, Math.max(0.25, W.mx + W.mvx * dt))
    W.my = Math.min(W.rows + 3, Math.max(st === ST.done ? W.rows + 0.3 : -3, W.my + W.mvy * dt))
  }
  const ex = sx - W.mx, ey = sy - W.my
  if (Math.hypot(ex, ey) > 1.5) { W.mx = sx; W.my = sy }
  else { const c = Math.min(1, dt * (m > 0.05 ? 1.2 : 6)); W.mx += ex * c; W.my += ey * c }
  return [W.mx, W.my]
}

function draw(now, dt) {
  const wrap = $('#g-wrap')
  const cw = wrap.clientWidth, ch = wrap.clientHeight
  if (!cw || !ch) return
  const a = Math.min(1, (now - W.frameAt) / FRAME_MS)
  const meP = predictMe(dt, a)
  const pos = i => (i === W.me && meP ? meP : lerpPos(i, a))
  // 向き（動いている向きへゆっくり回す）
  for (let i = 0; i < W.px.length; i++) {
    const vx = W.px[i] - W.ox[i], vy = W.py[i] - W.oy[i]
    if (Math.hypot(vx, vy) > 0.02) { const tgt = Math.atan2(vx, vy); let d = tgt - W.face[i]; d = Math.atan2(Math.sin(d), Math.cos(d)); W.face[i] += d * Math.min(1, dt * 10) }
  }
  if (W.me >= 0 && (input.dx || input.dy || input.auto) && W.st[W.me] !== ST.hit) {
    const dx = input.auto ? input.auto[0] : input.dx, dy = input.auto ? input.auto[1] : input.dy
    if (Math.hypot(dx, dy) > 0.1) { const tgt = Math.atan2(dx, dy); let d = tgt - W.face[W.me]; d = Math.atan2(Math.sin(d), Math.cos(d)); W.face[W.me] += d * Math.min(1, dt * 12) }
  }
  // 板ごとの重さ（届いた位置から画面側で数える。判定はサーバー）
  const load = new Float32Array(W.cols * W.rows)
  const spanLoad = new Float32Array(Math.ceil(W.rows / W.span))
  const gust = W.w
  for (let i = 0; i < W.st.length; i++) {
    const st = W.st[i]
    if (st === ST.fall || st === ST.done || st === ST.gone) continue
    const y = W.py[i], x = W.px[i]
    if (y < 0 || y >= W.rows) continue
    const k = Math.floor(y) * W.cols + Math.min(W.cols - 1, Math.floor(x))
    if (W.f[k] & FLAG.deck) continue
    const s = Math.floor(Math.floor(y) / W.span)
    let w = st === ST.run ? W.runWeight : 1
    if (gust && gust[1] === 2 && gust[0] === s && (st === ST.walk || st === ST.run)) w *= 3
    load[k] += w
    spanLoad[s] += w
  }
  const T = playT()
  const scene = { now, dt, a, meP, pos, load, spanLoad, T, input, cw, ch }
  let labels = null
  if (ui.v3) { ui.v3.setSize(cw, ch); labels = ui.v3.frame(scene) }
  else {
    const dpr = Math.min(2, devicePixelRatio || 1)
    if (ui.cv.width !== Math.round(cw * dpr) || ui.cv.height !== Math.round(ch * dpr)) { ui.cv.width = Math.round(cw * dpr); ui.cv.height = Math.round(ch * dpr) }
    ui.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    labels = draw2d(ui.ctx, W, scene)
  }
  W.events.length = 0
  placeLabels(labels, meP, now)
  if (now - ui.routeAt > 90) { ui.routeAt = now; drawRoute(meP) }
  // 自分の板の様子（音と文字）
  let myLoad = 0, myK = -1
  if (meP && W.me >= 0) {
    const st = W.st[W.me]
    if (meP[1] >= 0 && meP[1] < W.rows && st !== ST.fall && st !== ST.done) {
      myK = Math.floor(meP[1]) * W.cols + Math.min(W.cols - 1, Math.floor(meP[0]))
      myLoad = load[myK] / W.cap
    }
    if (myLoad > 1 && now - W.creakAt > 450) { W.creakAt = now; sfx.creak() }
  }
  bigText(now)
  statusLine(myLoad, myK, meP, T)
}

// 名前の札・合図の吹き出し・浮かぶ文字を、頭の上に置く
function placeLabels(L, meP, now) {
  if (!L) return
  const { heads } = L // [{i, x, y, vis}]
  const want = heads.filter(h => h.vis)
  // 自分と、近い順に12人まで名前を出す
  const near = want.filter(h => h.i !== W.me).sort((A, B) => A.d - B.d).slice(0, 10)
  const meH = want.find(h => h.i === W.me)
  const show = meH ? [meH, ...near] : near
  while (ui.tags.length < show.length) { const t = document.createElement('div'); t.className = 'tag'; ui.labels.append(t); ui.tags.push(t) }
  ui.tags.forEach((t, j) => {
    const h = show[j]
    if (!h || W.calls.has(h.i)) { t.hidden = true; return }
    t.hidden = false
    const me = h.i === W.me
    const text = me ? 'あなた' : W.roster[h.i][1]
    if (t.textContent !== text) t.textContent = text
    t.classList.toggle('me', me)
    t.style.setProperty('--c', PLAYER_COLORS[h.i % PLAYER_COLORS.length])
    t.style.transform = `translate(${h.x}px, ${h.y}px) translate(-50%, -100%)`
  })
  const calls = [...W.calls.entries()].map(([i, k]) => ({ k, h: heads.find(h => h.i === i) })).filter(c => c.h && c.h.vis).sort((A, B) => A.h.d - B.h.d).slice(0, 10)
  while (ui.bubbles.length < calls.length) { const b = document.createElement('div'); b.className = 'bubble'; ui.labels.append(b); ui.bubbles.push(b) }
  ui.bubbles.forEach((b, j) => {
    const c = calls[j]
    if (!c) { b.hidden = true; return }
    b.hidden = false
    b.dataset.k = c.k
    if (b.textContent !== CALLS[c.k]) b.textContent = CALLS[c.k]
    b.style.transform = `translate(${c.h.x}px, ${c.h.y - 4}px) translate(-50%, -100%)`
  })
  // 区間の札（3D のときだけ。2D はキャンバスに描く）
  const tg = L.tags || []
  while (ui.stags.length < tg.length) { const b = document.createElement('div'); b.className = 'spantag'; ui.labels.append(b); ui.stags.push(b) }
  ui.stags.forEach((b, j) => {
    const g = tg[j]
    if (!g) { b.hidden = true; return }
    b.hidden = false
    if (b.textContent !== g.text) b.textContent = g.text
    b.classList.toggle('over', g.over)
    b.style.transform = `translate(${Math.min(ui.cv.clientWidth - 92, g.x)}px, ${g.y}px) translate(0, -50%)`
  })
  for (const f of ui.labels.querySelectorAll('.floater')) {
    const h = heads.find(q => q.i === Number(f.dataset.i))
    if (h) f.style.left = h.x + 'px', f.style.top = (h.y - 24) + 'px'
  }
}

// 橋の進み具合（横の帯）。区間の色・やぐら・みんなの位置・自分
function drawRoute(meP) {
  const c = $('#g-route'); if (!c) return
  const w = c.clientWidth, h = c.clientHeight
  if (!w) return
  const dpr = Math.min(2, devicePixelRatio || 1)
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
  const x0 = 8, x1 = w - 18, yb = h / 2
  const X = y => x0 + Math.max(0, Math.min(1, y / W.rows)) * (x1 - x0)
  g.fillStyle = 'rgba(22,16,12,.72)'; g.beginPath(); g.roundRect(0, yb - 7, w, 14, 7); g.fill()
  for (const s of W.L.sections) {
    if (s.row0 >= W.rows) continue
    g.fillStyle = s.heat ? '#d0603a' : s.ice ? '#9fd6f0' : s.rock ? '#a8553a' : s.log ? '#8a5629' : s.gust ? '#c9b48a' : '#c08a52'
    g.fillRect(X(s.row0) + 1, yb - 4, X(s.row0 + W.span) - X(s.row0) - 2, 8)
    if (s.deck) { g.fillStyle = '#e8eef2'; g.fillRect(X(s.row0) + 1, yb - 6, Math.max(3, X(s.row0 + 2) - X(s.row0)), 12) }
  }
  if (W.w) { const s = W.w[0]; g.strokeStyle = W.w[1] === 2 ? '#fff' : '#ffd23f'; g.lineWidth = 2; g.strokeRect(X(s * W.span), yb - 8, X((s + 1) * W.span) - X(s * W.span), 16) }
  for (let i = 0; i < W.st.length; i++) {
    if (W.st[i] === ST.gone || i === W.me) continue
    g.fillStyle = PLAYER_COLORS[i % PLAYER_COLORS.length]; g.globalAlpha = W.st[i] === ST.fall ? 0.35 : 1
    g.beginPath(); g.arc(X(W.py[i]), yb, 3, 0, 7); g.fill()
  }
  g.globalAlpha = 1
  // ゴールの旗
  g.fillStyle = '#3fe0a0'; g.fillRect(w - 13, 2, 2, h - 4); g.beginPath(); g.moveTo(w - 11, 3); g.lineTo(w - 2, 6); g.lineTo(w - 11, 10); g.fill()
  if (meP) { g.fillStyle = '#fff'; g.strokeStyle = '#2a170c'; g.lineWidth = 2; g.beginPath(); g.arc(X(meP[1]), yb, 6, 0, 7); g.fill(); g.stroke() }
}

function bigText(now) {
  const el = $('#g-big')
  let text = '', k = ''
  if (W.ph === 0) text = String(Math.max(1, Math.ceil(W.tm / 10)))
  else if (W.ph === 1 && now - W.goSeenAt < 900) { text = 'わたれ！'; k = 'go' }
  else if (W.ph === 2) { text = '橋が落ちた！'; k = 'ng' }
  else if (W.me >= 0 && W.st[W.me] === ST.fall && now - W.stAt[W.me] < 1600) { text = W.why[W.me] === 2 ? '場外！' : 'ドボン！'; k = 'sm' }
  else if (W.goalAt && now - W.goalAt < 1400) { text = 'ゴール！'; k = 'ok' }
  el.hidden = !text
  const sp = el.firstChild
  if (sp.textContent !== text) { sp.textContent = text; sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = '' }
  el.dataset.k = k
}

function statusLine(myLoad, myK, meP, T) {
  const st = W.me >= 0 ? W.st[W.me] : ST.gone
  const gust = W.w
  const my = meP ? meP[1] : -9
  const mySpan = my >= 0 && my < W.rows ? Math.floor(my / W.span) : -1
  if (W.ph === 0) return status('ドラッグで移動。走るは速いが板が傷む', 'info')
  if (W.ph === 2) return status('1段まるごと抜けて橋が落ちた', 'ng')
  if (st === ST.fall) return status(W.why[W.me] === 2 ? '飛ばされて谷へ！ すぐ戻れる' : '落ちた！ すぐ戻れる', 'ng')
  if (st === ST.hit) return status('ふらふら… 少し動けない', 'warn')
  if (st === ST.done) return status(W.g >= W.need ? 'ゴール！ チーム目標達成' : `ゴール！ あと${W.need - W.g}人でチーム成功`, 'ok')
  if (meP && W.rocks.some(r => r.ph === 1 && Math.hypot(r.x - meP[0], r.y - meP[1]) < 1.3)) return status('落石！ 影から逃げて', 'ng')
  if (gust && gust[0] === mySpan) return status(gust[1] === 1 ? '突風が来る。止まって待つ' : '突風中。動くと板が割れる', 'warn')
  if (meP) for (const L of W.logs) if (my > L.row - 2.2 && my < L.row + 1.2 && Math.abs(logX(L, T, W.cols) - meP[0]) < 2.4) return status('丸太が来る！ 通りすぎてから', 'warn')
  if (myLoad > 1) return status('重すぎる！ 板が割れる。離れて', 'ng')
  if (myK >= 0 && W.k[myK] <= 3) return status('この板は割れかけ', 'warn')
  if (myK >= 0 && W.f[myK] & FLAG.deck) return status('やぐら。ここは割れない。落ちてもここから', 'ok')
  if (myK >= 0 && W.f[myK] & FLAG.ice) return status('凍った板。すべって止まれない', 'warn')
  if (myK >= 0 && W.f[myK] & FLAG.heat) return status('燃えている板。早く渡る', 'warn')
  if (myLoad >= 0.7) return status('人が多い。散らばろう', 'warn')
  if (input.run) return status('走ると速いが、板が傷む', 'info')
  return status('同じ板に集まらない。時間内に向こう岸へ', 'info')
}

// ---------- 結果（豪華でコミカルに）
const STAR = on => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z" fill="${on ? '#ffd23f' : '#e6d6b8'}" stroke="#2a170c" stroke-width="1.6" stroke-linejoin="round"/></svg>`
export function renderResult(state) {
  const r = state.result
  sfx.bgm(false)
  const me = r.ranking.find(x => x.id === state.you)
  const rec = record(state.code + ':' + state.round, r, me)
  if (renderResult.round !== state.code + state.round) { renderResult.round = state.code + state.round; r.win ? sfx.win() : sfx.lose() }
  const kind = r.win ? 'win' : r.collapsed ? 'collapse' : 'time'
  const stampText = r.win ? '渡り<br>きった' : r.collapsed ? 'ぜんいん<br>ドボン' : '日が<br>暮れた'
  const wrap = document.createElement('div')
  wrap.className = 'res'
  const c = loadCareer(), ct = careerTitle(c)
  wrap.innerHTML = `<div class="res-l">
    <div class="res-hero">
      <div class="stamp" data-k="${kind}">${stampText}</div>
      <div class="res-hero-r">
        <div class="res-stars" aria-label="星${r.stars}">${STAR(r.stars >= 1)}${STAR(r.stars >= 2)}${STAR(r.stars >= 3)}</div>
        <p class="res-line"></p>
        <p class="res-sub"></p>
      </div>
    </div>
    <div class="res-stats">
      <div>ゴール<b>${r.goals}/${r.n}</b></div><div>落ちた<b>${r.falls}</b></div><div>割れた板<b>${r.broken}</b></div><div>お守り<b>${r.coins}/${r.coinsMax}</b></div>
    </div>
    <div class="res-me" hidden></div>
    <p class="res-career"></p></div>
    <div class="res-r"><div class="res-awards"></div>
    <ol class="res-rank"></ol></div>`
  if (r.win) { const cf = document.createElement('div'); cf.className = 'confetti'; cf.setAttribute('aria-hidden', 'true'); for (let k = 0; k < 26; k++) { const i = document.createElement('i'); i.style.left = (k * 37 % 100) + '%'; i.style.background = PLAYER_COLORS[k % PLAYER_COLORS.length]; i.style.animationDelay = (k % 9) * 0.17 + 's'; i.style.animationDuration = 1.8 + (k % 5) * 0.3 + 's'; cf.append(i) } wrap.append(cf) }
  wrap.querySelector('.res-line').textContent = `${r.courseName || ''}　${r.win ? `チーム ${r.teamTime != null ? r.teamTime.toFixed(1) + '秒' : ''}` : r.collapsed ? '1段まるごと抜けた' : `目標まであと${Math.max(0, r.need - r.goals)}人`}`
  if (rec.newBest) { const s = document.createElement('span'); s.className = 'new-rec'; s.textContent = '自己ベスト'; wrap.querySelector('.res-line').append(s) }
  wrap.querySelector('.res-sub').textContent = r.win ? (r.stars === 3 ? '落ちずに速く。完ぺき' : r.stars === 2 ? `あと少し速ければ星3（${r.par}秒以内）` : '落ちる人が多かった。次は散らばって') : r.collapsed ? '同じ段に人が集まりすぎた' : '慎重すぎた。走る所を決めよう'
  if (me) {
    const box = wrap.querySelector('.res-me'); box.hidden = false
    box.innerHTML = `<span class="rk">${me.rank}</span><span></span><span class="tt"></span>`
    box.children[1].textContent = `位 ${me.done ? me.time.toFixed(1) + '秒' : me.prog + '%地点'}${me.falls ? `・落${me.falls}` : ''}${me.coins ? `・お守り${me.coins}` : ''}`
    for (const t of me.titles) box.querySelector('.tt').append(titleChip(t))
  }
  const aw = wrap.querySelector('.res-awards')
  r.awards.forEach((x, n) => {
    const s = document.createElement('span'); s.className = 'award'; s.style.animationDelay = (0.3 + n * 0.12) + 's'
    s.innerHTML = ICON[TITLE_ICON[x.key]] || ''
    s.append(x.label + ' '); const b = document.createElement('b'); b.textContent = x.name; s.append(b); aw.append(s)
  })
  if (!r.awards.length) aw.remove()
  const ol = wrap.querySelector('.res-rank')
  // 背の低い画面は順位を少なく（行の途中で切れないように）
  const land = innerWidth > innerHeight && innerHeight < 560
  const lim = land ? (innerHeight < 360 ? 3 : 5) : innerHeight < 700 ? 3 : r.ranking.length > 8 ? 5 : 6
  const top = r.ranking.slice(0, lim)
  if (me && me.rank > lim) top.push(me)
  for (const p of top) {
    const li = document.createElement('li')
    if (p.id === state.you) li.className = 'me'
    const rank = document.createElement('span'); rank.className = 'rk'; rank.textContent = p.rank
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.id === state.you ? '（あなた）' : '')
    const v = document.createElement('span'); v.className = 'v'; v.textContent = p.done ? `${p.time.toFixed(1)}秒` : `${p.prog}%`
    const f = document.createElement('span'); f.className = 'f'
    if (p.titles[0]) f.append(titleChip(p.titles[0])); else f.textContent = p.falls ? `落${p.falls}` : ''
    li.append(rank, nm, v, f)
    ol.append(li)
  }
  if (r.ranking.length > top.length) { const li = document.createElement('li'); li.className = 'more'; li.textContent = `ほか ${r.ranking.length - top.length}人`; ol.append(li) }
  const car = wrap.querySelector('.res-career')
  car.innerHTML = '称号 <b></b>'
  car.querySelector('b').textContent = ct.name
  if (ct.next) car.append(`（あと${ct.next.need}回渡りきると「${ct.next.name}」）`)
  return wrap
}
function titleChip(key) {
  const s = document.createElement('span'); s.className = 'title-chip'
  s.innerHTML = ICON[TITLE_ICON[key]] || ''
  s.append(TITLE_LABEL[key] || key)
  return s
}
export { COURSES }
