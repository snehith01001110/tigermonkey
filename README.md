# TigerMonkey

A small browser card table for Cabo and Yaniv. Both games support a computer opponent and private two-player online rooms.

## Cabo rules in this version

- 4 face-down cards per player.
- At the start, you may see only your bottom two cards.
- Lowest score wins.
- Draw from the deck or take the top discard.
- Powers only trigger when a power card is drawn from the deck and then discarded.
- 7–8: peek at one of your own cards.
- 9–10: peek at one opponent card.
- J: blind swap one of yours with one of theirs.
- Q: swap, then check the card you received.
- K: check one opponent card, then decide whether to swap it with one of yours.
- Red King: -1 point.
- Joker: 0 points.
- J/Q/black K score 11/12/13 respectively.
- Match discard: if one of your face-down cards has the same rank as the top discard, you can remove it. The card leaves its spot empty rather than closing the gap, so every other card stays where you memorized it. A wrong match adds a penalty card, which fills an empty spot before the hand grows.
- Call Cabo to lock your hand. The other player gets one final turn, then both hands are revealed and counted up on the table, each card marked with what it was worth.

## Yaniv rules in this version

- 5 visible cards per player; lowest cumulative score wins.
- On your turn, play one card, a same-rank set, or a same-suit run of at least 3 cards, then draw one card.
- Draw from the deck or take the top card from the previous discard.
- Aces score 1, number cards use their number, face cards score 10, and Jokers score 0.
- Jokers are wild in sets and runs.
- You may call Yaniv at 5 points or fewer.
- If the opponent has the same or a lower hand, they call Assaf: they score 0 and the caller adds their hand plus a 30-point penalty.
- Rounds continue until a score reaches 200; the lower total wins the match.
- Local play has easy, medium, and hard computer opponents in Settings. Medium looks for useful discard pickups and makes safer Yaniv calls; hard also weighs the remaining deck and Assaf risk.

## Run locally

Install the development dependency, then run the site and multiplayer API in separate terminals:

```bash
npm install
npm run dev
```

```bash
npm run dev:api
```

Then visit `http://localhost:8000`. The root page is the game library; individual
games use explicit URLs such as `/?game=cabo` and `/?game=yaniv`.

Run the rules tests and the live two-client smoke test with:

```bash
npm test
npm run smoke:api
npm run smoke:yaniv
```

The smoke test expects `npm run dev:api` to already be running.

## Multiplayer architecture

- `src/shared/games/cabo.js` and `src/shared/games/yaniv.js` are the server-authoritative rules engines.
- `src/shared/games/registry.js` is the extension point for additional games.
- `src/client/games.js` is the small catalog that populates both the home page and the in-game picker.
- `worker/index.js` provides room creation, joining, private player credentials, WebSocket updates, reconnect handling, and one Durable Object per room.
- `src/client/online.js` and `src/client/yaniv-online.js` render player-specific, redacted room views using the shared table design.

The server owns shuffling and validates every action. Hidden cards are removed from each outgoing player view rather than merely hidden with CSS.
Players join through the host's invite link; the room identifier stays in the URL and is not part of the visible interface.

## Deploy

The frontend remains a static GitHub Pages site with no build step. GitHub's own Pages builder publishes the
default branch on every push, so there is no deployment workflow to maintain; `.nojekyll` keeps the files as they
are and `CNAME` holds the custom domain.

Deploy the multiplayer Worker with:

```bash
npm run check:api
npm run deploy:api
```

The deployed Worker URL is set in the `multiplayer-api` meta tag in `index.html`. The Worker accepts the production domain and the local development origins configured in `wrangler.jsonc`.
