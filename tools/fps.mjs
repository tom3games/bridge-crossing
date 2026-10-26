// 3D の fps を測る（GPU を使う headless Chromium）。スマホ相当（390x844・画素比3・タッチ）と横持ちで、全コースを6秒ずつ歩く
// 使い方: node tools/fps.mjs [人数=2]（2人より多いときは ws のボットを足す）
import { chromium } from 'playwright'
import WebSocket from 'ws'
import { startServer } from '../server.mjs'
import { COURSE_IDS } from '../public/courses.js'
const N = Number(process.argv[2] || 2)
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[390, 844], [844, 390]]) {
  for (const id of COURSE_IDS) {
    const hp = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ja-JP' })).newPage()
    await hp.goto(base); await hp.fill('#name', 'A'); await hp.click('#createBtn'); await hp.waitForSelector('#lobby:not([hidden])')
    for (let i = 0; i < 6 && await hp.getAttribute('#coursePick .pk-body', 'data-id') !== id; i++) await hp.click('#coursePick .pk-btn[data-d="1"]')
    const code = await hp.textContent('#roomCode')
    const bots = []
    for (let i = 0; i < N - 1; i++) { const ws = new WebSocket(`ws://localhost:${srv.port}/ws`); ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello' })); ws.send(JSON.stringify({ t: 'join', code, name: 'b' + i })) }); bots.push(ws) }
    await hp.waitForFunction(n => document.querySelectorAll('#players li').length === n, N)
    await hp.click('#startBtn')
    await hp.waitForFunction(() => window.__bc && window.__bc.W() && window.__bc.W().ph === 1, null, { timeout: 15000 })
    const iv = setInterval(() => bots.forEach((ws, i) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'input', data: { type: 'move', dx: 0, dy: 1, run: i % 3 === 0 } }))), 300)
    await hp.evaluate(() => window.__bc.push(0.1, 1))
    await hp.waitForTimeout(6000)
    const r = await hp.evaluate(() => ({ fps: window.__bc.fps(), tier: window.__bc.tier() }))
    console.log(`${w}x${h} ${N}人 ${id.padEnd(8)} fps ${r.fps.toFixed(1)} 画質 ${r.tier}`)
    clearInterval(iv); bots.forEach(ws => ws.close())
    await hp.context().close()
  }
}
await b.close(); await srv.close()
