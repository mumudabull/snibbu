import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
const errors = [], runIds = [];
let active;
await fs.mkdir("generated-artifacts", { recursive: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = active = await desktop.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", async response => {
    if (response.url().endsWith("/api/runs") && response.status() === 201) runIds.push((await response.json()).runId);
  });
  await page.goto("http://localhost:80/");
  assert.equal(await page.title(), "Snibbu the Crab — Cross the Chop");
  await page.locator("#player-name").fill("Keyboard_Check");
  assert.equal(await page.evaluate(() => window.SNIBBU.match.state), "ready", "typing a name must not start gameplay");
  await page.locator("#start-btn").click();
  await page.waitForFunction(() => window.SNIBBU?.match.state === "playing");
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.SNIBBU.match.score >= 10);
  await page.keyboard.press("p");
  await page.waitForFunction(() => window.SNIBBU.match.state === "paused");
  const frozen = await page.evaluate(() => JSON.stringify(window.SNIBBU.match.vehicles));
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => JSON.stringify(window.SNIBBU.match.vehicles)), frozen);
  await page.keyboard.press("p");
  await page.keyboard.press("s"); await page.waitForTimeout(180);
  await page.keyboard.press("a"); await page.waitForTimeout(180);
  await page.keyboard.press("d"); await page.waitForTimeout(180);
  await page.screenshot({ path: "generated-artifacts/upstream-desktop.png" });
  // Complete a real run using real keyboard input; never alter client scores/positions.
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => ["gameover", "victory"].includes(window.SNIBBU.match.state))) break;
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(160);
  }
  await page.waitForFunction(() => ["gameover", "victory"].includes(window.SNIBBU.match.state));
  await page.locator("#submit-status").filter({ hasText: "Saved" }).waitFor();
  await page.locator("#over-board").click();
  await page.locator("#board-list").filter({ hasText: "Keyboard_Check" }).waitFor();
  assert.match(await page.locator("#board-note").innerText(), /practice|ownership/i);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phone = active = await mobile.newPage();
  phone.on("pageerror", error => errors.push(error.message));
  phone.on("response", async response => {
    if (response.url().endsWith("/api/runs") && response.status() === 201) runIds.push((await response.json()).runId);
  });
  await phone.goto("http://localhost:80/");
  await phone.locator("#open-board").tap();
  await phone.locator("#board-list").filter({ hasText: "Keyboard_Check" }).waitFor();
  await phone.locator("#board-back").tap();
  await phone.locator("#player-name").fill("Touch_Check");
  await phone.locator("#start-btn").tap();
  await phone.waitForFunction(() => window.SNIBBU?.match.state === "playing");
  await phone.locator('[data-dir="up"]').tap();
  await phone.waitForFunction(() => window.SNIBBU.match.score >= 10);
  await phone.locator("#pause-btn").tap();
  await phone.waitForFunction(() => window.SNIBBU.match.state === "paused");
  await phone.screenshot({ path: "generated-artifacts/upstream-mobile.png" });
  await phone.locator("#resume-btn").tap();
  // Back onto the safe start bank before testing a sideways native touch swipe.
  await phone.locator('[data-dir="down"]').tap();
  await phone.waitForTimeout(200);
  const box = await phone.locator("#game").boundingBox();
  const before = await phone.evaluate(() => window.SNIBBU.match.player.x);
  const cdp = await mobile.newCDPSession(phone);
  const x = box.x + box.width / 2, y = box.y + box.height * .6;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 60, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await phone.waitForTimeout(200);
  assert.ok(await phone.evaluate(() => window.SNIBBU.match.player.x) < before, "swipe moves Snibbu left");
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  for (const selector of ['[data-dir="up"]', '[data-dir="down"]', "#pause-btn"]) {
    const r = await phone.locator(selector).boundingBox();
    assert.ok(r.height >= 48 && r.y + r.height <= 844, "touch controls visible and at least 48px");
  }
  await phone.locator("#pause-btn").tap();
  await phone.locator("#pause-board").tap();
  await phone.locator("#board-list").filter({ hasText: "Keyboard_Check" }).waitFor();
  await phone.locator("#board-back").tap();
  await phone.locator("#resume-btn").tap();
  for (let i = 0; i < 100; i++) {
    if (await phone.evaluate(() => ["gameover", "victory"].includes(window.SNIBBU.match.state))) break;
    await phone.locator('[data-dir="up"]').tap();
    await phone.waitForTimeout(160);
  }
  await phone.waitForFunction(
    () => ["gameover", "victory"].includes(window.SNIBBU.match.state),
    undefined,
    { timeout: 60000 },
  );
  await phone.locator("#submit-status").filter({ hasText: "Saved" }).waitFor({ timeout: 10000 });
  await phone.locator("#over-board").tap();
  await phone.locator("#board-list").filter({ hasText: "Touch_Check" }).waitFor();

  const manifest = await phone.request.get("http://localhost:80/manifest.webmanifest");
  assert.equal(manifest.status(), 200, "mobile install manifest is available");
  assert.equal((await manifest.json()).display, "standalone");
  await phone.evaluate(() => navigator.serviceWorker.ready);
  await phone.reload();
  await phone.waitForFunction(() => window.SNIBBU?.match.state === "ready");
  assert.ok(
    Number(await phone.evaluate(() => window.localStorage.getItem("snibbu-crab-cross-the-chop-best"))) >= 10,
    "personal best survives a mobile page restart",
  );

  const offline = await mobile.newCDPSession(phone);
  await offline.send("Network.enable");
  await offline.send("Network.emulateNetworkConditions", {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await phone.reload();
  await phone.waitForFunction(() => window.SNIBBU?.match.state === "ready");
  await phone.locator("#start-btn").tap();
  await phone.waitForFunction(() => window.SNIBBU?.match.state === "playing");
  assert.match(await phone.locator("#mode-banner").innerText(), /practice/i);
  await phone.locator('[data-dir="up"]').tap();
  await phone.waitForFunction(() => window.SNIBBU.match.score >= 10);
  assert.ok(
    Number(await phone.evaluate(() => window.localStorage.getItem("snibbu-crab-cross-the-chop-best"))) >= 10,
    "offline mobile play still records the personal best locally",
  );
  await offline.send("Network.emulateNetworkConditions", {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  assert.deepEqual(errors, []);
  console.log("PASS: mobile run saves to shared rankings; app installs as a PWA; personal best persists across reloads; offline practice; keyboard, D-pad, swipe, and pause.");
} catch (error) {
  if (active) {
    await active.screenshot({ path: "generated-artifacts/upstream-browser-failure.png", fullPage: true });
    console.log(await active.locator("body").innerText());
  }
  throw error;
} finally {
  await fs.writeFile("generated-artifacts/upstream-browser-run-ids.json", JSON.stringify(runIds));
  await browser.close();
}
