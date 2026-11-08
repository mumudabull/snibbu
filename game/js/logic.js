/* Snibbu the Crab — Cross the Chop
   Rules, lanes, and collision. No DOM.
   Browser attaches SnibbuLogic; Node and the leaderboard server require() this file
   so a submitted run is replayed with the same physics. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SnibbuLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LOGICAL_W = 480;
  var LOGICAL_H = 706;
  var HUD_H = 74;
  var COLS = 9;
  var CELL = 46;
  var PLAY_W = COLS * CELL;
  var PLAY_X = (LOGICAL_W - PLAY_W) / 2;
  var PLAYER_SIZE = 30;
  var MAX_DT = 0.05;
  var HOP_TIME = 0.13;
  var GAME_TITLE = "Snibbu the Crab — Cross the Chop";
  var MAX_LEVEL = 99;
  var VICTORY_BONUS = 5000;
  var BEST_KEY = "snibbu-crab-cross-the-chop-best";
  var SOUND_KEY = "snibbu-crab-cross-the-chop-sound";
  var LEGACY_BEST_KEY = "snibbu-cross-the-chop-best";
  var MAX_SPEED = 190;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function colCenter(col) {
    return PLAY_X + col * CELL + CELL / 2;
  }

  function playerBox(p) {
    return {
      x: p.x - PLAYER_SIZE / 2,
      y: p.y - PLAYER_SIZE / 2,
      w: PLAYER_SIZE,
      h: PLAYER_SIZE,
    };
  }

  function candleBox(v) {
    var insetX = 5;
    var insetY = 3;
    return {
      x: v.x + insetX,
      y: v.y + insetY,
      w: Math.max(8, v.w - insetX * 2),
      h: Math.max(8, v.h - insetY * 2),
    };
  }

  function addScore(match, n) {
    match.score += n;
    if (match.score > match.best) {
      match.best = match.score;
      match.events.push("best");
    }
  }

  function levelTuning(level) {
    level = clamp(level | 0, 1, MAX_LEVEL);
    var t = (level - 1) / (MAX_LEVEL - 1);
    var eased = 1 - Math.pow(1 - t, 1.25);
    var breather = level % 10 === 0;
    var ease = breather ? Math.max(0, eased - 0.1) : eased;
    return {
      level: level,
      eased: ease,
      breather: breather,
      base: 54 + ease * 62,
      gapShrink: Math.round(ease * 32),
      lengthShrink: Math.round(ease * 8),
      phase: (level - 1) % 4,
      spice: (level - 1) % 5,
    };
  }

  function homePoints(level) {
    return 80 + clamp(level | 0, 1, MAX_LEVEL) * 20;
  }

  function clearPoints(level) {
    return 250 + clamp(level | 0, 1, MAX_LEVEL) * 25;
  }

  function shareText(row) {
    var level = row && row.level != null ? row.level : 1;
    var score = row && row.score != null ? row.score : 0;
    return GAME_TITLE + " — Score " + score + " · Level " + level + " / " + MAX_LEVEL;
  }

  function buildBoard(level, rng) {
    var tune = levelTuning(level);
    var lanes = [];
    var base = tune.base;
    var gapShrink = tune.gapShrink;
    var lengthShrink = tune.lengthShrink;

    function add(lane) {
      lane.id = lanes.length;
      lanes.push(lane);
      return lane;
    }

    add({ kind: "goal", h: 74 });

    var waters = [
      { dir: 1, mul: 0.92, len: 156, gap: 118 },
      { dir: -1, mul: 0.78, len: 124, gap: 108 },
      { dir: 1, mul: 1.12, len: 172, gap: 102 },
      { dir: -1, mul: 0.96, len: 138, gap: 112 },
    ];
    var roads = [
      { dir: -1, mul: 1.0, len: 84, gap: 176, color: "green" },
      { dir: 1, mul: 1.38, len: 56, gap: 148, color: "red" },
      { dir: -1, mul: 0.86, len: 108, gap: 196, color: "red" },
      { dir: 1, mul: 1.52, len: 50, gap: 132, color: "green" },
      { dir: -1, mul: 0.78, len: 64, gap: 220, color: "red" },
    ];
    if (tune.phase % 2 === 1) {
      for (var pi = 0; pi < roads.length; pi++) roads[pi].dir *= -1;
      for (var pw = 0; pw < waters.length; pw++) waters[pw].dir *= -1;
    }
    if (tune.phase >= 2) {
      for (var ci = 0; ci < roads.length; ci++) {
        roads[ci].color = roads[ci].color === "red" ? "green" : "red";
      }
    }
    roads[tune.spice % roads.length].mul += 0.1;
    waters[tune.spice % waters.length].mul += 0.08;
    for (var wi = 0; wi < waters.length; wi++) {
      var w = waters[wi];
      add({
        kind: "water",
        h: 50,
        dir: w.dir,
        speed: Math.min(MAX_SPEED, base * 0.68 * w.mul),
        length: Math.max(100, w.len - lengthShrink),
        gap: Math.max(90, w.gap - gapShrink),
      });
    }

    add({ kind: "median", h: 46 });

    for (var ri = 0; ri < roads.length; ri++) {
      var r = roads[ri];
      add({
        kind: "road",
        h: 50,
        dir: r.dir,
        speed: Math.min(MAX_SPEED, base * r.mul),
        length: r.len,
        gap: Math.max(110, r.gap - gapShrink),
        color: r.color,
      });
    }

    add({ kind: "start", h: 62 });

    var y = HUD_H;
    for (var i = 0; i < lanes.length; i++) {
      lanes[i].y = y;
      y += lanes[i].h;
    }

    var vehicles = [];
    for (var li = 0; li < lanes.length; li++) {
      var lane = lanes[li];
      if (lane.kind !== "road" && lane.kind !== "water") continue;
      var step = lane.length + lane.gap;
      var span = PLAY_W + step + lane.length;
      var count = Math.ceil(span / step) + 1;
      var x = PLAY_X - lane.length - rng() * lane.gap;
      for (var n = 0; n < count; n++) {
        var vh = lane.kind === "road" ? lane.h * 0.64 : lane.h * 0.62;
        vehicles.push({
          id: vehicles.length,
          laneId: lane.id,
          x: x,
          y: lane.y + (lane.h - vh) / 2,
          w: lane.length,
          h: vh,
          color: lane.color || "wood",
        });
        x += step;
      }
    }

    var bottomRoad = null;
    for (var b = lanes.length - 1; b >= 0; b--) {
      if (lanes[b].kind === "road") {
        bottomRoad = lanes[b];
        break;
      }
    }
    if (bottomRoad) clearOpening(bottomRoad, vehicles, colCenter((COLS / 2) | 0));

    var goal = lanes[0];
    var homes = [];
    var homeCount = 5;
    var slotW = 50;
    var slotH = 54;
    var gap = (PLAY_W - homeCount * slotW) / (homeCount + 1);
    for (var h = 0; h < homeCount; h++) {
      homes.push({
        i: h,
        x: PLAY_X + gap + h * (slotW + gap),
        y: goal.y + (goal.h - slotH) / 2 + 2,
        w: slotW,
        h: slotH,
        filled: false,
      });
    }

    return { lanes: lanes, vehicles: vehicles, homes: homes };
  }

  function clearOpening(lane, vehicles, targetX) {
    var group = [];
    for (var i = 0; i < vehicles.length; i++) {
      if (vehicles[i].laneId === lane.id) group.push(vehicles[i]);
    }
    if (!group.length) return;
    var step = lane.length + lane.gap;
    var shift = 0;
    var found = false;
    for (var s = 0; s < step; s += 4) {
      var hit = false;
      for (var g = 0; g < group.length; g++) {
        var left = group[g].x + s;
        if (targetX > left - 52 && targetX < left + group[g].w + 52) hit = true;
      }
      if (!hit) {
        shift = s;
        found = true;
        break;
      }
    }
    if (!found) return;
    for (var k = 0; k < group.length; k++) group[k].x += shift;
  }

  function placePlayer(match, laneIndex) {
    var lane = match.lanes[laneIndex];
    var col = (COLS / 2) | 0;
    var prev = match.player;
    match.player = {
      laneIndex: laneIndex,
      col: col,
      x: colCenter(col),
      y: lane.y + lane.h / 2,
      facing: "up",
      hop: null,
      buffer: null,
      riding: null,
      blinkUntil: prev && prev.blinkUntil ? prev.blinkUntil : 0,
      landedAt: match.time || 0,
    };
  }

  function createMatch(opts) {
    opts = opts || {};
    var seed = (opts.seed == null ? 1 : opts.seed) >>> 0;
    var match = {
      seed: seed,
      rng: mulberry32(seed),
      level: 1,
      maxLevel: 1,
      score: 0,
      best: opts.best || 0,
      lives: 3,
      state: "ready",
      events: [],
      timer: 0,
      deathReason: null,
      time: 0,
    };
    var board = buildBoard(1, match.rng);
    match.lanes = board.lanes;
    match.vehicles = board.vehicles;
    match.homes = board.homes;
    match.player = null;
    placePlayer(match, match.lanes.length - 1);
    return match;
  }

  function start(match) {
    if (match.state === "gameover" || match.state === "victory") {
      restart(match);
      return;
    }
    if (match.state === "ready" || match.state === "paused") match.state = "playing";
  }

  function restart(match) {
    var best = Math.max(match.best, match.score);
    var seed = (match.seed + 997) >>> 0;
    var next = createMatch({ seed: seed, best: best });
    next.state = "playing";
    var keys = Object.keys(match);
    for (var i = 0; i < keys.length; i++) delete match[keys[i]];
    Object.assign(match, next);
  }

  function togglePause(match) {
    if (match.state === "playing") {
      match.state = "paused";
      match.events.push("pause");
      return;
    }
    if (match.state === "paused") match.state = "playing";
  }

  function hitsCandle(match) {
    var box = playerBox(match.player);
    var vehicles = match.vehicles;
    for (var i = 0; i < vehicles.length; i++) {
      var v = vehicles[i];
      var lane = match.lanes[v.laneId];
      if (lane.kind !== "road") continue;
      if (aabb(box, candleBox(v))) return true;
    }
    return false;
  }

  function findRaft(match) {
    var box = playerBox(match.player);
    var best = null;
    var bestOverlap = 0;
    var vehicles = match.vehicles;
    for (var i = 0; i < vehicles.length; i++) {
      var v = vehicles[i];
      if (v.laneId !== match.player.laneIndex) continue;
      if (match.lanes[v.laneId].kind !== "water") continue;
      var overlap = Math.min(box.x + box.w, v.x + v.w) - Math.max(box.x, v.x);
      if (overlap >= 12 && overlap > bestOverlap) {
        best = v;
        bestOverlap = overlap;
      }
    }
    return best;
  }

  function kill(match, reason) {
    if (match.state !== "playing") return;
    var p = match.player;
    p.hop = null;
    p.buffer = null;
    p.riding = null;
    match.lives -= 1;
    match.deathReason = reason;
    match.events.push("die");
    if (match.lives <= 0) {
      match.state = "gameover";
      match.events.push("gameover");
    } else {
      match.state = "dying";
      match.timer = 0.72;
    }
  }

  function finishDeath(match) {
    placePlayer(match, match.lanes.length - 1);
    match.player.blinkUntil = match.time + 0.85;
    match.player.facing = "up";
    match.state = "playing";
  }

  function dropToMedian(match) {
    var median = -1;
    for (var i = 0; i < match.lanes.length; i++) {
      if (match.lanes[i].kind === "median") median = i;
    }
    var p = match.player;
    var lane = match.lanes[median];
    var col = clamp(Math.round((p.x - PLAY_X) / CELL - 0.5), 0, COLS - 1);
    p.laneIndex = median;
    p.col = col;
    p.x = colCenter(col);
    p.y = lane.y + lane.h / 2;
    p.hop = null;
    p.riding = null;
    p.landedAt = match.time;
    match.events.push("bounce");
  }

  function finishHop(match) {
    var p = match.player;
    var hop = p.hop;
    p.x = hop.toX;
    p.y = hop.toY;
    p.laneIndex = hop.toLane;
    p.col = hop.toCol;
    p.hop = null;
    p.landedAt = match.time;
    var lane = match.lanes[p.laneIndex];

    if (lane.kind === "road" && hitsCandle(match)) {
      kill(match, "candle");
      return;
    }

    if (lane.kind === "water") {
      var raft = findRaft(match);
      if (!raft) {
        kill(match, "sunk");
        return;
      }
      p.riding = raft.id;
      if (hop.scored) addScore(match, 10);
    } else if (lane.kind === "goal") {
      var home = null;
      for (var i = 0; i < match.homes.length; i++) {
        var slot = match.homes[i];
        if (p.x >= slot.x && p.x <= slot.x + slot.w && p.y >= slot.y && p.y <= slot.y + slot.h) {
          home = slot;
          break;
        }
      }
      if (!home || home.filled) {
        var prev = match.lanes[hop.fromLane];
        p.x = hop.fromX;
        p.y = hop.fromY;
        p.laneIndex = hop.fromLane;
        p.col = hop.fromCol;
        if (prev.kind === "water") {
          var back = findRaft(match);
          if (!back) dropToMedian(match);
          else {
            p.riding = back.id;
            match.events.push("bounce");
          }
        } else {
          p.riding = null;
          match.events.push("bounce");
        }
      } else {
        home.filled = true;
        match.lastHome = { x: home.x + home.w / 2, y: home.y + home.h / 2 };
        addScore(match, homePoints(match.level));
        match.events.push("home");
        if (match.homes.every(function (slot) { return slot.filled; })) {
          addScore(match, clearPoints(match.level));
          if (match.level >= MAX_LEVEL) {
            addScore(match, VICTORY_BONUS);
            match.state = "victory";
            match.events.push("victory");
          } else {
            match.state = "levelclear";
            match.timer = 1.2;
            match.events.push("level");
          }
        } else {
          placePlayer(match, match.lanes.length - 1);
          match.player.blinkUntil = match.time + 0.45;
        }
      }
    } else {
      p.riding = null;
      if (hop.scored) addScore(match, 10);
    }

    if (p.buffer && match.state === "playing" && !match.player.hop) {
      var dir = p.buffer;
      p.buffer = null;
      hopDir(match, dir);
    }
  }

  function hopDir(match, dir) {
    if (match.state !== "playing") return false;
    var p = match.player;
    if (p.hop) {
      p.buffer = dir;
      return true;
    }
    var lanes = match.lanes;
    var toLane = p.laneIndex;
    var toX = p.x;
    var toCol = p.col;
    if (dir === "up") toLane = p.laneIndex - 1;
    if (dir === "down") toLane = p.laneIndex + 1;
    if (toLane < 0 || toLane >= lanes.length) return false;

    var fromLane = lanes[p.laneIndex];
    var dest = lanes[toLane];
    if (dir === "left" || dir === "right") {
      var sign = dir === "left" ? -1 : 1;
      if (fromLane.kind === "water") {
        toX = p.x + sign * CELL;
        var half = PLAYER_SIZE / 2;
        if (toX - half < PLAY_X || toX + half > PLAY_X + PLAY_W) return false;
      } else {
        toCol = p.col + sign;
        if (toCol < 0 || toCol >= COLS) return false;
        toX = colCenter(toCol);
      }
    } else if (dest.kind === "water" && fromLane.kind === "water") {
      toX = p.x;
    } else if (dest.kind === "water") {
      toX = colCenter(p.col);
    } else if (fromLane.kind === "water" && dest.kind === "goal") {
      toX = p.x;
      toCol = clamp(Math.round((p.x - PLAY_X) / CELL - 0.5), 0, COLS - 1);
    } else if (fromLane.kind === "water") {
      toCol = clamp(Math.round((p.x - PLAY_X) / CELL - 0.5), 0, COLS - 1);
      toX = colCenter(toCol);
    } else {
      toX = colCenter(p.col);
    }

    p.hop = {
      fromX: p.x,
      fromY: p.y,
      fromLane: p.laneIndex,
      fromCol: p.col,
      toX: toX,
      toY: dest.y + dest.h / 2,
      toLane: toLane,
      toCol: toCol,
      dir: dir,
      t: 0,
      scored: toLane < p.laneIndex,
    };
    p.facing = dir;
    p.riding = null;
    match.events.push("hop");
    return true;
  }

  function moveVehicles(match, dt) {
    var lanes = match.lanes;
    var dxByLane = {};
    for (var i = 0; i < lanes.length; i++) {
      var lane = lanes[i];
      if (lane.kind === "road" || lane.kind === "water") {
        dxByLane[lane.id] = lane.speed * lane.dir * dt;
      }
    }
    var vehicles = match.vehicles;
    for (var v = 0; v < vehicles.length; v++) {
      vehicles[v].x += dxByLane[vehicles[v].laneId] || 0;
    }
    return dxByLane;
  }

  function wrapVehicles(match) {
    var rightBound = PLAY_X + PLAY_W + 36;
    var leftBound = PLAY_X - 36;
    for (var i = 0; i < match.lanes.length; i++) {
      var lane = match.lanes[i];
      if (lane.kind !== "road" && lane.kind !== "water") continue;
      var group = [];
      for (var v = 0; v < match.vehicles.length; v++) {
        if (match.vehicles[v].laneId === lane.id) group.push(match.vehicles[v]);
      }
      if (!group.length) continue;
      if (lane.dir > 0) {
        group.sort(function (a, b) { return b.x - a.x; });
        for (var a = 0; a < group.length; a++) {
          var veh = group[a];
          if (veh.x > rightBound) {
            var minX = group[0].x;
            for (var k = 1; k < group.length; k++) minX = Math.min(minX, group[k].x);
            veh.x = minX - lane.gap - veh.w;
          }
        }
      } else {
        group.sort(function (a, b) { return a.x - b.x; });
        for (var b = 0; b < group.length; b++) {
          var leftVeh = group[b];
          if (leftVeh.x + leftVeh.w < leftBound) {
            var maxRight = group[0].x + group[0].w;
            for (var j = 1; j < group.length; j++) {
              maxRight = Math.max(maxRight, group[j].x + group[j].w);
            }
            leftVeh.x = maxRight + lane.gap;
          }
        }
      }
    }
  }

  function rideOrSink(match, dxByLane) {
    var p = match.player;
    var lane = match.lanes[p.laneIndex];
    if (lane.kind !== "water") {
      p.riding = null;
      if (lane.kind === "road" && hitsCandle(match)) kill(match, "candle");
      return;
    }
    if (p.riding != null) p.x += dxByLane[lane.id] || 0;
    if (p.x < PLAY_X - 8 || p.x > PLAY_X + PLAY_W + 8) {
      kill(match, "offscreen");
      return;
    }
    var raft = findRaft(match);
    if (!raft) kill(match, "sunk");
    else p.riding = raft.id;
  }

  function advanceLevel(match) {
    if (match.level >= MAX_LEVEL) {
      match.state = "victory";
      match.events.push("victory");
      return;
    }
    match.level += 1;
    if (match.level > match.maxLevel) match.maxLevel = match.level;
    if ((match.level - 1) % 10 === 0 && match.lives < 5) {
      match.lives += 1;
      match.events.push("life");
    }
    var board = buildBoard(match.level, match.rng);
    match.lanes = board.lanes;
    match.vehicles = board.vehicles;
    match.homes = board.homes;
    placePlayer(match, match.lanes.length - 1);
    match.player.blinkUntil = match.time + 0.6;
    match.state = "playing";
  }

  function update(match, dt) {
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    match.time += dt;
    if (match.state === "paused") return;

    if (match.state === "dying") {
      match.timer -= dt;
      if (match.timer <= 0) finishDeath(match);
      return;
    }
    if (match.state === "levelclear") {
      match.timer -= dt;
      if (match.timer <= 0) advanceLevel(match);
      return;
    }
    if (match.state === "victory") return;

    var scenery = match.state === "playing" || match.state === "gameover";
    if (!scenery) return;
    var dxByLane = moveVehicles(match, dt);

    if (match.state === "playing") {
      var p = match.player;
      if (p.hop) {
        p.hop.t += dt / HOP_TIME;
        var t = Math.min(1, p.hop.t);
        var e = t * t * (3 - 2 * t);
        p.x = p.hop.fromX + (p.hop.toX - p.hop.fromX) * e;
        p.y = p.hop.fromY + (p.hop.toY - p.hop.fromY) * e;
        if (hitsCandle(match)) kill(match, "candle");
        else if (t >= 1 && match.state === "playing") finishHop(match);
      } else {
        rideOrSink(match, dxByLane);
      }
    }

    if (match.state !== "dying") wrapVehicles(match);
  }

  function debugSetLevel(match, level) {
    level = clamp(level | 0, 1, MAX_LEVEL);
    match.level = level;
    if (level > (match.maxLevel || 1)) match.maxLevel = level;
    var board = buildBoard(level, match.rng);
    match.lanes = board.lanes;
    match.vehicles = board.vehicles;
    match.homes = board.homes;
    placePlayer(match, match.lanes.length - 1);
    match.state = "playing";
    match.timer = 0;
    match.deathReason = null;
    return match;
  }

  function stepFrame(match, dtMs, hop) {
    var applied = null;
    if (hop && match.state === "playing" && match.player && !match.player.hop) {
      if (hopDir(match, hop)) applied = hop;
    }
    var ms = dtMs | 0;
    if (ms < 0) ms = 0;
    update(match, ms / 1000);
    return applied;
  }

  function replay(seed, frames) {
    var match = createMatch({ seed: seed });
    start(match);
    var totalMs = 0;
    var hopCount = 0;
    var list = frames || [];
    for (var i = 0; i < list.length; i++) {
      var frame = list[i] || {};
      var dt = frame.dt | 0;
      if (dt < 0) dt = 0;
      totalMs += dt;
      var applied = stepFrame(match, dt, frame.hop || null);
      if (applied) hopCount += 1;
    }
    return {
      score: match.score,
      level: match.level,
      state: match.state,
      victory: match.state === "victory",
      lives: match.lives,
      totalMs: totalMs,
      hopCount: hopCount,
    };
  }

  function debugPlace(match, spec) {
    var p = match.player;
    if (spec.laneIndex != null) {
      p.laneIndex = spec.laneIndex;
      var lane = match.lanes[p.laneIndex];
      p.y = spec.y != null ? spec.y : lane.y + lane.h / 2;
    } else if (spec.y != null) p.y = spec.y;
    if (spec.col != null) {
      p.col = spec.col;
      p.x = colCenter(spec.col);
    } else if (spec.x != null) p.x = spec.x;
    p.hop = null;
    p.buffer = null;
    p.riding = spec.riding != null ? spec.riding : null;
    return p;
  }

  return {
    LOGICAL_W: LOGICAL_W,
    LOGICAL_H: LOGICAL_H,
    HUD_H: HUD_H,
    COLS: COLS,
    CELL: CELL,
    PLAY_W: PLAY_W,
    PLAY_X: PLAY_X,
    PLAYER_SIZE: PLAYER_SIZE,
    MAX_DT: MAX_DT,
    HOP_TIME: HOP_TIME,
    GAME_TITLE: GAME_TITLE,
    MAX_LEVEL: MAX_LEVEL,
    MAX_SPEED: MAX_SPEED,
    VICTORY_BONUS: VICTORY_BONUS,
    BEST_KEY: BEST_KEY,
    SOUND_KEY: SOUND_KEY,
    LEGACY_BEST_KEY: LEGACY_BEST_KEY,
    levelTuning: levelTuning,
    homePoints: homePoints,
    clearPoints: clearPoints,
    shareText: shareText,
    debugSetLevel: debugSetLevel,
    stepFrame: stepFrame,
    replay: replay,
    aabb: aabb,
    colCenter: colCenter,
    playerBox: playerBox,
    createMatch: createMatch,
    start: start,
    restart: restart,
    togglePause: togglePause,
    hop: hopDir,
    update: update,
    debugPlace: debugPlace,
    hitsCandle: hitsCandle,
    findRaft: findRaft,
  };
});
