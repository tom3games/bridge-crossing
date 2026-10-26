// 画面で使う SVG アイコン（絵文字は使わない）。どれも viewBox 0 0 24 24
const S = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}>${body}</svg>`
const L = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'

export const ICON = {
  clock: S('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'),
  flag: S('<path d="M6 21V3M6 4h11l-3 4 3 4H6"/>'),
  coin: S('<path d="M7 3h10v13l-5 5-5-5z"/><path d="M10 8h4M12 6v6" stroke-width="2"/>'),
  mute: S('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6"/>'),
  sound: S('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12"/>'),
  zoom: S('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5"/>'),
  run: S('<circle cx="14" cy="4.5" r="2.2" fill="currentColor"/><path d="M6 21l3.5-6 3 2.5V22M9.5 15l1.5-6 3 2.5 4 .5M11 9l-4 1.5-1.5 3.5"/><path d="M1.5 8h3M1 12h2.5" opacity=".6"/>'),
  wait: S('<path d="M7 11V6a1.5 1.5 0 0 1 3 0v4V4.5a1.5 1.5 0 0 1 3 0V10V5.5a1.5 1.5 0 0 1 3 0V12V8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L4 14.5a1.5 1.5 0 0 1 2.5-1.6L7 13.5"/>'),
  go: S('<path d="M5 12h12M12 5l7 7-7 7"/>'),
  warn: S('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.3"/>'),
  drag: S('<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2M3 12l2-2M3 12l2 2M21 12l-2-2M21 12l-2 2"/>'),
  star: S('<path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z" fill="currentColor" stroke="#2a170c" stroke-width="1.6" stroke-linejoin="round"/>'),
  // 仕掛け
  gust: S('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>'),
  log: S('<path d="M12 2v6"/><rect x="5" y="8" width="14" height="7" rx="3.5"/><circle cx="17" cy="11.5" r="1.6"/><path d="M2 19h4M18 19h4" opacity=".6"/>'),
  rock: S('<path d="M6 13l3-5 6-1 4 4-1 5-6 2-5-1z"/><path d="M8 3v3M13 2v3M17 4l-1 2" opacity=".7"/><ellipse cx="12" cy="21" rx="7" ry="1.5" opacity=".6"/>'),
  ice: S('<path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M9 4l3 2 3-2M9 20l3-2 3 2"/>'),
  heat: S('<path d="M12 22c4 0 7-2.5 7-6.5 0-3.5-2.5-5.5-4-8-.8 2-2 3-3 3 0-3-1-5.5-3-8.5-.5 4-5 7-5 12 0 4.5 3.5 8 8 8z"/><path d="M12 22c-2 0-3-1.5-3-3 0-2 2-3 3-5 1 2 3 3 3 5 0 1.5-1 3-3 3z"/>'),
  deck: S('<path d="M4 21V10l8-5 8 5v11M4 14h16M9 21v-4h6v4"/>'),
  // 称号
  fast: S('<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="#ffd23f" stroke="#2a170c" stroke-width="1.8" stroke-linejoin="round"/>'),
  gentle: S('<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" fill="#ff8fb0" stroke="#2a170c" stroke-width="1.8" stroke-linejoin="round"/>'),
  break: S('<path d="M5 20l4-4M9 16l3 1 2-4 3 1 3-5-4 1-1-3-3 4-3-1z" fill="#ff6a3a" stroke="#2a170c" stroke-width="1.6" stroke-linejoin="round"/>'),
  fall: S('<path d="M3 15c2 0 2-2 4.5-2S10 15 12 15s2-2 4.5-2S19 15 21 15M3 19c2 0 2-2 4.5-2S10 19 12 19s2-2 4.5-2S19 19 21 19" fill="none" stroke="#3fb6ff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7" r="3.5" fill="#ffd9b0" stroke="#2a170c" stroke-width="1.6"/>'),
  coinT: S('<path d="M7 3h10v13l-5 5-5-5z" fill="#ffd23f" stroke="#2a170c" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 8h4M12 6v6" stroke="#c4720f" stroke-width="2" stroke-linecap="round"/>'),
  fly: S('<path d="M4 18c3-6 7-10 15-12M15 4l4 2-2 4" fill="none" stroke="#9b7bff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="2" fill="#ffd23f" stroke="#2a170c" stroke-width="1.2"/><circle cx="18" cy="16" r="1.6" fill="#ffd23f" stroke="#2a170c" stroke-width="1.2"/>'),
  last: S('<path d="M6 21l2-9 4-3 4 3 2 9" fill="#c8b48a" stroke="#2a170c" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="5" r="3" fill="#ffd9b0" stroke="#2a170c" stroke-width="1.6"/><path d="M17 9l3-3" stroke="#2a170c" stroke-width="2" stroke-linecap="round"/>'),
  chevL: S('<path d="M15 5l-7 7 7 7" ' + L + ' stroke-width="3"/>'),
  chevR: S('<path d="M9 5l7 7-7 7" ' + L + ' stroke-width="3"/>')
}
// 線のアイコンには線の指定を足す
for (const k of ['clock', 'flag', 'coin', 'mute', 'sound', 'zoom', 'run', 'wait', 'go', 'warn', 'drag', 'gust', 'log', 'rock', 'ice', 'heat', 'deck']) ICON[k] = ICON[k].replace('<svg ', `<svg ${L} `)

export const GIMMICK_LABEL = { gust: '突風', log: '丸太', rock: '落石', ice: '凍った板', heat: '燃える板', deck: 'やぐら' }
export const TITLE_ICON = { fast: 'fast', gentle: 'gentle', break: 'break', fall: 'fall', coin: 'coinT', fly: 'fly', last: 'last' }
export const TITLE_LABEL = { fast: '一番乗り', gentle: '橋にやさしい', break: '破壊王', fall: '落下王', coin: 'お守り長者', fly: 'ふっとび王', last: 'しんがり' }
