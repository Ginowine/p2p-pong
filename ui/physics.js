export const W = 800
export const H = 480

export const PADDLE_W = 12
export const PADDLE_H = 90
export const BALL_R   = 9
export const LEFT_X   = 18
export const RIGHT_X  = W - 18 - PADDLE_W
export const WIN_SCORE = 7

const PADDLE_SPEED   = 6
const BALL_SPEED_0   = 5.5
const BALL_SPEED_MAX = 12
const SPEED_INC      = 0.25

export function createState () {
  return {
    left:    { y: H / 2 - PADDLE_H / 2, dy: 0, score: 0 },
    right:   { y: H / 2 - PADDLE_H / 2, dy: 0, score: 0 },
    ball:    newBall(),
    phase:   'countdown',
    countdown: 3,
    winner:  null,
    tick:    0,
    effects: [],
    _resumeAtTick: 0,
    _hostRunning:  false,
  }
}

function newBall (lastScorer = null) {
  const angle = (Math.random() * 50 - 25) * (Math.PI / 180)
  const dirX  = lastScorer === 'left'  ?  1
              : lastScorer === 'right' ? -1
              : (Math.random() < 0.5 ? 1 : -1)
  const speed = BALL_SPEED_0
  return { x: W / 2, y: H / 2,
           vx: dirX * speed * Math.cos(angle),
           vy: speed * Math.sin(angle), speed }
}

export function setPaddleDir (state, side, direction) {
  state[side].dy = direction * PADDLE_SPEED
}

export function step (state) {
  const events = []
  state.tick++
  if (state.phase === 'gameover') return events

  for (const side of ['left', 'right']) {
    const p = state[side]
    p.y = Math.max(0, Math.min(H - PADDLE_H, p.y + p.dy))
  }

  if (state.phase !== 'playing') return events

  state.effects = state.effects.map(e => ({ ...e, age: e.age + 1 })).filter(e => e.age < e.maxAge)

  const b = state.ball
  b.x += b.vx
  b.y += b.vy

  if (b.y - BALL_R < 0) { b.y = BALL_R; b.vy = Math.abs(b.vy); events.push('hit-wall'); addEffect(state, b.x, b.y) }
  if (b.y + BALL_R > H) { b.y = H - BALL_R; b.vy = -Math.abs(b.vy); events.push('hit-wall'); addEffect(state, b.x, b.y) }

  if (b.vx < 0 &&
      b.x - BALL_R <= LEFT_X + PADDLE_W && b.x - BALL_R > LEFT_X - 2 &&
      b.y >= state.left.y - BALL_R && b.y <= state.left.y + PADDLE_H + BALL_R) {
    b.x = LEFT_X + PADDLE_W + BALL_R
    reflect(b, state.left, 1)
    events.push('hit-paddle'); addEffect(state, b.x, b.y)
  }

  if (b.vx > 0 &&
      b.x + BALL_R >= RIGHT_X && b.x + BALL_R < RIGHT_X + PADDLE_W + 2 &&
      b.y >= state.right.y - BALL_R && b.y <= state.right.y + PADDLE_H + BALL_R) {
    b.x = RIGHT_X - BALL_R
    reflect(b, state.right, -1)
    events.push('hit-paddle'); addEffect(state, b.x, b.y)
  }

  if (b.x + BALL_R < 0) {
    state.right.score++
    events.push('point-right')
    checkWin(state, 'right')
    if (state.phase !== 'gameover') { state.ball = newBall('right'); state.phase = 'point'; state._resumeAtTick = state.tick + 90 }
  }
  if (b.x - BALL_R > W) {
    state.left.score++
    events.push('point-left')
    checkWin(state, 'left')
    if (state.phase !== 'gameover') { state.ball = newBall('left'); state.phase = 'point'; state._resumeAtTick = state.tick + 90 }
  }

  return events
}

export function maybeResume (state) {
  if (state.phase === 'point' && state.tick >= state._resumeAtTick) state.phase = 'playing'
}

function reflect (ball, paddle, outDir) {
  const mid    = paddle.y + PADDLE_H / 2
  const impact = (ball.y - mid) / (PADDLE_H / 2)
  const angle  = impact * 65 * (Math.PI / 180)
  ball.speed   = Math.min(ball.speed + SPEED_INC, BALL_SPEED_MAX)
  ball.vx      = outDir * ball.speed * Math.cos(angle)
  ball.vy      = ball.speed * Math.sin(angle)
}

function checkWin (state, side) {
  if (state[side].score >= WIN_SCORE) { state.phase = 'gameover'; state.winner = side }
}

function addEffect (state, x, y) {
  state.effects.push({ x, y, age: 0, maxAge: 18 })
}

export function serialize (state) {
  return {
    lp: Math.round(state.left.y),  rp: Math.round(state.right.y),
    ls: state.left.score,          rs: state.right.score,
    bx: Math.round(state.ball.x * 10) / 10,
    by: Math.round(state.ball.y * 10) / 10,
    ph: state.phase, wi: state.winner, tk: state.tick,
    rt: state._resumeAtTick || 0,
  }
}

export function applySnapshot (state, snap) {
  state.left.y       = snap.lp;  state.right.y      = snap.rp
  state.left.score   = snap.ls;  state.right.score  = snap.rs
  state.ball.x       = snap.bx;  state.ball.y       = snap.by
  state.phase        = snap.ph;  state.winner       = snap.wi
  state.tick         = snap.tk;  state._resumeAtTick = snap.rt || 0
  state.effects      = state.effects || []
}