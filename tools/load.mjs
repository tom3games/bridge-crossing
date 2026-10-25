// 負荷試験。サーバーを別プロセスで立て、ws クライアントを N 本つないで1つの部屋で遊ばせ、
// サーバー側（送信量・tick 時間・CPU・メモリ）とクライアント側（往復の遅れ・受信量・差分の届く間隔）を測る。
//
// 使い方:
//   node tools/load.mjs                      10,30,50,100人を順に（各20秒）
//   node tools/load.mjs --n 100 --sec 30     人数と測る秒数を指定
//   node tools/load.mjs --naive              雛形と同じ送り方（毎 tick・人ごとに全体）で測る（比較用）
//   node tools/load.mjs --json out.json      結果を JSON でも保存
// ボット: 150ms ごとにランダムな向き（前寄り）に動き、3割は走る。1秒ごとに ping を送って往復時間を測る。
// ゲームが終わったら（ゴール・橋が落ちた・時間切れ）すぐ再戦して、測る間ずっとゲーム中にしておく。
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'

const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const NS = String(arg('--n', '10,30,50,100')).split(',').map(Number)
const SEC = Number(arg('--sec', 20))
const NAIVE = args.includes('--naive')
const JSON_OUT = arg('--json', null)
const PORT = Number(arg('--port', 8905))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))] }
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

async function startServer() {
  const proc = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(PORT), STATS: '1', BRIDGE_NAIVE: NAIVE ? '1' : '0' }, stdio: ['ignore', 'pipe', 'inherit']
  })
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/healthz`); if (r.ok) return proc } catch {}
    await sleep(100)
  }
  throw new Error('server did not start')
}
const stats = async (reset = true) => (await fetch(`http://localhost:${PORT}/stats${reset ? '' : '?reset=0'}`)).json()

function bot(i) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`)
  const b = { i, ws, id: null, state: null, inBytes: 0, rtt: [], frameGaps: [], lastFrame: 0, measuring: false, code: null, frames: 0 }
  ws.on('message', raw => {
    if (b.measuring) b.inBytes += raw.length
    const m = JSON.parse(raw)
    if (m.t === 'welcome') b.id = m.id
    else if (m.t === 'joined') b.code = m.code
    else if (m.t === 'state') { b.state = m; if (b.measuring && NAIVE && m.phase === 'playing') gap(b) }
    else if (m.t === 'f') { b.frames++; if (b.measuring) gap(b) }
    else if (m.t === 'pong' && b.measuring) b.rtt.push(performance.now() - m.at)
  })
  b.open = new Promise((res, rej) => { ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello' })); res() }); ws.on('error', rej) })
  b.send = m => ws.readyState === 1 && ws.send(JSON.stringify(m))
  return b
}
function gap(b) { const t = performance.now(); if (b.lastFrame) b.frameGaps.push(t - b.lastFrame); b.lastFrame = t }

async function runOne(n) {
  const proc = await startServer()
  const bots = []
  for (let i = 0; i < n; i++) { const b = bot(i); bots.push(b); await b.open }
  await sleep(300)
  const host = bots[0]
  host.send({ t: 'create', name: 'bot0' })
  while (!host.code) await sleep(20)
  for (const b of bots.slice(1)) { b.send({ t: 'join', code: host.code, name: 'bot' + b.i }); await sleep(5) }
  while (!bots.every(b => b.state && b.state.players.length === n)) await sleep(50)
  host.send({ t: 'start' })
  while (!bots.every(b => b.state && b.state.phase === 'playing')) await sleep(50)
  await sleep(3200) // 秒読みが終わるまで
  // ボットを動かす
  let restarts = 0
  const timers = bots.map(b => setInterval(() => {
    const r = Math.random()
    const dx = r < 0.15 ? 0 : Math.random() * 2 - 1
    const dy = r < 0.15 ? 0 : Math.random() * 1.6 - 0.6
    b.send({ t: 'input', data: { type: 'move', dx: Math.round(dx * 20) / 20, dy: Math.round(dy * 20) / 20, run: Math.random() < 0.3 } })
    if (Math.random() < 0.02) b.send({ t: 'input', data: { type: 'call', k: Math.floor(Math.random() * 3) } })
  }, 150 + Math.random() * 20))
  const pings = setInterval(() => { for (const b of bots) b.send({ t: 'ping', at: performance.now() }) }, 1000)
  const watch = setInterval(() => { if (host.state?.phase === 'result') { restarts++; host.send({ t: 'rematch' }) } }, 200)
  await sleep(1000)
  await stats() // ここから数え直す
  for (const b of bots) { b.measuring = true; b.lastFrame = 0 }
  const t0 = performance.now()
  // 途中のメモリの最大も見る
  let rssMax = 0
  const samples = []
  for (let s = 0; s < SEC; s += 5) { await sleep(5000); const st = await stats(false); rssMax = Math.max(rssMax, st.rssMB); samples.push(st) }
  const sec = (performance.now() - t0) / 1000
  const sv = await stats()
  for (const b of bots) b.measuring = false
  clearInterval(pings); clearInterval(watch); timers.forEach(clearInterval)
  const rtts = bots.flatMap(b => b.rtt), gaps = bots.flatMap(b => b.frameGaps)
  const row = {
    n, naive: NAIVE, sec: Math.round(sec),
    outKBps: +sv.outKBps.toFixed(1), outMsgsPerSec: Math.round(sv.outMsgsPerSec), inKBps: +sv.inKBps.toFixed(1),
    perClientInKBps: +(avg(bots.map(b => b.inBytes)) / 1024 / sec).toFixed(2),
    tickAvgMs: +sv.tickAvgMs.toFixed(3), tickP95Ms: +sv.tickP95Ms.toFixed(3), tickMaxMs: +sv.tickMaxMs.toFixed(2),
    cpuPct: +sv.cpuPct.toFixed(1), rssMB: +Math.max(rssMax, sv.rssMB).toFixed(1), heapMB: +sv.heapMB.toFixed(1),
    loopDelayP99Ms: +sv.loopDelayP99Ms.toFixed(1),
    rttAvgMs: +avg(rtts).toFixed(1), rttP95Ms: +pct(rtts, 0.95).toFixed(1), rttMaxMs: +Math.max(0, ...rtts).toFixed(1),
    frameGapP95Ms: +pct(gaps, 0.95).toFixed(1), restarts
  }
  for (const b of bots) b.ws.close()
  proc.kill()
  await new Promise(r => proc.on('exit', r))
  return row
}

const rows = []
for (const n of NS) {
  const r = await runOne(n)
  rows.push(r)
  console.log(JSON.stringify(r))
}
console.log('\n| 人数 | 送り方 | サーバー送信 KB/s | 送信メッセージ/秒 | 受信 KB/s | 1人あたり受信 KB/s | tick 平均 / p95 / 最大 ms | CPU % | メモリ RSS MB | ping 往復 平均 / p95 ms | 差分の間隔 p95 ms | 再戦 |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) console.log(`| ${r.n} | ${r.naive ? '雛形のまま' : '改善後'} | ${r.outKBps} | ${r.outMsgsPerSec} | ${r.inKBps} | ${r.perClientInKBps} | ${r.tickAvgMs} / ${r.tickP95Ms} / ${r.tickMaxMs} | ${r.cpuPct} | ${r.rssMB} | ${r.rttAvgMs} / ${r.rttP95Ms} | ${r.frameGapP95Ms} | ${r.restarts} |`)
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(rows, null, 2))
process.exit(0)
