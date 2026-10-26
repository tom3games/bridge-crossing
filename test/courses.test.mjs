// 橋の種類と仕掛け（丸太・落石・凍った板・焼けた板・やぐら・お守り）と、だんだん難しくなることのテスト
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, RULES, ST, timeFor } from '../lib/game.mjs'
import { COURSES, COURSE_IDS, SPAN, FLAG, layout, logsFor, logX } from '../public/courses.js'

function rng(seed = 1) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const ps = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'n' + i }))
const run = (g, sec) => { for (let t = 0; t < sec; t += 0.05) { g.tick(0.05); g.frame() } }
const P = (g, id) => g._debug.ps.find(p => p.id === id)
const place = (g, id, x, y) => { const p = P(g, id); p.x = x; p.y = y }
const quiet = (course, extra = {}) => ({ rng: rng(11), course, rules: { weakRate: 0, gustFirst: 1e9, hazards: false, ...extra } })

test('橋は5種類。どれも区間×7段で、長さと制限時間が違う。知らない名前は森の橋になる', () => {
  assert.deepEqual(COURSE_IDS, ['forest', 'canyon', 'snow', 'volcano', 'long'])
  for (const id of COURSE_IDS) {
    const g = createGame(ps(2), { rng: rng(1), course: id })
    const v = g.view()
    assert.equal(v.course, id)
    assert.equal(v.rows, COURSES[id].sections.length * SPAN)
    assert.equal(v.limit, timeFor(2, id))
    assert.equal(v.k.length, v.cols * v.rows)
    assert.equal(v.f.length, v.cols * v.rows)
  }
  assert.ok(createGame(ps(1), { course: 'long' }).view().rows >= 80, 'ロングは80段以上')
  assert.equal(createGame(ps(1), { course: 'nope' }).view().course, 'forest')
  assert.equal(createGame(ps(1), { course: 'constructor' }).view().course, 'forest')
})

test('後ろの区間ほど仕掛けが重なる（だんだん難しくなる）', () => {
  for (const id of COURSE_IDS) {
    const secs = COURSES[id].sections
    const score = s => s.weak * 10 + s.ice * 2 + s.heat * 4 + s.gust + s.log * 1.5 + s.rock
    const first = score(secs[0]), last = score(secs[secs.length - 1])
    assert.ok(last > first + 1, `${id}: 最後 ${last} > 最初 ${first}`)
  }
  // 実際に作った橋でも、最後の区間の方が傷んだ板が多い（5回分の合計）
  let a = 0, b = 0
  for (let s = 1; s <= 5; s++) {
    const g = createGame(ps(30), { rng: rng(s), course: 'canyon' })
    const { hp, cols } = g._debug
    for (let k = 0; k < cols * SPAN; k++) if (hp[k] < 1) a++
    for (let k = hp.length - cols * SPAN; k < hp.length; k++) if (hp[k] < 1) b++
  }
  assert.ok(b > a * 1.4, `最後の区間 ${b} 枚 > 最初 ${a} 枚`)
})

test('突風の間隔は、時間がたつほど短くなる', () => {
  const g = createGame(ps(1), { rng: () => 0.5, course: 'canyon', rules: { weakRate: 0, hazards: false, timeLimit: 200 } })
  run(g, RULES.readySec)
  const gaps = []
  let last = g._debug.gust.phase, endAt = null
  for (let t = 0; t < 190; t += 0.05) {
    g.tick(0.05)
    const ph = g._debug.gust.phase
    if (last === 2 && ph === 0) endAt = g._debug.play
    if (last === 0 && ph === 1 && endAt != null) gaps.push(g._debug.play - endAt)
    last = ph
    for (const p of g._debug.ps) { p.y = -1 } // 誰も橋に乗らない
  }
  assert.ok(gaps.length > 6)
  assert.ok(gaps[gaps.length - 1] < gaps[0] * 0.75, `最初 ${gaps[0].toFixed(2)} 最後 ${gaps[gaps.length - 1].toFixed(2)}`)
})

test('丸太: 時刻だけで位置が決まり、当たると飛ばされる。橋の端なら谷へ落ちる', () => {
  const g = createGame(ps(1), { rng: rng(3), course: 'forest', rules: { weakRate: 0, gustFirst: 1e9 } })
  const { logs, cols } = g._debug
  assert.equal(logs.length, 1)
  assert.deepEqual(logs, logsFor('forest', cols), '画面と同じ式')
  run(g, RULES.readySec)
  const L = logs[0]
  // 丸太が来る場所の手前（端の近く）に立って待つ
  let hitAt = null
  for (let t = 0; t < 12 && hitAt == null; t += 0.05) {
    const p = P(g, 'p0')
    if (p.st !== ST.hit && p.st !== ST.fall) { p.x = 0.4; p.y = L.row + 0.5 }
    g.tick(0.05)
    if (P(g, 'p0').hits > 0) hitAt = g._debug.play
  }
  assert.ok(hitAt != null, '丸太に当たる')
  const lx = logX(L, hitAt, cols)
  assert.ok(Math.abs(lx - 0.4) < 1.2, `当たったときの丸太の位置 ${lx}`)
  run(g, 1.2)
  const p = P(g, 'p0')
  // 端に立っていたので、外向きに飛ばされれば落ちる。内向きなら橋の上で起き上がる
  assert.ok(p.st === ST.fall || p.falls === 1 || (p.st !== ST.hit && p.x > 0.4), `st ${p.st} x ${p.x}`)
})

test('丸太で手すりの外へ飛ばされると落ちる（場外）', () => {
  const g = createGame(ps(1), { rng: rng(3), course: 'forest', rules: { weakRate: 0, gustFirst: 1e9 } })
  run(g, RULES.readySec)
  const p = P(g, 'p0')
  p.st = ST.hit; p.stunT = 1; p.kx = -6; p.ky = 0; p.x = 0.5; p.y = 10.5
  run(g, 0.6)
  assert.equal(p.falls, 1)
  assert.equal(p.fallWhy, 2)
})

test('落石: 影で予告してから落ち、板が傷み、下の人は動けなくなる', () => {
  const g = createGame(ps(1), { rng: () => 0.3, course: 'canyon', rules: { weakRate: 0, gustFirst: 1e9 } })
  run(g, RULES.readySec)
  const p = P(g, 'p0')
  const row0 = 2 * SPAN + 3 // 落石のある区間（やぐらの先）
  p.x = 1.5; p.y = row0 + 0.5
  let warned = null
  for (let t = 0; t < 10 && !warned; t += 0.05) { p.x = 1.5; p.y = row0 + 0.5; g.tick(0.05); if (g._debug.rocks.length) warned = { ...g._debug.rocks[0] } }
  assert.ok(warned, '落石の予告が出る')
  assert.equal(warned.ph, 1)
  assert.ok(g.view().r.length === 4 * g._debug.rocks.length)
  // 落ちる場所に立つ
  const k = Math.floor(warned.y) * g._debug.cols + Math.floor(warned.x)
  p.x = warned.x; p.y = warned.y; p.dx = 0; p.dy = 0
  run(g, RULES.rockWarn + 0.1)
  assert.ok(g._debug.hp[k] <= 1 - RULES.rockDamage + 0.05, `板が傷む ${g._debug.hp[k]}`)
  assert.ok(p.hits === 1, '下にいた人に当たる')
})

test('凍った板はすべる: 手を離しても進み続け、すぐには止まれない', () => {
  const g = createGame(ps(1), quiet('snow'))
  const { cols, flag } = g._debug
  for (let k = 0; k < flag.length; k++) if (!(flag[k] & FLAG.deck)) flag[k] = FLAG.ice
  run(g, RULES.readySec)
  place(g, 'p0', 1.5, 3)
  g.input('p0', { type: 'move', dx: 0, dy: 1 })
  run(g, 1.5)
  const p = P(g, 'p0')
  const v1 = p.vy
  assert.ok(v1 > 1 && v1 < RULES.walk, `動き出しが遅い ${v1}`)
  g.input('p0', { type: 'move', dx: 0, dy: 0 })
  const y0 = p.y
  run(g, 0.5)
  assert.ok(p.y - y0 > 0.4, `止めてもすべる ${p.y - y0}`)
  // 普通の板ならすぐ止まる
  const h = createGame(ps(1), quiet('forest'))
  run(h, RULES.readySec); place(h, 'p0', 1.5, 3); h.input('p0', { type: 'move', dx: 0, dy: 1 }); run(h, 1.5)
  h.input('p0', { type: 'move', dx: 0, dy: 0 }); const y1 = P(h, 'p0').y; run(h, 0.5)
  assert.ok(P(h, 'p0').y - y1 < 0.01)
  assert.ok(cols === 3)
})

test('焼けた板は誰も乗らなくても燃え落ちる。1段まるごと焼けた板にはならない', () => {
  const g = createGame(ps(2), { rng: rng(5), course: 'volcano', rules: { weakRate: 0, gustFirst: 1e9, hazards: false } })
  const { flag, hp, cols, rows } = g._debug
  let heat = -1
  for (let r = 0; r < rows; r++) {
    let n = 0
    for (let c = 0; c < cols; c++) if (flag[r * cols + c] & FLAG.heat) { n++; if (heat < 0) heat = r * cols + c }
    assert.ok(n < cols, `段 ${r} が全部焼けている`)
  }
  assert.ok(heat >= 0)
  run(g, RULES.readySec)
  for (const p of g._debug.ps) p.y = -2
  run(g, 5)
  assert.equal(hp[heat], 1, '誰も近づかないうちは燃えない')
  // 1人が橋の奥まで行くと、そこまでの区間が燃え始める
  const p0 = g._debug.ps[0]; p0.x = 0.5; p0.y = rows - 3
  run(g, 0.1); p0.y = -2
  run(g, 10)
  assert.ok(hp[heat] < 0.9 && hp[heat] > 0.7, `焼けた板 ${hp[heat]}`)
  const cold = [...flag.keys()].find(k => !flag[k])
  assert.equal(hp[cold], 1)
})

test('やぐら: 割れない。通ったあとに落ちると、スタートでなくやぐらから戻る', () => {
  const g = createGame(ps(1), quiet('canyon'))
  const { deckRow, cols } = g._debug
  const d0 = 2 * SPAN
  assert.equal(deckRow[d0], 1); assert.equal(deckRow[d0 + 1], 1); assert.equal(deckRow[d0 + 2], 0)
  run(g, RULES.readySec)
  place(g, 'p0', 1.5, d0 + 0.5)
  g.input('p0', { type: 'move', dx: 0, dy: 0.5 }); run(g, 0.2); g.input('p0', { type: 'move', dx: 0, dy: 0 })
  assert.equal(P(g, 'p0').cp, d0)
  // やぐらの先の板を割って落とす
  place(g, 'p0', 1.5, d0 + 3.5)
  g._debug.hp[(d0 + 3) * cols + 1] = 0
  run(g, 0.1)
  assert.equal(P(g, 'p0').st, ST.fall)
  run(g, RULES.fallSec + 0.1)
  const p = P(g, 'p0')
  assert.ok(p.y >= d0 && p.y < d0 + 2, `やぐらから戻る y=${p.y}`)
  // やぐらの板には重さをかけても傷まない
  for (let i = 0; i < 1; i++) { place(g, 'p0', 1.5, d0 + 0.5) }
  run(g, 3)
  assert.equal(g._debug.hp[d0 * cols + 1], 1)
})

test('お守りを拾うと個人の数が増え、差分で全員に届く。2個以上で「お守り長者」', () => {
  const g = createGame(ps(2), quiet('forest'))
  const { coins } = g._debug
  assert.ok(coins.length >= 5, `お守り ${coins.length}`)
  assert.equal(g.view().coins.length, coins.length * 3)
  run(g, RULES.readySec)
  const seen = []
  for (const o of coins.slice(0, 2)) {
    place(g, 'p1', o.x, o.y)
    g.tick(0.05); g.tick(0.05)
    const f = g.frame() || (g.tick(0.05), g.frame())
    if (f && f.co) seen.push(...f.co)
  }
  assert.equal(P(g, 'p1').coins, 2)
  assert.equal(coins[0].owner, 1)
  assert.deepEqual(seen.filter((_, i) => i % 2 === 1), [1, 1], '拾った人の番号が届く')
  const r = g.result()
  assert.ok(r.awards.some(a => a.key === 'coin' && a.name === 'n1'))
  assert.equal(r.coins, 2)
  assert.ok(r.ranking.find(x => x.id === 'p1').titles.includes('coin'))
})

test('結果: チーム目標がそろった時刻と星（成功1・落ちた回数が少ない2・速い3）', () => {
  const g = createGame(ps(3), quiet('forest'))
  run(g, RULES.readySec)
  for (const id of ['p0', 'p1', 'p2']) { place(g, id, 1.5, 27.8); g.input(id, { type: 'move', dx: 0, dy: 1 }) }
  run(g, 1)
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.win, true)
  assert.equal(r.stars, 3)
  assert.ok(r.teamTime > 0 && r.teamTime < 2)
  assert.ok(r.awards.some(a => a.key === 'last'), 'しんがり')
  const lose = createGame(ps(2), quiet('forest')); run(lose, timeFor(2) + 4)
  assert.equal(lose.result().stars, 0)
})

test('100人でロングの橋: 全体の view は大きくなりすぎず、tick は軽い', () => {
  const g = createGame(ps(100), { rng: rng(9), course: 'long' })
  run(g, RULES.readySec)
  for (let i = 0; i < 100; i++) g.input('p' + i, { type: 'move', dx: Math.sin(i), dy: 1, run: i % 3 === 0 })
  const t0 = performance.now()
  for (let i = 0; i < 200; i++) { g.tick(0.05); g.frame() }
  const per = (performance.now() - t0) / 200
  assert.ok(per < 3, `tick ${per}ms`)
  const full = JSON.stringify(g.view()).length
  assert.ok(full < 16000, `view ${full}B`)
})

test('丸太の位置の式は画面と同じ（logsFor が橋の幅で変わる）', () => {
  const a = logsFor('canyon', 3), b = logsFor('canyon', 18)
  assert.equal(a.length, 1)
  assert.ok(b[0].period > a[0].period, '広い橋ほどゆっくり')
  assert.ok(Math.abs(logX(a[0], 0, 3) - logX(a[0], a[0].period, 3)) < 1e-9, '周期で同じ位置')
  const { rows } = layout('long')
  for (const L of logsFor('long', 5)) assert.ok(L.row < rows)
})
