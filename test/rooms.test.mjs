// ルーム管理の単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomManager, LIMITS, cleanName } from '../lib/rooms.mjs'
import * as realDef from '../lib/game.mjs'

// 弱い板と突風を消して、結果がぶれないようにしたゲーム
const gameDef = { meta: realDef.meta, createGame: (p, o) => realDef.createGame(p, { ...o, rules: { weakRate: 0, gustFirst: 1e9 } }) }

function setup() {
  let t = 0
  const sent = []
  const m = new RoomManager(gameDef, { send: (id, msg) => sent.push([id, msg]), sendRaw: (id, data) => sent.push([id, JSON.parse(String(data))]), now: () => t })
  const s = () => m.newSession().id
  return { m, s, sent, advance: ms => { t += ms; m.tick(ms) } }
}

test('部屋を作るとコードが出て、作った人がホストになる', () => {
  const { m, s } = setup()
  const a = s()
  const r = m.create(a, 'たろう')
  assert.match(r.code, /^[A-Z2-9]{4}$/)
  assert.equal(m.rooms.get(r.code).hostId, a)
})

test('参加コードで入れる。小文字でも入れる', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  assert.deepEqual(m.join(b, code.toLowerCase(), 'B'), { code })
  assert.equal(m.rooms.get(code).players.length, 2)
})

test('入れないときは理由を返す（無い・満員・開始後・名前なし）', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  assert.equal(m.join(s(), 'ZZZZ', 'x').error, 'not_found')
  assert.equal(m.join(s(), code, '   ').error, 'bad_name')
  for (let i = 1; i < gameDef.meta.maxPlayers; i++) m.join(s(), code, 'p' + i)
  assert.equal(m.join(s(), code, 'over').error, 'full')
  const { code: c2 } = m.create(s(), 'H')
  const host = m.rooms.get(c2).hostId
  m.start(host)
  assert.equal(m.join(s(), c2, 'late').error, 'started')
})

test('名前は12文字まで・制御文字と<>は消す・同じ名前には番号がつく', () => {
  assert.equal(cleanName('<b>abcdefghijklmnop'), 'babcdefghijk')
  const { m, s } = setup()
  const { code } = m.create(s(), 'A')
  m.join(s(), code, 'A')
  assert.deepEqual(m.rooms.get(code).players.map(p => p.name), ['A', 'A2'])
})

test('ホスト以外はスタートできない。人数が足りないと始まらない', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  assert.equal(m.start(b).error, 'not_host')
  assert.equal(m.start(a).ok, true)
  assert.equal(m.rooms.get(code).phase, 'playing')
})

test('ゲームが終わると結果になり、ホストが再戦できる', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  for (let i = 0; i < realDef.RULES.readySec * 10 + 1; i++) advance(100) // 1回の tick で進むのは最大0.25秒なので刻む
  m.input(a, { type: 'move', dx: 0, dy: 1 })
  for (let i = 0; i < 300 && m.rooms.get(code).phase === 'playing'; i++) advance(100)
  const room = m.rooms.get(code)
  assert.equal(room.phase, 'result')
  assert.equal(room.result.win, true)
  assert.equal(m.rematch(a).ok, true)
  assert.equal(room.phase, 'playing')
  assert.equal(room.round, 2)
})

test('不正な入力は状態を変えない', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  const before = JSON.stringify(m.rooms.get(code).game.view(a))
  assert.equal(m.input(a, { type: 'hack', n: 999 }).error, 'bad_input')
  assert.equal(m.input(a, null).error, 'bad_input')
  assert.equal(m.input(a, { type: 'move', dx: 1e9, dy: 0 }).error, 'bad_input')
  assert.equal(JSON.stringify(m.rooms.get(code).game.view(a)), before)
  assert.equal(m.input(s(), { type: 'move', dx: 0, dy: 1 }).error, 'not_playing') // 部屋にいない人
})

test('時間切れで負けになる', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  for (let i = 0; i < (realDef.timeFor(1) + realDef.RULES.readySec + 1) * 10; i++) advance(100)
  assert.equal(m.rooms.get(code).phase, 'result')
  assert.equal(m.rooms.get(code).result.win, false)
})

test('ホストが切れたままだと次の人がホストになる。戻れば同じ席', () => {
  const { m, s, advance } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  m.disconnect(a)
  advance(LIMITS.hostGraceMs + 100)
  assert.equal(m.rooms.get(code).hostId, b)
  assert.equal(m.reconnect(a), code)
  assert.equal(m.rooms.get(code).players.find(p => p.id === a).connected, true)
})

test('切断が長いと席が消え、誰もいない部屋は消える', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.disconnect(a)
  advance(LIMITS.reconnectGraceMs + 100)
  assert.equal(m.rooms.get(code).players.length, 0)
  advance(LIMITS.emptyRoomMs + 100)
  assert.equal(m.rooms.has(code), false)
})

test('他人の token では席を奪えない', () => {
  const { m } = setup()
  const a = m.newSession()
  assert.equal(m.resume(a.id, 'wrong'), null)
  assert.ok(m.resume(a.id, a.token))
})

test('共通部分は1回だけ JSON にしても、人ごとの you は正しい。ゲーム中は差分 f が全員に同じ中身で届く', () => {
  const { m, s, sent, advance } = setup()
  const a = s(), b = s(), c = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B'); m.join(c, code, 'C')
  sent.length = 0
  m.start(a)
  const states = sent.filter(([, msg]) => msg.t === 'state')
  assert.equal(states.length, 3)
  for (const [id, msg] of states) { assert.equal(msg.you, id); assert.equal(msg.phase, 'playing'); assert.equal(msg.game.roster.length, 3) }
  sent.length = 0
  advance(50); advance(50)
  const frames = sent.filter(([, msg]) => msg.t === 'f')
  assert.equal(frames.length, 3)
  assert.equal(new Set(frames.map(([, f]) => JSON.stringify(f))).size, 1)
  assert.equal(sent.filter(([, msg]) => msg.t === 'state').length, 0, 'ゲーム中は毎 tick 全体を送らない')
})

test('naive（雛形と同じ送り方）にすると毎 tick 人ごとに全体を送る（負荷試験の比較用）', () => {
  let t = 0
  const sent = []
  const m = new RoomManager(gameDef, { send: (id, msg) => sent.push([id, msg]), now: () => t, naive: true })
  const a = m.newSession().id, b = m.newSession().id
  const { code } = m.create(a, 'A'); m.join(b, code, 'B')
  m.start(a); sent.length = 0
  t += 50; m.tick(50)
  assert.deepEqual(sent.map(([id, msg]) => [id, msg.t]), [[a, 'state'], [b, 'state']])
})

test('画面から届いた opts に rng やルールを入れても落ちず、ルールも変わらない', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  assert.equal(m.start(a, { rng: 'x', rules: { rows: 1 }, timeLimit: 9999, cols: 1, cap: 1e9 }).ok, true)
  const v = m.rooms.get(code).game.view(null)
  assert.equal(v.rows, 28)
  assert.equal(v.cols, 3)
  assert.equal(v.limit, realDef.timeFor(1))
  m.rooms.get(code).game.tick(0.05) // rng を使う処理が落ちない
})

test('最大100人まで入れて、100人で始められる', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  for (let i = 1; i < 100; i++) assert.equal(m.join(s(), code, 'p' + i).code, code)
  assert.equal(m.join(s(), code, 'x').error, 'full')
  assert.equal(m.start(a).ok, true)
  assert.equal(m.rooms.get(code).game.view(null).roster.length, 100)
})

test('ゲーム中に抜けた人は結果に入らず、ほかの人は続けられる', () => {
  const { m, s, advance } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A'); m.join(b, code, 'B')
  m.start(a)
  m.leave(b)
  const room = m.rooms.get(code)
  assert.equal(room.phase, 'playing')
  for (let i = 0; i < realDef.RULES.readySec * 10 + 1; i++) advance(100) // 1回の tick で進むのは最大0.25秒なので刻む
  assert.deepEqual(m.input(a, { type: 'move', dx: 0, dy: 1 }), { ok: true })
  assert.equal(m.input(b, { type: 'move', dx: 0, dy: 1 }).error, 'not_playing')
  for (let i = 0; i < 300 && room.phase === 'playing'; i++) advance(100)
  assert.equal(room.result.n, 1)
  assert.ok(!room.result.ranking.some(r => r.id === b))
})

test('start に渡す opts は文字・数字・真偽値だけになり、rng は捨てられる', () => {
  let got = null
  const spy = { meta: realDef.meta, createGame: (p, o) => { got = o; return realDef.createGame(p, {}) } }
  const m = new RoomManager(spy, {})
  const a = m.newSession().id
  m.create(a, 'A')
  m.start(a, { rng: 'x', rules: { rows: 1 }, fn: () => 1, s: 'x'.repeat(100), n: 3, b: true })
  assert.equal('rng' in got, false)
  assert.equal('rules' in got, false)
  assert.equal('fn' in got, false)
  assert.equal(got.s.length, 40)
  assert.equal(got.n, 3)
  assert.equal(got.b, true)
})
