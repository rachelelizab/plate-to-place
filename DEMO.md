# Plate2Place: demo script (about 6 minutes)

Start the app with `npm run build && npm start`, then open http://localhost:3000.
The badge in the top right should read **API · node vXX**, which shows the backend is serving.

## 1. Problem (30 s)
"Every night Bengaluru's restaurants, wedding halls and canteens throw away cooked food while shelters go short. Volunteers coordinate on WhatsApp: whoever sees a post goes, with no check that the food will still be safe when it arrives. Cooked food lasts a few hours, and the same trip takes 15 minutes at 22:30 and 50 minutes at 19:00."

## 2. Live map (90 s)
- Press **Play**. The circles are donations, their colour shows safe time left, and the blue dots are volunteers on real-time routes.
- **Kinetic heap panel:** "Each post's value is portions × share of safe time left, so it falls every minute. A normal heap would re-sort everything every minute. The kinetic heap stores a *certificate* for each parent–child pair, with the exact time it fails, and only does work at those moments."
- Click a heap row to show that donation on the map.
- **AVL panel:** "Indexed by expiry time. 'What spoils in the next 90 minutes' is a range query, O(log n + k)."
- Switch to **First come**. "Same evening, WhatsApp style. Watch the red ✕ marks: food spoiling while volunteers cross the city."

## 3. Compare (60 s)
- Read the three cards. Plate2Place delivers the most meals with **0 wasted trips**.
- Click **Run seeds 1–5**. "Five different evenings, computed by the backend. Plate2Place wins every one: about 71% rescued, against 64% for nearest-first and 29% for first come."

## 4. Dispatch desk (90 s)
- "This is real use: a coordinator posts donations and asks who should go where."
- **Find best pickup.** "Time-dependent Dijkstra for both legs at this exact hour. Posts that would spoil before reaching a shelter are rejected."
- **Assign this pickup.** "A hash-map claim lock means a second volunteer can't take it. The API returns an error if anyone tries."
- **+30 min.** "The kinetic heap re-ranks, and the AVL sweep removes expired posts."
- Click the map to post a new donation.

## 5. Structures lab (60 s)
- **Insert 8 keys in time order** twice. "Donations arrive in time order, the worst case for a BST: height n. The AVL tree stays at log n using rotations."
- Drag the kinetic slider. "The dots are the only moments the heap does any work."
- Benchmarks: "With 4,000 posts the BST has height 3,967 and the AVL tree 12, so the AVL tree needs 181× fewer comparisons. The kinetic heap does about 500× less work than re-sorting every minute."

## 6. Close (20 s)
Open the **Method** tab with the pseudocode and complexity table. "16 automated tests check every structure against a reference implementation."

## Likely questions
- **Why not a normal priority queue?** Priorities change continuously. Re-keying every item every minute costs O(n log n) per minute; the kinetic heap pays only for real crossings.
- **Why is Dijkstra exact with time-varying costs?** The congestion model is FIFO (leaving later never gets you there earlier). The test suite checks this.
- **Why AVL and not a heap for expiry?** A heap only gives the minimum. The AVL tree also gives range queries and ordered sweeps.
- **Is the data real?** The city layout and congestion pattern are modelled on Bengaluru. Donors and shelters are synthetic, so the results are from simulation.
