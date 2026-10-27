# Bum Voyage

A co-op river race for 1 to 4 players on separate devices. Each player is a cartoon character lying on their belly on the rim of a round inflatable boat, bottom hanging out over the water, and the whole crew steers by farting. Inspired by the idea behind "Fart Together"; the code, rivers and boat here are original.

## Characters

The six playable animals are a lion (Leo), a zebra (Zeke), a giraffe (Gerry), a hippo (Hattie), a mouse lemur (Milo) and a ring-tailed lemur king (King Ringo XIII). They are low-poly characters built from simple shapes in `public/js/characters/`. To change them, edit `public/shared/animals.js` (names, emoji, blurbs) and the matching module (see "Characters in code" below).

## How to play

- Create a room, share the 4-letter code (or the invite link), pick a character, and the host starts the race. Rename yourself any time in the lobby.
- **The boat is round and split between the crew.** Play alone and you can lie anywhere around the rim. Two players get half each, three a third each, four a quarter each. The colored wedge on the deck is your slice.
- **Move the stick to choose where you lie.** Your fart pushes the boat the opposite way, so go to the back to go forward. The arrow on the boat, in your color, shows where your next blast will push.
- **Hold TOOT to charge, release to fart.** Longer holds are bigger and cost more gas. Gas refills slowly. Keyboard: `WASD` or arrows to move, `Space` to toot.
- **The boat is an inflatable raft and it has no brakes.** After a blast it keeps gliding for seconds. To stop or turn, move round the rim and fart the other way.
- **Too much farting makes your bum red and sore.** A sore bum makes weaker farts until it cools down.
- **The river fights back.**
  - Rocks bump you.
  - Spiky sea urchins always hurt.
  - Purple spiked rails along the bank always hurt. Plain green rails are harmless.
  - Spiked rollers cross from the left, from the right, or roll at you from straight ahead.
  - Whirlpools drag you in. Sit in the core too long and you get flushed out, hurt and rattled.
  - Waterfalls fling you down the river and rattle everyone's gas tank.
  - Floating logs drift across the river and bump you.
  - Currents push you around.
- The crew shares 5 hull points. At zero the boat sinks and restarts from the last flag. If you get wedged against something, the river nudges you free after a few seconds.
- Stars: 3 for no sinking, 3 hits or fewer and beating par time. 2 for at most one sinking within 1.6x par. 1 for finishing.

### Rivers

Every river winds like a real one, with S-bends, narrow gorges and wide pools, and none of them cross themselves.

1. Poot Pond: warm-up bends with a few spikes.
2. Spiky Shallows: sea urchins and spiked rails.
3. Roller Coaster Creek: spiked rollers from three directions.
4. Whirlpool Wobble: drains in the river.
5. Big Drop Falls: three waterfalls and rollers coming at you.
6. The Gas Chamber: everything at once (rocks, urchins, logs, rollers, a whirlpool, waterfalls, rails and currents) on the twistiest river.

## Run it

```bash
npm ci
npm start
```

Open http://localhost:3000, create a room, then open the invite link in a second tab or on a phone on the same network (`http://<your-ip>:3000`). To fill a room with test crew:

```bash
node scripts/bots.mjs ROOMCODE 3
```

Bots only join, so the host still presses Start. Give them a third argument to fill a deployed room, for example `wss://bum-voyage.onrender.com/ws`.

## Sound

The farts are real recordings (public domain and CC0), cut into clips and played at different speeds for bigger and smaller blasts. See `public/audio/README.md` for credits and how to add your own. If the recordings can't load, a synthesized fart takes over. Licences for the recordings, three.js and `ws` are in `THIRD_PARTY_NOTICES.md`.

## Tests and tuning

```bash
npm test
```

Covers the physics and rules (sectors, walking, gas, heat, hull, sinking, every hazard), the river generator, room logic (host, seats, characters, rename, reconnect, late join), a real two-client WebSocket session (create, join, start, blast, resume) and the character checks below.

- `npm run tune` runs a headless autopilot over every river and crew size.
- `node scripts/rivers.mjs` prints each river's shape, widths and hazard counts.
- `node scripts/sinks.mjs <level 0-5> <crew 1-4> <seconds>` shows where the autopilot keeps getting hurt.
- `node scripts/feel.mjs` measures how long the boat glides after a blast and how much counter-farting it takes to stop.

### Characters in code

Each character is a module in `public/js/characters/` (`leo.js`, `zeke.js`, `gerry.js`, `hattie.js`, `milo.js`, `ringo.js`) exporting a `spec` and a `build` function. `kit.js` has the shape helpers (lofts, limbs, vertex painting) and `rig.js` turns a build into an animated rig: arms planted on the deck, legs hanging over the water, kick and recoil, squint and tail flick, and the red blush that spreads over the cheeks as the bum gets sore. All characters share the same frame constants so they sit on the rim the same way.

- `node scripts/check-rigs.mjs [id ...]` checks every character in every pose: nothing clips into the tube or deck, hands rest on the deck, feet hang just above the water, the bum is outside the boat, and the mesh and triangle budgets hold.
- `node scripts/render-sheet.mjs leo --views game,side` renders turnaround sheets to PNG with headless Chrome into `sheets/` (change it with `--out <dir>`). `node scripts/render-sheet.mjs leo --crew leo,zeke,hattie,milo --views cast` shows four characters from the game camera. Pass one character id, or you get one identical file per character. It needs Google Chrome; set `CHROME_PATH` if it is not in the macOS default place.

## Deploy

The repo includes a Render blueprint (`render.yaml`). Push it to GitHub, then in Render choose New, Blueprint, pick the repo, and deploy. It runs `node server/index.js` on the `PORT` Render provides and uses `/healthz` as the health check. Render's free plan sleeps after idle time, so the first visit can take about a minute. Rooms live in memory on a single instance, so a redeploy, restart or sleep ends every room, and the service must not be scaled past one instance. Pick `region` in `render.yaml` before the first deploy, because it cannot be changed afterwards. The build only installs `ws`; there is no bundling step.

The per-address limits (connections per address, rooms created per minute) read the first `X-Forwarded-For` hop, and a client can fake that hop. After your first deploy, log the header once, call the app with a made-up `X-Forwarded-For: 1.2.3.4` to see which hop is really yours, and set the `TRUST_PROXY_HOPS` environment variable to the number of hops Render appends. Leave it unset until you have checked: with too small a number every visitor would share one address.

The 3D library is bundled into `public/vendor/three.min.js` and committed, so deploys need no build step. It holds only the three.js names the code uses (`scripts/build-vendor.mjs` finds them by scanning the sources), which makes it about a fifth smaller. After upgrading three.js, or after using a new `THREE.Name` anywhere, run `npm ci` then `npm run build:vendor` and commit the result; a test fails until you do.

## How it works

- `server/Simulation.js` is the authoritative game at 60 Hz: boat physics, characters walking the rim, gas, heat, hazards, checkpoints.
- `server/Room.js` holds a room: players, host, seats, characters, countdown and race phases. Snapshots go out at 20 Hz.
- `public/shared/` (rules, levels, hazards, characters) is used by both server and browser. Each river is generated from a fixed seed, so only the level number goes over the wire.
- The browser sends only intent (`stick` direction and `charge on/off`). The server decides what happens. Snapshots arrive unevenly on a far-away or busy connection, so the browser draws the world a little in the past, on the server's clock, and keeps a cushion that grows with the jitter it measures (`public/js/snapshots.js`). Events from the server wait for the drawn world to reach the moment they happened at, and a player's own blast is shown the moment they let go, without waiting for the server's answer.
- The 3D view is a chase camera above and behind the boat, always looking downstream, so stick-up is always forward. Terrain, water, hazards, boat and characters live in `public/js/` (`terrain.js`, `water.js`, `hazards.js`, `boat.js`, `characters/`, `scene.js`).
- Players keep a session token in their tab, so a refresh or dropped connection rejoins the same seat if it comes back within 45 seconds (during a race the seat is held until the race ends).
