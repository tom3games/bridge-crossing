// og.png（1200x630）を Canvas で描いて public/og.png に保存する。使い方: node tools/og.mjs
import { chromium } from 'playwright'
const html = `<!doctype html><html><body style="margin:0;background:#0f1d22"><canvas id="c" width="1200" height="630"></canvas><script>
const c = document.getElementById('c').getContext('2d')
const g = c.createLinearGradient(0, 0, 0, 630); g.addColorStop(0, '#16343b'); g.addColorStop(1, '#0b2128'); c.fillStyle = g; c.fillRect(0, 0, 1200, 630)
c.strokeStyle = 'rgba(140,220,230,0.12)'; c.lineWidth = 3
for (let y = 300; y < 630; y += 22) { c.beginPath(); for (let x = 0; x <= 1200; x += 20) { const yy = y + Math.sin(x / 60 + y) * 4; x ? c.lineTo(x, yy) : c.moveTo(x, yy) } c.stroke() }
// 崖
c.fillStyle = '#5a4a3a'; c.fillRect(0, 330, 110, 300); c.fillStyle = '#3f6b45'; c.fillRect(1090, 330, 110, 300)
// 橋（横向き、たわんだ吊り橋）
const sag = x => Math.sin((x - 110) / 980 * Math.PI) * 40
c.strokeStyle = '#c9a46a'; c.lineWidth = 6
for (const off of [360, 520]) { c.beginPath(); for (let x = 110; x <= 1090; x += 10) { const y = off + sag(x); x === 110 ? c.moveTo(x, y) : c.lineTo(x, y) } c.stroke() }
const holes = new Set([9, 10, 23, 31, 32]), cracked = new Set([4, 15, 18, 27, 36])
for (let i = 0; i < 40; i++) {
  const x = 116 + i * 24.4, y = 366 + sag(x + 10)
  for (let r = 0; r < 4; r++) {
    const k = i * 4 + r
    if (holes.has(i) && r % 2 === (i % 2)) continue
    c.fillStyle = cracked.has(i) ? '#9a6a3e' : '#c08a52'; c.fillRect(x, y + r * 37, 21, 33)
    if (cracked.has(i) && r === 1) { c.strokeStyle = '#3a2414'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 4, y + r * 37); c.lineTo(x + 12, y + r * 37 + 16); c.lineTo(x + 8, y + r * 37 + 33); c.stroke() }
  }
}
// 渡る人たち
const cols = ['#ff8a5b', '#5bc0ff', '#ffd25b', '#9b8cff', '#5bffb0', '#ff5b9e', '#c8ff5b', '#5bf0ff']
let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280
for (let i = 0; i < 46; i++) {
  const x = 60 + rnd() * 760 + (i < 6 ? 0 : 0), y = 380 + rnd() * 130 + sag(x)
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(x, y + 8, 13, 6, 0, 0, 7); c.fill()
  c.fillStyle = cols[i % cols.length]; c.beginPath(); c.arc(x, y, 12, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 2; c.stroke()
}
// 落ちた人の波紋
c.strokeStyle = 'rgba(200,240,255,0.7)'; c.lineWidth = 3; c.beginPath(); c.arc(353, 560, 26, 0, 7); c.stroke(); c.beginPath(); c.arc(353, 560, 44, 0, 7); c.stroke()
// 吹き出し
function bubble(x, y, t, bg) { c.font = '800 26px "Hiragino Maru Gothic ProN", sans-serif'; const w = c.measureText(t).width + 28; c.fillStyle = bg; c.strokeStyle = '#1b1b1b'; c.lineWidth = 3; c.beginPath(); c.roundRect(x - w / 2, y - 46, w, 40, 14); c.fill(); c.stroke(); c.beginPath(); c.moveTo(x - 8, y - 7); c.lineTo(x, y + 4); c.lineTo(x + 8, y - 7); c.fill(); c.fillStyle = '#1b1b1b'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, x, y - 26) }
bubble(520, 380, '待って！', '#ffe08a'); bubble(760, 410, '行け', '#a8f0c0')
// 題名
c.textAlign = 'left'; c.textBaseline = 'alphabetic'
c.font = '900 120px "Hiragino Maru Gothic ProN", sans-serif'; c.lineWidth = 14; c.lineJoin = 'round'; c.strokeStyle = '#0b1a1f'; c.strokeText('橋を渡れ！', 70, 170); c.fillStyle = '#f0a24a'; c.fillText('橋を渡れ！', 70, 170)
c.font = '800 40px "Hiragino Maru Gothic ProN", sans-serif'; c.fillStyle = '#f3efe6'; c.fillText('1〜100人で渡る、崩れる吊り橋', 76, 240)
c.font = '700 28px "Hiragino Maru Gothic ProN", sans-serif'; c.fillStyle = '#a4b5b5'; c.fillText('急ぐと割れる。慎重すぎると時間切れ。', 78, 290)
c.fillStyle = '#ffd257'; c.beginPath(); c.roundRect(880, 70, 250, 64, 32); c.fill(); c.fillStyle = '#1d1206'; c.font = '900 30px "Hiragino Maru Gothic ProN", sans-serif'; c.textAlign = 'center'; c.fillText('リンクで参加', 1005, 113)
</script></body></html>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 630 } })
await p.setContent(html)
await p.locator('#c').screenshot({ path: new URL('../public/og.png', import.meta.url).pathname })
await b.close()
console.log('public/og.png')
