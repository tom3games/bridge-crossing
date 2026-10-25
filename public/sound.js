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
export const splash = () => { noise(0.6, { freq: 900, type: 'lowpass', vol: 0.4, sweep: 0.3 }); tone(520, 0.5, { type: 'triangle', vol: 0.12, slide: 0.3 }) }
export const splashFar = () => { if (gate('splashFar', 250)) noise(0.4, { freq: 600, type: 'lowpass', vol: 0.12, sweep: 0.4 }) }
export const goal = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.14, at: i * 0.08 }))
export const call = () => { if (gate('call', 150)) tone(880, 0.08, { type: 'sine', vol: 0.08 }) }
export const collapse = () => { noise(1.2, { freq: 300, type: 'lowpass', vol: 0.5, sweep: 0.4 }); tone(80, 1.0, { type: 'sawtooth', vol: 0.15, slide: 0.4 }) }
export const win = () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.14, at: i * 0.11 }))
export const lose = () => [392, 349, 311, 262].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.12, at: i * 0.16 }))

// BGM: 弦をはじくような短い音を、少し不安な音階で回す
let wantBgm = false, bgmTimer = 0, step = 0, nextAt = 0
const SCALE = [220, 247, 262, 294, 330, 349, 392, 440]
const PAT = [0, 4, 2, 5, 0, 6, 4, 3, 0, 4, 2, 7, 5, 4, 2, 1]
export function bgm(on) {
  wantBgm = on
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
      const n = PAT[step % PAT.length]
      tone(SCALE[n], 0.22, { type: 'triangle', vol: 0.045, at })
      if (step % 4 === 0) tone(SCALE[n] / 2, 0.4, { type: 'sine', vol: 0.06, at })
      step++
      nextAt += 0.2
    }
  }, 100)
}
