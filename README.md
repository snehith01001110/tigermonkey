# TigerMonkey — Cabo

A tiny browser version of a 4-card Cabo/Cambio variant. Built as plain HTML/CSS/JavaScript so it can be hosted anywhere with no backend.

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
- Call Cabo to lock your hand. The other player gets one final turn, then both hands are revealed.

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploy

Because the app is fully static, GitHub Pages, Cloudflare Pages, Netlify, or Vercel all work without a build step.

For GitHub Pages, publish the repository root from the default branch. Add a `CNAME` file containing `tigermonkey.com` only when you're ready to point the domain at this site.
