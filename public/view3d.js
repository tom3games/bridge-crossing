// ゲーム中の 3D 描画（Three.js r185、public/vendor）。判定はサーバーなので、ここは届いた状態を立体で見せるだけ。
// 座標: 橋の x（0〜cols）→ 3D の x（橋の真ん中が 0）、進む向き y → 3D の -z（奥）。1 = 板1枚 = 1m。
// カメラは自分の少し後ろ・上から進む先（奥）を見る追いかけ視点。向きは固定なので
// 「スティックの上 = 画面の奥 = 向こう岸」「右 = 右」がずっと一致する。虫めがねで高い引きの視点。
import * as THREE from './vendor/three.module.js'
import { FLAG, PLAYER_COLORS, THEMES, logX, LOG_HALF_W, LOG_HALF_D } from './courses.js'

const ST = { idle: 0, walk: 1, run: 2, fall: 3, done: 4, gone: 5, hit: 6 }
const DEPTH = -14          // 谷底（水面）の高さ
const v3 = (x, y, z) => new THREE.Vector3(x, y, z)
const UP = v3(0, 1, 0)

let gradTex = null
function toon(color, extra = {}) {
  if (!gradTex) {
    gradTex = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat)
    gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...extra })
}
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra })

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// 顔（表情ごとに1枚）。頭のカメラ側に貼る
function faceTex(kind) {
  return canvasTex(128, 128, g => {
    g.strokeStyle = '#1b130d'; g.fillStyle = '#1b130d'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'
    const eye = (x, y, r = 9) => { g.fillStyle = '#1b130d'; g.beginPath(); g.ellipse(x, y, r * 0.8, r, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 2, y - 3, r * 0.32, 0, 7); g.fill(); g.fillStyle = '#1b130d' }
    if (kind === 'happy') {
      g.beginPath(); g.arc(42, 60, 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke()
      g.beginPath(); g.arc(86, 60, 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke()
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.arc(64, 78, 20, 0, Math.PI); g.closePath(); g.fill(); g.stroke()
      g.fillStyle = '#ff7f8a'; g.beginPath(); g.arc(64, 92, 8, 0, Math.PI); g.fill()
    } else if (kind === 'run') { // 気合い
      g.lineWidth = 7; g.beginPath(); g.moveTo(30, 40); g.lineTo(54, 48); g.moveTo(98, 40); g.lineTo(74, 48); g.stroke()
      eye(44, 62, 8); eye(84, 62, 8)
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.moveTo(46, 82); g.lineTo(82, 82); g.lineTo(64, 100); g.closePath(); g.fill(); g.lineWidth = 5; g.stroke()
    } else if (kind === 'shock') {
      g.lineWidth = 5; g.fillStyle = '#fff'
      g.beginPath(); g.arc(42, 54, 13, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.arc(86, 54, 13, 0, 7); g.fill(); g.stroke()
      g.fillStyle = '#1b130d'; g.beginPath(); g.arc(42, 54, 4, 0, 7); g.arc(86, 54, 4, 0, 7); g.fill()
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.ellipse(64, 94, 13, 17, 0, 0, 7); g.fill(); g.stroke()
    } else if (kind === 'worry') {
      eye(44, 62); eye(84, 62)
      g.beginPath(); g.moveTo(30, 46); g.lineTo(52, 38); g.moveTo(98, 46); g.lineTo(76, 38); g.stroke()
      g.lineWidth = 5; g.beginPath(); g.moveTo(44, 96); for (let x = 44; x <= 84; x += 8) g.lineTo(x + 4, x % 16 ? 90 : 98); g.stroke()
      g.fillStyle = '#7fd3ff'; g.beginPath(); g.moveTo(108, 18); g.quadraticCurveTo(122, 40, 108, 46); g.quadraticCurveTo(94, 40, 108, 18); g.fill()
    } else if (kind === 'dizzy') {
      g.lineWidth = 5
      for (const cx of [42, 86]) { g.beginPath(); for (let a = 0; a < 12; a += 0.3) { const r = a * 1.1; g.lineTo(cx + Math.cos(a) * r, 56 + Math.sin(a) * r) } g.stroke() }
      g.beginPath(); g.moveTo(44, 92); g.quadraticCurveTo(54, 84, 64, 92); g.quadraticCurveTo(74, 100, 84, 92); g.stroke()
    } else {
      eye(44, 60); eye(84, 60)
      g.beginPath(); g.arc(64, 76, 13, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke()
    }
    g.fillStyle = 'rgba(255,110,110,.45)'; g.beginPath(); g.ellipse(24, 84, 11, 7, 0, 0, 7); g.ellipse(104, 84, 11, 7, 0, 0, 7); g.fill()
  })
}

function textTex(text, { w = 512, h = 128, bg = '#fff4df', fg = '#2a170c', border = '#2a170c' } = {}) {
  return canvasTex(w, h, g => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h)
    g.strokeStyle = border; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14)
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'
    let size = 80
    const f = s => `${s}px "RocknRoll One", "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif`
    g.font = f(size)
    while (g.measureText(text).width > w * 0.84 && size > 14) { size -= 4; g.font = f(size) }
    g.fillText(text, w / 2, h / 2 + 4)
  })
}

// 板の木目
function woodTex() {
  return canvasTex(128, 128, g => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128)
    g.strokeStyle = 'rgba(80,45,15,.28)'; g.lineWidth = 2
    for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(0, 8 + k * 14); g.bezierCurveTo(40, 2 + k * 14, 80, 16 + k * 14, 128, 8 + k * 14); g.stroke() }
    g.fillStyle = 'rgba(60,35,10,.5)'; g.beginPath(); g.arc(18, 22, 3, 0, 7); g.arc(110, 104, 3, 0, 7); g.fill()
    g.fillStyle = 'rgba(30,20,10,.55)'; g.fillRect(0, 0, 128, 5); g.fillRect(0, 123, 128, 5)
  })
}
// ひび（a: 1本、b: たくさん）
function crackTex(many) {
  const t = canvasTex(128, 128, g => {
    g.clearRect(0, 0, 128, 128)
    g.strokeStyle = '#1e1008'; g.lineWidth = many ? 7 : 6; g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath(); g.moveTo(26, 0); g.lineTo(50, 40); g.lineTo(38, 70); g.lineTo(60, 128); g.stroke()
    if (many) {
      g.beginPath(); g.moveTo(128, 30); g.lineTo(84, 56); g.lineTo(98, 86); g.lineTo(76, 128); g.stroke()
      g.beginPath(); g.moveTo(50, 40); g.lineTo(84, 56); g.stroke()
      g.beginPath(); g.moveTo(0, 96); g.lineTo(38, 70); g.stroke()
    }
  })
  return t
}
function waterTex(kind) {
  const t = canvasTex(256, 256, g => {
    const base = kind === 'lava' ? '#ff6a1a' : kind === 'ice' ? '#9fd8ee' : '#3f9fc2'
    g.fillStyle = base; g.fillRect(0, 0, 256, 256)
    g.strokeStyle = kind === 'lava' ? 'rgba(255,230,120,.75)' : 'rgba(255,255,255,.45)'; g.lineWidth = kind === 'lava' ? 6 : 4
    for (let i = 0; i < 26; i++) {
      const x = (i * 73) % 256, y = (i * 47) % 256
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 8, x + 30, y); g.stroke()
    }
    if (kind === 'lava') { g.fillStyle = 'rgba(80,10,0,.45)'; for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse((i * 97) % 256, (i * 61) % 256, 26, 12, i, 0, 7); g.fill() } }
    if (kind === 'ice') { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo((i * 53) % 256, 0); g.lineTo((i * 91) % 256, 256); g.stroke() } }
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// ---- 渡る人（頭の大きいちびキャラ）。帽子は キャップ / ニット帽 / ヘルメット の3種
function makeChibi(faces) {
  const g = new THREE.Group()
  const body = new THREE.Group(); g.add(body)
  const cloth = toon(0xffffff)
  const dark = toon(0x33303a)
  const skin = toon(0xffd9b3)
  const legs = [-0.08, 0.08].map(x => {
    const pv = new THREE.Group(); pv.position.set(x, 0.22, 0)
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.18, 8), dark); l.position.y = -0.09; l.castShadow = true; pv.add(l)
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.16), toon(0xf4f1ea)); shoe.position.set(0, -0.19, 0.03); pv.add(shoe)
    body.add(pv); return pv
  })
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 4, 12), cloth); torso.position.y = 0.37; torso.castShadow = true; body.add(torso)
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 12), dark); belt.position.y = 0.27; body.add(belt)
  const arms = [-1, 1].map(s => {
    const pv = new THREE.Group(); pv.position.set(s * 0.17, 0.47, 0)
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 6), cloth); a.position.y = -0.11; a.castShadow = true; pv.add(a)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin); hand.position.y = -0.23; pv.add(hand)
    pv.rotation.z = s * 0.25
    body.add(pv); return pv
  })
  const headG = new THREE.Group(); headG.position.y = 0.76; body.add(headG)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), skin); head.castShadow = true; headG.add(head)
  const outline = new THREE.Mesh(head.geometry, new THREE.MeshBasicMaterial({ color: 0x2a170c, side: THREE.BackSide })); outline.scale.setScalar(1.07); headG.add(outline)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.265, 16, 10, Math.PI * 0.75, Math.PI * 1.5, 0, Math.PI * 0.62), toon(0x3a2a20)); headG.add(hair)
  const hats = [0, 1, 2].map(style => {
    const h = new THREE.Group(); headG.add(h)
    if (style === 0) {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.275, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), cloth); crown.position.y = 0.02; h.add(crown)
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 14, 1, false, -Math.PI / 2, Math.PI), cloth); brim.position.set(0, 0.11, 0.19); h.add(brim)
    } else if (style === 1) {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), cloth); crown.position.y = 0.03; h.add(crown)
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toon(0xffffff)); pom.position.y = 0.33; h.add(pom)
    } else {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), cloth); crown.position.y = 0.03; h.add(crown)
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), toon(0xfff2a0)); lamp.rotation.x = Math.PI / 2; lamp.position.set(0, 0.17, 0.26); h.add(lamp)
    }
    return h
  })
  const face = new THREE.Sprite(faces.calm); face.scale.set(0.38, 0.38, 1); face.renderOrder = 4; g.add(face)
  // 目回りの星（ふっとび中）
  const stars = new THREE.Group(); g.add(stars)
  for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xffd23f })); stars.add(s) }
  stars.visible = false
  return { g, body, legs, arms, headG, face, hats, cloth, stars, slot: -1 }
}

export function createView3D(canvas, W) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    if (!renderer.getContext()) throw new Error('no gl')
  } catch (e) { console.warn('WebGL を使えない', e); return null }
  const { cols, rows, span } = W
  const sections = W.L.sections.filter(s => s.row0 < rows)
  const spans = Math.ceil(rows / span)
  const coarse = matchMedia('(pointer: coarse)').matches
  let tier = coarse ? 1 : 2
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  const scene = new THREE.Scene()
  const th0 = THEMES[sections[0].th] || THEMES.forest
  scene.background = new THREE.Color(th0.horizon)
  scene.fog = new THREE.Fog(th0.fog, 22, 80)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
  const hemi = new THREE.HemisphereLight(0xfff6e6, 0x6a5a48, 1.6); scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.1)
  sun.castShadow = true
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -12, near: 1, far: 40 })
  sun.shadow.bias = -0.0006
  scene.add(sun, sun.target)

  const X = x => x - cols / 2
  const Z = y => -y
  const secAt = y => sections[Math.max(0, Math.min(sections.length - 1, Math.floor(Math.max(0, y) / span)))]
  const themeAt = y => THEMES[secAt(y).th] || THEMES.forest

  // ---- 空（上が濃いグラデーションの球。カメラについてくる）
  const skyGeo = new THREE.SphereGeometry(300, 24, 12)
  skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3))
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
  sky.renderOrder = -10; scene.add(sky)
  const skyTop = new THREE.Color(), skyHor = new THREE.Color(), fogC = new THREE.Color()
  function paintSky(th) {
    skyTop.set(th.sky); skyHor.set(th.horizon)
    const p = skyGeo.attributes.position, c = skyGeo.attributes.color, tmp = new THREE.Color()
    for (let i = 0; i < p.count; i++) { const k = Math.max(0, Math.min(1, p.getY(i) / 300 * 1.8 + 0.1)); tmp.copy(skyHor).lerp(skyTop, k); c.setXYZ(i, tmp.r, tmp.g, tmp.b) }
    c.needsUpdate = true
  }
  let skyTheme = null
  // 太陽（火山は赤い月）
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0xfff1b8, fog: false, transparent: true, opacity: 0.9 }))
  scene.add(sunDisc)

  // ---- 谷底（区間ごとに水・氷・溶岩）
  const belowMats = {}
  const belowMat = kind => belowMats[kind] || (belowMats[kind] = new THREE.MeshLambertMaterial({ map: waterTex(kind), emissive: kind === 'lava' ? 0xff4a10 : 0x000000, emissiveIntensity: kind === 'lava' ? 0.9 : 0 }))
  const belows = []
  const addBelow = (z0, z1, th) => {
    const m = belowMat(th.belowKind)
    m.map.repeat.set(10, Math.max(1, (z0 - z1) / 12))
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(260, z0 - z1), m)
    pl.rotation.x = -Math.PI / 2; pl.position.set(0, DEPTH, (z0 + z1) / 2); scene.add(pl); belows.push(pl)
  }
  for (const s of sections) addBelow(Z(s.row0) + (s.i === 0 ? 40 : 0), Z(Math.min(rows, s.row0 + span)) - (s.i === sections.length - 1 ? 60 : 0), THEMES[s.th] || THEMES.forest)

  // ---- 崖（スタートとゴール）
  const cliffBox = (z0, z1, th) => {
    const geo = new THREE.BoxGeometry(220, -DEPTH + 1, z0 - z1)
    const side = lam(th.cliff), top = lam(th.ground)
    const m = new THREE.Mesh(geo, [side, side, top, side, side, side])
    m.position.set(0, (DEPTH - 1) / 2 + 0.5 - 0.5, (z0 + z1) / 2); m.receiveShadow = true
    scene.add(m)
  }
  const thS = THEMES[sections[0].th] || THEMES.forest, thG = THEMES[sections[sections.length - 1].th] || THEMES.forest
  cliffBox(60, Z(-0.02), thS)
  cliffBox(Z(rows + 0.02), Z(rows + 70), thG)

  // ---- 谷の壁（区間ごとに左右へ岩の塊）と、遠くの山。場所のテーマで色と飾りが変わる
  const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()
  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  const wallCount = sections.length * 6 + 24
  const walls = new THREE.InstancedMesh(rockGeo, lam(0xffffff, { flatShading: true }), wallCount)
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color()
  let wi = 0
  const putWall = (x, y, z, sx, sy, sz, color) => {
    if (wi >= wallCount) return
    q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * 3, rand() * 0.4)); mtx.compose(pos.set(x, y, z), q, sc.set(sx, sy, sz)); walls.setMatrixAt(wi, mtx)
    walls.setColorAt(wi, col.set(color).offsetHSL(0, 0, (rand() - 0.5) * 0.08)); wi++
  }
  const sideX = cols / 2 + 6
  for (const s of sections) {
    const th = THEMES[s.th] || THEMES.forest
    const zc = Z(s.row0 + span / 2)
    for (const sgn of [-1, 1]) {
      putWall(sgn * (sideX + 3 + rand() * 4), DEPTH + 4 + rand() * 4, zc + (rand() - 0.5) * 3, 6 + rand() * 3, 10 + rand() * 4, 5 + rand() * 2, th.cliff)
      putWall(sgn * (sideX + 10 + rand() * 6), DEPTH + 8 + rand() * 6, zc + (rand() - 0.5) * 4, 7, 12 + rand() * 6, 6, th.cliff)
      putWall(sgn * (sideX + 1 + rand() * 2), DEPTH + 1, zc + (rand() - 0.5) * 5, 3, 3 + rand() * 2, 3, th.cliff)
    }
  }
  for (let k = 0; k < 12; k++) for (const sgn of [-1, 1]) { const zz = 20 - k * Math.max(8, (rows + 60) / 12); const th = themeAt(-zz); putWall(sgn * (60 + rand() * 40), -8 + rand() * 10, zz, 22 + rand() * 12, 30 + rand() * 18, 18, th.cliff) }
  walls.count = wi; walls.instanceMatrix.needsUpdate = true; if (walls.instanceColor) walls.instanceColor.needsUpdate = true
  scene.add(walls)
  // 木（森・谷）、雪の帽子（雪山）、溶岩の光（火山）を崖の上と脇に
  const treeN = 160
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 2.6, 7), lam(0xffffff, { flatShading: true }), treeN)
  let ti = 0
  const putTree = (x, z, h, color) => { if (ti >= treeN) return; mtx.compose(pos.set(x, h / 2 * 2.6 / 2.6 + 0.0, z), q.identity(), sc.set(h / 2.6, h / 2.6, h / 2.6)); mtx.setPosition(x, h / 2, z); trees.setMatrixAt(ti, mtx); trees.setColorAt(ti, col.set(color).offsetHSL(0, 0, (rand() - 0.5) * 0.1)); ti++ }
  const treeColor = th => (th === THEMES.snow ? 0xf4f8ff : th === THEMES.volcano ? 0x2a1e22 : th === THEMES.canyon ? 0x6f8a3a : 0x2f8a46)
  for (let k = 0; k < 34; k++) { const x = (rand() < 0.5 ? -1 : 1) * (cols / 2 + 2.2 + rand() * 14); putTree(x, 2 + rand() * 18, 1.6 + rand() * 2.2, treeColor(thS)) }
  for (let k = 0; k < 34; k++) { const x = (rand() < 0.5 ? -1 : 1) * (cols / 2 + 2.2 + rand() * 14); putTree(x, Z(rows) - 4 - rand() * 22, 1.6 + rand() * 2.2, treeColor(thG)) }
  trees.count = ti; trees.instanceMatrix.needsUpdate = true; if (trees.instanceColor) trees.instanceColor.needsUpdate = true
  trees.castShadow = true; scene.add(trees)

  // ---- 橋の板（1枚1インスタンス）
  const N = cols * rows
  const plankMat = new THREE.MeshLambertMaterial({ map: woodTex() })
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.84), plankMat, N)
  planks.receiveShadow = true; planks.castShadow = false
  planks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); planks.frustumCulled = false
  const jitter = new Float32Array(N), tint = new Float32Array(N)
  for (let k = 0; k < N; k++) { jitter[k] = (rand() - 0.5) * 0.07; tint[k] = (rand() - 0.5) * 0.1 }
  scene.add(planks)
  // 石のやぐら（割れない段）。板とは別の石の塊
  const deckRows = []
  for (let r = 0; r < rows; r++) if (W.L.deckRow[r]) deckRows.push(r)
  const stone = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lam(0x9aa3aa), Math.max(1, deckRows.length + sections.length * 2))
  let si = 0
  const deckStarts = sections.filter(s => s.deck)
  for (const s of deckStarts) {
    mtx.compose(pos.set(0, -0.2, Z(s.row0 + 1)), q.identity(), sc.set(cols + 1.2, 0.4, 2)); stone.setMatrixAt(si++, mtx)
    mtx.compose(pos.set(0, (DEPTH - 0.4) / 2, Z(s.row0 + 1)), q.identity(), sc.set(cols * 0.6 + 0.8, -DEPTH - 0.4, 1.6)); stone.setMatrixAt(si++, mtx)
  }
  stone.count = si; stone.receiveShadow = true; stone.castShadow = true; scene.add(stone)
  // やぐらの旗（チェックポイント）
  const flagMat = toon(0x3fe0a0, { side: THREE.DoubleSide })
  for (const s of deckStarts) for (const sgn of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), toon(0x5a4030)); pole.position.set(sgn * (cols / 2 + 0.45), 1.2, Z(s.row0 + 1)); scene.add(pole)
    const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(-sgn * 0.7, -0.22); tri.lineTo(0, -0.44); tri.closePath()
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(tri), flagMat); fl.position.set(sgn * (cols / 2 + 0.45), 2.35, Z(s.row0 + 1)); fl.rotation.y = -sgn * 0.5; scene.add(fl)
  }
  // ひび（上に重ねる薄い板）
  const crackGeo = new THREE.PlaneGeometry(0.86, 0.8); crackGeo.rotateX(-Math.PI / 2)
  const crackA = new THREE.InstancedMesh(crackGeo, new THREE.MeshBasicMaterial({ map: crackTex(false), transparent: true, depthWrite: false }), N)
  const crackB = new THREE.InstancedMesh(crackGeo, new THREE.MeshBasicMaterial({ map: crackTex(true), transparent: true, depthWrite: false }), N)
  crackA.renderOrder = crackB.renderOrder = 2
  crackA.frustumCulled = crackB.frustumCulled = false; crackA.count = crackB.count = 0
  scene.add(crackA, crackB)
  // 手すりの綱と吊り綱
  const ropeMat = toon(0xc9a46a)
  const rails = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 5), ropeMat, rows * 4 + 4)
  rails.instanceMatrix.setUsage(THREE.DynamicDrawUsage); rails.frustumCulled = false; scene.add(rails)
  // 支柱（区間の境目）
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 2.6, 0.28), toon(0x6a4a2a), (spans + 1) * 2)
  for (let s = 0; s <= spans; s++) for (const [j, sgn] of [[0, -1], [1, 1]].entries()) {
    mtx.compose(pos.set(sgn[1] * (cols / 2 + 0.2), 0.8, Z(Math.min(rows, s * span))), q.identity(), sc.set(1, 1, 1)); posts.setMatrixAt(s * 2 + j, mtx)
  }
  posts.castShadow = true; scene.add(posts)

  // スタートとゴールの看板
  const signMat = txt => new THREE.MeshBasicMaterial({ map: textTex(txt), fog: true })
  const startSign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), signMat('スタート')); startSign.position.set(-cols / 2 - 2.6, 1.5, 1.2); startSign.rotation.y = 0.35; scene.add(startSign)
  for (const dx of [-0.95, 0.95]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), toon(0x6a4a2a)); p.position.set(-cols / 2 - 2.6 + dx * Math.cos(0.35), 0.75, 1.2 - dx * Math.sin(0.35) - 0.05); scene.add(p) }
  const archMat = toon(0xd94a3a), archW = toon(0xffffff)
  for (const sgn of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.6, 10), sgn < 0 ? archMat : archW); p.position.set(sgn * (cols / 2 + 0.6), 1.8, Z(rows + 1.2)); p.castShadow = true; scene.add(p)
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(cols + 1.6, 0.9), new THREE.MeshBasicMaterial({ map: textTex('ゴール', { bg: '#ffd23f' }), side: THREE.DoubleSide }))
  banner.position.set(0, 3.2, Z(rows + 1.2)); scene.add(banner)

  // ---- 丸太（振り子）
  const logParts = W.logs.map(L => {
    const g = new THREE.Group()
    const log = new THREE.Mesh(new THREE.CylinderGeometry(LOG_HALF_W, LOG_HALF_W, LOG_HALF_D * 2 + 0.3, 12), toon(0x8a5a30)); log.rotation.x = Math.PI / 2; log.castShadow = true; g.add(log)
    const end = new THREE.Mesh(new THREE.CircleGeometry(LOG_HALF_W * 0.92, 12), toon(0xe0b070)); end.position.z = LOG_HALF_D + 0.16; g.add(end)
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 5), ropeMat); scene.add(rope)
    scene.add(g)
    // 振り子を吊る高い梁
    const beamH = 6.2
    for (const sgn of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, beamH + 1, 0.3), toon(0x6a4a2a)); p.position.set(sgn * (cols / 2 + 0.9), (beamH + 1) / 2 - 0.5, Z(L.row + 0.5)); scene.add(p) }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(cols + 2.1, 0.3, 0.3), toon(0x6a4a2a)); beam.position.set(0, beamH, Z(L.row + 0.5)); scene.add(beam)
    return { L, g, rope, beamH }
  })

  // ---- お守り
  const coinGeo = new THREE.BoxGeometry(0.28, 0.36, 0.08)
  const coinMat = toon(0xe8402e), coinTop = toon(0xffd23f)
  const coinObjs = W.coins.map(o => {
    const g = new THREE.Group()
    const b = new THREE.Mesh(coinGeo, coinMat); g.add(b)
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 6, 10), coinTop); t.position.y = 0.22; g.add(t)
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.09), coinTop); s.position.y = 0.04; g.add(s)
    scene.add(g); return g
  })

  // ---- 落石（影→落ちる→砕ける）
  const rockPool = []
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
  for (let k = 0; k < 10; k++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), lam(0x8a7a6a, { flatShading: true })); rock.castShadow = true
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 20), shadowMat.clone()); sh.rotation.x = -Math.PI / 2
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.05, 24), ringMat.clone()); ring.rotation.x = -Math.PI / 2
    sh.renderOrder = ring.renderOrder = 3
    scene.add(rock, sh, ring); rock.visible = sh.visible = ring.visible = false
    rockPool.push({ rock, sh, ring })
  }

  // ---- 突風（予告の黄色い箱と、吹いている間の風の筋）
  const gustTex = canvasTex(64, 64, g => { g.fillStyle = '#ffd84a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#2a170c'; for (let i = -64; i < 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i - 48, 64); g.lineTo(i - 64, 64); g.fill() } })
  gustTex.wrapS = gustTex.wrapT = THREE.RepeatWrapping; gustTex.repeat.set((cols + 1.4) / 1.2, span / 1.2)
  const gustBox = new THREE.Mesh(new THREE.PlaneGeometry(cols + 1.4, span), new THREE.MeshBasicMaterial({ map: gustTex, transparent: true, opacity: 0.3, depthWrite: false }))
  gustBox.rotation.x = -Math.PI / 2; gustBox.renderOrder = 3
  gustBox.visible = false; scene.add(gustBox)
  const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }), 24)
  streaks.visible = false; scene.add(streaks)

  // ---- 粒（しぶき・木くず・紙吹雪）
  const PN = 420
  const parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }), PN)
  parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parts.count = 0; parts.frustumCulled = false; scene.add(parts)
  const P = []
  const burst = (x, y, z, color, n, sp = 2.5, up = 3, life = 1) => {
    for (let k = 0; k < n && P.length < PN; k++) {
      const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random())
      P.push({ x, y, z, vx: Math.cos(a) * v, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * v, age: 0, life: life * (0.6 + Math.random() * 0.6), c: new THREE.Color(Array.isArray(color) ? color[k % color.length] : color), s: 0.6 + Math.random() * 0.8, r: Math.random() * 6 })
    }
  }
  // 割れた板のかけら
  const debris = []
  const debrisGeo = new THREE.BoxGeometry(0.45, 0.1, 0.8)

  // ---- 雪・火の粉（画質が中以上のときだけ）
  let flakes = null
  const kinds = new Set(sections.map(s => s.th))
  if (kinds.has('snow') || kinds.has('volcano')) {
    const n = 260, arr = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) { arr[k * 3] = (Math.random() - 0.5) * 30; arr[k * 3 + 1] = Math.random() * 14 - 4; arr[k * 3 + 2] = -Math.random() * 30 }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    flakes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false }))
    flakes.frustumCulled = false; scene.add(flakes)
  }

  // ---- 人
  const faces = { calm: 'calm', happy: 'happy', run: 'run', shock: 'shock', worry: 'worry', dizzy: 'dizzy' }
  for (const k in faces) faces[k] = new THREE.SpriteMaterial({ map: faceTex(k), depthTest: true })
  const n = W.roster.length
  const POOL = Math.min(n, coarse ? 14 : 22)
  const pool = Array.from({ length: POOL }, () => { const c = makeChibi(faces); c.g.visible = false; scene.add(c.g); return c })
  // 遠い人は簡単な形（胴と頭）をまとめて描く
  const miniBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.2, 3, 8), lam(0xffffff), n)
  const miniHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 10, 8), lam(0xffd9b3), n)
  miniBody.count = miniHead.count = 0; miniBody.frustumCulled = miniHead.frustumCulled = false
  scene.add(miniBody, miniHead)
  const meRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }))
  meRing.rotation.x = -Math.PI / 2; meRing.renderOrder = 3; scene.add(meRing)
  const pcol = PLAYER_COLORS.map(c => new THREE.Color(c))
  const anim = Array.from({ length: n }, () => ({ ph: Math.random() * 6, splashed: 0, squash: 0, spin: 0, side: 0 }))

  // ---- 橋の形（区間ごとにたわむ。重いほど沈み、重すぎ・突風で横に揺れる）
  const sag = new Float32Array(spans), sway = new Float32Array(spans), roll = new Float32Array(spans)
  const segOf = y => Math.max(0, Math.min(spans - 1, Math.floor(Math.max(0, y) / span)))
  function deckH(y) {
    if (y < 0 || y > rows) return 0
    const s = segOf(y), sec = sections[s]
    const a = s * span + (sec && sec.deck ? 2 : 0), b = Math.min(rows, s * span + span)
    if (y < a) return 0
    const f = Math.max(0, Math.min(1, (y - a) / Math.max(1, b - a)))
    return -(0.32 + sag[s]) * Math.sin(Math.PI * f)
  }
  const swayAt = y => (y < 0 || y > rows ? 0 : sway[segOf(y)] * Math.sin(Math.PI * Math.max(0, Math.min(1, (y - segOf(y) * span) / span))))

  // ---- 画質
  function setTier(t) {
    tier = Math.max(0, Math.min(2, t))
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [1, 1.5, 2][tier]))
    renderer.shadowMap.enabled = tier > 0
    sun.castShadow = tier > 0
    const ms = tier === 2 ? 1024 : 512
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null } }
    if (flakes) flakes.visible = tier > 0
  }
  setTier(tier)

  // ---- カメラ
  const cam = { far: false, x: 0, y: 3, z: 5, lx: 0, ly: 0, lz: -3, init: false, base: 0, shake: 0 }
  let sizeW = 1, sizeH = 1, aspect = 1
  const fpsLog = []
  let lastTierCheck = performance.now() + 3500
  const tmpV = new THREE.Vector3()
  const project = (x, y, z) => { tmpV.set(x, y, z).project(camera); return { x: (tmpV.x * 0.5 + 0.5) * sizeW, y: (-tmpV.y * 0.5 + 0.5) * sizeH, ok: tmpV.z < 1 && tmpV.z > -1 } }
  let lastGoalAt = W.goalAt
  let collapseT0 = 0
  let laidOut = false

  function placeCamera(mx, my, dt, now) {
    const portrait = aspect < 0.8
    // 狭い橋は真ん中、広い橋は自分を追う
    const follow = cols <= 4 ? 0.35 : 0.8
    const tx = X(cols / 2) * (1 - follow) + X(mx) * follow
    const yy = Math.max(-2.5, Math.min(rows + 2.5, my))
    const hb = deckH(yy)
    cam.base += (hb - cam.base) * Math.min(1, dt * 3)
    let back = cam.far ? 9 : 4.6, up = cam.far ? 10 : 3.1, ahead = cam.far ? 7 : 3.6
    if (portrait) { back *= 1.18; up *= 1.12 }
    if (cols > 6 && !cam.far) { up += (cols - 6) * 0.12; back += (cols - 6) * 0.1 }
    let px = tx, py = cam.base + up, pz = Z(yy) + back
    let lx = tx, ly = cam.base + 0.2, lz = Z(yy) - ahead
    // 秒読み中は、橋の全体を見下ろす位置から自分の後ろへ下りてくる
    if (W.ph === 0) {
      const k = Math.max(0, Math.min(1, 1 - (W.tm / 10 - 0.6) / 2.4))
      const e = k * k * (3 - 2 * k)
      const ox = 0, oy = 16, oz = 12, olx = 0, oly = -2, olz = Z(Math.min(rows, 22))
      px = ox + (px - ox) * e; py = oy + (py - oy) * e; pz = oz + (pz - oz) * e
      lx = olx + (lx - olx) * e; ly = oly + (ly - oly) * e; lz = olz + (lz - olz) * e
    }
    // 自分が落ちている間は谷底をのぞきこむ（落ちていく自分が見える）
    if (W.me >= 0 && W.st[W.me] === ST.fall && W.ph !== 2) {
      const e = Math.min(1, (now - W.stAt[W.me]) / 1100)
      const fx = X(W.px[W.me])
      px += (fx - px) * e; pz += (Math.min(Z(yy) + 2.6, -3.2) - pz) * e; py += (cam.base + 5.5 - py) * e
      lx += (fx - lx) * e; ly += (DEPTH * 0.55 - ly) * e; lz += (Z(yy) - 0.8 - lz) * e
    }
    if (W.ph === 2) { py += 3; ly -= 4 }
    const k = !cam.init ? 1 : Math.min(1, dt * (W.ph === 0 ? 8 : 4.5))
    if (Math.hypot(px - cam.x, pz - cam.z) > 14) cam.init = false
    cam.x += (px - cam.x) * k; cam.y += (py - cam.y) * k; cam.z += (pz - cam.z) * k
    cam.lx += (lx - cam.lx) * k; cam.ly += (ly - cam.ly) * k; cam.lz += (lz - cam.lz) * k
    cam.init = true
    cam.shake = Math.max(0, cam.shake - dt * 1.8)
    const sh = cam.shake * cam.shake * 0.35
    camera.fov = portrait ? 62 : 52
    camera.updateProjectionMatrix()
    camera.position.set(cam.x + (Math.random() - 0.5) * sh, cam.y + (Math.random() - 0.5) * sh, cam.z)
    camera.lookAt(cam.lx, cam.ly, cam.lz)
    camera.updateMatrixWorld()
    sun.position.set(cam.lx + 6, 14, cam.lz + 6); sun.target.position.set(cam.lx, 0, cam.lz - 1)
    sky.position.copy(camera.position)
    sunDisc.position.set(camera.position.x - 60, 70, camera.position.z - 200); sunDisc.lookAt(camera.position)
    if (flakes) flakes.position.set(cam.lx, 0, cam.lz + 6)
  }

  // ---- 1人ぶんの姿勢
  function poseChibi(c, i, x, y, now, dt, face, meP, load) {
    const st = W.st[i]
    const A = anim[i]
    const color = pcol[i % pcol.length]
    if (c.slot !== i) {
      c.slot = i; c.cloth.color.copy(color)
      c.hats.forEach((h, k) => (h.visible = k === i % 3))
      A.splashed = 0
    }
    c.g.visible = true
    const t = now / 1000
    let px = X(x) + swayAt(y), py = deckH(y), pz = Z(y)
    if (y < 0 || y > rows) py = 0
    let rotY = Math.PI - face, rotX = 0, rotZ = 0, sq = 1
    const age = (now - W.stAt[i]) / 1000
    let expr = 'calm'
    c.stars.visible = false
    c.body.position.y = 0
    for (const a of c.arms) a.rotation.x = 0
    c.arms[0].rotation.z = -0.25; c.arms[1].rotation.z = 0.25
    if (st === ST.fall) {
      // 落ちる: 手足をばたつかせて谷へ。底でしぶき
      expr = 'shock'
      const side = W.why[i] === 2 ? (x < cols / 2 ? -1 : 1) : 0
      px += side * age * 2.2
      py = py - 4.9 * age * age + Math.min(age, 0.25) * 4
      rotX = age * 5; rotZ = side * age * 3
      c.arms[0].rotation.z = -2.6 + Math.sin(t * 30) * 0.5; c.arms[1].rotation.z = 2.6 - Math.sin(t * 30) * 0.5
      if (py < DEPTH + 0.3) {
        c.g.visible = false
        if (A.splashed !== W.stAt[i]) {
          A.splashed = W.stAt[i]
          const kind = themeAt(y).belowKind
          burst(px, DEPTH + 0.2, pz, kind === 'lava' ? [0xffd23f, 0xff6a1a, 0x5a1a0a] : kind === 'ice' ? [0xffffff, 0xbfe6ff] : [0xffffff, 0x9fe3ff, 0x3fb6ff], 36, 2.2, 6, 1.4)
        }
        return
      }
    } else if (st === ST.hit) {
      expr = 'dizzy'
      if (A.squash > 0) { sq = 0.45 + Math.min(0.55, age * 0.6) }
      else { rotY += age * 14; rotZ = Math.sin(age * 20) * 0.3 }
      c.stars.visible = true
      for (let k = 0; k < 3; k++) { const a = t * 6 + k * 2.1; c.stars.children[k].position.set(Math.cos(a) * 0.32, 1.2, Math.sin(a) * 0.32) }
    } else if (st === ST.done) {
      // ゴール: 跳ねて両手を上げる
      expr = 'happy'
      c.body.position.y = Math.abs(Math.sin(t * 7 + i)) * 0.3
      c.arms[0].rotation.z = -2.7; c.arms[1].rotation.z = 2.7
      rotY = Math.sin(t * 2 + i) * 0.6
    } else {
      const moving = st === ST.walk || st === ST.run
      const run = st === ST.run
      A.ph += dt * (run ? 16 : moving ? 10 : 0)
      const sw = moving ? Math.sin(A.ph) * (run ? 0.9 : 0.6) : 0
      c.legs[0].rotation.x = sw; c.legs[1].rotation.x = -sw
      c.arms[0].rotation.x = -sw * 0.9; c.arms[1].rotation.x = sw * 0.9
      c.body.position.y = moving ? Math.abs(Math.cos(A.ph)) * (run ? 0.08 : 0.04) : Math.sin(t * 2 + i) * 0.01
      rotX = run ? 0.28 : 0
      if (run) expr = 'run'
      // 足元が危ないと不安な顔
      if (y >= 0 && y < rows) {
        const k = Math.floor(y) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x)))
        const wk = W.k[k] > 0 && W.k[k] <= 3 && !(W.f[k] & FLAG.deck)
        if (wk || load[k] / W.cap > 1 || (W.w && W.w[0] === segOf(y))) expr = 'worry'
        if (W.ph === 2) expr = 'shock'
      }
      // 橋が落ちた瞬間はみんな一緒に落ちる
      if (W.ph === 2 && y >= 0 && y < rows) { const e = Math.max(0, (now - collapseT0) / 1000 - Math.abs(y - W.cr) * 0.05); py -= 4.9 * e * e }
    }
    if (W.ph === 0 && st !== ST.fall) expr = i % 2 ? 'run' : 'calm'
    c.legs[0].visible = c.legs[1].visible = true
    if (st !== ST.walk && st !== ST.run) { c.legs[0].rotation.x = st === ST.fall ? Math.sin(t * 25) * 0.8 : 0; c.legs[1].rotation.x = -c.legs[0].rotation.x }
    c.g.position.set(px, py, pz)
    // カメラのすぐ前にいる他人は画面をふさぐので消す
    if (i !== W.me && camera.position.z - pz < 3.0) { c.g.visible = false; return [px, py, pz, true] }
    c.body.rotation.set(rotX, rotY, rotZ, 'YXZ')
    c.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq))
    if (c.face.material !== faces[expr]) c.face.material = faces[expr]
    // 顔はいつもカメラ側（後ろ姿でも表情が見えるように）
    // 頭はカメラのほうへ振り向く（後ろ姿でも表情が見えるように）
    tmpV.set(camera.position.x - px, 0, camera.position.z - pz).normalize()
    const ang = Math.atan2(tmpV.x, tmpV.z)
    c.headG.rotation.y = st === ST.fall ? 0 : ang - rotY
    const hy = (0.76 + c.body.position.y) * sq
    c.face.position.set(tmpV.x * 0.31, hy, tmpV.z * 0.31)
    c.face.visible = st !== ST.fall || age < 2
    c.headG.visible = true
    return [px, py, pz]
  }

  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), dirV = new THREE.Vector3()
  function segMatrix(ax, ay, az, bx, by, bz) {
    dirV.set(bx - ax, by - ay, bz - az)
    const len = dirV.length() || 1e-3
    tmpQ.setFromUnitVectors(UP, dirV.multiplyScalar(1 / len))
    return mtx.compose(tmpP.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), tmpQ, tmpS.set(1, len, 1))
  }

  const api = {
    is3d: true,
    get tier() { return tier },
    toggleZoom() { cam.far = !cam.far; return cam.far },
    setSize(w, h) {
      if (w === sizeW && h === sizeH) return
      sizeW = w; sizeH = h; aspect = w / Math.max(1, h)
      renderer.setSize(w, h, false)
      camera.aspect = aspect; camera.updateProjectionMatrix()
    },
    frame({ now, dt, meP, pos: posOf, load, spanLoad, T }) {
      fpsLog.push(dt || 0.016); if (fpsLog.length > 90) fpsLog.shift()
      if (now > lastTierCheck && fpsLog.length >= 60) {
        lastTierCheck = now + 2500
        const fps = fpsLog.length / fpsLog.reduce((a, b) => a + b, 0)
        if (fps < 42 && tier > 0) setTier(tier - 1)
      }
      const t = now / 1000
      if (W.ph === 2 && !collapseT0) { collapseT0 = W.collapseAt || now; cam.shake = 1.4 }
      const myX = meP ? meP[0] : cols / 2, myY = meP ? meP[1] : 0
      // テーマ（ロングでは場所で変わる）
      const th = themeAt(myY)
      if (th !== skyTheme) {
        skyTheme = th; paintSky(th)
        scene.background.set(th.horizon); fogC.set(th.fog); scene.fog.color.copy(fogC)
        const dark = th === THEMES.volcano
        hemi.intensity = dark ? 1.15 : 1.6; sun.intensity = dark ? 1.4 : 2.1
        sun.color.set(dark ? 0xffb08a : 0xfff0dc)
        sunDisc.material.color.set(dark ? 0xff6a4a : th === THEMES.canyon ? 0xffd08a : 0xfff1b8)
        if (flakes) { flakes.material.color.set(dark ? 0xffa040 : 0xffffff); flakes.material.size = dark ? 0.09 : 0.13 }
      }
      // 谷底の流れ
      for (const k in belowMats) { const m = belowMats[k]; m.map.offset.y = (t * (k === 'lava' ? 0.02 : 0.05)) % 1; m.map.offset.x = Math.sin(t * 0.3) * 0.02 }
      // 橋のたわみと揺れ
      const gust = W.w
      for (let s = 0; s < spans; s++) {
        const r = spanLoad[s] / W.spanCap
        const want = Math.min(0.5, r * 0.22)
        sag[s] += (want - sag[s]) * Math.min(1, dt * 4)
        let amp = r > 0.75 ? Math.min(1, (r - 0.75) * 2) : 0
        if (gust && gust[1] === 2 && gust[0] === s) amp = Math.max(amp, 0.8)
        sway[s] = amp * Math.sin(t * 7 + s * 1.3) * 0.16
        roll[s] = amp * Math.sin(t * 7 + s * 1.3 + 0.6) * 0.06
      }
      placeCamera(myX, myY, dt, now)
      // 板
      const full = !laidOut; laidOut = true
      const lo = full ? 0 : Math.max(0, Math.floor(myY) - 8), hi = full ? rows - 1 : Math.min(rows - 1, Math.ceil(myY) + (cam.far ? 44 : 30))
      const ce = collapseT0 ? (now - collapseT0) / 1000 : 0
      let na = 0, nb = 0
      const pulse = 0.5 + 0.5 * Math.sin(t * 12)
      for (let r = lo; r <= hi; r++) {
        const s = segOf(r + 0.5), sw = swayAt(r + 0.5)
        let hh = deckH(r + 0.5)
        if (ce > 0) { const e = Math.max(0, ce - Math.abs(r - W.cr) * 0.05); hh -= 4.9 * e * e }
        for (let c = 0; c < cols; c++) {
          const k = r * cols + c
          const l = W.k[k], f = W.f[k]
          if (f & FLAG.deck) { mtx.makeScale(0, 0, 0); planks.setMatrixAt(k, mtx); continue }
          if (l === 0) { mtx.makeScale(0, 0, 0); planks.setMatrixAt(k, mtx); continue }
          const xx = X(c + 0.5) + sw
          const wob = load[k] / W.cap > 1 ? Math.sin(t * 40 + k) * 0.025 : 0
          tmpQ.setFromEuler(new THREE.Euler(0, jitter[k], roll[s]))
          mtx.compose(tmpP.set(xx, hh - 0.06 + wob, Z(r + 0.5)), tmpQ, tmpS.set(1, 1, 1))
          planks.setMatrixAt(k, mtx)
          // 色: 木（傷むほど暗い）/ 氷 / 焼けた / 重すぎは赤く点滅
          if (f & FLAG.ice) col.setRGB(0.72, 0.9, 1.0)
          else if (f & FLAG.heat) col.setRGB(1, 0.42 + 0.12 * Math.sin(t * 5 + k), 0.2)
          else col.setRGB(0.86, 0.62, 0.38)
          if (!(f & FLAG.ice)) col.offsetHSL(0, 0, tint[k] - (l >= 7 ? 0 : l >= 4 ? 0.1 : 0.2))
          const ratio = load[k] / W.cap
          if (ratio > 1) col.lerp(new THREE.Color(1, 0.15, 0.1), 0.5 + 0.4 * pulse)
          else if (ratio >= 0.7) col.lerp(new THREE.Color(1, 0.75, 0.2), 0.4)
          planks.setColorAt(k, col)
          if (l <= 6) {
            mtx.compose(tmpP.set(xx, hh + 0.005 + wob, Z(r + 0.5)), tmpQ, tmpS.set(1, 1, 1))
            if (l <= 3) crackB.setMatrixAt(nb++, mtx); else crackA.setMatrixAt(na++, mtx)
          }
        }
      }
      crackA.count = na; crackB.count = nb
      planks.instanceMatrix.needsUpdate = true; if (planks.instanceColor) planks.instanceColor.needsUpdate = true
      crackA.instanceMatrix.needsUpdate = true; crackB.instanceMatrix.needsUpdate = true
      // 手すりと吊り綱
      let ri = 0
      const rlo = Math.max(0, lo - 2), rhi = Math.min(rows, hi + 2)
      for (let r = rlo; r < rhi; r++) {
        let h0 = deckH(r), h1 = deckH(r + 1)
        if (ce > 0) { const e0 = Math.max(0, ce - Math.abs(r - W.cr) * 0.05), e1 = Math.max(0, ce - Math.abs(r + 1 - W.cr) * 0.05); h0 -= 4.9 * e0 * e0; h1 -= 4.9 * e1 * e1 }
        for (const sgn of [-1, 1]) {
          const x0 = sgn * (cols / 2 + 0.12) + swayAt(r), x1 = sgn * (cols / 2 + 0.12) + swayAt(r + 1)
          rails.setMatrixAt(ri++, segMatrix(x0, h0 + 1.0, Z(r), x1, h1 + 1.0, Z(r + 1)))
          rails.setMatrixAt(ri++, segMatrix(x0, h0 - 0.02, Z(r), x0, h0 + 1.0, Z(r)))
        }
      }
      rails.count = ri; rails.instanceMatrix.needsUpdate = true
      // 丸太
      for (const lp of logParts) {
        const lx = X(logX(lp.L, T, cols)), lz = Z(lp.L.row + 0.5), ly = deckH(lp.L.row + 0.5) + 0.6
        lp.g.position.set(lx, ly, lz)
        lp.g.rotation.z = (lx / (cols / 2 + 1)) * -0.5
        lp.g.children[0].rotation.y = t * 2
        const m = segMatrix(0, lp.beamH, lz, lx, ly + LOG_HALF_W, lz)
        m.decompose(lp.rope.position, lp.rope.quaternion, lp.rope.scale)
      }
      // お守り
      W.coins.forEach((o, j) => {
        const g = coinObjs[j]; if (!g) return
        g.visible = o.owner < 0 && o.y < myY + 34
        if (!g.visible) return
        g.position.set(X(o.x) + swayAt(o.y), deckH(o.y) + 0.5 + Math.sin(t * 3 + j) * 0.08, Z(o.y))
        g.rotation.y = t * 2 + j
      })
      // 落石
      for (let k = 0; k < rockPool.length; k++) {
        const R = W.rocks[k], p = rockPool[k]
        if (!R) { p.rock.visible = p.sh.visible = p.ring.visible = false; continue }
        const hh = deckH(R.y), rx = X(R.x) + swayAt(R.y), rz = Z(R.y)
        if (R.ph === 1) {
          const left = Math.max(0, R.left - (now - W.frameAt) / 1000)
          const k2 = 1 - left / 1.3
          p.sh.visible = p.ring.visible = true
          p.sh.position.set(rx, hh + 0.03, rz); p.sh.scale.setScalar(0.85 * (0.4 + k2 * 0.6)); p.sh.material.opacity = 0.2 + k2 * 0.45
          p.ring.position.set(rx, hh + 0.04, rz); p.ring.scale.setScalar(0.85 + 0.06 * Math.sin(t * 16)); p.ring.material.opacity = 0.5 + 0.5 * pulse
          p.rock.visible = left < 0.8
          p.rock.position.set(rx, hh + 0.6 + left * 14, rz); p.rock.rotation.set(t * 4, t * 3, 0)
        } else {
          p.sh.visible = p.ring.visible = false
          p.rock.visible = true
          const e = 0.6 - R.left
          p.rock.position.set(rx, hh + 0.5 - Math.max(0, e - 0.3) * 6, rz)
        }
      }
      // 突風
      if (gust) {
        const s = gust[0], zc = Z(s * span + span / 2)
        gustBox.visible = gust[1] === 1
        gustBox.position.set(0, deckH(s * span + span / 2) + 0.08, zc)
        gustBox.material.opacity = 0.18 + 0.2 * pulse
        streaks.visible = gust[1] === 2
        if (streaks.visible) {
          for (let k = 0; k < 24; k++) {
            const xx = ((t * 14 + k * 3.7) % (cols + 14)) - (cols / 2 + 7)
            mtx.compose(tmpP.set(xx, 0.3 + ((k * 37) % 17) / 9, zc - span / 2 + ((k * 53) % 70) / 10), q.identity(), tmpS.set(1, 1, 1))
            streaks.setMatrixAt(k, mtx)
          }
          streaks.instanceMatrix.needsUpdate = true
        }
      } else { gustBox.visible = false; streaks.visible = false }
      // できごと（板が割れた・お守りを拾った・石が落ちた・当たった）
      for (const ev of W.events) {
        if (ev.k === 'plank') {
          const r = Math.floor(ev.i / cols), c = ev.i % cols
          const xx = X(c + 0.5) + swayAt(r + 0.5), yy = deckH(r + 0.5), zz = Z(r + 0.5)
          for (const sgn of [-1, 1]) {
            const m = new THREE.Mesh(debrisGeo, plankMat); m.position.set(xx + sgn * 0.22, yy, zz); scene.add(m)
            debris.push({ m, vx: sgn * 0.8, vy: 1, vz: (Math.random() - 0.5), rx: Math.random() * 6 - 3, rz: sgn * 4 })
          }
          burst(xx, yy, zz, [0xc08a52, 0x7a4a24], 14, 1.6, 2.5, 0.8)
          if (Math.abs(r - myY) < 4) cam.shake = Math.max(cam.shake, 0.5)
        } else if (ev.k === 'coin') {
          const o = W.coins[ev.j]; if (o) burst(X(o.x), deckH(o.y) + 0.5, Z(o.y), [0xffd23f, 0xffffff, 0xe8402e], 22, 2, 3, 0.8)
        } else if (ev.k === 'rock') {
          burst(X(ev.x), deckH(ev.y) + 0.3, Z(ev.y), [0x8a7a6a, 0xc9b8a0, 0x5a4a3a], 26, 3, 3, 0.9)
          if (Math.abs(ev.y - myY) < 5) cam.shake = Math.max(cam.shake, 0.9)
        } else if (ev.k === 'hit') {
          const nearRock = W.rocks.some(r => Math.hypot(r.x - ev.x, r.y - ev.y) < 1.4)
          anim[ev.i].squash = nearRock ? 1 : 0
          burst(X(ev.x), deckH(ev.y) + 0.8, Z(ev.y), [0xffd23f, 0xffffff], 12, 2.4, 2, 0.6)
          if (ev.i === W.me) cam.shake = Math.max(cam.shake, 0.8)
        } else if (ev.k === 'fall' && ev.i === W.me) cam.shake = Math.max(cam.shake, 0.6)
      }
      if (W.goalAt && W.goalAt !== lastGoalAt) { lastGoalAt = W.goalAt; burst(X(myX), 1.2, Z(myY), PLAYER_COLORS.map(c => parseInt(c.slice(1), 16)), 120, 3, 7, 2.4) }
      // 人: 近い順にちびキャラ、残りは簡単な形
      const order = []
      for (let i = 0; i < n; i++) if (W.st[i] !== ST.gone) order.push(i)
      order.sort((A, B) => (A === W.me ? -1 : B === W.me ? 1 : Math.abs(posOf(A)[1] - myY) - Math.abs(posOf(B)[1] - myY)))
      const heads = []
      let mb = 0
      const used = new Set()
      for (let j = 0; j < order.length; j++) {
        const i = order[j]
        const p = posOf(i)
        let wp
        if (j < POOL) {
          // 同じ人には同じちびを使い回す（帽子の付け替えを減らす）
          let c = pool.find(o => o.slot === i && !used.has(o))
          if (!c) c = pool.find(o => !used.has(o) && !order.slice(0, POOL).includes(o.slot)) || pool.find(o => !used.has(o))
          used.add(c)
          wp = poseChibi(c, i, p[0], p[1], now, dt, W.face[i], meP, load)
          if (!wp) continue
        } else {
          const st = W.st[i]
          if (st === ST.fall) continue
          const xx = X(p[0]) + swayAt(p[1]), yy = p[1] < 0 || p[1] > rows ? 0 : deckH(p[1]), zz = Z(p[1])
          if (camera.position.z - zz < 3.0) { const hp = project(xx, yy + 1.32, zz); heads.push({ i, x: hp.x, y: hp.y, vis: hp.ok && hp.x > -40 && hp.x < sizeW + 40 && hp.y > -20 && hp.y < sizeH + 20 && W.st[i] !== ST.fall, d: Math.abs(p[1] - myY) + Math.abs(p[0] - myX) * 0.3 }); continue }
          const hop = st === ST.done ? Math.abs(Math.sin(t * 7 + i)) * 0.3 : 0
          mtx.compose(tmpP.set(xx, yy + 0.38 + hop, zz), q.identity(), tmpS.set(1, 1, 1)); miniBody.setMatrixAt(mb, mtx); miniBody.setColorAt(mb, pcol[i % pcol.length])
          mtx.compose(tmpP.set(xx, yy + 0.84 + hop, zz), q.identity(), tmpS.set(1, 1, 1)); miniHead.setMatrixAt(mb, mtx)
          mb++
          wp = [xx, yy, zz]
        }
        const hp = project(wp[0], wp[1] + 1.32, wp[2])
        heads.push({ i, x: hp.x, y: hp.y, vis: hp.ok && hp.x > -40 && hp.x < sizeW + 40 && hp.y > -20 && hp.y < sizeH + 20 && W.st[i] !== ST.fall, d: Math.abs(p[1] - myY) + Math.abs(p[0] - myX) * 0.3 })
      }
      for (const c of pool) if (!used.has(c)) c.g.visible = false
      miniBody.count = mb; miniHead.count = mb
      if (mb) { miniBody.instanceMatrix.needsUpdate = true; miniHead.instanceMatrix.needsUpdate = true; if (miniBody.instanceColor) miniBody.instanceColor.needsUpdate = true }
      // 自分の足元の輪
      if (meP && W.me >= 0 && W.st[W.me] !== ST.fall && W.st[W.me] !== ST.gone) {
        meRing.visible = true
        const yy = meP[1] < 0 || meP[1] > rows ? 0 : deckH(meP[1])
        meRing.position.set(X(meP[0]) + swayAt(meP[1]), yy + 0.02, Z(meP[1]))
        meRing.scale.setScalar(1 + 0.08 * Math.sin(t * 5))
      } else meRing.visible = false
      // 粒
      let pc = 0
      for (let k = P.length - 1; k >= 0; k--) {
        const p = P[k]
        p.age += dt
        if (p.age > p.life) { P.splice(k, 1); continue }
        p.vy -= 9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.r += dt * 8
      }
      for (const p of P) {
        const s = p.s * Math.max(0.2, 1 - p.age / p.life)
        tmpQ.setFromEuler(new THREE.Euler(p.r, p.r * 0.7, 0))
        mtx.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(s, s, s))
        parts.setMatrixAt(pc, mtx); parts.setColorAt(pc, p.c); pc++
      }
      parts.count = pc
      if (pc) { parts.instanceMatrix.needsUpdate = true; if (parts.instanceColor) parts.instanceColor.needsUpdate = true }
      // かけら
      for (let k = debris.length - 1; k >= 0; k--) {
        const d = debris[k]
        d.vy -= 9.8 * dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt
        d.m.rotation.x += d.rx * dt; d.m.rotation.z += d.rz * dt
        if (d.m.position.y < DEPTH) { scene.remove(d.m); debris.splice(k, 1) }
      }
      // 雪・火の粉
      if (flakes && flakes.visible) {
        const a = flakes.geometry.attributes.position, vol = th === THEMES.volcano, show = th === THEMES.snow || vol
        flakes.material.opacity = show ? 0.85 : 0
        for (let k = 0; k < a.count; k++) {
          let yv = a.getY(k) + (vol ? 1.2 : -1.0) * dt
          if (yv < -4) yv = 10; if (yv > 10) yv = -4
          a.setY(k, yv); a.setX(k, a.getX(k) + Math.sin(t + k) * dt * 0.3)
        }
        a.needsUpdate = true
      }
      renderer.render(scene, camera)
      // 区間の札（ゆれ・重すぎ）
      const tags = []
      for (let s = 0; s < spans; s++) {
        if (spanLoad[s] <= W.spanCap * 0.85) continue
        if (Math.abs(s * span + span / 2 - myY) > 16) continue
        const yc = Math.min(rows, s * span + span / 2)
        const p = project(cols / 2 + 0.3, deckH(yc) + 1.3, Z(yc))
        if (p.ok) tags.push({ x: p.x, y: p.y, text: spanLoad[s] > W.spanCap ? '重すぎ' : 'ゆれ', over: spanLoad[s] > W.spanCap })
      }
      return { heads, tags }
    },
    // 描けているかの確認用: いまの画面の輝度の分散
    variance() {
      renderer.render(scene, camera)
      const gl = renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const px = new Uint8Array(4)
      let s1 = 0, s2 = 0, nn = 0
      for (let yy = 4; yy < h; yy += Math.max(1, h / 24 | 0)) for (let xx = 4; xx < w; xx += Math.max(1, w / 24 | 0)) {
        gl.readPixels(xx, yy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
        const l = px[0] * 0.3 + px[1] * 0.59 + px[2] * 0.11; s1 += l; s2 += l * l; nn++
      }
      return s2 / nn - (s1 / nn) ** 2
    },
    fps() { return fpsLog.length ? fpsLog.length / fpsLog.reduce((a, b) => a + b, 0) : 0 },
    dispose() {
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { if (x.map) x.map.dispose(); x.dispose() }) })
      for (const k in faces) { faces[k].map.dispose(); faces[k].dispose() }
      renderer.dispose()
    }
  }
  return api
}
