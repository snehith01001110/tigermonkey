# TigerMonkey — Cabo

A small browser version of a 4-card Cabo/Cambio variant. It supports the original computer opponent and private two-player online rooms.

## Rules in this version

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
- Match discard: if one of your face-down cards has the same rank as the top discard, you can remove it. A wrong match adds a penalty card.
- Call Cabo to lock your hand. The other player gets one final turn, then both hands are revealed and counted up on the table.

## Run locally

Install the development dependency, then run the site and multiplayer API in separate terminals:

```bash
npm install
npm run dev
```

```bash
npm run dev:api
```

Then visit `http://localhost:8000`.

Run the rules tests and the live two-client smoke test with:

```bash
npm test
npm run smoke:api
```

The smoke test expects `npm run dev:api` to already be running.

## Multiplayer architecture

- `src/shared/games/cabo.js` is the server-authoritative Cabo rules engine.
- `src/shared/games/registry.js` is the extension point for additional games.
- `worker/index.js` provides room creation, joining, private player credentials, WebSocket updates, reconnect handling, and one Durable Object per room.
- `src/client/online.js` renders a player-specific, redacted room view using the existing table design.

The server owns shuffling and validates every action. Hidden cards are removed from each outgoing player view rather than merely hidden with CSS.
Players join through the host's invite link; the room identifier stays in the URL and is not part of the visible interface.

## Deploy

The frontend remains a static GitHub Pages site with no build step. Pushing the default branch runs `.github/workflows/pages.yml`.

Deploy the multiplayer Worker with:

```bash
npm run check:api
npm run deploy:api
```

The deployed Worker URL is set in the `multiplayer-api` meta tag in `index.html`. The Worker accepts the production domain and the local development origins configured in `wrangler.jsonc`.
