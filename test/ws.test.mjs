// 本物のサーバーを立てて、WebSocket で複数人がつなぐ統合テスト
import test from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { startServer } from '../server.mjs'

function client(port, saved) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const c = { ws, msgs: [], id: null, token: null, state: null }
  ws.on('message', d => {
    const m = JSON.parse(d)
    c.msgs.push(m)
    if (m.t === 'session') { c.id = m.id; c.token = m.token }
    if (m.t === 'state') c.state = m
  })
  c.ready = new Promise(r => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ...(saved || {}) })); r() }))
  c.send = m => ws.send(JSON.stringify(m))
  c.wait = (pred, ms = 3000) => new Promise((res, rej) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      const hit = c.msgs.find(pred)
      if (hit) { clearInterval(iv); res(hit) } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')) }
    }, 10)
  })
  return c
}

// 橋を短く、秒読みを短く、弱い板と突風なし（テストを速く・ぶれなくする）
const SHORT = { rules: { rows: 4, readySec: 0.3, weakRate: 0, gustFirst: 1e9 } }

test('2人がつないで、作成・参加・開始・操作・終了・再戦まで通る', async () => {
  const srv = await startServer({ port: 0, quiet: true, gameOpts: SHORT })
  try {
    const a = client(srv.port), b = client(srv.port)
    await a.ready; await b.ready
    await a.wait(m => m.t === 'welcome'); await b.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    b.send({ t: 'join', code, name: 'B' })
    await b.wait(m => m.t === 'joined')
    await a.wait(m => m.t === 'state' && m.players.length === 2)
    b.send({ t: 'start' })
    await b.wait(m => m.t === 'error' && m.code === 'not_host')
    a.send({ t: 'start' })
    await b.wait(m => m.t === 'state' && m.phase === 'playing')
    await b.wait(m => m.t === 'f' && m.ph === 1)
    for (const c of [a, b]) c.send({ t: 'input', data: { type: 'move', dx: 0, dy: 1, run: true } })
    const end = await b.wait(m => m.t === 'state' && m.phase === 'result', 8000)
    assert.equal(end.result.win, true)
    assert.equal(end.result.goals, 2)
    assert.ok(b.msgs.filter(m => m.t === 'f').length >= 5, 'ゲーム中は差分が届く')
    a.send({ t: 'rematch' })
    await b.wait(m => m.t === 'state' && m.phase === 'playing' && m.round === 2)
    a.ws.close(); b.ws.close()
  } finally { await srv.close() }
})

test('切れても id と token で同じ席に戻れる。token が違うと別人になる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'session')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    const saved = { id: a.id, token: a.token }
    a.ws.close()
    await new Promise(r => setTimeout(r, 100))
    const a2 = client(srv.port, saved)
    const w = await a2.wait(m => m.t === 'welcome')
    assert.equal(w.code, code)
    const st = await a2.wait(m => m.t === 'state')
    assert.equal(st.you, saved.id)
    const evil = client(srv.port, { id: saved.id, token: 'x'.repeat(32) })
    const w2 = await evil.wait(m => m.t === 'welcome')
    assert.notEqual(w2.id, saved.id)
    assert.equal(w2.code, null)
    a2.ws.close(); evil.ws.close()
  } finally { await srv.close() }
})

test('操作を送りすぎても、部屋の操作（再戦など）は捨てられない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' }); await a.wait(m => m.t === 'joined')
    a.send({ t: 'start' }); await a.wait(m => m.t === 'state' && m.phase === 'playing')
    for (let i = 0; i < 300; i++) a.send({ t: 'input', data: { type: 'move', dx: 0, dy: 1 } }) // 一気に送る
    a.send({ t: 'leave' })
    await new Promise(r => setTimeout(r, 200))
    assert.equal(srv.rooms.rooms.get([...srv.rooms.rooms.keys()][0]).players.length, 0)
    a.ws.close()
  } finally { await srv.close() }
})

test('壊れたメッセージを送ってもサーバーは落ちない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready
    a.ws.send('not json')
    a.send({ nope: 1 })
    a.send({ t: 'input', data: { type: 'move', dx: 0, dy: 1 } })
    await a.wait(m => m.t === 'error' && m.code === 'bad_json')
    const res = await fetch(`http://localhost:${srv.port}/healthz`)
    assert.equal((await res.json()).ok, true)
    a.ws.close()
  } finally { await srv.close() }
})

test('画面と招待URL（/r/コード）が返る。フォルダの外は読めない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const base = `http://localhost:${srv.port}`
    assert.equal((await fetch(base + '/')).status, 200)
    assert.match(await (await fetch(base + '/r/ABCD')).text(), /<html/)
    assert.equal((await fetch(base + '/app.js')).status, 200)
    const r = await fetch(base + '/..%2fpackage.json')
    assert.notEqual(r.status, 200)
  } finally { await srv.close() }
})

test('画面から送った opts でルールは変えられない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' }); await a.wait(m => m.t === 'joined')
    a.send({ t: 'start', opts: { cols: 1, timeLimit: 9999, rules: { rows: 1 } } })
    const st = await a.wait(m => m.t === 'state' && m.phase === 'playing')
    assert.equal(st.game.rows, 28)
    assert.equal(st.game.cols, 3)
    assert.ok(st.game.limit < 100)
    a.ws.close()
  } finally { await srv.close() }
})

test('og:image は来たホスト名の絶対URLで返る', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const html = await (await fetch(`http://localhost:${srv.port}/r/ABCD`)).text()
    assert.match(html, new RegExp(`property="og:image" content="http://localhost:${srv.port}/og.png"`))
    assert.match(html, /og:url/)
    const html2 = await (await fetch(`http://localhost:${srv.port}/`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'bridge.example.com"><script>' } })).text()
    assert.match(html2, /content="https:\/\/bridge\.example\.comscript\/og\.png"/)
    assert.ok(!html2.includes('"><script>'))
  } finally { await srv.close() }
})

test('ロビーで選んだ橋が参加者にも届き、その橋で始まる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port), b = client(srv.port)
    await a.ready; await b.ready
    await a.wait(m => m.t === 'welcome'); await b.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    b.send({ t: 'join', code, name: 'B' }); await b.wait(m => m.t === 'joined')
    a.send({ t: 'setup', opts: { course: 'canyon' } })
    await b.wait(m => m.t === 'state' && m.setup && m.setup.course === 'canyon')
    a.send({ t: 'start', opts: { course: 'canyon' } })
    const st = await b.wait(m => m.t === 'state' && m.phase === 'playing')
    assert.equal(st.game.course, 'canyon')
    assert.equal(st.game.rows, 42)
    a.ws.close(); b.ws.close()
  } finally { await srv.close() }
})
