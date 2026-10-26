// OGP 画像（public/og.png, 1200x630）を作る。使い方: node tools/og.mjs
// 1) サーバーを立てて5人で森の吊り橋を渡り始め、3D の画面だけを撮る（HUD は隠す）
// 2) その上にタイトルのロゴ（index.html と同じ SVG）と一言を重ねる
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { startServer } from '../server.mjs'

const OUT = new URL('../public/og.png', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const pages = []
for (let i = 0; i < 5; i++) pages.push(await (await b.newContext({ viewport: i ? { width: 390, height: 844 } : { width: 1200, height: 630 }, deviceScaleFactor: i ? 1 : 1.5, locale: 'ja-JP' })).newPage())
const [h] = pages
await h.goto(base); await h.fill('#name', 'たろう'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
const inv = await h.inputValue('#invite')
for (const [i, nm] of [[1, 'はなこ'], [2, 'けんた'], [3, 'みお'], [4, 'そうた']]) { await pages[i].goto(inv); await pages[i].fill('#name', nm); await pages[i].click('#joinBtn'); await pages[i].waitForSelector('#lobby:not([hidden])') }
await h.click('#startBtn')
await h.waitForFunction(() => window.__bc && window.__bc.W() && window.__bc.W().ph === 1, null, { timeout: 15000 })
const lanes = [[0.6, 1], [-0.5, 1], [0.1, 1], [-0.2, 0.8], [0.4, 0.9]]
await Promise.all(pages.map((p, i) => p.evaluate(([x, y]) => window.__bc.push(x, y), lanes[i])))
await h.waitForTimeout(1700)
await pages[2].evaluate(() => window.__bc.run(true))
await h.waitForTimeout(900)
await Promise.all(pages.map(p => p.evaluate(() => window.__bc.push(0, 0))))
await pages[3].locator('.call[data-k="0"]').click()
await h.waitForTimeout(500)
await h.addStyleTag({ content: '.hud-top,.side-btns,.route,.status,.ctrl,.pad,.pad-hint,#quitBtn,.big,.floater{display:none!important}' })
await h.waitForTimeout(200)
const shot = await h.locator('#g-wrap').screenshot()
const bg = 'data:image/png;base64,' + shot.toString('base64')
const logo = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).match(/<svg class="logo"[\s\S]*?<\/svg>/)[0]
const og = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage()
await og.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=RocknRoll+One&display=swap"><style>
  body{margin:0;width:1200px;height:630px;position:relative;overflow:hidden;font-family:"RocknRoll One",sans-serif}
  .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .logo{position:absolute;left:24px;top:14px;width:470px;filter:drop-shadow(0 8px 0 rgba(0,0,0,.3))}
  .logo svg{width:100%;height:auto}
  .say{position:absolute;color:#fff;font-size:40px;line-height:1.3;-webkit-text-stroke:8px #2a170c;paint-order:stroke fill}
  .tag{position:absolute;right:30px;bottom:26px;background:#ffd23f;color:#2a170c;font-size:30px;padding:8px 22px;border-radius:40px;border:5px solid #2a170c;transform:rotate(-3deg)}
</style></head><body><img class="bg" src="${bg}"><div class="logo">${logo}</div>
<p class="say" style="left:36px;bottom:30px;margin:0">急ぐと割れる。<br>慎重すぎると時間切れ。</p>
<p class="tag" style="margin:0">1〜100人・スマホで参加</p></body></html>`)
await og.waitForLoadState('networkidle').catch(() => {})
await og.evaluate(() => document.fonts.ready)
await og.screenshot({ path: OUT })
await b.close(); await srv.close()
console.log('public/og.png')
