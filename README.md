# P2P Pong

A real-time two-player Pong game built with Pears. No servers, no REST APIs, no hosted databases. Two machines connect directly over the internet using Hyperswarm peer-to-peer networking.

## Quick start

```bash
# 1. Install Pears runtime
npm install -g pear

# 2. Clone and install
git clone https://github.com/Ginowine/p2p-pong.git
cd p2p-pong
npm install

# 3. Run
pear run -d .
```

## Play with a friend

Player 1 (host): Enter your name, click Create room, and copy the 64-character room code.

Player 2 (guest): Enter your name, paste the code, and click Join room.

Controls: W/S or ArrowUp/ArrowDown

## Test locally (two players, one machine)

Use --tmp-store to run separate instances with separate storage:

```bash
# Terminal 1
pear run --tmp-store -d .

# Terminal 2
pear run --tmp-store -d .
```

Host from one window, join from the other.

## Project structure

```
p2p-pong/
├── index.js        # Bare backend — Hyperswarm + Hypercore
├── package.json    # Pears config + dependencies
└── ui/
    ├── index.html  # Renderer entry point
    ├── app.js      # UI logic, game loop, IPC with backend
    ├── physics.js  # Pong game engine (pure logic)
    ├── renderer.js # Canvas drawing
    └── style.css
```

## How it works

Pears desktop apps have two processes:

| Process | File | Runtime | Responsibilities |
|---|---|---|---|
| Backend | index.js | Bare (Node-like) | Hyperswarm, Hypercore, TCP framing |
| Renderer | ui/ | Chromium | Game physics, canvas, UI, keyboard |

The two communicate via a pipe using newline-delimited JSON.

### Peer discovery

The host generates a random 32-byte topic and announces it on the Hyperswarm DHT. The guest looks up the same topic, finds the host's address, and a direct Noise-encrypted connection is established. After discovery, the DHT is no longer involved.

### Game authority

The host runs the physics simulation every frame and broadcasts the full game state to the guest. The guest only sends paddle direction inputs. One source of truth, no conflicts.

### Leaderboard

Each player has a local Hypercore (append-only log). Scores are saved locally after each match. A separate Hyperswarm swarm keyed by the core's discoveryKey replicates scores to any peer who has played before, no server needed.

## Documentation

Full docs in the docs/ folder:

```bash
cd docs && npm install && npm start
```

## License

MIT
