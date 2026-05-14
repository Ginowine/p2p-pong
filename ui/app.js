import { createState, step, maybeResume, serialize, applySnapshot, setPaddleDir } from './physics.js'
import { Renderer } from './renderer.js'
import pipe from 'pear-pipe'

const backendPipe = pipe()
let recvBuf = ''

backendPipe.on('data', (data) => {
  recvBuf += Buffer.from(data).toString('utf8')
  const lines = recvBuf.split('\n')
  recvBuf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    try { onBackendMessage(JSON.parse(line)) } catch {}
  }
})

function toBackend (msg) { backendPipe.write(JSON.stringify(msg) + '\n') }
function toPeer    (msg) { toBackend({ type: 'send', data: JSON.stringify(msg) }) }

const canvas = document.getElementById('canvas')
const R      = new Renderer(canvas)

let state    = null
let myRole   = null
let myName   = 'Player'
let oppName  = 'Opponent'
let loopId   = null
let cdTimer  = null
let pingId   = null
let latency  = null
let pingSeq  = 0
const pings  = new Map()
let lbEntries = []

const $    = id => document.getElementById(id)
const show = id => $(id).classList.remove('hidden')
const hide = id => $(id).classList.add('hidden')

toBackend({ type: 'lb-init' })
bindLobby()
bindKeys()

function onBackendMessage (msg) {
  switch (msg.type) {
    case 'hosted':          onHosted(msg.code); break
    case 'peer-connect':    onPeerConnect(); break
    case 'peer-disconnect': onDisconnect(); break
    case 'peer-message':    onPeerMessage(JSON.parse(msg.data)); break
    case 'lb-ready':        onLbReady(msg.entries); break
    case 'lb-updated':      onLbUpdated(msg.entries); break
  }
}

function bindLobby () {
  $('btn-host').addEventListener('click', () => {
    myName = $('name-host').value.trim() || 'Player 1'
    myRole = 'left'
    $('btn-host').disabled = true
    $('btn-host').textContent = 'Creating…'
    toBackend({ type: 'host' })
  })

  $('btn-join').addEventListener('click', () => {
    const code = $('join-code').value.trim()
    myName = $('name-join').value.trim() || 'Player 2'
    myRole = 'right'
    if (code.length !== 64) { setMsg('join-msg', 'Need a 64-character room code.', 'err'); return }
    setMsg('join-msg', 'Connecting…', 'ok')
    $('btn-join').disabled = true
    toBackend({ type: 'join', code })
  })

  $('btn-copy').addEventListener('click', () => {
    navigator.clipboard?.writeText($('host-code').textContent)
    $('btn-copy').textContent = '✓'
    setTimeout(() => { $('btn-copy').textContent = '⧉' }, 1500)
  })

  $('btn-rematch').addEventListener('click', onRematch)
  $('btn-lobby').addEventListener('click', onBackLobby)
}

function onHosted (code) {
  $('host-code').textContent = code
  show('host-code-wrap')
  $('btn-host').textContent = 'Waiting…'
}

function onPeerConnect () {
  toPeer({ type: 'hello', name: myName })
  startPinging()
}

function onPeerMessage (msg) {
  if (msg._type === 'ping') { toPeer({ _type: 'pong', seq: msg.seq }); return }
  if (msg._type === 'pong') {
    const t = pings.get(msg.seq)
    if (t !== undefined) { latency = Date.now() - t; pings.delete(msg.seq) }
    return
  }

  switch (msg.type) {
    case 'hello':
      oppName = msg.name || 'Opponent'
      if (myRole === 'left') {
        launchGame()
      } else {
        setMsg('join-msg', `Connected to ${oppName}!`, 'ok')
        switchScreen('game'); setupHud(); startRenderLoop()
      }
      break
    case 'countdown': setHudStatus(msg.n > 0 ? `${msg.n}…` : 'GO!'); break
    case 'start':     setHudStatus('GO!'); break
    case 'state':
      if (!state) state = createState()
      applySnapshot(state, msg.s)
      updateScoreHud()
      if (state.phase === 'gameover' && !state._guestEndHandled) {
        state._guestEndHandled = true; onGameOver()
      }
      break
    case 'paddle':
      if (myRole === 'left' && state) setPaddleDir(state, 'right', msg.dy)
      break
    case 'rematch':
      if (myRole === 'right') startRematch()
      break
  }
}

function launchGame () {
  state = createState(); switchScreen('game'); setupHud(); startRenderLoop(); runCountdown(3)
}

function runCountdown (n) {
  setHudStatus(n > 0 ? `${n}…` : 'GO!')
  if (myRole === 'left') toPeer({ type: 'countdown', n })
  if (n > 0) {
    cdTimer = setTimeout(() => runCountdown(n - 1), 1000)
  } else if (myRole === 'left') {
    state.phase = 'playing'; state.countdown = 0; state._hostRunning = true
    toPeer({ type: 'start' })
  }
}

function startRenderLoop () {
  cancelAnimationFrame(loopId); loopId = null
  const tick = () => {
    loopId = requestAnimationFrame(tick)
    if (!state) { R.drawWaiting(); return }
    if (myRole === 'left' && state._hostRunning) {
      maybeResume(state)
      const events = step(state)
      if (events.includes('point-left') || events.includes('point-right')) updateScoreHud()
      toPeer({ type: 'state', s: serialize(state) })
      if (state.phase === 'gameover') { state._hostRunning = false; onGameOver() }
    }
    R.draw(state)
    if (latency !== null) $('hud-ping-text').textContent = `${latency}ms`
  }
  tick()
}

const KEYS = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 }
const held = { up: false, down: false }
let lastDy = null

function bindKeys () {
  document.addEventListener('keydown', e => {
    if (KEYS[e.code] === undefined) return
    e.preventDefault()
    if (KEYS[e.code] === -1) held.up   = true
    if (KEYS[e.code] ===  1) held.down = true
    flushInput()
  })
  document.addEventListener('keyup', e => {
    if (KEYS[e.code] === undefined) return
    if (KEYS[e.code] === -1) held.up   = false
    if (KEYS[e.code] ===  1) held.down = false
    flushInput()
  })
}

function flushInput () {
  if (!state || state.phase === 'gameover') return
  const dy = (held.up && !held.down) ? -1 : (held.down && !held.up) ? 1 : 0
  if (dy === lastDy) return
  lastDy = dy
  if (myRole === 'left') {
    setPaddleDir(state, 'left', dy)
  } else {
    setPaddleDir(state, 'right', dy)
    toPeer({ type: 'paddle', dy })
  }
}

function onGameOver () {
  cancelAnimationFrame(loopId); loopId = null
  if (state) R.draw(state)
  const myPaddle  = myRole
  const oppPaddle = myRole === 'left' ? 'right' : 'left'
  const won       = state.winner === myPaddle
  const entry = {
    playerName: myName, opponent: oppName, won,
    myScore: state[myPaddle].score, opponentScore: state[oppPaddle].score, ts: Date.now(),
  }
  lbEntries.push(entry)
  refreshLb()
  toBackend({ type: 'lb-record', entry })
  const title = won ? 'You win!' : `${oppName} wins`
  showOverlay(won ? '🏆' : '😬', title, `${state.left.score} – ${state.right.score}`, myRole === 'left')
  setHudStatus(title)
}

function onRematch () {
  if (myRole !== 'left') return
  toPeer({ type: 'rematch' })
  startRematch()
}

function startRematch () {
  hideOverlay()
  cancelAnimationFrame(loopId); loopId = null
  state = createState(); lastDy = null
  startRenderLoop(); runCountdown(3)
}

function onDisconnect () {
  cancelAnimationFrame(loopId); clearTimeout(cdTimer); clearInterval(pingId); loopId = null
  showOverlay('🔌', 'Disconnected', 'Your opponent left.', false)
  $('hud-ping').classList.remove('live')
}

function onBackLobby () {
  cancelAnimationFrame(loopId); clearTimeout(cdTimer); clearInterval(pingId)
  loopId = null; state = null; lastDy = null; latency = null
  toBackend({ type: 'destroy' })
  $('btn-host').disabled = false; $('btn-host').textContent = 'Create room'
  $('btn-join').disabled = false
  hide('host-code-wrap'); hide('join-msg')
  $('join-code').value = ''; $('name-host').value = ''; $('name-join').value = ''
  hideOverlay(); refreshLb(); switchScreen('lobby')
}

function startPinging () {
  clearInterval(pingId)
  $('hud-ping').classList.add('live')
  pingId = setInterval(() => {
    const seq = ++pingSeq; pings.set(seq, Date.now())
    toPeer({ _type: 'ping', seq })
  }, 1000)
}

function setupHud () {
  $('hud-left-name').textContent  = myRole === 'left'  ? myName : oppName
  $('hud-right-name').textContent = myRole === 'right' ? myName : oppName
  $('hud-left-score').textContent  = '0'
  $('hud-right-score').textContent = '0'
  $('hud-ping-text').textContent   = 'P2P'
  setHudStatus('Get ready…')
}

function updateScoreHud () {
  if (!state) return
  $('hud-left-score').textContent  = state.left.score
  $('hud-right-score').textContent = state.right.score
}

function setHudStatus (t) { $('hud-status').textContent = t }

function showOverlay (icon, title, msg, showRematch) {
  $('ov-icon').textContent = icon; $('ov-title').textContent = title; $('ov-msg').textContent = msg
  showRematch ? show('btn-rematch') : hide('btn-rematch')
  show('overlay')
}
function hideOverlay () { hide('overlay') }

function onLbReady   (entries) { lbEntries = entries || []; refreshLb() }
function onLbUpdated (entries) { lbEntries = entries || []; refreshLb() }

function refreshLb () {
  const top = [...lbEntries]
    .filter(e => e && typeof e.playerName === 'string')
    .sort((a, b) => (b.won - a.won) || (b.myScore - a.myScore) || (b.ts - a.ts))
    .slice(0, 8)
  const el = $('lb-list')
  if (!top.length) { el.innerHTML = '<span class="lb-empty">No matches yet.</span>'; return }
  el.innerHTML = top.map((e, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${esc(e.playerName)}</span>
      <span class="lb-wins">${e.won ? '🏆 W' : 'L'}</span>
      <span class="lb-pts">${e.myScore}–${e.opponentScore}</span>
    </div>`).join('')
}

function switchScreen (name) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none' })
  const el = $(`screen-${name}`)
  el.classList.add('active'); el.style.display = 'flex'
}

function setMsg (id, text, cls) {
  const el = $(id); if (!el) return
  el.textContent = text; el.className = `msg ${cls}`; el.classList.remove('hidden')
}

function esc (s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}