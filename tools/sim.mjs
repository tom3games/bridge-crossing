// 橋ごとの難しさを、そこそこ賢いボットで確かめる（ゲーム本体は使わない）。
// ボット: 前へ歩く。突風の予告・吹いている区間では止まる。前の板が穴か割れかけなら横へずれる。丸太の段の手前では丸太が遠いときだけ渡る。
// 使い方: node tools/sim.mjs [人数=4] [回数=20]
import { createGame, RULES, ST } from '../lib/game.mjs'
import { COURSE_IDS, logsFor, logX } from '../public/courses.js'

const N = Number(process.argv[2] || 4), RUNS = Number(process.argv[3] || 20)
function rng(seed = 1) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

for (const id of COURSE_IDS) {
  let wins = 0, timeout = 0, collapsed = 0, falls = 0, hits = 0, tt = 0, stars = 0, coins = 0
  for (let s = 1; s <= RUNS; s++) {
    const players = Array.from({ length: N }, (_, i) => ({ id: 'b' + i, name: 'b' + i }))
    const g = createGame(players, { rng: rng(s * 31), course: id })
    const D = g._debug
    const logs = logsFor(id, D.cols)
    const delay = players.map((_, i) => i * 0.9)
    while (!g.isOver()) {
      for (const [i, p] of D.ps.entries()) {
        if (p.st === ST.done || p.st === ST.fall || p.st === ST.gone) continue
        let dx = 0, dy = D.play > delay[i] ? 1 : 0
        const sec = Math.floor(Math.max(0, p.y + 1) / 7)
        if (D.gust.phase && D.gust.span === sec && p.y > -0.5) dy = 0
        // 前の1段（と今の段）で一番丈夫な列へ寄る。寄り切るまでは前に出ない
        const r = Math.floor(p.y + 0.9)
        if (r >= 0 && r < D.rows) {
          const c = Math.min(D.cols - 1, Math.floor(p.x))
          const at = k => Math.min(D.hp[r * D.cols + k], r + 1 < D.rows ? D.hp[(r + 1) * D.cols + k] + 0.3 : 1)
          if (at(c) < 0.3) {
            let best = c, bv = -1
            for (let k = 0; k < D.cols; k++) { const v = at(k) - Math.abs(k - c) * 0.08; if (v > bv) { bv = v; best = k } }
            const off = best + 0.5 - p.x
            if (Math.abs(off) > 0.2) { dx = Math.sign(off); dy = 0 }
          }
        }
        for (const L of logs) if (p.y < L.row && p.y > L.row - 1.4 && Math.abs(logX(L, D.play, D.cols) - p.x) < 2.2) dy = 0
        g.input(p.id, { type: 'move', dx, dy })
      }
      g.tick(0.05)
    }
    const res = g.result()
    wins += res.win; collapsed += res.collapsed; timeout += !res.win && !res.collapsed; falls += res.falls; hits += res.ranking.reduce((a, b) => a + b.hits, 0); stars += res.stars; coins += res.coins
    tt += res.teamTime || 0
  }
  console.log(`${id.padEnd(8)} ${N}人 成功 ${wins}/${RUNS} 橋が落ちた ${collapsed} 時間切れ ${timeout} 落下/回 ${(falls / RUNS).toFixed(1)} 当たり/回 ${(hits / RUNS).toFixed(1)} 成功時の秒 ${wins ? (tt / wins).toFixed(1) : '-'} 星 ${(stars / RUNS).toFixed(1)} お守り ${(coins / RUNS).toFixed(1)}`)
}
