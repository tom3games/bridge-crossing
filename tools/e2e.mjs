// 実ブラウザ（chromium と webkit）で3人つないで、作成→招待URLで参加→開始→操作→結果→再戦 を通す。スクショは tools/shots/
// 使い方: node tools/e2e.mjs   （サーバーは自前で立てる）
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'
import * as play from './e2e-play.mjs'

const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }

for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch()
  const errors = []
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: bname === 'chromium' })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    p.on('requestfailed', r => errors.push('requestfailed ' + r.url()))
    return p
  }
  const host = await mk(), guests = [await mk(), await mk()]
  await host.goto(base)
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URLが出る ${invite}`)
  for (const [i, g] of guests.entries()) {
    await g.goto(invite)
    if (i === 0) check((await g.inputValue('#code')).length === 4, `${bname}: 招待URLを開くと参加コードが入っている`)
    await g.fill('#name', 'ゲスト' + (i + 1))
    await g.click('#joinBtn')
    await g.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(true, `${bname}: 3人がロビーにそろう`)
  await host.screenshot({ path: `${SHOTS}${bname}-lobby.png` })
  await host.click('#startBtn')
  for (const g of guests) await g.waitForSelector('#game:not([hidden])')
  check(true, `${bname}: ゲームが始まる`)
  await host.screenshot({ path: `${SHOTS}${bname}-countdown.png` })
  const release = await play.playToEnd(host, guests, { shot: async n => { await host.screenshot({ path: `${SHOTS}${bname}-${n}.png` }); await guests[0].screenshot({ path: `${SHOTS}${bname}-${n}-guest.png` }) } })
  // 動けているか: ステータスやタイマーではなく、キャンバスに描かれていること（画素のばらつき）を数値で見る
  const varc = await host.evaluate(() => {
    const c = document.querySelector('#g-canvas'); if (!c) return 0
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let s = 0, s2 = 0, n = 0
    for (let i = 0; i < d.length; i += 400) { const v = d[i] + d[i + 1] + d[i + 2]; s += v; s2 += v * v; n++ }
    return s2 / n - (s / n) ** 2
  }).catch(() => -1)
  check(varc > 500 || varc === -1, `${bname}: キャンバスに絵が出ている（分散 ${Math.round(varc)}）`)
  const resultTitle = await guests[0].waitForSelector('#result:not([hidden])', { timeout: 90000 }).then(() => guests[0].textContent('#resultTitle'))
  check(true, `${bname}: 結果画面が出る（${resultTitle}）`)
  await release()
  const rows = await guests[0].locator('.res-rank li').count()
  check(rows === 3, `${bname}: 個人順位が3人分出る (${rows})`)
  await guests[0].screenshot({ path: `${SHOTS}${bname}-result.png` })
  const goals = await guests[0].textContent('.res-stamp b')
  check(/ゴール [1-3] \/ 3人/.test(goals), `${bname}: 誰かが向こう岸に着く（${goals}）`)
  await host.waitForSelector('#result:not([hidden])')
  await host.screenshot({ path: `${SHOTS}${bname}-result-host.png` })
  await host.click('#rematchBtn')
  await host.waitForTimeout(1000)
  for (const g of guests) await g.waitForSelector('#game:not([hidden])')
  check(true, `${bname}: 再戦できる`)
  check(errors.length === 0, `${bname}: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}
await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)
