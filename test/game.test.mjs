// ルールの単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, meta, RULES, ST, colsFor, needFor, timeFor } from '../lib/game.mjs'

function rng(seed = 1) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const ps = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'n' + i }))
// 弱い板と突風を消した、結果がぶれない設定
const calm = (extra = {}) => ({ rng: rng(7), rules: { weakRate: 0, gustFirst: 1e9, ...extra } })
const run = (g, sec) => { for (let t = 0; t < sec; t += 0.05) { g.tick(0.05); g.frame() } }
const place = (g, id, x, y) => { const p = g._debug.ps.find(p => p.id === id); p.x = x; p.y = y }

test('人数: 1人から100人。大人数ほど橋が広く時間が長い', () => {
  assert.equal(meta.minPlayers, 1)
  assert.equal(meta.maxPlayers, 100)
  assert.equal(colsFor(1), 3)
  assert.equal(colsFor(100), 18)
  assert.ok(timeFor(100) > timeFor(1))
  assert.equal(needFor(1), 1)
  assert.equal(needFor(10), 7)
  assert.equal(needFor(100), 70)
})

test('1人で歩いて渡りきるとチーム成功。ゴールで終わり、着順と秒数が残る', () => {
  const g = createGame(ps(1), calm())
  run(g, RULES.readySec)
  g.input('p0', { type: 'move', dx: 0, dy: 1 })
  run(g, 25)
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.win, true)
  assert.equal(r.title, 'チーム成功')
  assert.equal(r.goals, 1)
  assert.equal(r.ranking[0].done, true)
  assert.ok(r.ranking[0].time > 12 && r.ranking[0].time < 20, `time ${r.ranking[0].time}`)
})

test('秒読みの間は動けない', () => {
  const g = createGame(ps(1), calm())
  const y0 = g._debug.ps[0].y
  g.input('p0', { type: 'move', dx: 0, dy: 1 })
  run(g, 2)
  assert.equal(g._debug.ps[0].y, y0)
  assert.equal(g.view().ph, 0)
})

test('秒読み中に押しっぱなしにしていた向きで、始まった瞬間に動き出す', () => {
  const g = createGame(ps(1), calm())
  const y0 = g._debug.ps[0].y
  g.input('p0', { type: 'move', dx: 0, dy: 1 })
  run(g, RULES.readySec + 1)
  assert.ok(g._debug.ps[0].y - y0 > 1.5, `moved ${g._debug.ps[0].y - y0}`)
})

test('時間切れで負け。ゴールしていない人は進んだ割合で並ぶ', () => {
  const g = createGame(ps(2), calm())
  run(g, RULES.readySec)
  g.input('p0', { type: 'move', dx: 0, dy: 1 })
  run(g, 4)
  g.input('p0', { type: 'move', dx: 0, dy: 0 })
  run(g, timeFor(2) + 1)
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.win, false)
  assert.equal(r.title, '時間切れ')
  assert.equal(r.ranking[0].id, 'p0')
  assert.ok(r.ranking[0].prog > r.ranking[1].prog)
})

test('同じ板に人が集まると割れて落ち、スタートに戻る', () => {
  const g = createGame(ps(3), calm())
  run(g, RULES.readySec)
  for (const id of ['p0', 'p1', 'p2']) place(g, id, 1.5, 5.5) // 重さ3 > 上限2.5
  run(g, 4)
  const k = 5 * g._debug.cols + 1
  assert.equal(g._debug.hp[k], 0)
  for (const p of g._debug.ps) assert.equal(p.falls, 1)
  run(g, RULES.fallSec + 0.2)
  for (const p of g._debug.ps) { assert.notEqual(p.st, ST.fall); assert.ok(p.y < 0, 'スタートに戻る') }
})

test('2人までなら同じ板でもすぐには割れない', () => {
  const g = createGame(ps(2), calm())
  run(g, RULES.readySec)
  for (const id of ['p0', 'p1']) place(g, id, 1.5, 5.5)
  run(g, 4)
  assert.ok(g._debug.hp[5 * g._debug.cols + 1] > 0.6)
})

test('走ると歩くより板が傷む', () => {
  const pass = runFlag => {
    const g = createGame(ps(1), calm())
    run(g, RULES.readySec)
    place(g, 'p0', 1.5, 2.0)
    g.input('p0', { type: 'move', dx: 0, dy: 0.0001, run: runFlag }) // その場でほぼ止まって乗り続ける
    g._debug.ps[0].dy = 0.06
    run(g, 2)
    return 1 - g._debug.hp[2 * g._debug.cols + 1]
  }
  const walk = pass(false), runD = pass(true)
  assert.ok(walk > 0, 'walk damage')
  assert.ok(runD > walk * 3, `run ${runD} walk ${walk}`)
})

test('区間の重さの上限を超えると、誰も乗っていない板まで傷む', () => {
  const g = createGame(ps(10), calm())
  const cols = g._debug.cols
  run(g, RULES.readySec)
  // 区間0（0〜6段目）にばらけて10人。1枚あたりは軽いが区間の上限 cols*1.3 を超える
  g._debug.ps.forEach((p, i) => { p.x = (i % cols) + 0.5; p.y = 1 + Math.floor(i / cols) * 2 + 0.5 })
  assert.ok(10 > g._debug.spanCap)
  run(g, 1)
  const empty = 6 * cols + 0 // 6段目は誰もいない
  assert.ok(g._debug.hp[empty] < 1, '区間の板が傷む')
  const other = 10 * cols // 区間1は無傷
  assert.equal(g._debug.hp[other], 1)
})

test('突風: 予告のあと吹く。吹いている区間で動くと傷み、止まっていれば傷まない', () => {
  const mk = moving => {
    const g = createGame(ps(1), { rng: () => 0.01, rules: { weakRate: 0, gustFirst: 0.1, gustWarn: 0.2, gustBlow: 2 } })
    run(g, RULES.readySec + 0.35)
    assert.equal(g._debug.gust.phase, 2)
    assert.equal(g._debug.gust.span, 0)
    assert.deepEqual(g.view().w.slice(0, 2), [0, 2])
    place(g, 'p0', 1.5, 3.5)
    g.input('p0', { type: 'move', dx: moving ? 0.001 : 0, dy: 0 }) // ほぼ動かないが「動いている」扱い
    g._debug.ps[0].dx = moving ? 0.06 : 0
    run(g, 1)
    return 1 - g._debug.hp[3 * g._debug.cols + 1]
  }
  const still = mk(false), moving = mk(true)
  assert.ok(still <= RULES.wear + 1e-6, `止まっていれば普段どおりの傷みだけ ${still}`)
  assert.ok(moving > 0.2, `moving ${moving}`)
})

test('1段まるごと割れると橋が落ち、乗っていた人は全員落ちて終わる', () => {
  const g = createGame(ps(3), calm())
  const cols = g._debug.cols
  assert.equal(cols, 3)
  run(g, RULES.readySec)
  g._debug.hp[8 * cols] = 0.001; g._debug.hp[8 * cols + 1] = 0.001; g._debug.hp[8 * cols + 2] = 0
  place(g, 'p0', 0.5, 8.5); place(g, 'p1', 1.5, 8.5); place(g, 'p2', 1.5, 12.5)
  run(g, 0.2)
  assert.equal(g.view().ph, 2)
  assert.equal(g._debug.ps[2].st, ST.fall, '別の段にいた人も落ちる')
  run(g, RULES.collapseSec + 0.1)
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.collapsed, true)
  assert.equal(r.title, '橋が落ちた')
  assert.equal(r.win, false)
})

test('10人中7人がゴールすればチーム成功（残りは時間切れでも）', () => {
  const g = createGame(ps(10), calm())
  run(g, RULES.readySec)
  for (let i = 0; i < 7; i++) place(g, 'p' + i, 0.5 + (i % 5), 27.9)
  for (let i = 0; i < 7; i++) g.input('p' + i, { type: 'move', dx: 0, dy: 1 })
  run(g, 1)
  for (let i = 0; i < 7; i++) g.input('p' + i, { type: 'move', dx: 0, dy: 0 })
  assert.equal(g.view().g, 7)
  run(g, timeFor(10))
  const r = g.result()
  assert.equal(r.win, true)
  assert.equal(r.goals, 7)
  assert.equal(r.need, 7)
  assert.ok(r.ranking.slice(0, 7).every(x => x.done))
  assert.ok(r.awards.some(a => a.key === 'fast'))
})

test('ゴールした人は橋に戻れない', () => {
  const g = createGame(ps(2), calm())
  run(g, RULES.readySec)
  place(g, 'p0', 1.5, 27.9)
  g.input('p0', { type: 'move', dx: 0, dy: 1 }); run(g, 0.5)
  assert.equal(g._debug.ps[0].st, ST.done)
  g.input('p0', { type: 'move', dx: 0, dy: -1 }); run(g, 3)
  assert.ok(g._debug.ps[0].y >= 28.3)
})

test('不正な入力は { error } を返して状態を変えない', () => {
  const g = createGame(ps(1), calm())
  run(g, RULES.readySec)
  const before = JSON.stringify(g.view())
  const bad = [null, 1, 'x', {}, { type: 'hack' }, { type: 'move' }, { type: 'move', dx: NaN, dy: 0 }, { type: 'move', dx: Infinity, dy: 0 },
    { type: 'move', dx: 99, dy: 0 }, { type: 'move', dx: '1', dy: '1' }, { type: 'call', k: 9 }, { type: 'call', k: 1.5 }, { type: 'call' }]
  for (const b of bad) assert.ok(g.input('p0', b).error, JSON.stringify(b))
  assert.equal(g.input('nobody', { type: 'move', dx: 0, dy: 1 }).error, 'not_player')
  assert.equal(JSON.stringify(g.view()), before)
  // 1.5以下でも長さ1を超える向きは1に縮める（速く走れない）
  g.input('p0', { type: 'move', dx: 1.4, dy: 1.4 })
  assert.ok(Math.hypot(g._debug.ps[0].dx, g._debug.ps[0].dy) <= 1.0001)
})

test('合図は送れるが、連打は止まる', () => {
  const g = createGame(ps(2), calm())
  assert.deepEqual(g.input('p0', { type: 'call', k: 1 }), { ok: true })
  assert.equal(g.input('p0', { type: 'call', k: 2 }).error, 'too_fast')
  assert.deepEqual(g.view().c, [0, 1])
  run(g, RULES.callSec + 0.1)
  assert.deepEqual(g.view().c, [])
})

test('途中で抜けた人は数えない。残りが全員ゴールなら終わる', () => {
  const g = createGame(ps(3), calm())
  run(g, RULES.readySec)
  place(g, 'p0', 1.5, 27.9); place(g, 'p1', 0.5, 27.9)
  g.input('p0', { type: 'move', dx: 0, dy: 1 }); g.input('p1', { type: 'move', dx: 0, dy: 1 })
  run(g, 0.5)
  assert.equal(g.isOver(), false)
  g.removePlayer('p2')
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.n, 2)
  assert.equal(r.win, true)
  assert.ok(!r.ranking.some(x => x.id === 'p2'))
  assert.equal(g.view().p[2 * 3 + 2], ST.gone, '番号は詰めずに「いない」にする')
})

test('全員が同じ view を受け取り、秘密（token）は入っていない', () => {
  const g = createGame(ps(3), calm())
  assert.deepEqual(g.view('p0'), g.view('p1'))
  assert.ok(!JSON.stringify(g.view()).includes('token'))
})

test('frame は2tickに1回。動いた人と変わった板だけを送る', () => {
  const g = createGame(ps(5), calm())
  run(g, RULES.readySec)
  g.tick(0.05); g.frame(); g.tick(0.05); g.frame() // 送った値をそろえる
  g.input('p3', { type: 'move', dx: 0, dy: 1 })
  g.tick(0.05)
  const first = g.frame()
  g.tick(0.05)
  const f = first || g.frame()
  assert.ok(f)
  assert.deepEqual(f.p.filter((_, i) => i % 4 === 0), [3])
  assert.deepEqual(f.k, [])
})

test('100人: 橋は18列、1回の tick は軽く、止まっていれば frame は小さい', () => {
  const g = createGame(ps(100), { rng: rng(3) })
  assert.equal(g._debug.cols, 18)
  run(g, RULES.readySec)
  for (let i = 0; i < 100; i++) g.input('p' + i, { type: 'move', dx: Math.sin(i), dy: 1, run: i % 3 === 0 })
  const t0 = performance.now()
  for (let i = 0; i < 200; i++) { g.tick(0.05); g.frame() }
  const per = (performance.now() - t0) / 200
  assert.ok(per < 2, `tick ${per}ms`)
  const full = JSON.stringify(g.view()).length
  assert.ok(full < 12000, `view ${full}B`)
  for (let i = 0; i < 100; i++) g.input('p' + i, { type: 'move', dx: 0, dy: 0 })
  g.tick(0.05); g.frame(); g.tick(0.05); g.frame(); g.tick(0.05); g.frame(); g.tick(0.05)
  const f = g.frame() || (g.tick(0.05), g.frame())
  if (f) assert.ok(JSON.stringify(f).length < 300, `idle frame ${JSON.stringify(f).length}B`)
})

test('サーバーが詰まって大きな dt が来ても、一度に進むのは0.25秒まで', () => {
  const g = createGame(ps(1), calm())
  run(g, RULES.readySec)
  g.input('p0', { type: 'move', dx: 0, dy: 1 })
  const y0 = g._debug.ps[0].y
  g.tick(5)
  assert.ok(g._debug.ps[0].y - y0 <= 0.25 * RULES.walk + 1e-6)
})

test('賞: 一番乗り・橋にやさしい・破壊王（板1枚ぶん以上傷めた人だけ）', () => {
  const g = createGame(ps(3), calm())
  run(g, RULES.readySec)
  g._debug.ps[2].dmg = 1.2
  g._debug.ps[1].dmg = 0.1
  place(g, 'p0', 0.5, 27.9); place(g, 'p1', 1.5, 27.9)
  g.input('p0', { type: 'move', dx: 0, dy: 1 }); run(g, 0.2); g.input('p1', { type: 'move', dx: 0, dy: 1 }); run(g, 0.5)
  const r = g.result()
  assert.deepEqual(r.awards.map(a => [a.key, a.name]), [['fast', 'n0'], ['gentle', 'n0'], ['break', 'n2']])
  const g2 = createGame(ps(2), calm())
  assert.ok(!g2.result().awards.some(a => a.key === 'break'))
})
