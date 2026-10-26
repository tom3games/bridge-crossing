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
// 橋の形と仕掛けは public/courses.js（画面も同じものを読む）。

import { COURSES, COURSE_IDS, DEFAULT_COURSE, SPAN, layout, logsFor, logX, logVX, LOG_HALF_W, LOG_HALF_D, FLAG } from '../public/courses.js'

export const meta = {
  id: 'bridge-crossing',
  title: '橋を渡れ！',
  minPlayers: 1,
  maxPlayers: 100,
  tickHz: 20,
  sharedView: true
}

export const RULES = {
  span: SPAN,          // 支柱と支柱の間の段数。この区間ごとに重さの上限がある
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
  weakRate: null,      // 最初から傷んでいる板の割合。null なら区間ごとの値（courses.js）
  weakHp: 0.45,
  heatRate: 0.016,     // 焼けた板が勝手に減る耐久/秒（約60秒で燃え落ちる）
  iceGrip: 1.6,        // 凍った板の上で速さが目標に近づく強さ（小さいほどすべる）
  readySec: 3,         // 開始前の秒読み
  fallSec: 2.5,        // 落ちてから戻るまで
  collapseSec: 2.5,    // 橋が落ちてから結果までの間
  teamRatio: 0.7,      // この割合がゴールすればチーム成功
  sendEvery: 2,        // 何 tick に1回 frame を送るか（20Hz の物理を 10Hz で配る）
  keyEvery: 20,        // 何 frame に1回、全員の位置をまとめて送るか（取りこぼしの保険）
  callSec: 1.5,        // 合図の吹き出しが出ている時間
  callCooldown: 1.0,
  gustFirst: 5,        // 始まってから最初の突風まで（秒）
  gustGap: [5, 8],     // 突風と突風の間（秒）。時間がたつほど短くなる（最後は 55%）
  gustWarn: 1.5,       // 予告の長さ
  gustBlow: 2.0,       // 吹いている長さ
  gustMul: 3,          // 突風の区間で動いている人の重さの倍率（止まっていれば1倍）
  hazards: true,       // 丸太・落石を出すか（テストで切る）
  logStun: 0.9,        // 丸太に当たって飛ばされている時間
  logKick: 5.5,        // 飛ばされる速さ
  rockWarn: 1.3,       // 落石の影が出てから落ちるまで
  rockGap: 3.4,        // 落石の間隔（rock:1 の区間。時間がたつほど短くなる）
  rockR: 0.85,         // 落石の半径
  rockDamage: 0.5,     // 落石が板に与える傷み
  rockStun: 1.1,
  timeLimit: null,
  rows: null           // テスト用: 橋の長さを縮める
}

// 状態の番号（通信で使う）
export const ST = { idle: 0, walk: 1, run: 2, fall: 3, done: 4, gone: 5, hit: 6 }

export const colsFor = n => (n <= 3 ? 3 : Math.min(18, 3 + Math.ceil(n / 7)))
export const timeFor = (n, id = DEFAULT_COURSE) => (COURSES[id] || COURSES[DEFAULT_COURSE]).time + Math.min(25, Math.floor(n / 4))
export const needFor = n => Math.max(1, Math.ceil(n * RULES.teamRatio))
const lvl = hp => (hp <= 0 ? 0 : Math.max(1, Math.ceil(hp * 10)))
const LV = '0123456789a'
const r1 = v => Math.round(v * 10)

export function createGame(players, opts = {}) {
  // rng と rules はテストからだけ渡す（関数とオブジェクトは rooms.mjs が画面からの opts から捨てる）
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random
  const R = { ...RULES, ...(opts.rules && typeof opts.rules === 'object' ? opts.rules : {}) }
  const courseId = COURSE_IDS.includes(opts.course) ? opts.course : DEFAULT_COURSE
  const L = layout(courseId)
  const n = players.length
  const cols = colsFor(n)
  const rows = R.rows ? Math.min(L.rows, Math.max(1, R.rows | 0)) : L.rows
  const sections = L.sections.filter(s => s.row0 < rows)
  const timeLimit = R.timeLimit || timeFor(n, courseId)
  const spanCap = cols * R.spanCapPerCol
  const spans = Math.ceil(rows / R.span)
  const secOf = y => Math.min(spans - 1, Math.max(0, Math.floor(Math.floor(y) / R.span)))

  // 板: 耐久と印（凍った・焼けた・やぐら）
  const hp = new Float32Array(cols * rows).fill(1)
  const flag = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const s = sections[secOf(r)]
    const deck = L.deckRow[r] === 1
    let heats = 0
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c
      if (deck) { flag[k] = FLAG.deck; continue }
      const weak = R.weakRate == null ? s.weak : R.weakRate
      if (rng() < weak) hp[k] = R.weakHp
      if (s.ice && rng() < s.ice) flag[k] |= FLAG.ice
      if (s.heat && rng() < s.heat) { flag[k] |= FLAG.heat; heats++ }
    }
    // 1段まるごと焼けた板にはしない（時間だけで橋が落ちないように）
    if (heats === cols) flag[r * cols + Math.floor(rng() * cols)] &= ~FLAG.heat
  }
  // スタート直後の1段だけは弱い板を置かない（いきなり詰まないように）
  for (let c = 0; c < cols && c < hp.length; c++) hp[c] = 1
  const load = new Float32Array(cols * rows)
  const runners = new Uint8Array(cols * rows)
  const dmgRate = new Float32Array(cols * rows)
  const spanLoad = new Float32Array(spans)
  const lit = new Uint8Array(spans) // 焼けた板が燃え始めた区間
  const sentLvl = Uint8Array.from(hp, lvl)

  // 丸太（位置は時刻だけで決まる）と、お守り
  const logs = R.hazards ? logsFor(courseId, cols).filter(l => l.row < rows) : []
  const coins = []
  for (const s of sections) {
    for (let j = 0; j < s.coin; j++) {
      // 傷んだ板の上に置きがち（取りに行くと危ない）
      let best = null
      for (let t = 0; t < 6; t++) {
        const r = s.row0 + (s.deck ? 2 : 0) + Math.floor(rng() * (R.span - (s.deck ? 2 : 0)))
        if (r >= rows) continue
        const c = Math.floor(rng() * cols)
        const k = r * cols + c
        const score = (hp[k] < 1 ? 2 : 0) + (flag[k] ? 1 : 0) + rng()
        if (!best || score > best.score) best = { x: c + 0.5, y: r + 0.5, score }
      }
      if (best && !coins.some(o => Math.abs(o.x - best.x) < 0.1 && Math.abs(o.y - best.y) < 0.1)) coins.push({ x: best.x, y: best.y, owner: -1 })
    }
  }
  const coinNews = []

  const ps = players.map((p, i) => ({
    i, id: p.id, name: p.name,
    x: 0, y: 0, dx: 0, dy: 0, vx: 0, vy: 0, run: false, st: ST.idle,
    fallT: 0, stunT: 0, kx: 0, ky: 0, falls: 0, hits: 0, coins: 0, cp: -1, best: 0, doneAt: null, order: null, dmg: 0,
    lastCall: -9, call: null, callAt: -9, fallWhy: 0,
    sx: null, sy: null, sst: null // 最後に送った値
  }))
  const byId = new Map(ps.map(p => [p.id, p]))
  for (const p of ps) spawn(p)

  let ready = R.readySec
  let time = timeLimit
  let clock = 0          // 開始からの経過（秒読みを含む）
  let play = 0           // 秒読みのあとの経過（丸太の位置はこれで決まる）
  let collapse = -1      // 橋が落ちてからの経過。-1 は落ちていない
  let collapseRow = -1
  let over = false
  let goals = 0
  let teamAt = null      // チーム目標の人数がそろった時刻
  let fticks = 0, frames = 0
  let broken = 0
  // 突風: ある区間に予告→吹く。吹いている区間で動いている人は重さが gustMul 倍
  const gustSecs = sections.filter(s => s.gust).map(s => s.i)
  const gust = { span: -1, phase: 0, left: gustSecs.length ? R.gustFirst : 1e9 } // phase 0 なし / 1 予告 / 2 吹いている
  // 落石: 影で予告して落ちる
  const rockSecs = R.hazards ? sections.filter(s => s.rock) : []
  const rocks = []
  let rockLeft = 2.5

  function spawn(p) {
    p.x = 0.4 + rng() * (cols - 0.8)
    p.y = p.cp >= 0 ? p.cp + 0.3 + rng() * 1.4 : -0.5 - rng() * 2.2
    p.vx = 0; p.vy = 0
    p.st = ST.idle
  }
  const active = () => ps.filter(p => p.st !== ST.gone)
  const plankAt = (x, y) => {
    if (y < 0 || y >= rows) return -1
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x)))
    return Math.floor(y) * cols + c
  }
  const inGust = p => gust.phase === 2 && p.y >= 0 && p.y < rows && secOf(p.y) === gust.span
  const moving = p => p.st === ST.walk || p.st === ST.run
  const weightOf = p => (p.st === ST.run ? R.runWeight : R.walkWeight) * (moving(p) && inGust(p) ? R.gustMul : 1)
  const frac = () => Math.min(1, play / timeLimit) // 時間がたつほど仕掛けが速くなる

  function stepGust(dt) {
    gust.left -= dt
    if (gust.left > 0) return
    if (gust.phase === 0) { gust.phase = 1; gust.span = gustSecs[Math.floor(rng() * gustSecs.length)]; gust.left = R.gustWarn }
    else if (gust.phase === 1) { gust.phase = 2; gust.left = R.gustBlow }
    else { gust.phase = 0; gust.span = -1; gust.left = (R.gustGap[0] + rng() * (R.gustGap[1] - R.gustGap[0])) * (1 - 0.45 * frac()) }
  }
  const gustView = () => (gust.phase ? [gust.span, gust.phase, Math.ceil(gust.left * 10)] : null)
  const onBridge = p => p.st !== ST.gone && p.st !== ST.fall && p.st !== ST.done

  function stepRocks(dt) {
    for (const r of rocks) r.left -= dt
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i]
      if (r.ph === 1 && r.left <= 0) {
        r.ph = 2; r.left = 0.6
        // 落ちた: 板が傷み、下にいた人はぺしゃんこ
        for (let k = 0; k < hp.length; k++) {
          if (hp[k] <= 0 || flag[k] & FLAG.deck) continue
          const cx = k % cols + 0.5, cy = Math.floor(k / cols) + 0.5
          if (Math.hypot(cx - r.x, cy - r.y) < R.rockR + 0.2) hurt(k, R.rockDamage)
        }
        for (const p of ps) {
          if (!onBridge(p) || p.st === ST.hit) continue
          if (Math.hypot(p.x - r.x, p.y - r.y) < R.rockR) { p.st = ST.hit; p.stunT = R.rockStun; p.kx = 0; p.ky = 0; p.hits++ }
        }
      } else if (r.ph === 2 && r.left <= 0) rocks.splice(i, 1)
    }
    if (!rockSecs.length) return
    rockLeft -= dt
    if (rockLeft > 0) return
    // 落石の区間に人がいればその近くを狙う。いなければ区間のどこか
    const s = rockSecs[Math.floor(rng() * rockSecs.length)]
    const top = Math.min(rows, s.row0 + R.span), bottom = s.row0 + (s.deck ? 2 : 0)
    const there = ps.filter(p => onBridge(p) && p.y >= bottom && p.y < top)
    let x, y
    if (there.length && rng() < 0.75) { const p = there[Math.floor(rng() * there.length)]; x = p.x + (rng() - 0.5) * 1.6; y = p.y + 0.6 + rng() * 1.2 }
    else { x = rng() * cols; y = bottom + rng() * (top - bottom) }
    x = Math.min(cols - 0.4, Math.max(0.4, x)); y = Math.min(top - 0.3, Math.max(bottom + 0.3, y))
    rocks.push({ x, y, ph: 1, left: R.rockWarn })
    rockLeft = (R.rockGap / s.rock) * (1 - 0.4 * frac()) * (0.75 + rng() * 0.5)
  }

  function stepLogs() {
    for (const lg of logs) {
      const lx = logX(lg, play, cols), vx = logVX(lg, play)
      for (const p of ps) {
        if (!onBridge(p) || p.st === ST.hit) continue
        if (Math.abs(p.y - (lg.row + 0.5)) < LOG_HALF_D + 0.15 && Math.abs(p.x - lx) < LOG_HALF_W + 0.22) {
          // 丸太の振れる向きへ飛ばされる。橋の端なら外へ落ちる
          const dir = Math.abs(vx) > 0.3 ? Math.sign(vx) : (p.x < lx ? -1 : 1)
          p.st = ST.hit; p.stunT = R.logStun; p.kx = dir * R.logKick; p.ky = -0.8 - rng() * 1.2; p.hits++
        }
      }
    }
  }

  function step(dt) {
    stepGust(dt)
    if (R.hazards) { stepRocks(dt); stepLogs() }
    // 動く
    for (const p of ps) {
      if (p.st === ST.gone) continue
      if (p.st === ST.fall) {
        p.fallT -= dt
        if (p.fallT <= 0) spawn(p)
        continue
      }
      if (p.st === ST.hit) {
        p.stunT -= dt
        const d = Math.exp(-2.6 * dt)
        p.x += p.kx * dt; p.y += p.ky * dt; p.kx *= d; p.ky *= d
        p.y = Math.max(-3, p.y)
        // 飛ばされて手すりを越えたら谷へ
        if (p.x < -0.15 || p.x > cols + 0.15) { fall(p, 2); continue }
        p.x = Math.min(cols, Math.max(0, p.x))
        if (p.stunT <= 0) { p.st = ST.idle; p.vx = 0; p.vy = 0; p.x = Math.min(cols - 0.25, Math.max(0.25, p.x)) }
        continue
      }
      const m = Math.hypot(p.dx, p.dy)
      const sp = m < 0.05 ? 0 : (p.run ? R.run : R.walk) * Math.min(1, m) / m
      const tx = p.dx * sp, ty = p.dy * sp
      const k0 = plankAt(p.x, p.y)
      const ice = p.st !== ST.done && k0 >= 0 && hp[k0] > 0 && (flag[k0] & FLAG.ice)
      if (ice) { const a = Math.min(1, R.iceGrip * dt); p.vx += (tx - p.vx) * a; p.vy += (ty - p.vy) * a }
      else { p.vx = tx; p.vy = ty }
      const v = Math.hypot(p.vx, p.vy)
      if (v < 0.05) { p.vx = 0; p.vy = 0; if (p.st !== ST.done) p.st = ST.idle; continue }
      p.x = Math.min(cols - 0.25, Math.max(0.25, p.x + p.vx * dt))
      const minY = p.st === ST.done ? rows + 0.3 : -3
      p.y = Math.min(rows + 3, Math.max(minY, p.y + p.vy * dt))
      if (p.st !== ST.done) p.st = p.run && m >= 0.05 ? ST.run : ST.walk
      if (p.y >= rows + 0.3 && p.doneAt == null) {
        p.doneAt = timeLimit - time
        p.order = ++goals
        p.st = ST.done
        if (teamAt == null && goals >= needFor(active().length)) teamAt = p.doneAt
      }
      if (p.st !== ST.done) p.best = Math.max(p.best, Math.min(rows, p.y))
      // やぐらに着いたら、そこが戻る場所になる
      if (p.y >= 0 && p.y < rows && L.deckRow[Math.floor(p.y)]) {
        let r0 = Math.floor(p.y); while (r0 > 0 && L.deckRow[r0 - 1]) r0--
        if (r0 > p.cp) p.cp = r0
      }
    }
    // お守りを拾う
    for (let j = 0; j < coins.length; j++) {
      const o = coins[j]
      if (o.owner >= 0) continue
      for (const p of ps) {
        if (!onBridge(p)) continue
        if (Math.abs(p.x - o.x) < 0.55 && Math.abs(p.y - o.y) < 0.55) { o.owner = p.i; p.coins++; coinNews.push(j, p.i); break }
      }
    }
    // 焼けた板は、誰かがその区間の手前まで来たときから燃え始める（先の区間が勝手に無くならないように）
    for (const p of ps) if (onBridge(p) && p.y > -1) { const s = secOf(Math.min(rows - 1, Math.max(0, p.y + 2))); for (let j = 0; j <= s; j++) lit[j] = 1 }
    // 重さを集計
    load.fill(0); runners.fill(0); spanLoad.fill(0)
    for (const p of ps) {
      if (!onBridge(p)) continue
      const k = plankAt(p.x, p.y)
      if (k < 0 || flag[k] & FLAG.deck) continue
      const w = weightOf(p)
      load[k] += w
      if (p.st === ST.run) runners[k] += inGust(p) ? 2 : 1
      spanLoad[secOf(p.y)] += w
    }
    // 板が傷む
    for (let k = 0; k < hp.length; k++) {
      if (hp[k] <= 0 || flag[k] & FLAG.deck) { dmgRate[k] = 0; continue }
      const s = secOf(k / cols)
      let d = R.wear * load[k] + R.runShake * runners[k] + R.overload * Math.max(0, load[k] - R.plankCap)
      d += R.spanDamage * Math.max(0, spanLoad[s] - spanCap)
      dmgRate[k] = d
      if (d > 0) {
        hp[k] = Math.max(0, hp[k] - d * dt)
        if (hp[k] <= 0) broken++
      }
      if (flag[k] & FLAG.heat && hp[k] > 0 && lit[s]) hurt(k, R.heatRate * dt)
    }
    // 誰が橋を傷めたか（その板の重さの割合で割り振る）と、穴に落ちる判定
    for (const p of ps) {
      if (!onBridge(p)) continue
      const k = plankAt(p.x, p.y)
      if (k < 0) continue
      if (hp[k] <= 0) { fall(p, 1); continue }
      if (load[k] > 0) p.dmg += dmgRate[k] * dt * weightOf(p) / load[k]
    }
    // 1段まるごと抜けたら橋が落ちる
    for (let r = 0; r < rows && collapse < 0; r++) {
      let alive = false
      for (let c = 0; c < cols; c++) if (hp[r * cols + c] > 0) { alive = true; break }
      if (!alive) {
        collapse = 0; collapseRow = r
        for (const p of ps) if (onBridge(p) && p.y >= 0 && p.y < rows) fall(p, 3)
      }
    }
  }

  // 仕掛け（落石・熱）で傷める。段の最後の1枚だけは割らずに残す（人の重さでしか橋は落ちない）
  function hurt(k, d) {
    const r = Math.floor(k / cols)
    let others = 0
    for (let c = 0; c < cols; c++) if (r * cols + c !== k && hp[r * cols + c] > 0) others++
    const floor = others ? 0 : 0.35
    if (hp[k] <= floor) return
    hp[k] = Math.max(floor, hp[k] - d)
    if (hp[k] <= 0) broken++
  }

  // why: 1 穴 / 2 飛ばされて場外 / 3 橋が落ちた
  function fall(p, why) {
    p.st = ST.fall
    p.fallT = R.fallSec
    p.falls++
    p.fallWhy = why
    p.vx = 0; p.vy = 0
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
  const rockView = () => { const o = []; for (const r of rocks) o.push(r1(r.x), r1(r.y), r.ph, Math.ceil(r.left * 10)); return o }
  const phase = () => (collapse >= 0 ? 2 : ready > 0 ? 0 : 1)
  const timeLeft = () => Math.ceil((ready > 0 ? ready : time) * 10)
  const kStr = () => { let s = ''; for (let i = 0; i < hp.length; i++) s += LV[lvl(hp[i])]; return s }

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
      while (left > 1e-6 && collapse < 0) { const h = Math.min(0.05, left); step(h); time = Math.max(0, time - h); play += h; left -= h }
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
        course: courseId, cols, rows, span: R.span, cap: R.plankCap, spanCap, runWeight: R.runWeight, iceGrip: R.iceGrip,
        limit: timeLimit, need: needFor(active().length), n: active().length,
        ph: phase(), tm: timeLeft(), ck: r1(play), g: goals, w: gustView(), cr: collapseRow,
        roster: ps.map(p => [p.id, p.name]),
        p: snapPlayers(),
        k: kStr(),
        f: Array.from(flag, v => String(v)).join(''),
        coins: coins.flatMap(o => [r1(o.x), r1(o.y), o.owner]),
        logs: logs.length,
        r: rockView(),
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
      const f = { tm: timeLeft(), ck: r1(play), ph: phase(), g: goals, w: gustView(), n: active().length, need: needFor(active().length), p, k, c: calls() }
      if (rocks.length) f.r = rockView()
      if (coinNews.length) f.co = coinNews.splice(0)
      if (collapse >= 0) f.cr = collapseRow
      return f
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
        falls: p.falls, hits: p.hits, coins: p.coins, dmg: Math.round(p.dmg * 100) / 100, titles: []
      })).sort((A, B) => (B.done - A.done) || (A.done ? A.time - B.time : B.prog - A.prog) || A.falls - B.falls || A.dmg - B.dmg)
      ranking.forEach((r, i) => (r.rank = i + 1))
      const done = ranking.filter(r => r.done)
      const awards = []
      const give = (key, label, r) => { if (!r) return; awards.push({ key, label, name: r.name }); r.titles.push(key) }
      const top = (list, f, min) => { const s = [...list].sort((A, B) => f(B) - f(A))[0]; return s && f(s) >= min ? s : null }
      if (done.length) give('fast', '一番乗り', done[0])
      if (done.length >= 2) give('gentle', '橋にやさしい', [...done].sort((A, B) => A.dmg - B.dmg)[0])
      // 破壊王は板1枚ぶん以上傷めた人だけ
      if (ranking.length >= 2) give('break', '破壊王', top(ranking, r => r.dmg, 1))
      if (ranking.length >= 2) give('fall', '落下王', top(ranking, r => r.falls, 2))
      give('coin', 'お守り長者', top(ranking, r => r.coins, 2))
      if (ranking.length >= 2) give('fly', 'ふっとび王', top(ranking, r => r.hits, 2))
      if (done.length >= 3) give('last', 'しんがり', done[done.length - 1])
      const fallsAll = a.reduce((s, p) => s + p.falls, 0)
      const coinsAll = a.reduce((s, p) => s + p.coins, 0)
      const par = Math.round(timeLimit * 0.62)
      const stars = !win ? 0 : 1 + (fallsAll <= Math.ceil(a.length / 2) ? 1 : 0) + (teamAt != null && teamAt <= par ? 1 : 0)
      return {
        win, collapsed: collapse >= 0, course: courseId, courseName: (COURSES[courseId] || {}).name,
        title: win ? 'チーム成功' : collapse >= 0 ? '橋が落ちた' : '時間切れ',
        goals: goalsNow, need, n: a.length, rows,
        falls: fallsAll, broken, coins: coinsAll, coinsMax: coins.length,
        teamTime: teamAt != null ? Math.round(teamAt * 10) / 10 : null, par, stars,
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
    _debug: { ps, hp, flag, lit, load, spanLoad, cols, rows, spanCap, gust, rocks, coins, logs, courseId, deckRow: L.deckRow, get time() { return time }, get play() { return play }, get ready() { return ready }, get collapse() { return collapse } }
  }
}
