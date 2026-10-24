# Plate2Place

**Spoilage-aware surplus-food rescue dispatch for Bengaluru.**
Advanced Data Structures & Algorithms mini-project.

## Problem

Every night, Bengaluru's restaurants, wedding halls, hostels and canteens throw away cooked food, while shelters nearby go short. Rescue groups coordinate on WhatsApp: a volunteer sees a post and goes. Nobody checks whether the food will still be safe when it reaches a shelter, or whether someone else is already on the way. Cooked food is safe for only a few hours, and the same trip can take 15 minutes at 22:30 and 50 minutes at 19:00.

## Solution

Two things make the problem hard:

- the value of each post **decays continuously** as its safe time runs out;
- travel time **depends on when you leave**.

Plate2Place handles both with hand-written data structures:

| Structure | File | Role | Key cost |
|---|---|---|---|
| **Kinetic heap** (certificates + event queue) | `engine/kinetic.js` | Ranks posts by value still savable, `f(t) = P·(E − t)/L`. Only does work when two values cross. | advance `O(e log n)`, insert/remove `O(log n)` |
| **Indexed min-heap** | `engine/minheap.js` | Certificate queue, Dijkstra frontier, simulation event loop | `O(log n)` |
| **AVL tree** keyed on (expiry, id) | `engine/avl.js` | "What spoils in the next 90 min?" plus the expiry sweep | range `O(log n + k)` |
| **Plain BST** | `engine/bst.js` | Baseline. Shows how sorted arrivals degenerate it to height n. | `O(n)` worst case |
| **Graph + time-dependent Dijkstra** | `engine/graph.js` | Exact arrival times at this hour of the evening (FIFO-safe congestion model) | `O((V+E) log V)` |
| **Hash map** (separate chaining, resizing) | `engine/hashmap.js` | Registry, claim locks, heap position index | `O(1)` average |

A volunteer is only sent on a trip if the food will reach a shelter before it expires. Among the feasible trips, the dispatcher picks the one with the most meals saved per volunteer-minute, with a bonus for urgent posts.

## Results

The same city, donations and volunteers are run under all three methods: 160 donations, 20 volunteers, average over 5 evenings.

| Method | Meals saved | Rescue rate | Wasted trips |
|---|---|---|---|
| First come, first served (WhatsApp today) | 2,921 | 29.3% | 14 per night |
| Nearest first | 6,424 | 64.4% | 3 per night |
| **Plate2Place** | **7,149** | **71.5%** | **0** |

Benchmarks (`npm run bench`):

- **Trees:** with 4,000 nearly-sorted expiry keys, the BST reaches height 3,967 and the AVL tree height 12. The AVL tree needs 181× fewer comparisons.
- **Kinetic heap:** compared with re-sorting every minute, it does about 350–520× less work.

## Run it

Requires Node.js 18 or later. There are no dependencies to install.

```bash
npm test          # 16 tests: each structure checked against a reference implementation
npm run bench     # benchmark tables
npm run build     # bundles engine + frontend into frontend/dist/
npm start         # http://localhost:3000  (frontend + REST API)
```

The frontend detects the backend. When served by `npm start`, every simulation and dispatch-desk call goes through the API. When `frontend/dist/index.html` is opened as a static file, the same engine runs in the browser.

## Deploy online

- **Render (free):** push to GitHub, then New → Blueprint → select the repo. `render.yaml` builds, runs the tests and starts the server.
- **Docker:** `docker build -t plate2place . && docker run -p 3000:3000 plate2place`
- **Static only:** `frontend/dist/index.html` runs the whole engine in the browser, so any static host works (no API).

See `DEMO.md` for a 6-minute presentation script.

## API

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/health` | |
| GET | `/api/run` | `seed, donations, volunteers` → all 3 strategies with full traces |
| GET | `/api/simulate` | `strategy=fcfs\|nearest\|plate2place` + the above |
| GET | `/api/compare` | `seeds=1,2,3,4,5` → metrics per seed |
| GET | `/api/bench/trees`, `/api/bench/kinetic` | |
| GET | `/api/live/state`, `/api/live/city`, `/api/live/urgent?within=60` | |
| POST | `/api/live/donations` | `{donor, lat, lng, portions, lifeMinutes}` |
| POST | `/api/live/recommend` | `{lat, lng, cap}` → ranked feasible pickups with both routes |
| POST | `/api/live/claim` | `{id, volunteer}` (hash-map lock; a second claim is rejected) |
| POST | `/api/live/complete` | `{id}` |
| POST | `/api/live/time` | `{t}` minutes since midnight. Advances the kinetic heap and sweeps the AVL tree. |

## Layout

```
engine/   hashmap, minheap, bst, avl, kinetic, graph, city (scenario generator), sim (3 strategies), live (dispatch desk), bench
server/   server.js: zero-dependency Node HTTP server
frontend/ app.html, app.css, app.js → built into dist/
tests/    run.js
scripts/  build.js, bench-cli.js
```

## Data note

The city is a synthetic road graph (418 intersections, about 880 roads) laid over Bengaluru's real extent and 22 real neighbourhoods. Evening congestion profiles follow typical weekday peaks. Donors and shelters are generated labels, not real organisations.
# plate-to-place
