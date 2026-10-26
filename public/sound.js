// 効果音と BGM。音源ファイルは使わず WebAudio で鳴らす。最初のタップで有効になる（ブラウザの決まり）。
const KEY = 'bc-mute'
let ctx = null, master = null, noiseBuf = null
let isMuted = false
try { isMuted = localStorage.getItem(KEY) === '1' } catch {}
const last = {}

export function muted() { return isMuted }
export function setMuted(v) {
  isMuted = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch {}
  if (master) master.gain.value = v ? 0 : 0.8
}

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  try {
    ctx = new AC()
    master = ctx.createGain(); master.gain.value = isMuted ? 0 : 0.8; master.connect(ctx.destination)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    if (wantBgm) startBgm()
  } catch { ctx = null }
}

// 同じ音を短い間に重ねない
function gate(name, ms) {
  const t = performance.now()
  if (last[name] && t - last[name] < ms) return false
  last[name] = t
  return true
}

function tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0, dest } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type; o.frequency.setValueAtTime(freq, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur)
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02)
}

function noise(dur, { freq = 1200, q = 1, vol = 0.2, type = 'bandpass', at = 0, sweep = 0 } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const s = ctx.createBufferSource(); s.buffer = noiseBuf
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q
  if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur)
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur)
}

export const count = () => tone(660, 0.12, { type: 'square', vol: 0.08 })
export const go = () => { tone(990, 0.25, { type: 'square', vol: 0.1 }); tone(1320, 0.3, { type: 'triangle', vol: 0.1, at: 0.08 }) }
export const tickLow = () => tone(440, 0.07, { type: 'square', vol: 0.05 })
export const crack = () => { if (!gate('crack', 120)) return; noise(0.18, { freq: 2200, q: 2, vol: 0.35 }); tone(110, 0.25, { vol: 0.25, slide: 0.5 }) }
export const creak = () => { if (!gate('creak', 400)) return; tone(140, 0.35, { type: 'sawtooth', vol: 0.05, slide: 0.8 }) }
export const splash = (kind = 'water') => {
  if (kind === 'lava') { noise(0.8, { freq: 500, type: 'lowpass', vol: 0.45, sweep: 0.5 }); tone(90, 0.6, { type: 'sawtooth', vol: 0.12, slide: 0.6 }); noise(0.5, { freq: 3000, q: 0.5, vol: 0.12, at: 0.15 }); return }
  if (kind === 'ice') { noise(0.25, { freq: 3200, q: 3, vol: 0.3 }); tone(1400, 0.3, { type: 'triangle', vol: 0.1, slide: 0.5 }); tone(200, 0.3, { vol: 0.2, slide: 0.5, at: 0.05 }); return }
  noise(0.7, { freq: 900, type: 'lowpass', vol: 0.45, sweep: 0.3 }); tone(520, 0.5, { type: 'triangle', vol: 0.12, slide: 0.3 }); tone(160, 0.3, { vol: 0.2, slide: 0.5 })
}
// 落ちるときの悲鳴（声っぽく、ビブラートをかけて下がる）
export const scream = () => {
  if (!ctx) return
  const t = ctx.currentTime
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain()
  o.type = 'sawtooth'; o.frequency.setValueAtTime(820, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.8)
  lfo.frequency.value = 9; lg.gain.value = 40; lfo.connect(lg); lg.connect(o.frequency)
  f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2.5
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85)
  o.connect(f); f.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t + 0.9); lfo.stop(t + 0.9)
}
export const whack = () => { if (!gate('whack', 120)) return; noise(0.12, { freq: 700, q: 1, vol: 0.5 }); tone(180, 0.18, { type: 'square', vol: 0.12, slide: 0.5 }); [1200, 1500].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.06, at: 0.08 + i * 0.07 })) }
export const thud = () => { if (!gate('thud', 150)) return; noise(0.35, { freq: 250, type: 'lowpass', vol: 0.6 }); tone(70, 0.4, { vol: 0.3, slide: 0.6 }) }
export const rockWarn = () => { if (gate('rockWarn', 500)) tone(1600, 0.9, { type: 'sine', vol: 0.05, slide: 0.4 }) }
export const gustWarn = () => { if (gate('gustWarn', 800)) { tone(740, 0.15, { type: 'square', vol: 0.06 }); tone(740, 0.15, { type: 'square', vol: 0.06, at: 0.22 }) } }
export const gust = () => { if (gate('gust', 800)) noise(1.8, { freq: 500, q: 0.7, vol: 0.22, sweep: 2.4 }) }
export const coin = () => [1318, 1760, 2093].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.1, at: i * 0.06 }))
export const goalFar = () => { if (gate('goalFar', 300)) tone(1047, 0.18, { type: 'triangle', vol: 0.06 }) }
export const splashFar = () => { if (gate('splashFar', 250)) noise(0.4, { freq: 600, type: 'lowpass', vol: 0.12, sweep: 0.4 }) }
export const goal = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.14, at: i * 0.08 }))
export const call = () => { if (gate('call', 150)) tone(880, 0.08, { type: 'sine', vol: 0.08 }) }
export const collapse = () => { noise(1.2, { freq: 300, type: 'lowpass', vol: 0.5, sweep: 0.4 }); tone(80, 1.0, { type: 'sawtooth', vol: 0.15, slide: 0.4 }) }
export const win = () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.14, at: i * 0.11 }))
export const lose = () => [392, 349, 311, 262].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.12, at: i * 0.16 }))

// BGM: 弦をはじくような短い音を回す。橋の景色ごとに音階と速さを変える
let wantBgm = false, bgmTimer = 0, step = 0, nextAt = 0
const BGMS = {
  forest: { scale: [262, 294, 330, 392, 440, 523, 587, 659], pat: [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 6, 5, 4, 2, 3], beat: 0.19, wave: 'triangle' },
  canyon: { scale: [220, 247, 262, 294, 330, 349, 392, 440], pat: [0, 4, 2, 5, 0, 6, 4, 3, 0, 4, 2, 7, 5, 4, 2, 1], beat: 0.18, wave: 'triangle' },
  snow: { scale: [330, 370, 415, 494, 554, 659, 740, 831], pat: [0, 4, 7, 4, 2, 5, 7, 5, 1, 4, 6, 4, 3, 5, 7, 6], beat: 0.22, wave: 'sine' },
  volcano: { scale: [196, 208, 247, 262, 294, 311, 370, 392], pat: [0, 0, 3, 1, 0, 5, 4, 1, 0, 0, 3, 6, 5, 3, 1, 2], beat: 0.15, wave: 'sawtooth' }
}
let B = BGMS.canyon
export function bgm(on, theme) {
  wantBgm = on
  if (theme && BGMS[theme]) B = BGMS[theme]
  if (on) startBgm()
  else { clearInterval(bgmTimer); bgmTimer = 0 }
}
function startBgm() {
  if (!ctx || bgmTimer) return
  nextAt = ctx.currentTime + 0.05
  bgmTimer = setInterval(() => {
    if (!ctx) return
    while (nextAt < ctx.currentTime + 0.3) {
      const at = nextAt - ctx.currentTime
      const n = B.pat[step % B.pat.length]
      tone(B.scale[n], 0.22, { type: B.wave, vol: B.wave === 'sawtooth' ? 0.022 : 0.045, at })
      if (step % 4 === 0) tone(B.scale[n] / 2, 0.4, { type: 'sine', vol: 0.06, at })
      if (step % 2 === 1) noise(0.04, { freq: 6000, q: 1, vol: 0.025, at })
      step++
      nextAt += B.beat
    }
  }, 100)
}
