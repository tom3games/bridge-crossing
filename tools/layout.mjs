// 画面の収まりと大人数の見た目を確かめる。1つのブラウザ（ホスト）＋ ws のボット N-1 人で遊び、
// 6つの画面サイズで「ホーム・ロビー・ゲーム・結果」が上下スクロールなしに収まるか、ボタンが画面内で44px以上かを数値で見る。
// スクショは tools/shots/layout-<幅>x<高さ>-<人数>-<画面>.png
// 使い方: node tools/layout.mjs [人数=30]
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import WebSocket from 'ws'
import { startServer } from '../server.mjs'

const N = Number(process.argv[2] || 30)
const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true, gameOpts: { rules: { timeLimit: 14 } } })
const base = `http://localhost:${srv.port}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }

const SIZES = [[390, 844], [360, 640], [844, 390], [667, 375], [768, 1024], [1440, 900]]

function fit() {
  const de = document.documentElement
  const vis = [...document.querySelectorAll('button, input, summary')].filter(e => e.offsetParent && !e.closest('[hidden]'))
  const name = e => e.id || e.className || e.textContent.trim().slice(0, 8)
  const out = vis.filter(e => { const r = e.getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1 }).map(name)
  const small = vis.filter(e => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 }).map(e => name(e) + ':' + Math.round(e.getBoundingClientRect().height))
  return { sh: de.scrollHeight, ih: innerHeight, sw: de.scrollWidth, iw: innerWidth, out, small }
}

function bots(code, n) {
  const list = []
  for (let i = 0; i < n; i++) {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`)
    const b = { ws, i, delay: (i % 10) * 0.9, run: i % 4 === 0 }
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello' })); ws.send(JSON.stringify({ t: 'join', code, name: 'ボット' + (i + 1) })) })
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'state') b.state = m })
    list.push(b)
  }
  return list
}

for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch()
  for (const [w, h] of bname === 'webkit' ? SIZES.slice(0, 3) : SIZES) {
    const tag = `${bname}-${w}x${h}-${N}`
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', hasTouch: w < 1000, isMobile: bname === 'chromium' && w < 1000 })
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    await p.goto(base)
    await p.waitForSelector('#home:not([hidden])')
    let f = await p.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length, `${tag} ホームが収まる sh=${f.sh}/${f.ih} out=${f.out}`)
    check(!f.small.length, `${tag} ホームのボタンが44px以上 ${f.small}`)
    await p.screenshot({ path: `${SHOTS}layout-${tag}-home.png` })
    await p.fill('#name', 'わたし')
    await p.click('#createBtn')
    await p.waitForSelector('#lobby:not([hidden])')
    const code = await p.textContent('#roomCode')
    const bs = bots(code, N - 1)
    await p.waitForFunction(n => document.querySelectorAll('#players li').length === n, N, { timeout: 20000 })
    f = await p.evaluate(fit)
    check(f.sh <= f.ih && !f.out.length, `${tag} ロビー（${N}人）が収まる sh=${f.sh}/${f.ih} out=${f.out}`)
    await p.screenshot({ path: `${SHOTS}layout-${tag}-lobby.png` })
    await p.click('#startBtn')
    await p.waitForSelector('#game:not([hidden])')
    await sleep(3200)
    const t0 = Date.now()
    const iv = setInterval(() => {
      const t = (Date.now() - t0) / 1000
      for (const b of bs) if (b.ws.readyState === 1) b.ws.send(JSON.stringify({ t: 'input', data: { type: 'move', dx: Math.round(Math.sin(t + b.i) * 6) / 20, dy: t > b.delay ? 1 : 0, run: b.run } }))
      if (Math.random() < 0.3) { const b = bs[Math.floor(Math.random() * bs.length)]; b?.ws.readyState === 1 && b.ws.send(JSON.stringify({ t: 'input', data: { type: 'call', k: Math.floor(Math.random() * 3) } })) }
    }, 200)
    await p.keyboard.down('ArrowUp')
    await sleep(4500)
    f = await p.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length, `${tag} ゲームが収まる sh=${f.sh}/${f.ih} out=${f.out}`)
    check(!f.small.length, `${tag} ゲームのボタンが44px以上 ${f.small}`)
    await p.screenshot({ path: `${SHOTS}layout-${tag}-game.png` })
    await p.keyboard.up('ArrowUp')
    await p.waitForSelector('#result:not([hidden])', { timeout: 30000 })
    clearInterval(iv)
    await sleep(300)
    f = await p.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length, `${tag} 結果が収まる sh=${f.sh}/${f.ih} out=${f.out}`)
    await p.screenshot({ path: `${SHOTS}layout-${tag}-result.png` })
    const clipped = await p.evaluate(() => { const ol = document.querySelector('.res-rank'); const b = ol.getBoundingClientRect(); return [...ol.children].filter(li => li.getBoundingClientRect().bottom > b.bottom + 0.5 || li.getBoundingClientRect().bottom > innerHeight).length })
    check(clipped === 0, `${tag} 順位の行が途中で切れない (${clipped})`)
    check(await p.locator('.res-rank li.me').count() === 1, `${tag} 自分の順位が出る`)
    // ピンチやダブルタップで拡大しない（viewport の指定と、ズームの倍率が1のまま）
    const meta = await p.getAttribute('meta[name=viewport]', 'content')
    check(/user-scalable=no/.test(meta) && /maximum-scale=1/.test(meta), `${tag} 拡大止めの viewport`)
    check(errors.length === 0, `${tag} コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
    for (const b of bs) b.ws.close()
    await ctx.close()
  }
  await browser.close()
}
await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)
