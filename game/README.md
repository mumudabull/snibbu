# SNIBBU: Cross the Chop

A Frogger-style arcade game about Snibbu, the yellow crab. Hop candle traffic, ride the moving bids across the river, and fill every gold slot. It runs in a phone or desktop browser from static files. Nothing here phones home, connects a wallet, or promises a return.

## Play

From this folder:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/` (or `http://localhost:8080/game/` if you started the server from the repository root).

You can also open `index.html` directly. Scripts are classic files, and the crab image is loaded from `assets/snibbu.png` next to the page, so the game does not need a network connection at runtime.

## Controls

- Desktop: arrow keys or WASD. `P` or `Escape` pauses, `R` restarts, `M` toggles sound, `Enter` or `Space` starts.
- Phone: swipe on the board, or the large D-pad. Tap the board to hop up. Pause, restart, and sound are buttons.
- Sound stays off until you turn it on. The choice is remembered on this device.
- Best score is stored in `localStorage` under `snibbu-cross-the-chop-best`.

Leaving the tab pauses a live game.

## Host or embed

Upload the `game/` directory to any static host. There is no build step and no runtime dependency.

```html
<iframe src="https://example.com/game/" title="SNIBBU: Cross the Chop" width="480" height="820" style="border:0; max-width:100%"></iframe>
```

Give the frame enough height for the board plus the D-pad (about 760px or more on a phone). The canvas keeps one logical size, so collisions do not change when the page is resized.

## Tests

From the repository root:

```bash
npm test
```

That checks hops, candle hits, water, bids, lives, homes, round speed, pause, and the delta cap. It does not need a browser.

## Art

The player is Snibbu, cropped from the owner's artwork (tuxedo crab, transparent background) and drawn with `drawImage` each frame. If that file fails to load, the game draws a yellow crab and keeps going. Candles, bids, and the board are drawn in the canvas. This is not a Frogger port and it does not use those assets.
