// 1つのゲームだけを配信するサーバー。画面（public/）と WebSocket（/ws）を同じポートで出す。
// 起動: node server.mjs   （PORT=8080 node server.mjs でポート変更）

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { RoomManager } from './lib/rooms.mjs'
import * as gameDef from './lib/game.mjs'

const ROOT = fileURLToPath(new URL('./public/', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
const MAX_MSG = 4096          // 1メッセージの上限（バイト）
const MAX_INPUT_PER_SEC = 40  // 1接続あたりの操作の上限（毎秒）

export function startServer({ port = Number(process.env.PORT) || 8105, quiet = false, naive = process.env.BRIDGE_NAIVE === '1', stats = process.env.STATS === '1', gameOpts = null } = {}) {
  // gameOpts はテストからだけ渡す（橋を短くする等）。画面から来る opts はゲームに渡さない（ルールを書き換えられないように）
  const def = gameOpts ? { meta: gameDef.meta, createGame: (p, o) => gameDef.createGame(p, { ...o, ...gameOpts }) } : gameDef
  const sockets = new Map() // sessionId -> ws
  // 計測（負荷試験用）。送った量と tick にかかった時間を数える。/stats は STATS=1 のときだけ開く
  const M = { outBytes: 0, outMsgs: 0, inBytes: 0, inMsgs: 0, ticks: [], since: Date.now(), cpu: process.cpuUsage() }
  const eld = monitorEventLoopDelay({ resolution: 10 }); eld.enable()
  const out = (ws, data) => {
    if (!ws || ws.readyState !== 1) return
    M.outBytes += typeof data === 'string' ? Buffer.byteLength(data) : data.length
    M.outMsgs++
    ws.send(data, { binary: false })
  }
  const rooms = new RoomManager(def, {
    naive,
    send: (id, msg) => out(sockets.get(id), JSON.stringify(msg)),
    sendRaw: (id, data) => out(sockets.get(id), data)
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, game: gameDef.meta.id, rooms: rooms.rooms.size, sessions: sockets.size }))
    }
    if (url.pathname === '/stats' && stats) {
      // 前回 /stats を読んでからの平均。reset=0 なら数え直さない
      const now = Date.now(), sec = (now - M.since) / 1000
      const cpu = process.cpuUsage(M.cpu)
      const t = [...M.ticks].sort((a, b) => a - b)
      const q = f => (t.length ? t[Math.min(t.length - 1, Math.floor(t.length * f))] : 0)
      const mem = process.memoryUsage()
      const body = {
        sec, sessions: sockets.size, rooms: rooms.rooms.size, naive,
        outKBps: M.outBytes / 1024 / sec, outMsgsPerSec: M.outMsgs / sec, inKBps: M.inBytes / 1024 / sec, inMsgsPerSec: M.inMsgs / sec,
        tickAvgMs: t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0, tickP95Ms: q(0.95), tickMaxMs: t.length ? t[t.length - 1] : 0, ticks: t.length,
        cpuPct: (cpu.user + cpu.system) / 1000 / (sec * 1000) * 100,
        rssMB: mem.rss / 1048576, heapMB: mem.heapUsed / 1048576,
        loopDelayP99Ms: eld.percentile(99) / 1e6, loopDelayMaxMs: eld.max / 1e6
      }
      if (url.searchParams.get('reset') !== '0') { Object.assign(M, { outBytes: 0, outMsgs: 0, inBytes: 0, inMsgs: 0, ticks: [], since: now, cpu: process.cpuUsage() }); eld.reset() }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(body))
    }
    // /r/ABCD のような招待URLも index.html を返す（画面側でコードを読む）
    let path = url.pathname === '/' || url.pathname.startsWith('/r/') ? '/index.html' : url.pathname
    const file = normalize(join(ROOT, decodeURIComponent(path)))
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
    try {
      let body = await readFile(file)
      if (path === '/index.html') {
        // og:image は絶対URLでないと読まない SNS があるので、来たホスト名で書き換える
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g, '')
        const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http'
        if (host) body = Buffer.from(String(body).replaceAll('content="/og.png"', `content="${proto}://${host}/og.png"`).replace('<meta property="og:type"', `<meta property="og:url" content="${proto}://${host}/">\n<meta property="og:type"`))
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found')
    }
  })

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG })
  wss.on('connection', ws => {
    let session = null
    let tokens = MAX_INPUT_PER_SEC, lastRefill = Date.now() // 操作の送りすぎを抑える（部屋の操作は制限しない）
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })

    const reply = msg => out(ws, JSON.stringify(msg))

    ws.on('message', raw => {
      M.inBytes += raw.length; M.inMsgs++
      let msg
      try { msg = JSON.parse(raw) } catch { return reply({ t: 'error', code: 'bad_json' }) }
      if (!msg || typeof msg.t !== 'string') return reply({ t: 'error', code: 'bad_msg' })

      if (msg.t === 'hello') {
        // 前のセッションに戻れるなら戻る（token が一致するときだけ）
        if (msg.id && msg.token && rooms.resume(msg.id, msg.token)) session = msg.id
        else { const s = rooms.newSession(); session = s.id; reply({ t: 'session', id: s.id, token: s.token }) }
        const old = sockets.get(session); if (old && old !== ws) old.close(4000, 'replaced')
        sockets.set(session, ws)
        const code = rooms.reconnect(session)
        reply({ t: 'welcome', id: session, code, game: gameDef.meta })
        if (code) rooms.broadcast(rooms.rooms.get(code))
        return
      }
      if (!session) return reply({ t: 'error', code: 'no_session' })
      if (msg.t === 'input') {
        const now = Date.now()
        tokens = Math.min(MAX_INPUT_PER_SEC, tokens + (now - lastRefill) * MAX_INPUT_PER_SEC / 1000)
        lastRefill = now
        if (tokens < 1) return // 送りすぎた操作だけ捨てる
        tokens -= 1
      }

      let r
      switch (msg.t) {
        case 'create': r = rooms.create(session, msg.name); break
        case 'join': r = rooms.join(session, msg.code, msg.name); break
        case 'leave': rooms.leave(session); r = { ok: true }; break
        case 'start': r = rooms.start(session, msg.opts); break
        case 'input': r = rooms.input(session, msg.data); break
        case 'rematch': r = rooms.rematch(session, msg.opts); break
        case 'setup': r = rooms.setup(session, msg.opts); break
        case 'lobby': r = rooms.backToLobby(session); break
        case 'ping': return reply({ t: 'pong', at: msg.at })
        default: r = { error: 'unknown' }
      }
      if (r && r.error) reply({ t: 'error', code: r.error, need: r.need, req: msg.t })
      else if (msg.t === 'create' || msg.t === 'join') reply({ t: 'joined', code: r.code })
    })

    ws.on('close', () => {
      if (session && sockets.get(session) === ws) { sockets.delete(session); rooms.disconnect(session) }
    })
  })

  // 生存確認（切れた接続を掃除）
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue }
      ws.isAlive = false; ws.ping()
    }
  }, 15_000)

  // ゲームの時間を進める
  const tickMs = 1000 / (gameDef.meta.tickHz || 15)
  let last = Date.now()
  const loop = setInterval(() => {
    const t = Date.now(); const t0 = performance.now()
    rooms.tick(t - last); last = t
    if (M.ticks.length < 100000) M.ticks.push(performance.now() - t0)
  }, tickMs)

  return new Promise(resolve => server.listen(port, () => {
    if (!quiet) console.log(`${gameDef.meta.title}: http://localhost:${server.address().port}`)
    resolve({
      port: server.address().port, rooms,
      close: () => new Promise(r => { eld.disable(); clearInterval(loop); clearInterval(heartbeat); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()) })
    })
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer()
