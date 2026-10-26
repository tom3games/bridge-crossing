// 大人数の 3D 画面を撮る（ブラウザ1台＋ ws のボット）。重い区間の札・落ちる人・遠い人の簡易表示を見る用。
// 使い方: node tools/shot-crowd.mjs [人数=30] [コース=canyon]   → tools/shots/crowd-*.png と fps
import { chromium } from 'playwright'
import WebSocket from 'ws'
import { startServer } from '../server.mjs'
const N = Number(process.argv[2] || 30), COURSE = process.argv[3] || 'canyon'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ja-JP' })).newPage()
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
await p.goto(`http://localhost:${srv.port}`); await p.fill('#name', 'わたし'); await p.click('#createBtn'); await p.waitForSelector('#lobby:not([hidden])')
for (let i = 0; i < 6 && await p.getAttribute('#coursePick .pk-body', 'data-id') !== COURSE; i++) await p.click('#coursePick .pk-btn[data-d="1"]')
const code = await p.textContent('#roomCode')
const bots = []
for (let i = 0; i < N - 1; i++) { const ws = new WebSocket(`ws://localhost:${srv.port}/ws`); ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello' })); ws.send(JSON.stringify({ t: 'join', code, name: 'ボット' + (i + 1) })) }); bots.push(ws) }
await p.waitForFunction(n => document.querySelectorAll('#players li').length === n, N, { timeout: 20000 })
await p.click('#startBtn')
await p.waitForFunction(() => window.__bc && window.__bc.W() && window.__bc.W().ph === 1, null, { timeout: 15000 })
const t0 = Date.now()
const iv = setInterval(() => { const t = (Date.now() - t0) / 1000; bots.forEach((ws, i) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'input', data: { type: 'move', dx: Math.round(Math.sin(t + i) * 6) / 20, dy: t > (i % 8) * 0.5 ? 1 : 0, run: i % 3 === 0 } }))) }, 200)
await p.evaluate(() => window.__bc.push(0, 1))
for (const k of [1, 2, 3]) {
  await p.waitForTimeout(2600)
  const r = await p.evaluate(() => ({ fps: window.__bc.fps(), tier: window.__bc.tier(), v: window.__bc.variance(), me: window.__bc.me() }))
  console.log(k, JSON.stringify(r))
  await p.screenshot({ path: `${SHOTS}crowd-${N}-${COURSE}-${k}.png` })
}
clearInterval(iv); for (const ws of bots) ws.close()
console.log('errors', errs.length, errs.slice(0, 3))
await b.close(); await srv.close()
