import Runtime from 'pear-electron'
import Bridge  from 'pear-bridge'
import Hyperswarm from 'hyperswarm'
import Hypercore  from 'hypercore'

const runtime = new Runtime()

const bridge = new Bridge({ mount: '/ui', waypoint: 'index.html' })
await bridge.ready()

const pipe = await runtime.start({ bridge })
Pear.teardown(() => pipe.end())

let recvBuf = ''

pipe.on('data', (data) => {
  recvBuf += Buffer.from(data).toString('utf8')
  const lines = recvBuf.split('\n')
  recvBuf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    try { handle(JSON.parse(line)) } catch (e) { console.error('[BE] bad msg:', e) }
  }
})

function send (msg) {
  pipe.write(JSON.stringify(msg) + '\n')
}

let swarm   = null
let conn    = null
let peerBuf = Buffer.alloc(0)

let lbCore  = null
let lbSwarm = null

async function handle (msg) {
  switch (msg.type) {
    case 'host':      return onHost()
    case 'join':      return onJoin(msg.code)
    case 'send':      return onSend(msg.data)
    case 'destroy':   return onDestroy()
    case 'lb-init':   return onLbInit()
    case 'lb-record': return onLbRecord(msg.entry)
  }
}

async function onHost () {
  swarm = new Hyperswarm()

  const topic = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) {
    topic[i] = Math.floor(Math.random() * 256)
  }

  attachSwarmListeners()

  const discovery = swarm.join(topic, { server: true, client: false })
  await discovery.flushed()

  send({ type: 'hosted', code: topic.toString('hex') })
}

async function onJoin (code) {
  swarm = new Hyperswarm()
  const topic = Buffer.from(code, 'hex')

  attachSwarmListeners()

  swarm.join(topic, { server: false, client: true })
}

function onSend (data) {
  if (!conn || conn.destroyed) return
  try {
    const payload = Buffer.from(data, 'utf8')
    const frame   = Buffer.allocUnsafe(4 + payload.length)
    frame.writeUInt32BE(payload.length, 0)
    payload.copy(frame, 4)
    conn.write(frame)
  } catch (e) {
    console.error('[BE] send error:', e)
  }
}

async function onDestroy () {
  if (swarm) { await swarm.destroy(); swarm = null }
  conn    = null
  peerBuf = Buffer.alloc(0)
}

function attachSwarmListeners () {
  swarm.on('connection', (c) => {
    if (conn) { c.destroy(); return }
    conn    = c
    peerBuf = Buffer.alloc(0)

    c.on('data', (chunk) => {
      peerBuf = Buffer.concat([peerBuf, chunk])
      drainPeerFrames()
    })

    c.on('close', () => {
      conn    = null
      peerBuf = Buffer.alloc(0)
      send({ type: 'peer-disconnect' })
    })

    c.on('error', () => {
      conn    = null
      peerBuf = Buffer.alloc(0)
      send({ type: 'peer-disconnect' })
    })

    send({ type: 'peer-connect' })
  })
}

function drainPeerFrames () {
  while (peerBuf.length >= 4) {
    const len = peerBuf.readUInt32BE(0)
    if (len > 1_000_000) { conn?.destroy(); return }
    if (peerBuf.length < 4 + len) break
    const payload = peerBuf.slice(4, 4 + len).toString('utf8')
    peerBuf = peerBuf.slice(4 + len)
    send({ type: 'peer-message', data: payload })
  }
}

async function onLbInit () {
  try {
    const storage = Pear.config.storage.replace(/[/\\]$/, '') + '/lb-v1'
    lbCore = new Hypercore(storage, { valueEncoding: 'json' })
    await lbCore.ready()

    const entries = []
    for (let i = 0; i < lbCore.length; i++) {
      try { entries.push(await lbCore.get(i)) } catch {}
    }

    send({ type: 'lb-ready', entries })

    lbSwarm = new Hyperswarm()
    lbSwarm.join(lbCore.discoveryKey, { server: true, client: true })
    lbSwarm.on('connection', (c) => {
      const isInit = c.isInitiator ?? false
      const stream = lbCore.replicate(isInit, { live: true })
      stream.pipe(c).pipe(stream)
      stream.on('error', () => {})
      c.on('error', () => {})

      lbCore.on('append', async () => {
        const fresh = []
        for (let i = 0; i < lbCore.length; i++) {
          try { fresh.push(await lbCore.get(i)) } catch {}
        }
        send({ type: 'lb-updated', entries: fresh })
      })
    })
  } catch (e) {
    console.error('[BE] lb init error:', e)
    send({ type: 'lb-ready', entries: [] })
  }
}

//Leaderboard: append a match result
async function onLbRecord (entry) {
  if (!lbCore) return
  try { await lbCore.append(entry) } catch (e) { console.error('[BE] lb record:', e) }
}
