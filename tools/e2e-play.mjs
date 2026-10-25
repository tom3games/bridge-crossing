// 橋を渡れ！ を最後まで遊ぶ手順。ホストとゲスト2はキーボード（上キー、Shiftで走る）、ゲスト1は画面をドラッグして進む。
// 突風や穴で落ちても、時間切れで必ず結果まで行く。途中でスクショを撮る。
export async function playToEnd(host, guests, { shot } = {}) {
  const keyers = [host, ...guests.slice(1)]
  await host.keyboard.down('ArrowUp') // ホストは秒読み中から押しっぱなし（始まった瞬間に動き出すこと）
  await host.waitForFunction(() => document.querySelector('#g-time b')?.textContent !== '--', null, { timeout: 15000 })
  for (const p of keyers.slice(1)) await p.keyboard.down('ArrowUp')
  const g = guests[0]
  const box = await g.locator('#g-canvas').boundingBox()
  const x = box.x + box.width / 2, y = box.y + box.height * 0.7
  await g.mouse.move(x, y); await g.mouse.down(); await g.mouse.move(x + 6, y - 30, { steps: 3 }); await g.mouse.move(x + 4, y - 60, { steps: 3 })
  await host.waitForTimeout(2500)
  if (guests[1]) await guests[1].click('.g-call[data-k="0"]') // 合図
  await host.waitForTimeout(150)
  if (shot) await shot('game')
  await host.keyboard.down('Shift') // 少しだけ走る
  await host.waitForTimeout(800)
  await host.keyboard.up('Shift')
  return async () => { for (const p of keyers) await p.keyboard.up('ArrowUp'); await g.mouse.up() }
}
