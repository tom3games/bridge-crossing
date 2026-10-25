// 橋を渡れ！ のルール。全員で崩れやすい吊り橋を渡る。
//
// 守る約束（rooms.mjs から呼ばれる）
//   meta: { id, title, minPlayers, maxPlayers, tickHz, sharedView }
//   createGame(players, opts) -> { tick, input, view, isOver, result, removePlayer, frame }
//
// このゲームには秘密の情報が無い（全員が全員の位置を見る）。だから view は全員同じ内容で、
// meta.sharedView = true のとき rooms.mjs は view を1回だけ作って全員に配る。
// frame() はゲーム中の差分（動いた人と傷んだ板だけ）。rooms.mjs が tick ごとに呼び、null でなければ全員に同じ文字列を送る。
//
// 座標: x は橋の幅方向（0〜cols）、y は進む方向（0〜rows が橋、y<0 がスタートの崖、y>=rows がゴールの崖）。1 = 板1枚。

export const meta = {
  id: 'bridge-crossing',
  title: '橋を渡れ！',
  minPlayers: 1,
  maxPlayers: 100,
  tickHz: 20,
  sharedView: true
}

export const RULES = {
  rows: 28,            // 橋の長さ（板の段数）
  span: 7,             // 支柱と支柱の間の段数。この区間ごとに重さの上限がある
  walk: 2.0,           // 歩く速さ（板/秒）
  run: 3.6,            // 走る速さ
  walkWeight: 1,
  runWeight: 2,        // 走ると板にかかる重さが倍
  plankCap: 2.5,       // 1枚の板が耐えられる重さ（これを超えると急に傷む）
  wear: 0.035,         // 乗っているだけで減る耐久（重さ1あたり/秒）
  runShake: 0.18,      // 走る人がいる板の追加の傷み（1人あたり/秒）
  overload: 0.45,      // 上限を超えた重さ1あたりの傷み/秒
  spanCapPerCol: 1.3,  // 区間の上限 = 列数 × これ
  spanDamage: 0.012,   // 区間の上限を超えた重さ1あたり、区間の全部の板が傷む/秒
  weakRate: 0.14,      // 最初から傷んでいる板の割合
  weakHp: 0.45,
  readySec: 3,         // 開始前の秒読み
  fallSec: 2.5,        // 落ちてからスタートに戻るまで
  collapseSec: 2.5,    // 橋が落ちてから結果までの間
  teamRatio: 0.7,      // この割合がゴールすればチーム成功
  sendEvery: 2,        // 何 tick に1回 frame を送るか（20Hz の物理を 10Hz で配る）
  keyEvery: 20,        // 何 frame に1回、全員の位置をまとめて送るか（取りこぼしの保険）
  callSec: 1.5,        // 合図の吹き出しが出ている時間
  callCooldown: 1.0,
  gustFirst: 5,        // 始まってから最初の突風まで（秒）
  gustGap: [5, 8],     // 突風と突風の間（秒）
  gustWarn: 1.5,       // 予告の長さ
  gustBlow: 2.0,       // 吹いている長さ
  gustMul: 3           // 突風の区間で動いている人の重さの倍率（止まっていれば1倍）
}

// 状態の番号（通信で使う）
export const ST = { idle: 0, walk: 1, run: 2, fall: 3, done: 4, gone: 5 }

export const colsFor = n => (n <= 3 ? 3 : Math.min(18, 3 + Math.ceil(n / 7)))
export const timeFor = n => 35 + Math.min(25, Math.floor(n / 4))
export const needFor = n => Math.max(1, Math.ceil(n * RULES.teamRatio))
const lvl = hp => (hp <= 0 ? 0 : Math.max(1, Math.ceil(hp * 10)))
const r1 = v => Math.round(v * 10)

export function createGame(players, opts = {}) {
  // rng と rules はテストからだけ渡す（関数とオブジェクトは rooms.mjs が画面からの opts から捨てる）
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random
  const R = { ...RULES, ...(opts.rules && typeof opts.rules === 'object' ? opts.rules : {}) }
  const n = players.length
  const cols = colsFor(n)
  const rows = R.rows
  const timeLimit = R.timeLimit || timeFor(n)
  const spanCap = cols * R.spanCapPerCol
  const spans = Math.ceil(rows / R.span)

  const hp = new Float32Array(cols * rows).fill(1)
  for (let i = 0; i < hp.length; i++) if (rng() < R.weakRate) hp[i] = R.weakHp
  // スタート直後の1段だけは弱い板を置かない（いきなり詰まないように）
  for (let c = 0; c < cols; c++) hp[c] = 1
  const load = new Float32Array(cols * rows)
  const runners = new Uint8Array(cols * rows)
  const dmgRate = new Float32Array(cols * rows)
  const spanLoad = new Float32Array(spans)
  const sentLvl = Uint8Array.from(hp, lvl)

  const ps = players.map((p, i) => ({
    i, id: p.id, name: p.name,
    x: 0, y: 0, dx: 0, dy: 0, run: false, st: ST.idle,
    fallT: 0, falls: 0, best: 0, doneAt: null, order: null, dmg: 0, lastCall: -9, call: null, callAt: -9,
    sx: null, sy: null, sst: null // 最後に送った値
  }))
  const byId = new Map(ps.map(p => [p.id, p]))
  for (const p of ps) spawn(p)

  let ready = R.readySec
  let time = timeLimit
  let clock = 0          // 開始からの経過（秒読みを含む）
  let collapse = -1      // 橋が落ちてからの経過。-1 は落ちていない
  let over = false
  let goals = 0
  let fticks = 0, frames = 0
  let broken = 0
  // 突風: ある区間に予告→吹く。吹いている区間で動いている人は重さが gustMul 倍
  const gust = { span: -1, phase: 0, left: R.gustFirst } // phase 0 なし / 1 予告 / 2 吹いている

  function spawn(p) {
    p.x = 0.4 + rng() * (cols - 0.8)
    p.y = -0.5 - rng() * 2.2
    p.st = ST.idle
  }
  const active = () => ps.filter(p => p.st !== ST.gone)
  const plankAt = (x, y) => {
    if (y < 0 || y >= rows) return -1
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x)))
    return Math.floor(y) * cols + c
  }
  const inGust = p => gust.phase === 2 && p.y >= 0 && p.y < rows && Math.floor(Math.floor(p.y) / R.span) === gust.span
  const weightOf = p => (p.st === ST.run ? R.runWeight : R.walkWeight) * (p.st !== ST.idle && inGust(p) ? R.gustMul : 1)

  function stepGust(dt) {
    gust.left -= dt
    if (gust.left > 0) return
    if (gust.phase === 0) { gust.phase = 1; gust.span = Math.floor(rng() * spans); gust.left = R.gustWarn }
    else if (gust.phase === 1) { gust.phase = 2; gust.left = R.gustBlow }
    else { gust.phase = 0; gust.span = -1; gust.left = R.gustGap[0] + rng() * (R.gustGap[1] - R.gustGap[0]) }
  }
  const gustView = () => (gust.phase ? [gust.span, gust.phase, Math.ceil(gust.left * 10)] : null)
  const onBridge = p => p.st !== ST.gone && p.st !== ST.fall && p.st !== ST.done

  function step(dt) {
    stepGust(dt)
    // 動く
    for (const p of ps) {
      if (p.st === ST.gone) continue
      if (p.st === ST.fall) {
        p.fallT -= dt
        if (p.fallT <= 0) spawn(p)
        continue
      }
      const m = Math.hypot(p.dx, p.dy)
      if (m < 0.05) { if (p.st !== ST.done) p.st = ST.idle; continue }
      const sp = (p.run ? R.run : R.walk) * Math.min(1, m) / m
      p.x = Math.min(cols - 0.25, Math.max(0.25, p.x + p.dx * sp * dt))
      const minY = p.st === ST.done ? rows + 0.3 : -3
      p.y = Math.min(rows + 3, Math.max(minY, p.y + p.dy * sp * dt))
      if (p.st !== ST.done) p.st = p.run ? ST.run : ST.walk
      if (p.y >= rows + 0.3 && p.doneAt == null) {
        p.doneAt = timeLimit - time
        p.order = ++goals
        p.st = ST.done
      }
      if (p.st !== ST.done) p.best = Math.max(p.best, Math.min(rows, p.y))
    }
    // 重さを集計
    load.fill(0); runners.fill(0); spanLoad.fill(0)
    for (const p of ps) {
      if (!onBridge(p)) continue
      const k = plankAt(p.x, p.y)
      if (k < 0) continue
      const w = weightOf(p)
      load[k] += w
      if (p.st === ST.run) runners[k] += inGust(p) ? 2 : 1
      spanLoad[Math.floor(Math.floor(p.y) / R.span)] += w
    }
    // 板が傷む
    for (let k = 0; k < hp.length; k++) {
      if (hp[k] <= 0) { dmgRate[k] = 0; continue }
      const s = Math.floor(Math.floor(k / cols) / R.span)
      let d = R.wear * load[k] + R.runShake * runners[k] + R.overload * Math.max(0, load[k] - R.plankCap)
      d += R.spanDamage * Math.max(0, spanLoad[s] - spanCap)
      dmgRate[k] = d
      if (d > 0) {
        hp[k] = Math.max(0, hp[k] - d * dt)
        if (hp[k] <= 0) broken++
      }
    }
    // 誰が橋を傷めたか（その板の重さの割合で割り振る）と、穴に落ちる判定
    for (const p of ps) {
      if (!onBridge(p)) continue
      const k = plankAt(p.x, p.y)
      if (k < 0) continue
      if (hp[k] <= 0) { fall(p); continue }
      if (load[k] > 0) p.dmg += dmgRate[k] * dt * weightOf(p) / load[k]
    }
    // 1段まるごと抜けたら橋が落ちる
    for (let r = 0; r < rows && collapse < 0; r++) {
      let alive = false
      for (let c = 0; c < cols; c++) if (hp[r * cols + c] > 0) { alive = true; break }
      if (!alive) {
        collapse = 0
        for (const p of ps) if (onBridge(p) && p.y >= 0 && p.y < rows) fall(p)
      }
    }
  }

  function fall(p) {
    p.st = ST.fall
    p.fallT = R.fallSec
    p.falls++
  }

  function finished() {
    const a = active()
    return a.length > 0 && a.every(p => p.st === ST.done)
  }

  function snapPlayers() {
    const out = []
    for (const p of ps) out.push(r1(p.x), r1(p.y), p.st)
    return out
  }
  function calls() {
    const out = []
    for (const p of ps) if (p.call != null && p.st !== ST.gone && clock - p.callAt < R.callSec) out.push(p.i, p.call)
    return out
  }
  const phase = () => (collapse >= 0 ? 2 : ready > 0 ? 0 : 1)
  const timeLeft = () => Math.ceil((ready > 0 ? ready : time) * 10)

  return {
    tick(dt) {
      if (over) return
      dt = Math.min(dt, 0.25) // サーバーが詰まっても一度に大きく飛ばない
      clock += dt
      if (collapse >= 0) {
        collapse += dt
        if (collapse >= R.collapseSec) over = true
        return
      }
      if (ready > 0) { ready = Math.max(0, ready - dt); return }
      // 物理は 1/20 秒ずつ進める（tick 間隔が揺れても結果が変わらないように）
      let left = dt
      while (left > 1e-6 && collapse < 0) { const h = Math.min(0.05, left); step(h); time = Math.max(0, time - h); left -= h }
      if (time <= 0 || finished()) over = true
    },

    input(id, data) {
      if (over) return { error: 'over' }
      const p = byId.get(id)
      if (!p || p.st === ST.gone) return { error: 'not_player' }
      if (!data || typeof data !== 'object') return { error: 'bad_input' }
      if (data.type === 'move') {
        const dx = Number(data.dx), dy = Number(data.dy)
        if (typeof data.dx !== 'number' || typeof data.dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) return { error: 'bad_input' }
        const m = Math.hypot(dx, dy)
        p.dx = m > 1 ? dx / m : dx
        p.dy = m > 1 ? dy / m : dy
        p.run = data.run === true
        // 秒読み中・落下中も向きは覚えておく（動くのは tick 側で止める）。押しっぱなしの人が「わたれ！」の瞬間に動き出せるように
        return { ok: true }
      }
      if (data.type === 'call') {
        const k = data.k
        if (!Number.isInteger(k) || k < 0 || k > 2) return { error: 'bad_input' }
        if (clock - p.lastCall < R.callCooldown) return { error: 'too_fast' }
        p.lastCall = clock; p.call = k; p.callAt = clock
        return { ok: true }
      }
      return { error: 'bad_input' }
    },

    // 全員に同じ内容（秘密が無いゲーム）。id は受け取るが使わない
    view() {
      return {
        cols, rows, span: R.span, cap: R.plankCap, spanCap, runWeight: R.runWeight,
        limit: timeLimit, need: needFor(active().length), n: active().length,
        ph: phase(), tm: timeLeft(), g: goals, w: gustView(),
        roster: ps.map(p => [p.id, p.name]),
        p: snapPlayers(),
        k: Array.from(hp, lvl),
        c: calls()
      }
    },

    // 差分。sendEvery tick に1回だけ中身を返す
    frame() {
      if (++fticks % R.sendEvery !== 0 && !over) return null
      frames++
      const key = frames % R.keyEvery === 0
      const p = []
      for (const q of ps) {
        const x = r1(q.x), y = r1(q.y)
        if (key || x !== q.sx || y !== q.sy || q.st !== q.sst) { p.push(q.i, x, y, q.st); q.sx = x; q.sy = y; q.sst = q.st }
      }
      const k = []
      for (let i = 0; i < hp.length; i++) { const l = lvl(hp[i]); if (l !== sentLvl[i]) { k.push(i, l); sentLvl[i] = l } }
      return { tm: timeLeft(), ph: phase(), g: goals, w: gustView(), n: active().length, need: needFor(active().length), p, k, c: calls() }
    },

    isOver: () => over,

    result() {
      const a = active()
      const need = needFor(a.length)
      const goalsNow = a.filter(p => p.st === ST.done).length
      const win = goalsNow > 0 && goalsNow >= need
      const ranking = a.map(p => ({
        id: p.id, name: p.name, done: p.doneAt != null,
        time: p.doneAt != null ? Math.round(p.doneAt * 10) / 10 : null,
        prog: Math.round(Math.max(0, p.best) / rows * 100),
        falls: p.falls, dmg: Math.round(p.dmg * 100) / 100
      })).sort((A, B) => (B.done - A.done) || (A.done ? A.time - B.time : B.prog - A.prog) || A.falls - B.falls || A.dmg - B.dmg)
      ranking.forEach((r, i) => (r.rank = i + 1))
      const done = ranking.filter(r => r.done)
      const awards = []
      if (done.length) awards.push({ key: 'fast', label: '一番乗り', name: done[0].name })
      if (done.length >= 2) {
        const gentle = [...done].sort((A, B) => A.dmg - B.dmg)[0]
        awards.push({ key: 'gentle', label: '橋にやさしい', name: gentle.name })
      }
      const breaker = [...ranking].sort((A, B) => B.dmg - A.dmg)[0]
      // 破壊王は板1枚ぶん以上傷めた人だけ
      if (breaker && breaker.dmg >= 1 && ranking.length >= 2) awards.push({ key: 'break', label: '破壊王', name: breaker.name })
      return {
        win, collapsed: collapse >= 0,
        title: win ? 'チーム成功' : collapse >= 0 ? '橋が落ちた' : '時間切れ',
        goals: goalsNow, need, n: a.length,
        falls: a.reduce((s, p) => s + p.falls, 0), broken,
        ranking, awards
      }
    },

    // 途中で抜けた人は席（番号）を残して「いない」にする。番号を詰めると画面側の対応がずれるため
    removePlayer(id) {
      const p = byId.get(id)
      if (!p) return
      p.st = ST.gone
      p.dx = 0; p.dy = 0
      if (finished()) over = true
    },

    // テスト用
    _debug: { ps, hp, load, spanLoad, cols, rows, spanCap, gust, get time() { return time }, get ready() { return ready }, get collapse() { return collapse } }
  }
}
