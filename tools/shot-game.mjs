// 3D のゲーム画面を撮る（コースごと）。node tools/shot-game.mjs [コース] [W] [H]
// GPU を使う headless Chromium で2人つなぎ、ホストを前へ歩かせて数枚撮る。tools/shots/game-*.png
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'
import { COURSE_IDS } from '../public/courses.js'
const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const want = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : COURSE_IDS
const w = Number(process.argv[3] || 390), h = Number(process.argv[4] || 844)
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const errs = []
for (const id of want) {
  const mk = async () => { const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' })).newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); return p }
  const hp = await mk(), gp = await mk()
  await hp.goto(base); await hp.fill('#name', 'たろう'); await hp.click('#createBtn'); await hp.waitForSelector('#lobby:not([hidden])')
  for (let i = 0; i < 6 && await hp.getAttribute('#coursePick .pk-body', 'data-id') !== id; i++) await hp.click('#coursePick .pk-btn[data-d="1"]')
  await gp.goto(await hp.inputValue('#invite')); await gp.fill('#name', 'はなこ'); await gp.click('#joinBtn'); await gp.waitForSelector('#lobby:not([hidden])')
  await hp.click('#startBtn')
  await hp.waitForFunction(() => window.__bc && window.__bc.mode(), null, { timeout: 15000 })
  await hp.waitForTimeout(1500)
  await hp.screenshot({ path: `${SHOTS}game-${id}-${w}x${h}-0count.png` })
  await hp.waitForFunction(() => window.__bc.W() && window.__bc.W().ph === 1, null, { timeout: 10000 })
  await hp.evaluate(() => window.__bc.push(0.15, 1)); await gp.evaluate(() => window.__bc.push(-0.2, 1))
  for (const [k, ms] of [[1, 2500], [2, 5000], [3, 6000]]) {
    await hp.waitForTimeout(ms)
    const info = await hp.evaluate(() => ({ mode: window.__bc.mode(), v: window.__bc.variance(), fps: window.__bc.fps(), tier: window.__bc.tier(), me: window.__bc.me() }))
    console.log(id, k, JSON.stringify(info))
    await hp.screenshot({ path: `${SHOTS}game-${id}-${w}x${h}-${k}.png` })
  }
  await hp.context().close(); await gp.context().close()
}
console.log('errors', errs.length, errs.slice(0, 5))
await b.close(); await srv.close()
