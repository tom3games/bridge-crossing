// 画面の切り替え（ホーム → ロビー → ゲーム → 結果）。ゲーム中の描画と操作は game-view.js に任せる。
import { connect } from './net.js'
import * as view from './game-view.js'
import { COURSES, COURSE_IDS, DEFAULT_COURSE, THEMES, PLAYER_COLORS } from './courses.js'
import { ICON, GIMMICK_LABEL } from './icons.js'
import { loadRecords, careerTitle, loadCareer } from './records.js'

const $ = s => document.querySelector(s)
const screens = ['home', 'lobby', 'game', 'result']
const ERR = {
  not_found: 'その部屋は見つかりません。コードを確かめてください',
  full: 'その部屋は満員です',
  started: 'その部屋はもうゲームを始めています。終わるまで待ってください',
  bad_name: 'ニックネームを入れてください（12文字まで）',
  not_host: 'ゲームを始められるのはホストだけです',
  not_enough: '人数が足りません',
  not_playing: 'いまはゲーム中ではありません',
  no_room: '部屋に入っていません',
  closed: 'しばらく動きがなかったので、部屋を閉じました',
  too_fast: null, bad_input: null, over: null // ゲーム中の細かい拒否は表示しない
}

let me = null, state = null, gameMeta = null, leftCode = null
const NAME_KEY = 'pg-name'
const pick = { course: DEFAULT_COURSE }
try { const c = localStorage.getItem('bc-course'); if (COURSE_IDS.includes(c)) pick.course = c } catch {}

const net = connect({
  onStatus: s => {
    const el = $('#net')
    el.dataset.s = s
    el.textContent = s === 'online' ? '接続中' : s === 'connecting' ? '接続しています' : '切断。つなぎ直しています'
  },
  onMessage: msg => {
    if (msg.t === 'welcome') {
      me = msg.id; gameMeta = msg.game
      // 招待URL（/r/ABCD）で開いたら、コード欄を埋めておく
      const m = location.pathname.match(/^\/r\/([A-Z0-9]{4})/i)
      if (m && !msg.code) { $('#code').value = m[1].toUpperCase(); $('#joinBox').open = true; $('#name').focus() }
      if (!msg.code) show('home')
    } else if (msg.t === 'state') {
      if (leftCode && msg.code === leftCode) return // 抜けた直後に届いた古い部屋の状態で、画面を戻さない
      state = msg
      render()
    } else if (msg.t === 'f') {
      // ゲーム中の差分（動いた人と傷んだ板だけ）。全体の状態は持ち直さず、ゲーム画面にだけ渡す
      if (state && state.phase === 'playing' && view.frame) view.frame(msg)
    } else if (msg.t === 'joined') {
      leftCode = null
      history.replaceState(null, '', '/r/' + msg.code)
    } else if (msg.t === 'error') {
      if (ERR[msg.code] === null || msg.req === 'input') return // 操作の拒否（終わった直後の入力など）は出さない
      toast(ERR[msg.code] ? ERR[msg.code] + (msg.need ? `（${msg.need}人から）` : '') : 'エラー: ' + msg.code)
    } else if (msg.t === 'closed') {
      state = null; toast(ERR.closed); history.replaceState(null, '', '/'); show('home')
    } else if (msg.t === 'pong') {
      $('#ping').textContent = Math.round(performance.now() - msg.at) + 'ms'
    }
  }
})

function show(name) {
  for (const s of screens) $('#' + s).hidden = s !== name
  document.body.dataset.screen = name
  if (name === 'home') showCareer()
}

function toast(text) {
  const t = $('#toast')
  t.textContent = text; t.hidden = false
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500)
}

function showCareer() {
  const c = loadCareer()
  const el = $('#career')
  if (!c.plays) { el.hidden = true; return }
  el.hidden = false
  el.innerHTML = `${ICON.star}<span></span>`
  el.lastChild.textContent = `${careerTitle(c).name}・渡りきった ${c.wins}回`
}

function render() {
  if (!state) return show('home')
  const isHost = state.hostId === state.you
  if (state.phase === 'lobby') {
    show('lobby')
    $('#roomCode').textContent = state.code
    $('#invite').value = `${location.origin}/r/${state.code}`
    $('#count').textContent = `${state.players.length} / ${state.max}人`
    $('#players').dataset.many = state.players.length > 10 ? '1' : ''
    $('#players').replaceChildren(...state.players.map((p, i) => {
      const li = document.createElement('li')
      const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = PLAYER_COLORS[i % PLAYER_COLORS.length]
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name
      li.append(dot, nm)
      if (p.id === state.hostId) li.append(badge('ホスト'))
      if (p.id === state.you) li.append(badge('あなた', 'you'))
      if (!p.connected) { li.append(badge('切断中')); li.classList.add('off') }
      return li
    }))
    const short = state.min - state.players.filter(p => p.connected).length
    $('#startBtn').hidden = !isHost
    $('#startBtn').disabled = short > 0
    renderPick(isHost)
    $('#lobbyHint').textContent = short > 0 ? `あと${short}人でスタートできます` : isHost ? '橋を選んでスタート' : 'ホストがスタートするのを待っています'
  } else if (state.phase === 'playing') {
    show('game')
    view.render(state, { send: data => net.send({ t: 'input', data }) })
  } else if (state.phase === 'result') {
    show('result')
    const r = state.result || {}
    $('#resultTitle').textContent = r.title || '結果'
    $('#resultTitle').dataset.win = r.win ? '1' : '0'
    $('#resultBody').replaceChildren(view.renderResult(state))
    $('#rematchBtn').hidden = !isHost
    $('#lobbyBtn').hidden = !isHost
    $('#resultHint').textContent = isHost ? '' : 'ホストが次を選ぶのを待っています'
    $('#resultHint').hidden = isHost
  }
}

function renderPick(isHost) {
  // ホストは自分の選択、ほかの人はホストが選んだもの（サーバー経由で届く）を見る
  const sh = state.setup || {}
  const id = isHost ? pick.course : COURSE_IDS.includes(sh.course) ? sh.course : DEFAULT_COURSE
  if (isHost && sh.course !== pick.course) net.send({ t: 'setup', opts: { course: pick.course } })
  const c = COURSES[id]
  const i = COURSE_IDS.indexOf(id)
  const rec = loadRecords()[id]
  const el = $('#coursePick')
  el.dataset.host = isHost ? '1' : '0'
  const gims = ['deck', 'gust', 'log', 'rock', 'ice', 'heat'].filter(k => c.sections.some(s => s[k]))
  el.innerHTML = `
    <button type="button" class="btn pk-btn" data-d="-1" aria-label="前の橋">${ICON.chevL}</button>
    <div class="pk-body" data-id="${id}"><div class="pk-thumb">${courseThumb(id)}</div><div class="pk-text">
      <small><span>${i + 1}/${COURSE_IDS.length}</span><span class="stars" aria-label="難しさ${c.stars}">${ICON.star.repeat(c.stars)}</span><span class="gim">${gims.map(k => ICON[k].replace('<svg ', `<svg aria-label="${GIMMICK_LABEL[k]}" role="img" `)).join('')}</span></small>
      <b></b><span class="pk-lead"></span><span class="pk-note"></span></div></div>
    <button type="button" class="btn pk-btn" data-d="1" aria-label="次の橋">${ICON.chevR}</button>`
  el.querySelector('b').textContent = c.name
  el.querySelector('.pk-lead').textContent = c.lead
  el.querySelector('.pk-note').textContent = rec ? `自己ベスト ${rec.best != null ? rec.best.toFixed(1) + '秒' : '-'}・星${rec.stars}` : isHost ? 'まだ記録なし' : 'ホストが選ぶ'
  for (const b of el.querySelectorAll('.pk-btn')) {
    b.hidden = !isHost
    b.onclick = () => { pick.course = COURSE_IDS[(i + Number(b.dataset.d) + COURSE_IDS.length) % COURSE_IDS.length]; try { localStorage.setItem('bc-course', pick.course) } catch {}; render() }
  }
}

// 橋の小さな絵（奥へのびる吊り橋。仕掛けの区間は色で示す）
const thumbCache = {}
function courseThumb(id) {
  if (thumbCache[id]) return thumbCache[id]
  const c = COURSES[id]
  const th = THEMES[c.sections[c.sections.length - 1].th] || THEMES.forest
  const hex = v => '#' + v.toString(16).padStart(6, '0')
  const n = c.sections.length
  let planks = ''
  const rows = Math.min(14, n * 2)
  for (let r = 0; r < rows; r++) {
    const t = r / rows, t2 = (r + 0.7) / rows
    const w0 = 60 - t * 46, w1 = 60 - t2 * 46
    const y0 = 64 - t * 46, y1 = 64 - t2 * 46
    const s = c.sections[Math.min(n - 1, Math.floor(r / rows * n))]
    const col = s.deck ? '#9aa0a6' : s.heat ? '#d0603a' : s.ice ? '#bfe6ff' : '#c08a52'
    planks += `<path d="M${48 - w0 / 2} ${y0}L${48 + w0 / 2} ${y0}L${48 + w1 / 2} ${y1}L${48 - w1 / 2} ${y1}z" fill="${col}" stroke="#2a170c" stroke-width=".8"/>`
  }
  const out = `<svg viewBox="0 0 96 64" preserveAspectRatio="xMidYMid slice"><rect width="96" height="64" fill="${hex(th.sky)}"/><rect y="22" width="96" height="42" fill="${hex(th.horizon)}" opacity=".5"/><path d="M0 26l14-10 12 8 10-6 0 46H0zM96 26l-14-10-12 8-10-6 0 46h36z" fill="${hex(th.cliff)}"/><rect y="52" width="96" height="12" fill="${hex(th.below)}"/>${planks}<path d="M18 64L41 18M78 64L55 18" stroke="#2a170c" stroke-width="1.5"/></svg>`
  return (thumbCache[id] = out)
}

function badge(text, cls) { const b = document.createElement('span'); b.className = 'badge' + (cls ? ' ' + cls : ''); b.textContent = text; return b }

// ---- ボタン
const nameInput = $('#name')
try { nameInput.value = localStorage.getItem(NAME_KEY) || '' } catch {}
const name = () => { const n = nameInput.value.trim(); try { localStorage.setItem(NAME_KEY, n) } catch {}; return n }

$('#createBtn').onclick = () => { leftCode = null; if (!name()) return toast(ERR.bad_name); net.send({ t: 'create', name: name() }) }
$('#joinBtn').onclick = () => {
  leftCode = null
  const code = $('#code').value.trim().toUpperCase()
  if (!name()) return toast(ERR.bad_name)
  if (!/^[A-Z0-9]{4}$/.test(code)) return toast('参加コードは4文字です')
  net.send({ t: 'join', code, name: name() })
}
$('#copyBtn').onclick = async () => {
  const url = $('#invite').value
  try {
    if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: document.title, url })
    else { await navigator.clipboard.writeText(url); toast('招待URLをコピーしました') }
  } catch { $('#invite').select(); toast('URLを長押ししてコピーしてください') }
}
$('#startBtn').onclick = () => net.send({ t: 'start', opts: { course: pick.course } })
function leaveRoom() { leftCode = state && state.code; net.send({ t: 'leave' }); state = null; history.replaceState(null, '', '/'); show('home') }
$('#leaveBtn').onclick = leaveRoom
$('#rematchBtn').onclick = () => net.send({ t: 'rematch', opts: { course: (state && state.result && state.result.course) || pick.course } })
$('#lobbyBtn').onclick = () => net.send({ t: 'lobby' })
// 抜けるボタンは2回押しで確定（ブラウザの確認ダイアログは使わない）
$('#quitBtn').onclick = () => {
  const b = $('#quitBtn')
  if (b.dataset.armed !== '1') { const icon = b.innerHTML; b.dataset.armed = '1'; b.textContent = 'もう一度で退出'; setTimeout(() => { b.dataset.armed = ''; b.innerHTML = icon }, 2500); return }
  leaveRoom()
}
// 遊び方
$('#howBtn').onclick = () => { $('#howto').hidden = false; $('#howClose').focus() }
$('#howClose').onclick = () => { $('#howto').hidden = true }
$('#howto').onclick = e => { if (e.target.id === 'howto') $('#howto').hidden = true }
addEventListener('keydown', e => { if (e.key === 'Escape') $('#howto').hidden = true })

window.__boot = true
{ const d = document.getElementById('bootErr'); if (d) d.hidden = true } // 遅れて起動できたときは誤報を消す
show('home')
