// 2D の描き方（WebGL が使えない端末の保険）。真上から見た橋を、自分の少し先が見えるように描く。
// 名前の札と吹き出しは game-view.js が HTML で重ねるので、ここは頭の位置を返すだけ。
import { FLAG, PLAYER_COLORS, logX, LOG_HALF_W, LOG_HALF_D } from './courses.js'

const ST = { idle: 0, walk: 1, run: 2, fall: 3, done: 4, gone: 5, hit: 6 }
let camY = null

export function draw2d(c, W, { now, dt, meP, pos, load, spanLoad, T, input, cw, ch }) {
  const { cols, rows } = W
  const t = now
  const S = Math.min((cw - 28) / (cols + 0.8), 58, ch / 11)
  const viewH = ch / S
  const lo = -3.4 + viewH * 0.38, hi = rows + 3.4 - viewH * 0.62
  let target
  if (lo > hi) target = rows / 2 - viewH * 0.12
  else target = Math.min(hi, Math.max(lo, meP ? meP[1] : rows / 2))
  camY = camY == null || W.fresh ? target : camY + (target - camY) * Math.min(1, dt * 5)
  let shake = 0
  if (W.ph === 2) shake = Math.max(0, 1 - (now - W.collapseAt) / 1500) * 8
  const X0 = (cw - cols * S) / 2 - 4 + (shake ? (Math.random() - 0.5) * shake : 0)
  const sx = x => X0 + x * S
  const sy = y => ch * 0.6 - (y - camY) * S
  const yTop = camY + ch * 0.6 / S, yBot = camY - ch * 0.4 / S

  // 谷と川
  c.fillStyle = '#123a4a'; c.fillRect(0, 0, cw, ch)
  c.strokeStyle = 'rgba(160,230,240,0.14)'; c.lineWidth = 2
  for (let y = Math.floor(yBot); y < yTop + 1; y += 0.6) {
    const off = ((t / 1000) * 0.6 + y * 0.37) % 1
    c.beginPath()
    const xa = Math.floor(-X0 / S) - 2, xb = Math.ceil((cw - X0) / S) + 1
    for (let x = xa; x <= xb; x += 0.5) { const px = sx(x + off * 0.5), py = sy(y) + Math.sin(x * 2 + y * 3 + t / 600) * 2; x === xa ? c.moveTo(px, py) : c.lineTo(px, py) }
    c.stroke()
  }
  const cliff = (y0, y1, top, label) => {
    const ya = sy(y1), yb = sy(y0)
    if (yb < 0 || ya > ch) return
    c.fillStyle = top; c.fillRect(0, ya, cw, yb - ya)
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.font = `900 ${Math.max(13, Math.min(20, S * 0.45))}px "RocknRoll One", system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle'
    c.fillText(label, 10, Math.min(ch - 14, Math.max(14, (ya + yb) / 2)))
  }
  cliff(-4, 0, '#6a5640', 'スタート')
  cliff(rows, rows + 4, '#3f7a4a', 'ゴール')

  // 揺れ（重い区間と突風の区間）
  const gust = W.w
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
      const k = r * cols + col, l = W.k[k], f = W.f[k]
      const x = sx(col + 0.05 + sway[s]), y = sy(r + 0.92), w = S * 0.9, h = S * 0.84
      if (f & FLAG.deck) { c.fillStyle = '#9aa3aa'; c.fillRect(x - S * 0.05, y - S * 0.08, w + S * 0.1, h + S * 0.16); c.strokeStyle = '#5f676e'; c.lineWidth = 1; c.strokeRect(x, y, w, h); continue }
      if (l === 0) { c.fillStyle = '#5d4630'; c.fillRect(x, y, w * 0.18, h * 0.3); c.fillRect(x + w * 0.75, y + h * 0.65, w * 0.25, h * 0.35); continue }
      const ratio = load[k] / W.cap
      c.fillStyle = f & FLAG.ice ? (l >= 7 ? '#cfefff' : '#9fcfe6') : f & FLAG.heat ? `rgb(${190 + 40 * Math.sin(t / 200 + k)},${80},${40})` : l >= 7 ? '#c08a52' : l >= 4 ? '#a87444' : '#8a5a36'
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
  for (let s = 0; s < spanLoad.length; s++) {
    const yc = sy(s * W.span + W.span / 2)
    if (spanLoad[s] > W.spanCap * 0.85) tag(c, sx(cols) + 6, yc, spanLoad[s] > W.spanCap ? '重すぎ' : 'ゆれ', spanLoad[s] > W.spanCap ? '#ff5b5b' : '#ffc94a', cw)
  }
  // お守り
  for (const o of W.coins) {
    if (o.owner >= 0) continue
    const X = sx(o.x), Y = sy(o.y) + Math.sin(t / 300 + o.x) * 2
    c.fillStyle = '#ffd23f'; c.strokeStyle = '#2a170c'; c.lineWidth = 2
    c.beginPath(); c.moveTo(X - S * 0.18, Y - S * 0.22); c.lineTo(X + S * 0.18, Y - S * 0.22); c.lineTo(X + S * 0.18, Y + S * 0.1); c.lineTo(X, Y + S * 0.26); c.lineTo(X - S * 0.18, Y + S * 0.1); c.closePath(); c.fill(); c.stroke()
  }
  // 落石の影
  for (const r of W.rocks) {
    const X = sx(r.x), Y = sy(r.y)
    if (r.ph === 1) {
      const k = 1 - Math.max(0, r.left) / 1.3
      c.fillStyle = `rgba(0,0,0,${0.2 + k * 0.4})`; c.beginPath(); c.ellipse(X, Y, S * 0.85 * (0.5 + k * 0.5), S * 0.6 * (0.5 + k * 0.5), 0, 0, 7); c.fill()
      c.strokeStyle = '#ff5b3c'; c.lineWidth = 2; c.beginPath(); c.ellipse(X, Y, S * 0.85, S * 0.6, 0, 0, 7); c.stroke()
    } else { c.fillStyle = '#8a7a6a'; c.beginPath(); c.arc(X, Y, S * 0.45, 0, 7); c.fill(); c.strokeStyle = '#2a170c'; c.stroke() }
  }
  // 丸太
  for (const L of W.logs) {
    const lx = logX(L, T, cols)
    const X = sx(lx - LOG_HALF_W), Y = sy(L.row + 0.5 + LOG_HALF_D)
    c.fillStyle = '#7a4a24'; c.strokeStyle = '#2a170c'; c.lineWidth = 2
    c.beginPath(); c.roundRect(X, Y, LOG_HALF_W * 2 * S, LOG_HALF_D * 2 * S, S * 0.3); c.fill(); c.stroke()
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
      for (let i = 0; i < 9; i++) { const yy = ya + ((i * 37) % 100) / 100 * (yb - ya); const xx = ((t / 2.2 + i * 140) % (cw + 200)) - 100; c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + 60, yy); c.stroke() }
    }
  }
  // 人
  const r = Math.max(5, S * 0.3)
  const heads = []
  const me = W.me
  for (let i = 0; i < W.st.length; i++) {
    if (W.st[i] === ST.gone) continue
    const p = pos(i)
    if (i !== me) person(c, W, i, p, sx, sy, r, now, false)
    const X = sx(p[0]), Y = sy(p[1])
    heads.push({ i, x: X, y: Y - r - 4, vis: Y > -20 && Y < ch + 20 && W.st[i] !== ST.fall, d: meP ? Math.abs(p[1] - meP[1]) + Math.abs(p[0] - meP[0]) * 0.3 : 0 })
  }
  if (me >= 0 && W.st[me] !== ST.gone && meP) person(c, W, me, meP, sx, sy, r, now, true)
  return { heads }
}

function person(c, W, i, [x, y], sx, sy, r, now, me) {
  const st = W.st[i]
  const X = sx(x), Y = sy(y)
  const col = PLAYER_COLORS[i % PLAYER_COLORS.length]
  if (st === ST.fall) {
    const e = Math.min(1, (now - W.stAt[i]) / 900)
    c.strokeStyle = `rgba(200,240,255,${1 - e})`; c.lineWidth = 2
    c.beginPath(); c.arc(X, Y, r * (1 + e * 2.2), 0, 7); c.stroke()
    if (e < 1) { c.fillStyle = col; c.globalAlpha = 1 - e; c.beginPath(); c.arc(X, Y, r * (1 - e * 0.8), 0, 7); c.fill(); c.globalAlpha = 1 }
    return
  }
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(X, Y + r * 0.55, r * 0.9, r * 0.4, 0, 0, 7); c.fill()
  c.fillStyle = col; c.beginPath(); c.arc(X, Y, r, 0, 7); c.fill()
  c.strokeStyle = me ? '#ffffff' : 'rgba(0,0,0,0.45)'; c.lineWidth = me ? 3 : 1.2; c.stroke()
  if (st === ST.hit) { c.fillStyle = '#ffd23f'; for (let k = 0; k < 3; k++) { const a = now / 200 + k * 2.1; c.beginPath(); c.arc(X + Math.cos(a) * r * 1.2, Y - r + Math.sin(a) * r * 0.4, 3, 0, 7); c.fill() } }
}

function tag(c, x, y, text, color, cw) {
  c.font = '800 12px system-ui, sans-serif'
  const w = c.measureText(text).width + 22
  x = Math.min(x, cw - w - 14)
  c.fillStyle = 'rgba(0,0,0,0.7)'; c.beginPath(); c.roundRect(x, y - 11, w, 22, 6); c.fill()
  c.fillStyle = color; c.beginPath(); c.moveTo(x + 9, y - 6); c.lineTo(x + 14, y + 5); c.lineTo(x + 4, y + 5); c.closePath(); c.fill()
  c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(text, x + 17, y)
}
