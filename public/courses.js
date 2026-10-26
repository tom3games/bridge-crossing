// 橋（コース）のデータ。サーバー（lib/game.mjs）と画面（game-view.js / view3d.js）の両方が読む。
//
// 橋は「区間」（支柱と支柱の間、SPAN 段）を手前から順に並べたもの。区間ごとに仕掛けを持てる。
//   weak: 最初から傷んでいる板の割合      ice: 凍った板の割合（すべる）     heat: 焼けた板の割合（勝手に燃え落ちる）
//   gust: 突風が来る区間                  log: 振り子の丸太の本数           rock: 落石の強さ（0〜2）
//   deck: 区間の最初の2段が石のやぐら（割れない。通ったあとに落ちると、ここから戻れる）
//   coin: お守りの数（拾うと個人の得点）  th: 景色（forest / canyon / snow / volcano）
// 後ろの区間ほど仕掛けを重ねる＝1回の中でだんだん難しくなる。

export const SPAN = 7
export const DECK_ROWS = 2

const S = (o) => ({ weak: 0.08, ice: 0, heat: 0, gust: 0, log: 0, rock: 0, deck: 0, coin: 1, ...o })

const FOREST = [S({ th: 'forest', weak: 0.05, coin: 1 }), S({ th: 'forest', weak: 0.12, coin: 2 }), S({ th: 'forest', weak: 0.14, gust: 1, coin: 1 }), S({ th: 'forest', weak: 0.16, log: 1, coin: 2 })]
const CANYON = [S({ th: 'canyon', weak: 0.1 }), S({ th: 'canyon', weak: 0.12, gust: 1, coin: 2 }), S({ th: 'canyon', deck: 1, weak: 0.14, rock: 1 }), S({ th: 'canyon', weak: 0.16, gust: 1, rock: 1, coin: 2 }), S({ th: 'canyon', weak: 0.18, log: 1, gust: 1 }), S({ th: 'canyon', weak: 0.22, rock: 2, gust: 1, coin: 2 })]
const SNOW = [S({ th: 'snow', weak: 0.06, ice: 0.3 }), S({ th: 'snow', weak: 0.1, ice: 0.6, coin: 2 }), S({ th: 'snow', deck: 1, ice: 0.8, gust: 1 }), S({ th: 'snow', weak: 0.14, ice: 1, log: 1, coin: 2 }), S({ th: 'snow', weak: 0.18, ice: 1, gust: 1, log: 1, coin: 1 })]
const VOLCANO = [S({ th: 'volcano', weak: 0.06, heat: 0.1 }), S({ th: 'volcano', weak: 0.08, heat: 0.15, rock: 1, coin: 2 }), S({ th: 'volcano', deck: 1, heat: 0.2, gust: 1 }), S({ th: 'volcano', weak: 0.1, heat: 0.22, rock: 1, coin: 2 }), S({ th: 'volcano', weak: 0.12, heat: 0.25, rock: 1, log: 1 }), S({ th: 'volcano', weak: 0.14, heat: 0.28, rock: 2, gust: 1, coin: 2 })]

export const COURSES = {
  forest: { name: '森の吊り橋', lead: 'はじめはここ。最後に丸太が振れる', th: 'forest', stars: 1, time: 40, sections: FOREST },
  canyon: { name: '赤い谷の大橋', lead: '突風と落石。途中のやぐらで一息', th: 'canyon', stars: 2, time: 66, sections: CANYON },
  snow: { name: '氷の吊り橋', lead: '凍った板はすべって止まれない', th: 'snow', stars: 2, time: 62, sections: SNOW },
  volcano: { name: '火山の橋', lead: '焼けた板は勝手に燃え落ちる。急げ', th: 'volcano', stars: 3, time: 64, sections: VOLCANO },
  long: {
    name: '大冒険（ロング）', lead: '森→谷→氷→火山を一気に渡る。やぐら3つ', th: 'forest', stars: 3, time: 165,
    // 長いぶん、傷んだ板と焼けた板は各コースの7割にする
    sections: [FOREST[0], FOREST[1], FOREST[3], CANYON[2], CANYON[3], CANYON[5], SNOW[2], SNOW[3], SNOW[4], VOLCANO[2], VOLCANO[3], VOLCANO[5]]
      .map(s => ({ ...s, weak: s.weak * 0.7, heat: s.heat * 0.7 }))
  }
}
export const COURSE_IDS = Object.keys(COURSES)
export const DEFAULT_COURSE = 'forest'

export const THEMES = {
  forest: { name: '森', sky: 0x7cc8f0, horizon: 0xe3f4ff, ground: 0x5f9e4a, cliff: 0x7a6a52, below: 0x3f9fc2, belowKind: 'water', fog: 0xcfe8f2 },
  canyon: { name: '谷', sky: 0xf0a060, horizon: 0xffe0b8, ground: 0xc77a46, cliff: 0xa8553a, below: 0x3f86a8, belowKind: 'water', fog: 0xf6d2aa },
  snow: { name: '雪山', sky: 0x8fb8e0, horizon: 0xf0f6ff, ground: 0xf2f6fb, cliff: 0x9fb1c6, below: 0x8fd4ea, belowKind: 'ice', fog: 0xe6eef8 },
  volcano: { name: '火山', sky: 0x4a2a3a, horizon: 0xc0605a, ground: 0x3d3236, cliff: 0x2e2428, below: 0xff6a1a, belowKind: 'lava', fog: 0x6a3a3a }
}

// 区間の並びから、段ごとの情報を作る
export function layout(id) {
  const c = COURSES[id] || COURSES[DEFAULT_COURSE]
  const sections = c.sections.map((s, i) => ({ ...s, i, row0: i * SPAN }))
  const rows = sections.length * SPAN
  const deckRow = new Uint8Array(rows)
  for (const s of sections) if (s.deck) for (let r = 0; r < DECK_ROWS; r++) deckRow[s.row0 + r] = 1
  return { course: c, sections, rows, deckRow }
}

// 振り子の丸太。区間ごとに真ん中あたりの段を横に振れる。位置はゲーム開始からの秒数だけで決まる（サーバーと画面が同じ式で計算する）
export function logsFor(id, cols) {
  const { sections } = layout(id)
  const out = []
  for (const s of sections) {
    for (let j = 0; j < s.log; j++) {
      const row = s.row0 + (s.deck ? 4 : 3) + j * 2
      const period = 3.4 + (cols / 18) * 1.6 + (s.i % 3) * 0.35
      out.push({ row, period, phase: (s.i * 1.7 + j * 2.1) % (Math.PI * 2), amp: cols / 2 + 0.9 })
    }
  }
  return out
}
export const logX = (L, t, cols) => cols / 2 + L.amp * Math.sin((t / L.period) * Math.PI * 2 + L.phase)
export const logVX = (L, t) => L.amp * Math.cos((t / L.period) * Math.PI * 2 + L.phase) * (Math.PI * 2 / L.period)
export const LOG_HALF_W = 0.42   // 丸太の太さ（幅方向の半分）
export const LOG_HALF_D = 0.5    // 丸太の長さ方向（進む方向）の半分

// 板の印（通信では1文字＝1枚）: 1 凍った / 2 焼けた / 4 やぐら
export const FLAG = { ice: 1, heat: 2, deck: 4 }

export const CALLS = ['待って', '行け', '危ない']
export const PLAYER_COLORS = ['#ff7a45', '#3fb6ff', '#ffd23f', '#9b7bff', '#3fe0a0', '#ff5b9e', '#b8ef3f', '#3fe8f0', '#ffa63f', '#d77bff', '#7bf0c8', '#ff6262']
