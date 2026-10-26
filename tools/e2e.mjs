// 実ブラウザ（chromium と webkit）で3人つないで最後まで遊ぶ。スクショは tools/shots/
// 作成 → 招待URLで参加 → 橋を選ぶ（参加者にも見える）→ 開始 → 3D で描けている → キーボード・ドラッグ・走る（切り替え）・合図が届く
// → 自動操縦で向こう岸へ → 結果（順位・称号・記録）→ 再戦 → 2回目も始まる。続けて4サイズで画面が収まるかを数値で見る。
// 使い方: node tools/e2e.mjs   （サーバーは自前で立てる）
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'

const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true })
const base = process.env.BASE || `http://localhost:${srv.port}`
let fail = 0, total = 0
const check = (ok, label) => { total++; console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']

// 画面がスクロールせずに収まるか・ボタンが44px以上か
function fit() {
  const de = document.documentElement
  const vis = [...document.querySelectorAll('button, input, summary')].filter(e => e.offsetParent && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden')
  const name = e => e.id || e.className || e.textContent.trim().slice(0, 8)
  const out = vis.filter(e => { const r = e.getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1 }).map(name)
  const small = vis.filter(e => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 }).map(e => name(e) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))
  // 重なり: ゲーム中の上の部品（時計・ボタン・道のり）同士
  const hud = [...document.querySelectorAll('.hud-top > *, .side-btns > *, .route, .status, #quitBtn')].filter(e => e.offsetParent && !e.hidden).map(e => [name(e), e.getBoundingClientRect()])
  const over = []
  for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) { const a = hud[i][1], b = hud[j][1]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over.push(hud[i][0] + '/' + hud[j][0]) }
  return { sh: de.scrollHeight, ih: innerHeight, sw: de.scrollWidth, iw: innerWidth, out, small, over }
}

for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.ONLY || process.env.ONLY === n)) {
  const browser = await bt.launch(bname === 'chromium' ? { args: GPU } : {})
  const errors = []
  const mk = async (w = 390, h = 844) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', hasTouch: true, isMobile: bname === 'chromium' })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    p.on('requestfailed', r => !/fonts\.(googleapis|gstatic)/.test(r.url()) && errors.push('requestfailed ' + r.url()))
    return p
  }
  if (!process.env.FIT_ONLY) {
  const host = await mk(), guests = [await mk(), await mk()]
  const all = [host, ...guests]
  await host.goto(base)
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URLが出る`)
  for (const [i, g] of guests.entries()) {
    await g.goto(invite)
    if (i === 0) check((await g.inputValue('#code')).length === 4, `${bname}: 招待URLを開くと参加コードが入っている`)
    await g.fill('#name', 'ゲスト' + (i + 1))
    await g.click('#joinBtn')
    await g.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(true, `${bname}: 3人がロビーにそろう`)
  // 橋を選ぶ: 一度「谷」にしてから「森」に戻す。参加者の画面にも同じ橋が出る
  await host.click('#coursePick .pk-btn[data-d="1"]')
  await guests[0].waitForFunction(() => document.querySelector('#coursePick .pk-body')?.dataset.id === 'canyon', null, { timeout: 5000 }).then(() => check(true, `${bname}: ホストが選んだ橋が参加者にも出る`), () => check(false, `${bname}: ホストが選んだ橋が参加者にも出る`))
  check(await guests[0].locator('#coursePick .pk-btn').first().isHidden(), `${bname}: 参加者は橋を選べない`)
  await host.click('#coursePick .pk-btn[data-d="-1"]')
  await guests[0].waitForFunction(() => document.querySelector('#coursePick .pk-body')?.dataset.id === 'forest')
  await host.screenshot({ path: `${SHOTS}${bname}-lobby.png` })
  await host.click('#startBtn')
  for (const g of all) await g.waitForSelector('#game:not([hidden])')
  check(true, `${bname}: 全員のゲームが始まる`)
  await host.waitForFunction(() => window.__bc && window.__bc.mode(), null, { timeout: 15000 })
  const mode = await host.evaluate(() => window.__bc.mode())
  check(mode === '3d' || bname === 'webkit', `${bname}: 3D で描く（${mode}）`)
  await host.waitForTimeout(1200)
  await host.screenshot({ path: `${SHOTS}${bname}-countdown.png` })
  const v = await host.evaluate(() => window.__bc.variance())
  check(v > 300, `${bname}: 画面に絵が出ている（輝度の分散 ${Math.round(v)}）`)
  // 秒読み中から上キーを押しっぱなし → 始まった瞬間に動き出す
  // （ブラウザがウィンドウのフォーカスを外すと、押しっぱなしのキーは離したことになる。テスト中に外れたら押し直す）
  await host.evaluate(() => { window.__blurs = 0; addEventListener('blur', () => window.__blurs++) })
  const hy0 = await host.evaluate(() => window.__bc.me().y)
  await host.keyboard.down('ArrowUp')
  await host.waitForFunction(() => window.__bc.W().ph === 1, null, { timeout: 10000 })
  await host.waitForTimeout(900)
  let hy = await host.evaluate(() => window.__bc.me().y)
  const blurs = await host.evaluate(() => window.__blurs)
  if (hy <= hy0 + 0.8 && blurs) { await host.keyboard.up('ArrowUp'); await host.keyboard.down('ArrowUp'); await host.waitForTimeout(900); hy = await host.evaluate(() => window.__bc.me().y) }
  check(hy > hy0 + 0.8, `${bname}: キーボードで前へ進む（y=${hy0.toFixed(1)} → ${hy.toFixed(1)}、フォーカス外れ ${blurs}回）`)
  await host.keyboard.up('ArrowUp')
  // ゲスト1は画面をドラッグ
  const g0 = guests[0]
  const y0 = await g0.evaluate(() => window.__bc.me().y)
  const box = await g0.locator('#g-cv').boundingBox()
  const cx = box.x + box.width * 0.35, cy = box.y + box.height * 0.55
  await g0.mouse.move(cx, cy); await g0.mouse.down(); await g0.mouse.move(cx + 4, cy - 40, { steps: 4 }); await g0.mouse.move(cx + 4, cy - 70, { steps: 3 })
  await g0.waitForTimeout(900)
  const y1 = await g0.evaluate(() => window.__bc.me().y)
  await g0.mouse.up()
  check(y1 > y0 + 0.5, `${bname}: ドラッグで前へ進む（${y0.toFixed(1)} → ${y1.toFixed(1)}）`)
  // ほかの人の画面でも動いて見える
  const seen = await guests[1].evaluate(() => { const W = window.__bc.W(); return W.py[W.roster.findIndex(r => r[1] === 'ホスト')] })
  check(Math.abs(seen - hy) < 1.5 && seen > hy0 + 0.5, `${bname}: ホストの動きがほかの人にも届く（y=${seen.toFixed(1)}）`)
  // 走るは切り替え式
  const g1 = guests[1]
  await g1.locator('#g-run').tap()
  await g1.waitForTimeout(400)
  check(await g1.getAttribute('#g-run', 'aria-pressed') === 'true', `${bname}: 走るボタンを1回押すと入りっぱなし`)
  await g1.locator('#g-run').tap()
  check(await g1.getAttribute('#g-run', 'aria-pressed') === 'false', `${bname}: もう1回押すと切れる`)
  // 合図
  await g1.locator('.call[data-k="1"]').tap()
  await host.waitForFunction(() => [...document.querySelectorAll('.bubble')].some(b => !b.hidden && b.textContent === '行け'), null, { timeout: 4000 }).then(() => check(true, `${bname}: 合図の吹き出しがほかの人の画面に出る`), () => check(false, `${bname}: 合図の吹き出しがほかの人の画面に出る`))
  await host.screenshot({ path: `${SHOTS}${bname}-game.png` })
  await g0.screenshot({ path: `${SHOTS}${bname}-game-guest.png` })
  // 自動操縦: 自分の列を決めて前へ。突風の区間の手前では止まり、丸太が近いときは待つ
  const pilot = () => {
    const W = window.__bc.W(); const m = window.__bc.me()
    if (!W || !m || W.ph !== 1) return
    const lane = (W.me % W.cols) + 0.5
    let dy = 1
    const span = Math.floor(Math.max(0, m.y + 0.8) / W.span)
    if (W.w && W.w[0] === span && m.y > -0.5) dy = 0
    for (const L of W.logs) { const lx = W.cols / 2 + L.amp * Math.sin((window.__bc.T() / L.period) * Math.PI * 2 + L.phase); if (m.y > L.row - 1.6 && m.y < L.row + 0.2 && Math.abs(lx - m.x) < 2.2) dy = m.y < L.row - 0.9 ? 0 : 1 }
    window.__bc.push(Math.max(-1, Math.min(1, (lane - m.x) * 1.5)), dy)
  }
  const iv = setInterval(() => { for (const p of all) p.evaluate(pilot).catch(() => {}) }, 150)
  await host.waitForTimeout(6000)
  await host.screenshot({ path: `${SHOTS}${bname}-game-mid.png` })
  for (const p of all) await p.waitForSelector('#result:not([hidden])', { timeout: 90000 })
  clearInterval(iv)
  check(true, `${bname}: 全員に結果画面が出る（${await host.textContent('#resultTitle')}）`)
  await host.waitForTimeout(900)
  const rows = await guests[0].locator('.res-rank li:not(.more)').count()
  check(rows === 3, `${bname}: 個人順位が3人分出る (${rows})`)
  const goals = await host.evaluate(() => document.querySelector('.res-stats b').textContent)
  check(/^[1-3]\/3$/.test(goals), `${bname}: 誰かが向こう岸に着く（${goals}）`)
  const career = await host.evaluate(() => JSON.parse(localStorage.getItem('bc-career') || '{}').plays)
  check(career === 1, `${bname}: この端末に記録が残る（遊んだ回数 ${career}）`)
  await host.screenshot({ path: `${SHOTS}${bname}-result-host.png` })
  await guests[0].screenshot({ path: `${SHOTS}${bname}-result.png` })
  check(await guests[0].locator('#rematchBtn').isHidden(), `${bname}: 参加者には再戦ボタンが出ない`)
  await host.click('#rematchBtn')
  for (const g of all) await g.waitForSelector('#game:not([hidden])')
  await host.waitForFunction(() => window.__bc.W() && window.__bc.W().ph === 1, null, { timeout: 10000 })
  check(await host.evaluate(() => window.__bc.me().y < 0), `${bname}: 再戦で全員が手前の崖に戻って始まる`)
  check(await host.evaluate(() => JSON.parse(localStorage.getItem('bc-career')).plays) === 1, `${bname}: 再戦しても前の回を二重に数えない`)
  await host.click('#quitBtn'); await host.click('#quitBtn')
  await host.waitForSelector('#home:not([hidden])')
  check(await host.isVisible('#career'), `${bname}: 抜けるとホームに称号が出る`)
  for (const p of all) await p.context().close()
  // WebGL が使えない端末: 2D に戻して遊べる
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true })
    await ctx.addInitScript(() => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, ...a) { return /webgl/.test(k) ? null : o.call(this, k, ...a) } })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    await p.goto(base); await p.fill('#name', 'ひとり'); await p.click('#createBtn'); await p.waitForSelector('#lobby:not([hidden])')
    await p.click('#startBtn'); await p.waitForFunction(() => window.__bc && window.__bc.mode(), null, { timeout: 15000 })
    await p.waitForTimeout(1500)
    const m = await p.evaluate(() => window.__bc.mode()), vv = await p.evaluate(() => window.__bc.variance())
    check(m === '2d' && vv > 300, `${bname}: WebGL が無いと 2D で描く（${m}、分散 ${Math.round(vv)}）`)
    await p.screenshot({ path: `${SHOTS}${bname}-2d.png` })
    await ctx.close()
  }
  }

  // 4サイズ: ホーム・遊び方・ロビー・ゲーム・結果が収まる
  for (const [w, h] of process.env.NO_FIT ? [] : [[390, 844], [360, 640], [844, 390], [568, 320]]) {
    const tag = `${bname} ${w}x${h}`
    const a = await mk(w, h), b = await mk(w, h)
    await a.goto(base); await a.waitForSelector('#home:not([hidden])')
    let f = await a.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length && !f.small.length, `${tag} ホーム sh=${f.sh}/${f.ih} out=${f.out} small=${f.small}`)
    await a.screenshot({ path: `${SHOTS}fit-${bname}-${w}x${h}-home.png` })
    await a.click('#howBtn'); await a.waitForTimeout(250)
    f = await a.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length && !f.small.length, `${tag} 遊び方 out=${f.out} small=${f.small}`)
    await a.screenshot({ path: `${SHOTS}fit-${bname}-${w}x${h}-howto.png` })
    await a.click('#howClose')
    await a.fill('#name', 'たろう'); await a.click('#createBtn'); await a.waitForSelector('#lobby:not([hidden])')
    await b.goto(await a.inputValue('#invite')); await b.fill('#name', 'とても長い名前の人'); await b.click('#joinBtn'); await b.waitForSelector('#lobby:not([hidden])')
    await a.waitForTimeout(300)
    f = await a.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length && !f.small.length, `${tag} ロビー out=${f.out} small=${f.small}`)
    await a.screenshot({ path: `${SHOTS}fit-${bname}-${w}x${h}-lobby.png` })
    await a.click('#startBtn'); await a.waitForSelector('#game:not([hidden])')
    await a.waitForTimeout(4200)
    await a.evaluate(() => window.__bc.push(0, 1))
    await a.waitForTimeout(1500)
    f = await a.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length && !f.small.length && !f.over.length, `${tag} ゲーム out=${f.out} small=${f.small} 重なり=${f.over}`)
    await a.screenshot({ path: `${SHOTS}fit-${bname}-${w}x${h}-game.png` })
    // 終わらせる: 2人とも抜けずに時間切れを待つと長いので、相手が抜けて自分も抜ける…ではなく、走って渡りきる
    const iv2 = setInterval(() => { for (const p of [a, b]) p.evaluate(() => { const m = window.__bc.me(); const W = window.__bc.W(); if (m && W) window.__bc.push(((W.me % W.cols) + 0.5 - m.x) * 1.5, 1) }).catch(() => {}) }, 200)
    await a.waitForSelector('#result:not([hidden])', { timeout: 90000 }); clearInterval(iv2)
    await a.waitForTimeout(1200)
    f = await a.evaluate(fit)
    check(f.sh <= f.ih && f.sw <= f.iw && !f.out.length && !f.small.length, `${tag} 結果 out=${f.out} small=${f.small}`)
    await a.screenshot({ path: `${SHOTS}fit-${bname}-${w}x${h}-result.png` })
    await a.context().close(); await b.context().close()
  }
  check(errors.length === 0, `${bname}: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}
await srv.close()
console.log(fail ? `NG ${fail}件 / ${total}項目` : `すべてOK ${total}項目`)
process.exit(fail ? 1 : 0)
