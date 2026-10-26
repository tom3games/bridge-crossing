// この端末に残す記録（自己ベストと、渡った回数による称号）。localStorage が使えなくても動く
const REC = 'bc-rec', CAR = 'bc-career'
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

export const loadRecords = () => read(REC, {})
export const loadCareer = () => ({ plays: 0, wins: 0, coins: 0, falls: 0, ...read(CAR, {}) })

const RANKS = [[0, '見習いの渡り人'], [3, '渡り職人'], [8, '吊り橋の達人'], [16, '谷の名人'], [30, '伝説の渡り人']]
export function careerTitle(c) {
  let i = 0
  for (let k = 0; k < RANKS.length; k++) if (c.wins >= RANKS[k][0]) i = k
  const next = RANKS[i + 1]
  return { name: RANKS[i][1], next: next ? { name: next[1], need: next[0] - c.wins } : null }
}

// 結果を1回だけ記録する（同じラウンドを2回数えない）。戻り値: 自己ベストを更新したか
const seen = new Map()
export function record(key, result, me) {
  if (seen.has(key)) return seen.get(key)
  const c = loadCareer()
  c.plays++; if (result.win) c.wins++
  if (me) { c.coins += me.coins || 0; c.falls += me.falls || 0 }
  write(CAR, c)
  const all = loadRecords()
  const old = all[result.course] || { best: null, stars: 0 }
  const out = { newBest: false, newStars: false }
  if (result.win && result.teamTime != null && (old.best == null || result.teamTime < old.best)) { old.best = result.teamTime; out.newBest = true }
  if (result.stars > old.stars) { old.stars = result.stars; out.newStars = true }
  all[result.course] = old
  write(REC, all)
  seen.set(key, out)
  return out
}
