import Runtime from 'pear-electron'
import Bridge  from 'pear-bridge'
import Hyperswarm from 'hyperswarm'
import Hypercore  from 'hypercore'

// Create Pear desktop runtime
const runtime = new Runtime()

// Mount frontend UI
const bridge = new Bridge({ mount: '/ui', waypoint: 'index.html' })
await bridge.ready()

// Start runtime and create communication pipe
const pipe = await runtime.start({ bridge })

// Cleanup on app shutdown
Pear.teardown(() => pipe.end())

// Buffer for incoming frontend messages
let recvBuf = ''

pipe.on('data', (data) => {
  recvBuf += Buffer.from(data).toString('utf8')

  // Split newline-delimited messages
  const lines = recvBuf.split('\n')
  recvBuf = lines.pop()

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      handle(JSON.parse(line))
    } catch (e) {
      console.error('[BE] bad msg:', e)
    }
  }
})

// Send message to frontend
function send (msg) {
  pipe.write(JSON.stringify(msg) + '\n')
}

let swarm   = null
let conn    = null
let peerBuf = Buffer.alloc(0)

let lbCore  = null
let lbSwarm = null

// Handle frontend commands
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

// Host a new game session
async function onHost () {
  swarm = new Hyperswarm()

  // Generate random room topic
  const topic = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) {
    topic[i] = Math.floor(Math.random() * 256)
  }

  attachSwarmListeners()

  // Announce as server on DHT
  const discovery = swarm.join(topic, { server: true, client: false })
  await discovery.flushed()

  // Send room code to frontend
  send({ type: 'hosted', code: topic.toString('hex') })
}

// Join an existing game
async function onJoin (code) {
  swarm = new Hyperswarm()

  // Convert room code back to topic buffer
  const topic = Buffer.from(code, 'hex')

  attachSwarmListeners()

  // Lookup host peer
  swarm.join(topic, { server: false, client: true })
}

// Send framed data to connected peer
function onSend (data) {
  if (!conn || conn.destroyed) return

  try {
    const payload = Buffer.from(data, 'utf8')

    // Prefix payload with length header
    const frame   = Buffer.allocUnsafe(4 + payload.length)
    frame.writeUInt32BE(payload.length, 0)

    payload.copy(frame, 4)

    conn.write(frame)
  } catch (e) {
    console.error('[BE] send error:', e)
  }
}

// Destroy active swarm connection
async function onDestroy () {
  if (swarm) {
    await swarm.destroy()
    swarm = null
  }

  conn    = null
  peerBuf = Buffer.alloc(0)
}

// Register peer connection listeners
function attachSwarmListeners () {
  swarm.on('connection', (c) => {

    // Allow only one active peer
    if (conn) {
      c.destroy()
      return
    }

    conn    = c
    peerBuf = Buffer.alloc(0)

    // Handle incoming peer data
    c.on('data', (chunk) => {
      peerBuf = Buffer.concat([peerBuf, chunk])
      drainPeerFrames()
    })

    // Peer disconnected
    c.on('close', () => {
      conn    = null
      peerBuf = Buffer.alloc(0)

      send({ type: 'peer-disconnect' })
    })

    // Peer connection error
    c.on('error', () => {
      conn    = null
      peerBuf = Buffer.alloc(0)

      send({ type: 'peer-disconnect' })
    })

    send({ type: 'peer-connect' })
  })
}

// Read framed peer messages
function drainPeerFrames () {
  while (peerBuf.length >= 4) {

    // Read frame length
    const len = peerBuf.readUInt32BE(0)

    // Basic safety check
    if (len > 1_000_000) {
      conn?.destroy()
      return
    }

    // Wait for full frame
    if (peerBuf.length < 4 + len) break

    // Extract payload
    const payload = peerBuf
      .slice(4, 4 + len)
      .toString('utf8')

    peerBuf = peerBuf.slice(4 + len)

    send({ type: 'peer-message', data: payload })
  }
}

// Initialize distributed leaderboard
async function onLbInit () {
  try {

    // Hypercore storage path
    const storage = Pear.config.storage.replace(/[/\\]$/, '') + '/lb-v1'

    lbCore = new Hypercore(storage, {
      valueEncoding: 'json'
    })

    await lbCore.ready()

    // Load existing entries
    const entries = []

    for (let i = 0; i < lbCore.length; i++) {
      try {
        entries.push(await lbCore.get(i))
      } catch {}
    }

    send({ type: 'lb-ready', entries })

    // Swarm used for leaderboard replication
    lbSwarm = new Hyperswarm()

    lbSwarm.join(lbCore.discoveryKey, {
      server: true,
      client: true
    })

    lbSwarm.on('connection', (c) => {
      const isInit = c.isInitiator ?? false

      // Replicate Hypercore feed
      const stream = lbCore.replicate(isInit, {
        live: true
      })

      stream.pipe(c).pipe(stream)

      stream.on('error', () => {})
      c.on('error', () => {})

      // Push updates when new entries replicate
      lbCore.on('append', async () => {
        const fresh = []

        for (let i = 0; i < lbCore.length; i++) {
          try {
            fresh.push(await lbCore.get(i))
          } catch {}
        }

        send({ type: 'lb-updated', entries: fresh })
      })
    })

  } catch (e) {
    console.error('[BE] lb init error:', e)

    send({ type: 'lb-ready', entries: [] })
  }
}

// Append new leaderboard entry
async function onLbRecord (entry) {
  if (!lbCore) return

  try {
    await lbCore.append(entry)
  } catch (e) {
    console.error('[BE] lb record:', e)
  }
}
