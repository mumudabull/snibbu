const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../game/js/logic.js");

function settle(match, seconds) {
  const steps = Math.ceil(seconds / 0.016);
  for (let i = 0; i < steps; i++) L.update(match, 0.016);
}

function parkTraffic(match) {
  for (const lane of match.lanes) lane.speed = 0;
  for (const v of match.vehicles) {
    const lane = match.lanes[v.laneId];
    // Park off the side they are not traveling toward, so wrap does not pull them back.
    v.x = lane.dir > 0 ? -4000 : 8000;
  }
}

test("board fills the logical canvas and starts on the bank", () => {
  const m = L.createMatch({ seed: 1 });
  const sum = L.HUD_H + m.lanes.reduce((s, lane) => s + lane.h, 0);
  assert.equal(sum, L.LOGICAL_H);
  assert.equal(m.lanes[0].kind, "goal");
  assert.equal(m.lanes[0].y, L.HUD_H);
  const last = m.lanes[m.lanes.length - 1];
  assert.equal(last.kind, "start");
  assert.equal(last.y + last.h, L.LOGICAL_H);
  assert.equal(m.player.laneIndex, m.lanes.length - 1);
  assert.equal(m.state, "ready");
  assert.equal(m.lives, 3);
  assert.equal(L.hop(m, "up"), false);
});

test("same seed builds the same traffic", () => {
  const a = L.createMatch({ seed: 42 });
  const b = L.createMatch({ seed: 42 });
  assert.deepEqual(
    a.vehicles.map((v) => [v.laneId, Math.round(v.x), v.w]),
    b.vehicles.map((v) => [v.laneId, Math.round(v.x), v.w])
  );
});

test("forward hop scores, edges block, and sideways does not score", () => {
  const m = L.createMatch({ seed: 1 });
  L.start(m);
  parkTraffic(m);
  assert.equal(L.hop(m, "left"), true);
  settle(m, 0.2);
  assert.equal(m.score, 0);
  assert.equal(m.player.col, 3);
  L.debugPlace(m, { laneIndex: m.lanes.length - 1, col: 0 });
  assert.equal(L.hop(m, "left"), false);
  assert.equal(m.player.col, 0);
  L.debugPlace(m, { laneIndex: m.lanes.length - 1, col: L.COLS - 1 });
  assert.equal(L.hop(m, "right"), false);
  L.debugPlace(m, { laneIndex: m.lanes.length - 1, col: 4 });
  assert.equal(L.hop(m, "down"), false);
  assert.equal(L.hop(m, "up"), true);
  settle(m, 0.2);
  assert.equal(m.score, 10);
  assert.equal(m.lanes[m.player.laneIndex].kind, "road");
  assert.equal(m.lives, 3);
});

test("standing on a candle loses a life and a gap does not", () => {
  const m = L.createMatch({ seed: 7 });
  L.start(m);
  for (const lane of m.lanes) lane.speed = 0;
  const candle = m.vehicles.find((v) => m.lanes[v.laneId].kind === "road");
  L.debugPlace(m, {
    laneIndex: candle.laneId,
    x: candle.x + candle.w / 2,
    y: m.lanes[candle.laneId].y + m.lanes[candle.laneId].h / 2,
  });
  L.update(m, 0.016);
  assert.equal(m.lives, 2);
  assert.equal(m.state, "dying");
  assert.equal(m.deathReason, "candle");

  const safe = L.createMatch({ seed: 7 });
  L.start(safe);
  for (const lane of safe.lanes) lane.speed = 0;
  const road = safe.lanes.find((lane) => lane.kind === "road");
  const group = safe.vehicles
    .filter((v) => v.laneId === road.id)
    .sort((a, b) => a.x - b.x);
  let x = null;
  for (let i = 0; i < group.length - 1; i++) {
    const gapStart = group[i].x + group[i].w;
    const gapEnd = group[i + 1].x;
    if (gapEnd - gapStart > 50) {
      x = (gapStart + gapEnd) / 2;
      break;
    }
  }
  assert.ok(x != null);
  L.debugPlace(safe, { laneIndex: road.id, x });
  L.update(safe, 0.016);
  assert.equal(safe.lives, 3);
  assert.equal(safe.state, "playing");
});

test("open water sinks, a bid carries, and the edge stops you out", () => {
  const sunk = L.createMatch({ seed: 3 });
  L.start(sunk);
  for (const lane of sunk.lanes) lane.speed = 0;
  const water = sunk.lanes.find((lane) => lane.kind === "water");
  for (const v of sunk.vehicles) {
    if (v.laneId === water.id) v.x = -3000;
  }
  L.debugPlace(sunk, { laneIndex: water.id, x: L.PLAY_X + L.PLAY_W / 2 });
  L.update(sunk, 0.016);
  assert.equal(sunk.deathReason, "sunk");
  assert.equal(sunk.lives, 2);

  const ride = L.createMatch({ seed: 5 });
  L.start(ride);
  const lane = ride.lanes.find((item) => item.kind === "water");
  const raft = ride.vehicles.find(
    (v) => v.laneId === lane.id && v.x > L.PLAY_X && v.x + v.w < L.PLAY_X + L.PLAY_W
  );
  assert.ok(raft);
  L.debugPlace(ride, { laneIndex: lane.id, x: raft.x + raft.w / 2 });
  L.update(ride, 0.016);
  assert.equal(ride.lives, 3);
  assert.equal(ride.player.riding, raft.id);
  const before = ride.player.x;
  L.update(ride, 0.2);
  assert.ok((ride.player.x - before) * lane.dir > 0);
  assert.equal(ride.state, "playing");

  const edge = L.createMatch({ seed: 5 });
  L.start(edge);
  const leftLane = edge.lanes.find((item) => item.kind === "water" && item.dir === -1);
  const leftRaft = edge.vehicles.find((v) => v.laneId === leftLane.id);
  L.debugPlace(edge, { laneIndex: leftLane.id, x: L.PLAY_X - 12, riding: leftRaft.id });
  L.update(edge, 0.016);
  assert.equal(edge.deathReason, "offscreen");
  assert.equal(edge.state, "dying");
});

test("death respawns, last life ends the run, restart clears the score", () => {
  const m = L.createMatch({ seed: 9 });
  L.start(m);
  for (const lane of m.lanes) lane.speed = 0;
  const candle = m.vehicles.find((v) => m.lanes[v.laneId].kind === "road");
  L.debugPlace(m, { laneIndex: candle.laneId, x: candle.x + candle.w / 2 });
  L.update(m, 0.016);
  assert.equal(m.state, "dying");
  settle(m, 0.8);
  assert.equal(m.state, "playing");
  assert.equal(m.lanes[m.player.laneIndex].kind, "start");
  assert.equal(m.lives, 2);

  m.lives = 1;
  L.debugPlace(m, { laneIndex: candle.laneId, x: candle.x + candle.w / 2 });
  L.update(m, 0.016);
  assert.equal(m.state, "gameover");
  assert.equal(m.lives, 0);

  m.score = 420;
  L.restart(m);
  assert.equal(m.state, "playing");
  assert.equal(m.score, 0);
  assert.equal(m.best, 420);
  assert.equal(m.lives, 3);
  assert.equal(m.round, 1);
  assert.equal(m.lanes[m.player.laneIndex].kind, "start");
});

test("homes fill, a miss bounces, and a full book advances the round", () => {
  const m = L.createMatch({ seed: 4 });
  L.start(m);
  for (const lane of m.lanes) lane.speed = 0;
  const water = m.lanes[1];
  assert.equal(water.kind, "water");

  L.debugPlace(m, { laneIndex: 1, x: L.PLAY_X + 8 });
  assert.equal(L.hop(m, "up"), true);
  settle(m, 0.25);
  assert.equal(m.homes.some((h) => h.filled), false);
  assert.equal(m.lives, 3);
  assert.notEqual(m.player.laneIndex, 0);

  const speedBefore = m.lanes.find((lane) => lane.kind === "road").speed;
  for (const home of m.homes) {
    L.debugPlace(m, { laneIndex: 1, x: home.x + home.w / 2 });
    assert.equal(L.hop(m, "up"), true);
    settle(m, 0.25);
    assert.equal(home.filled, true);
  }
  assert.equal(m.state, "roundclear");
  assert.equal(m.score, 5 * (100 + 25) + 400);
  settle(m, 1.5);
  assert.equal(m.round, 2);
  assert.equal(m.state, "playing");
  assert.equal(m.homes.every((h) => !h.filled), true);
  const speedAfter = m.lanes.find((lane) => lane.kind === "road").speed;
  assert.ok(speedAfter > speedBefore);

  const filled = L.createMatch({ seed: 4 });
  L.start(filled);
  for (const lane of filled.lanes) lane.speed = 0;
  filled.homes[2].filled = true;
  L.debugPlace(filled, { laneIndex: 1, x: filled.homes[2].x + filled.homes[2].w / 2 });
  L.hop(filled, "up");
  settle(filled, 0.25);
  assert.equal(filled.homes.filter((h) => h.filled).length, 1);
  assert.equal(filled.lives, 3);
});

test("pause freezes the board and delta is capped", () => {
  const m = L.createMatch({ seed: 11 });
  L.start(m);
  const x = m.player.x;
  const vx = m.vehicles[0].x;
  L.togglePause(m);
  assert.equal(L.hop(m, "up"), false);
  L.update(m, 0.5);
  assert.equal(m.state, "paused");
  assert.equal(m.player.x, x);
  assert.equal(m.vehicles[0].x, vx);
  L.togglePause(m);
  assert.equal(m.state, "playing");

  const moving = L.createMatch({ seed: 12 });
  L.start(moving);
  const lane = moving.lanes[moving.vehicles[0].laneId];
  const before = moving.vehicles[0].x;
  L.update(moving, 10);
  const moved = Math.abs(moving.vehicles[0].x - before);
  assert.ok(moved <= lane.speed * L.MAX_DT + 0.001);
});

test("traffic gaps stay open after a long run", () => {
  const m = L.createMatch({ seed: 3 });
  L.start(m);
  for (let i = 0; i < 400; i++) L.update(m, 0.05);
  for (const lane of m.lanes) {
    if (lane.kind !== "road" && lane.kind !== "water") continue;
    const group = m.vehicles.filter((v) => v.laneId === lane.id).sort((a, b) => a.x - b.x);
    for (let i = 0; i < group.length - 1; i++) {
      const gap = group[i + 1].x - (group[i].x + group[i].w);
      assert.ok(gap > 20, "lane " + lane.id + " gap " + gap);
    }
    assert.ok(group.length >= 2);
  }
});

test("the opening hop clears the first candle lane", () => {
  for (const seed of [1, 2, 3, 4, 8, 15, 42, 99, 500]) {
    const m = L.createMatch({ seed });
    L.start(m);
    assert.equal(L.hop(m, "up"), true);
    for (let i = 0; i < 20; i++) L.update(m, 0.016);
    assert.equal(m.lives, 3, "seed " + seed + " " + m.deathReason);
    assert.equal(m.lanes[m.player.laneIndex].kind, "road");
    assert.equal(m.score, 10, "seed " + seed);
  }
});

test("the title screen does not close the opening gap", () => {
  const m = L.createMatch({ seed: 4 });
  for (let i = 0; i < 200; i++) L.update(m, 0.05);
  assert.equal(m.state, "ready");
  L.start(m);
  assert.equal(L.hop(m, "up"), true);
  for (let i = 0; i < 20; i++) L.update(m, 0.016);
  assert.equal(m.lives, 3);
  assert.equal(m.score, 10);
});

test("round 1 leaves a gap above the start column", () => {
  for (const seed of [1, 2, 3, 4, 7, 9, 11, 42, 99, 1234]) {
    const m = L.createMatch({ seed });
    const road = m.lanes.filter((lane) => lane.kind === "road").pop();
    const box = { x: m.player.x - 18, y: road.y, w: 36, h: road.h };
    for (const v of m.vehicles) {
      if (v.laneId !== road.id) continue;
      assert.equal(L.aabb(box, v), false, "seed " + seed + " vehicle " + v.id);
    }
  }
});

test("rectangles overlap only when they actually touch", () => {
  assert.equal(L.aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 4, h: 4 }), true);
  assert.equal(L.aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 4, h: 4 }), false);
});
