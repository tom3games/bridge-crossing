// 公開URLの確認: chromium（ホスト）と webkit（参加）の2人でつないで遊び、OGP が取れること・起動エラーの誤表示が出ないことを見る
// 使い方: node tools/live-check.mjs https://xxxx.trycloudflare.com
import { chromium, webkit } from 'playwright'
const base = process.argv[2]
let fail = 0
const check = (ok, l) => { console.log(ok ? 'OK  ' : 'NG  ', l); if (!ok) fail++ }
const html = await (await fetch(base + '/')).text()
const og = (html.match(/property="og:image" content="([^"]+)"/) || [])[1]
check(/^https:\/\//.test(og || ''), `og:image が絶対URL（${og}）`)
const img = await fetch(og)
const buf = Buffer.from(await img.arrayBuffer())
check(img.ok && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630, `og.png が取れる（${img.status}、${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}）`)
const errs = []
const cb = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }), wb = await webkit.launch()
const mk = async (b, n) => { const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'ja-JP' })).newPage(); p.on('pageerror', e => errs.push(n + ' ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(n + ' ' + m.text())); return p }
const h = await mk(cb, 'chromium'), g = await mk(wb, 'webkit')
await h.goto(base); await h.fill('#name', 'ホスト'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
await g.goto(await h.inputValue('#invite')); await g.fill('#name', 'ゲスト'); await g.click('#joinBtn'); await g.waitForSelector('#lobby:not([hidden])')
await h.click('#coursePick .pk-btn[data-d="1"]')
await g.waitForFunction(() => document.querySelector('#coursePick .pk-body')?.dataset.id === 'canyon', null, { timeout: 8000 }).then(() => check(true, '選んだ橋（新しいルールの setup）が参加者に届く'), () => check(false, '選んだ橋が参加者に届く'))
await h.click('#startBtn')
await h.waitForFunction(() => window.__bc && window.__bc.W() && window.__bc.W().ph === 1, null, { timeout: 20000 })
check(await h.evaluate(() => window.__bc.W().course) === 'canyon', 'その橋で始まる')
check(await h.evaluate(() => window.__bc.mode()) === '3d', `chromium が 3D（${await h.evaluate(() => window.__bc.mode())}）`)
check(['3d', '2d'].includes(await g.evaluate(() => window.__bc.mode())), `webkit で描ける（${await g.evaluate(() => window.__bc.mode())}）`)
const y0 = await g.evaluate(() => window.__bc.me().y)
await g.evaluate(() => window.__bc.push(0, 1)); await h.evaluate(() => window.__bc.push(0, 1))
await h.waitForTimeout(1500)
const y1 = await g.evaluate(() => window.__bc.me().y)
check(y1 > y0 + 1, `webkit の操作が届いて進む（${y0} → ${y1}）`)
const seen = await h.evaluate(() => { const W = window.__bc.W(); return W.py[W.roster.findIndex(r => r[1] === 'ゲスト')] })
check(Math.abs(seen - y1) < 1.5, `ゲストの動きがホストに見える（${seen}）`)
await h.waitForTimeout(20500)
check(await h.isHidden('#bootErr') && await g.isHidden('#bootErr'), '20秒たっても起動エラーの表示が出ない')
check(errs.length === 0, `コンソールエラー0件 ${errs.slice(0, 3)}`)
await cb.close(); await wb.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)
