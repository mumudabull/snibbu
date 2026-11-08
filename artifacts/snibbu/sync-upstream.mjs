import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(root, "../../lib/snibbu-upstream/game");
await mkdir(path.join(root, "public"), { recursive: true });
for (const dir of ["assets", "css", "js"]) {
  await cp(path.join(source, dir), path.join(root, "public", dir), { recursive: true });
}
let html = await readFile(path.join(source, "index.html"), "utf8");
html = html.replace(
  '<p id="mode-banner"',
  '<p class="ownership-notice">Practice only · Contest disabled. Display names do not prove prize ownership. No prizes or contest dates have been announced.</p>\n    <p id="mode-banner"',
);
html = html.replace("</head>", '<meta property="og:title" content="Snibbu the Crab — Cross the Chop"><meta property="og:description" content="The original 99-level Snibbu arcade game. Practice only. Shared gameplay-verified rankings."></head>');
html = html.replace(
  '<link rel="icon" href="assets/favicon.png">',
  '<link rel="icon" href="assets/favicon.png">\n  <link rel="apple-touch-icon" href="assets/app-icon-192.png">\n  <link rel="manifest" href="./manifest.webmanifest">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n  <meta name="apple-mobile-web-app-title" content="Snibbu Crab">',
);
html = html.replace(
  '<p class="keys">Arrows or WASD · swipe or the D-pad</p>',
  '<p class="keys">Arrows or WASD · swipe or the D-pad</p>\n          <p class="install-tip">Best score saves on this phone. Finish a run online to add it to shared practice rankings.</p>\n          <p class="install-tip">iPhone: Share → Add to Home Screen to install.</p>',
);
html = html.replace(
  "</body>",
  '  <script>if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("./service-worker.js").catch(function () {}); });</script>\n</body>',
);
await writeFile(path.join(root, "index.html"), html);
let game = await readFile(path.join(source, "js/game.js"), "utf8");
game = game
  .replace('  function onKey(e) {\n', '  function onKey(e) {\n    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;\n')
  .replace("Official run — score is checked by the server.", "Verified practice run — contest disabled.")
  .replace("Shared leaderboard is reachable. Start an official run to be ranked.", "Shared practice leaderboard ready. Contest disabled.")
  .replace("Shared leaderboard. Contest is not open, so this is not a prize list.", "Practice rankings only. A display name does not prove prize ownership.")
  .replace("Saved on the shared leaderboard.", "Saved to shared practice rankings. Not a contest entry.")
  .replace("  window.SNIBBU = {", '  setInterval(function () { if (boardOpen) refreshBoard(); }, 15000);\n\n  window.SNIBBU = {');
await writeFile(path.join(root, "public/js/game.js"), game);
await writeFile(path.join(root, "public/css/game.css"),
  await readFile(path.join(source, "css/game.css"), "utf8") +
  "\n.ownership-notice{margin:0;text-align:center;font-size:10px;line-height:1.3;color:#ffe14a;flex-shrink:0;padding:2px 8px;}\n.install-tip{margin:5px 0 0;font-size:11px;line-height:1.35;color:#c6d0e0;}\n");
