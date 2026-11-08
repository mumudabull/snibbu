/* Snibbu the Crab — Cross the Chop
   Canvas presentation, input, and sound. Rules live in logic.js.
   Official runs record each frame and the server replays that log.
   Sprite: preload with Image(), draw with drawImage in the main loop. */
(function () {
  "use strict";

  var L = window.SnibbuLogic;
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var stage = document.getElementById("stage");
  var overlay = document.getElementById("overlay");
  var toast = document.getElementById("toast");
  var statusEl = document.getElementById("status");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var frogSprite = new Image();
  var spriteReady = false;
  frogSprite.onload = function () { spriteReady = true; };
  frogSprite.onerror = function () {
    frogSprite.failed = true;
    spriteReady = false;
    console.warn("Snibbu sprite failed to load; using the drawn crab.");
  };
  frogSprite.src = "assets/snibbu.png";

  var storedBest = 0;
  var soundOn = false;
  var savedName = "";
  try {
    var savedScore = Number(localStorage.getItem(L.BEST_KEY));
    if (!isFinite(savedScore) || savedScore <= 0) savedScore = Number(localStorage.getItem(L.LEGACY_BEST_KEY));
    if (isFinite(savedScore) && savedScore > 0) storedBest = savedScore;
    soundOn = localStorage.getItem(L.SOUND_KEY) === "on";
    savedName = localStorage.getItem("snibbu-crab-cross-the-chop-name") || "";
  } catch (err) { /* private mode */ }

  var match = L.createMatch({
    seed: (Math.random() * 1e9) >>> 0,
    best: storedBest,
  });

  var audioCtx = null;
  var particles = [];
  var shake = 0;
  var flash = 0;
  var holdDir = null;
  var holdDelay = 0;
  var lastTs = 0;
  var toastText = "";
  var lastStatus = "";
  var inputQueue = [];
  var frameLog = [];
  var official = false;
  var runId = null;
  var logClosed = true;
  var submitState = "idle";
  var submitError = "";
  var serverResult = null;
  var boardOpen = false;
  var bootPromise = null;
  var practiceOnly = window.SNIBBU_PRACTICE_ONLY === true;
  var serverReachable = practiceOnly ? false : null;

  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function blip(freq, dur, type, gain, slide) {
    if (!soundOn || !audioCtx) return;
    var t = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var amp = audioCtx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
    amp.gain.setValueAtTime(gain || 0.04, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function playEvent(name) {
    if (name === "hop") blip(540, 0.05, "square", 0.03, 780);
    else if (name === "die") blip(210, 0.2, "sawtooth", 0.05, 55);
    else if (name === "home") {
      blip(523, 0.08, "square", 0.04);
      blip(784, 0.12, "square", 0.035);
    } else if (name === "round") {
      blip(523, 0.09, "square", 0.045);
      setTimeout(function () { blip(659, 0.09, "square", 0.04); }, 90);
      setTimeout(function () { blip(880, 0.16, "square", 0.04); }, 180);
    } else if (name === "bounce") blip(170, 0.05, "square", 0.025);
    else if (name === "gameover") blip(150, 0.35, "sawtooth", 0.05, 42);
  }

  function saveBest() {
    try { localStorage.setItem(L.BEST_KEY, String(match.best)); } catch (err) {}
  }

  function setSound(on) {
    soundOn = on;
    var btn = document.getElementById("sound-btn");
    btn.textContent = soundOn ? "SOUND ON" : "SOUND OFF";
    btn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem(L.SOUND_KEY, soundOn ? "on" : "off"); } catch (err) {}
  }

  function burst(x, y, color) {
    var count = reduceMotion ? 6 : 16;
    for (var i = 0; i < count; i++) {
      var a = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      var s = 50 + Math.random() * 140;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 30,
        life: 0.35 + Math.random() * 0.3,
        color: color,
      });
    }
  }

  function say(text) {
    if (text === lastStatus) return;
    lastStatus = text;
    statusEl.textContent = text;
  }

  function showToast(text, bad) {
    if (text === toastText && !toast.hidden) return;
    toastText = text || "";
    if (!text) {
      toast.hidden = true;
      return;
    }
    toast.hidden = false;
    toast.textContent = text;
    toast.className = bad ? "bad" : "";
  }

  function scoreNow() {
    if (serverResult && serverResult.score != null) return serverResult.score;
    return match.score;
  }

  function levelNow() {
    if (serverResult && serverResult.level != null) return serverResult.level;
    return match.level;
  }

  function submitMessage(target) {
    var el = document.getElementById(target);
    if (!official) {
      el.textContent = "Practice only. This run cannot be submitted.";
      return;
    }
    if (submitState === "saving") el.textContent = "Saving to the shared leaderboard…";
    else if (submitState === "saved") {
      el.textContent = serverResult && serverResult.reviewStatus === "flagged"
        ? "Saved. This run is flagged for review and is not prize-eligible."
        : "Saved on the shared leaderboard.";
    } else if (submitState === "error") el.textContent = submitError || "Could not reach the leaderboard.";
    else el.textContent = "";
  }

  function syncOverlay() {
    var ready = document.getElementById("card-ready");
    var paused = document.getElementById("card-paused");
    var over = document.getElementById("card-over");
    var victory = document.getElementById("card-victory");
    var board = document.getElementById("card-board");
    var state = match.state;
    var showCard = boardOpen || state === "ready" || state === "paused" || state === "gameover" || state === "victory";
    overlay.hidden = !showCard;
    ready.hidden = boardOpen || state !== "ready";
    paused.hidden = boardOpen || state !== "paused";
    over.hidden = boardOpen || state !== "gameover";
    victory.hidden = boardOpen || state !== "victory";
    board.hidden = !boardOpen;
    var banner = document.getElementById("mode-banner");
    if (practiceOnly) banner.textContent = "Practice only — this copy cannot submit official results.";
    else if (serverReachable === null) banner.textContent = "Checking the shared leaderboard…";
    else if (!serverReachable) banner.textContent = "Practice — the shared leaderboard is not reachable from here.";
    else if (official) banner.textContent = "Official run — score is checked by the server.";
    else banner.textContent = "Shared leaderboard is reachable. Start an official run to be ranked.";
    if (state === "gameover") {
      document.getElementById("final-level").textContent = "Level " + levelNow() + " / " + L.MAX_LEVEL;
      document.getElementById("final-score").textContent = "SCORE " + scoreNow();
      document.getElementById("final-best").textContent = "BEST " + match.best;
      submitMessage("submit-status");
      document.getElementById("retry-submit").hidden = submitState !== "error";
      say("Stopped out. Score " + scoreNow() + ". Level " + levelNow() + ".");
      showToast("", false);
    } else if (state === "victory") {
      document.getElementById("victory-score").textContent = "SCORE " + scoreNow();
      submitMessage("victory-status");
      document.getElementById("victory-retry").hidden = submitState !== "error";
      say("Level 99 clear. Score " + scoreNow() + ".");
      showToast("", false);
    } else if (state === "paused") {
      say("Paused.");
      showToast("", false);
    } else if (state === "ready") {
      say(L.GAME_TITLE + ". Press start.");
      showToast("", false);
    } else if (state === "levelclear") {
      say("Level " + match.level + " clear.");
      showToast("LEVEL " + match.level + " CLEAR", false);
    } else if (state === "dying") {
      var reason = match.deathReason === "sunk"
        ? "OPEN WATER"
        : match.deathReason === "offscreen"
          ? "SWEPT OFF"
          : "CANDLE HIT";
      showToast(reason, true);
      say(reason + ". " + match.lives + " lives left.");
    } else if (state === "playing") {
      showToast("", false);
      say("Level " + match.level + " of " + L.MAX_LEVEL + ". Score " + match.score + ".");
    }
    document.getElementById("pause-btn").textContent = state === "paused" ? "RESUME" : "PAUSE";
  }

  function drainEvents() {
    while (match.events.length) {
      var ev = match.events.shift();
      if (ev === "die") {
        shake = reduceMotion ? 0 : 7;
        flash = 0.22;
        if (navigator.vibrate) navigator.vibrate(20);
      } else if (ev === "home" && match.lastHome) {
        burst(match.lastHome.x, match.lastHome.y, "#ffe14a");
      } else if (ev === "level" || ev === "victory") {
        burst(L.LOGICAL_W / 2, 120, "#1ed98a");
        playEvent("round");
      } else if (ev === "life") {
        blip(880, 0.08, "square", 0.04);
      } else if (ev === "best") saveBest();
      if (ev !== "level" && ev !== "victory" && ev !== "life") playEvent(ev);
    }
  }

  function queueHop(dir) {
    if (inputQueue.length < 1) inputQueue.push(dir);
  }

  function resetRunLog() {
    inputQueue = [];
    frameLog = [];
    official = false;
    runId = null;
    logClosed = true;
    submitState = "idle";
    submitError = "";
    serverResult = null;
  }

  function startPractice() {
    var best = match.best;
    resetRunLog();
    match = L.createMatch({ seed: (Math.random() * 1e9) >>> 0, best: best });
    L.start(match);
  }

  function startOfficial() {
    var nameInput = document.getElementById("player-name");
    var name = nameInput ? nameInput.value : "";
    try { localStorage.setItem("snibbu-crab-cross-the-chop-name", name); } catch (err) {}
    return fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name }),
    }).then(function (res) {
      if (!res.ok) throw new Error("run");
      return res.json();
    }).then(function (data) {
      var best = match.best;
      resetRunLog();
      match = L.createMatch({ seed: data.seed, best: best });
      runId = data.runId;
      official = true;
      logClosed = false;
      serverReachable = true;
      L.start(match);
    }).catch(function () {
      serverReachable = false;
      startPractice();
    });
  }

  function submitOfficial() {
    if (!official || !runId || submitState === "saving" || submitState === "saved") return;
    submitState = "saving";
    fetch("/api/runs/" + runId + "/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames: frameLog }),
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (result) {
      if (result.status === 201 || result.status === 409) {
        serverResult = result.data;
        submitState = "saved";
        if (result.data.score > match.best) {
          match.best = result.data.score;
          saveBest();
        }
      } else {
        submitState = "error";
        submitError = result.data && result.data.error ? result.data.error : "The run was not saved.";
      }
      syncOverlay();
    }).catch(function () {
      submitState = "error";
      submitError = "The leaderboard server did not answer.";
      syncOverlay();
    });
  }

  function refreshBoard() {
    var list = document.getElementById("board-list");
    var empty = document.getElementById("board-empty");
    var note = document.getElementById("board-note");
    list.replaceChildren();
    if (practiceOnly) {
      empty.hidden = false;
      empty.textContent = "This copy is practice only and cannot submit official results.";
      note.textContent = "Open the hosted game to use the shared leaderboard.";
      return Promise.resolve();
    }
    return fetch("/api/leaderboard").then(function (res) {
      if (!res.ok) throw new Error("board");
      return res.json();
    }).then(function (data) {
      serverReachable = true;
      if (data.contest && data.contest.open) {
        note.textContent = "Contest is open. Only clean runs are prize-eligible. A display name is not a claim identity.";
      } else {
        note.textContent = "Shared leaderboard. Contest is not open, so this is not a prize list.";
      }
      if (!data.entries.length) {
        empty.hidden = false;
        empty.textContent = "No scores yet.";
        return;
      }
      empty.hidden = true;
      data.entries.forEach(function (row) {
        var li = document.createElement("li");
        var who = document.createElement("span");
        who.textContent = row.rank + ". " + row.name;
        var meta = document.createElement("span");
        var bits = row.score + " · Level " + row.level + " / 99";
        if (row.victory) bits += " · cleared";
        if (row.reviewStatus === "flagged") bits += " · needs review";
        else if (row.prizeEligible) bits += " · prize eligible";
        meta.textContent = bits;
        li.appendChild(who);
        li.appendChild(meta);
        list.appendChild(li);
      });
    }).catch(function () {
      serverReachable = false;
      empty.hidden = false;
      empty.textContent = "Official leaderboard unavailable. This copy is practice only and cannot submit results.";
      note.textContent = "";
    });
  }

  function openBoard() {
    boardOpen = true;
    refreshBoard().then(syncOverlay);
    syncOverlay();
  }

  function copyScore() {
    var text = L.shareText({ score: scoreNow(), level: levelNow() });
    function fallback() {
      var area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); } catch (err) {}
      area.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else fallback();
  }

  function shareScore() {
    var text = L.shareText({ score: scoreNow(), level: levelNow() });
    if (navigator.share) navigator.share({ title: L.GAME_TITLE, text: text }).catch(function () {});
  }

  function begin() {
    if (match.state === "paused") {
      doPause();
      return;
    }
    if (match.state !== "ready" && match.state !== "gameover" && match.state !== "victory") return;
    if (bootPromise) return;
    boardOpen = false;
    if (soundOn) ensureAudio();
    if (practiceOnly) {
      startPractice();
      return;
    }
    bootPromise = startOfficial().then(function () {
      bootPromise = null;
    });
  }

  function doRestart() {
    saveBest();
    particles.length = 0;
    shake = 0;
    boardOpen = false;
    if (soundOn) ensureAudio();
    if (practiceOnly) {
      startPractice();
      return;
    }
    if (bootPromise) return;
    bootPromise = startOfficial().then(function () {
      bootPromise = null;
    });
  }

  function doPause() {
    if (match.state === "playing" || match.state === "paused") L.togglePause(match);
  }

  function resize() {
    var rect = stage.getBoundingClientRect();
    var aspect = L.LOGICAL_W / L.LOGICAL_H;
    var cssW = rect.width;
    var cssH = cssW / aspect;
    if (cssH > rect.height) {
      cssH = rect.height;
      cssW = cssH * aspect;
    }
    cssW = Math.max(2, cssW);
    cssH = Math.max(2, cssH);
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, L.LOGICAL_H);
    g.addColorStop(0, "#10182a");
    g.addColorStop(1, "#070c14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.LOGICAL_W, L.LOGICAL_H);
  }

  function drawHud() {
    ctx.fillStyle = "#0c1422";
    ctx.fillRect(0, 0, L.LOGICAL_W, L.HUD_H);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffe14a";
    ctx.font = "700 15px Inter, Segoe UI, sans-serif";
    ctx.fillText(L.GAME_TITLE, L.PLAY_X, 6);
    ctx.font = "700 13px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = "#f6f7fb";
    ctx.fillText("Level " + match.level + " / " + L.MAX_LEVEL, L.PLAY_X, 28);

    ctx.font = "700 13px Inter, Segoe UI, sans-serif";
    var label = "Level " + match.level + " / " + L.MAX_LEVEL;
    var labelW = ctx.measureText(label).width;
    var pipX = L.PLAY_X + labelW + 14;
    if (match.lives <= 0) {
      ctx.fillStyle = "#ff8b98";
      ctx.fillText("OUT", pipX, 32);
    } else {
      for (var i = 0; i < match.lives; i++) drawLife(pipX + i * 16, 35, true);
    }

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffe14a";
    ctx.font = "800 22px Inter, Segoe UI, sans-serif";
    ctx.fillText(String(match.score), L.PLAY_X + L.PLAY_W, 28);
    ctx.fillStyle = "#9eabc2";
    ctx.font = "700 11px Inter, Segoe UI, sans-serif";
    ctx.fillText("BEST " + match.best, L.PLAY_X + L.PLAY_W, 48);
    ctx.textAlign = "left";
  }

  function drawLane(lane) {
    var x = L.PLAY_X;
    var y = lane.y;
    var w = L.PLAY_W;
    var h = lane.h;
    if (lane.kind === "road") {
      ctx.fillStyle = lane.dir > 0 ? "#171b24" : "#12161e";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(255,225,74,0.18)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = -match.time * 30 * lane.dir;
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (lane.kind === "water") {
      var wg = ctx.createLinearGradient(0, y, 0, y + h);
      wg.addColorStop(0, lane.dir > 0 ? "#0a4f78" : "#083e62");
      wg.addColorStop(1, "#06283f");
      ctx.fillStyle = wg;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      var base = y + h * 0.55;
      for (var px = 0; px <= w; px += 8) {
        var wy = base + Math.sin((px + match.time * 70 + y) / 16) * 2.2;
        if (px === 0) ctx.moveTo(x + px, wy);
        else ctx.lineTo(x + px, wy);
      }
      ctx.stroke();
    } else if (lane.kind === "median") {
      ctx.fillStyle = "#243044";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#ffe14a";
      for (var s = 0; s < w; s += 16) {
        ctx.fillRect(x + s, y + 4, 8, 4);
        ctx.fillRect(x + s, y + h - 8, 8, 4);
      }
      ctx.fillStyle = "#f6f7fb";
      ctx.font = "800 14px Inter, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SAFE", x + w / 2, y + h / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    } else if (lane.kind === "start") {
      var sg = ctx.createLinearGradient(0, y, 0, y + h);
      sg.addColorStop(0, "#1d4a38");
      sg.addColorStop(1, "#123526");
      ctx.fillStyle = sg;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(255,225,74,0.85)";
      ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = "rgba(246,247,251,0.85)";
      ctx.font = "800 12px Inter, Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("START", x + 10, y + h - 10);
      for (var c = 0; c < L.COLS; c++) {
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.arc(L.colCenter(c), y + 14, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (lane.kind === "goal") {
      var gg = ctx.createLinearGradient(0, y, 0, y + h);
      gg.addColorStop(0, "#1a1408");
      gg.addColorStop(1, "#0e1a2c");
      ctx.fillStyle = gg;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#5c4316";
      ctx.fillRect(x, y + h - 6, w, 6);
    }
  }

  function drawHomes() {
    for (var i = 0; i < match.homes.length; i++) {
      var home = match.homes[i];
      ctx.fillStyle = home.filled ? "rgba(255, 225, 74, 0.2)" : "rgba(0,0,0,0.35)";
      roundRect(home.x, home.y, home.w, home.h, 10);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = home.filled ? "#ffe14a" : "#c9a15b";
      ctx.stroke();
      if (home.filled) {
        drawCrab(home.x + home.w / 2 - 16, home.y + 6, 32, 34, false);
      } else {
        ctx.fillStyle = "rgba(255,225,74,0.8)";
        ctx.font = "800 12px Inter, Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), home.x + home.w / 2, home.y + home.h - 8);
        ctx.textAlign = "left";
      }
    }
  }

  function drawCandle(v, dir) {
    var wick = 8;
    ctx.strokeStyle = "#f4f7fb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(v.x - wick, v.y + v.h / 2);
    ctx.lineTo(v.x + v.w + wick, v.y + v.h / 2);
    ctx.stroke();
    ctx.fillStyle = v.color === "green" ? "#17c984" : "#ff3b55";
    roundRect(v.x, v.y, v.w, v.h, 6);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#16080c";
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    roundRect(v.x + 3, v.y + 3, Math.min(7, v.w - 6), Math.max(4, v.h - 6), 3);
    ctx.fill();
    ctx.fillStyle = dir > 0 ? "#fff" : "#fff";
    var tip = dir > 0 ? v.x + v.w + wick : v.x - wick;
    ctx.beginPath();
    ctx.arc(tip, v.y + v.h / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRaft(v, dir) {
    ctx.fillStyle = "#c9853a";
    roundRect(v.x, v.y + v.h * 0.32, v.w, v.h * 0.62, 8);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#3a2412";
    ctx.stroke();
    ctx.fillStyle = "#ffe14a";
    ctx.fillRect(v.x + 8, v.y + v.h * 0.52, Math.max(8, v.w - 16), 4);
    var cabinW = Math.min(28, v.w * 0.28);
    ctx.fillStyle = "#8d5a2b";
    roundRect(v.x + v.w / 2 - cabinW / 2, v.y + 2, cabinW, v.h * 0.42, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff6d0";
    ctx.beginPath();
    var tip = dir > 0 ? v.x + v.w - 10 : v.x + 10;
    var mid = v.y + v.h * 0.62;
    ctx.moveTo(tip, mid);
    ctx.lineTo(tip - dir * 7, mid - 4);
    ctx.lineTo(tip - dir * 7, mid + 4);
    ctx.closePath();
    ctx.fill();
  }

  function drawLife(x, y, alive) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = alive ? "#ffe14a" : "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    if (alive) {
      ctx.fillStyle = "#1a1204";
      ctx.beginPath();
      ctx.arc(-2.2, -0.6, 1.2, 0, Math.PI * 2);
      ctx.arc(2.2, -0.6, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVehicles() {
    for (var i = 0; i < match.vehicles.length; i++) {
      var v = match.vehicles[i];
      var lane = match.lanes[v.laneId];
      if (lane.kind === "road") drawCandle(v, lane.dir);
      else drawRaft(v, lane.dir);
    }
  }

  function drawFallbackCrab(w, h) {
    ctx.fillStyle = "#ffe14a";
    ctx.strokeStyle = "#1a1204";
    ctx.lineWidth = Math.max(2, w * 0.045);
    ctx.beginPath();
    ctx.ellipse(0, h * 0.05, w * 0.28, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    var side;
    for (var s = 0; s < 2; s++) {
      side = s === 0 ? -1 : 1;
      ctx.fillStyle = "#ffe14a";
      ctx.beginPath();
      ctx.ellipse(side * w * 0.12, -h * 0.22, w * 0.08, h * 0.16, side * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#141018";
      ctx.beginPath();
      ctx.arc(side * w * 0.1, -h * 0.2, w * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f5a623";
    ctx.beginPath();
    ctx.ellipse(w * 0.1, h * 0.05, w * 0.16, h * 0.055, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffb703";
    for (var c = 0; c < 2; c++) {
      side = c === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.ellipse(side * w * 0.32, h * 0.1, w * 0.11, h * 0.07, side * -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawCrab(x, y, w, h, flip) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    if (flip) ctx.scale(-1, 1);
    if (spriteReady && frogSprite.naturalWidth > 0 && !frogSprite.failed) {
      ctx.drawImage(frogSprite, -w / 2, -h / 2, w, h);
    } else {
      drawFallbackCrab(w, h);
    }
    ctx.restore();
  }

  function renderPlayer() {
    var p = match.player;
    if (!p) return;
    var blinking = match.time < (p.blinkUntil || 0) && Math.floor(match.time * 14) % 2 === 0;
    if (blinking && match.state === "playing") return;

    var arc = 0;
    var squash = 1;
    var stretch = 1;
    if (p.hop) {
      var t = Math.min(1, p.hop.t);
      arc = Math.sin(t * Math.PI) * (reduceMotion ? 8 : 16);
      stretch = 1 + Math.sin(t * Math.PI) * 0.1;
      squash = 1 - Math.sin(t * Math.PI) * 0.05;
    } else {
      var since = match.time - (p.landedAt || 0);
      if (since >= 0 && since < 0.09) {
        var k = 1 - since / 0.09;
        squash = 1 + 0.12 * k;
        stretch = 1 - 0.1 * k;
      } else if (!reduceMotion && (match.state === "playing" || match.state === "ready")) {
        arc = Math.sin(match.time * 2.5) * 1.3;
      }
    }

    var drawW = 52;
    var drawH = 52;
    if (spriteReady && frogSprite.naturalWidth) {
      drawH = drawW * (frogSprite.naturalHeight / frogSprite.naturalWidth);
    }
    var groundY = p.y + 14;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(p.x, groundY, 14 * squash, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    var frog = {
      x: p.x - (drawW * squash) / 2,
      y: p.y - arc - (drawH * stretch) / 2,
      width: drawW * squash,
      height: drawH * stretch,
    };
    ctx.save();
    ctx.translate(p.x, 0);
    if (p.facing === "left") ctx.scale(-1, 1);
    ctx.translate(-p.x, 0);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 8;
    if (spriteReady && frogSprite.naturalWidth > 0 && !frogSprite.failed) {
      ctx.drawImage(frogSprite, frog.x, frog.y, frog.width, frog.height);
    } else {
      ctx.save();
      ctx.translate(frog.x + frog.width / 2, frog.y + frog.height / 2);
      drawFallbackCrab(frog.width, frog.height);
      ctx.restore();
    }
    ctx.restore();
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    var dprX = canvas.width / L.LOGICAL_W;
    var dprY = canvas.height / L.LOGICAL_H;
    ctx.setTransform(dprX, 0, 0, dprY, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, L.LOGICAL_W, L.LOGICAL_H);
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawBackground();
    drawHud();

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.PLAY_X, L.HUD_H, L.PLAY_W, L.LOGICAL_H - L.HUD_H);
    ctx.clip();
    for (var i = 0; i < match.lanes.length; i++) drawLane(match.lanes[i]);
    drawVehicles();
    drawHomes();
    renderPlayer();
    drawParticles();
    ctx.restore();

    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 3;
    ctx.strokeRect(L.PLAY_X + 1.5, L.HUD_H + 1.5, L.PLAY_W - 3, L.LOGICAL_H - L.HUD_H - 3);

    if (flash > 0) {
      ctx.fillStyle = "rgba(255, 59, 85, " + Math.min(0.35, flash) + ")";
      ctx.fillRect(0, 0, L.LOGICAL_W, L.LOGICAL_H);
    }
  }

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (document.hidden) {
      requestAnimationFrame(frame);
      return;
    }
    var dtMs = Math.max(0, Math.min(50, Math.round(dt * 1000)));
    if (holdDir) {
      holdDelay -= dtMs / 1000;
      if (holdDelay <= 0 && match.state === "playing") {
        queueHop(holdDir);
        holdDelay = 0.16;
      }
    }
    var hop = null;
    if (match.state === "playing" && inputQueue.length) hop = inputQueue.shift();
    var recording = official && !logClosed && match.state !== "paused" && match.state !== "ready";
    L.stepFrame(match, dtMs, hop);
    if (recording) {
      frameLog.push({ dt: dtMs, hop: hop });
      if (match.state === "gameover" || match.state === "victory") {
        logClosed = true;
        submitOfficial();
      }
    }
    drainEvents();
    if (shake > 0) shake = Math.max(0, shake - dt * 28);
    if (flash > 0) flash = Math.max(0, flash - dt);
    updateParticles(Math.min(dt, L.MAX_DT));
    render();
    syncOverlay();
    requestAnimationFrame(frame);
  }

  function onKey(e) {
    var key = e.key;
    if (key === " " || key === "Enter" || key.indexOf("Arrow") === 0) e.preventDefault();
    if (e.repeat) return;
    if (e.target && e.target.tagName === "BUTTON" && (key === " " || key === "Enter")) return;
    var dir = null;
    if (key === "ArrowUp" || key === "w" || key === "W") dir = "up";
    else if (key === "ArrowDown" || key === "s" || key === "S") dir = "down";
    else if (key === "ArrowLeft" || key === "a" || key === "A") dir = "left";
    else if (key === "ArrowRight" || key === "d" || key === "D") dir = "right";
    if (dir) {
      if (match.state === "ready" || match.state === "gameover" || match.state === "victory") begin();
      else if (match.state === "paused") doPause();
      if (match.state === "playing") queueHop(dir);
      return;
    }
    if (key === "p" || key === "P" || key === "Escape") doPause();
    else if (key === "r" || key === "R") doRestart();
    else if (key === "m" || key === "M") {
      setSound(!soundOn);
      if (soundOn) {
        ensureAudio();
        blip(660, 0.07, "square", 0.04);
      }
    } else if (key === "Enter" || key === " ") {
      if (match.state === "ready" || match.state === "gameover" || match.state === "victory") begin();
      else if (match.state === "paused") doPause();
    }
  }

  function bindPad(btn) {
    btn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
      holdDir = btn.dataset.dir;
      holdDelay = 0.34;
      if (match.state === "ready" || match.state === "gameover" || match.state === "victory") begin();
      else if (match.state === "paused") doPause();
      if (match.state === "playing") queueHop(holdDir);
    });
    function release() {
      if (holdDir === btn.dataset.dir) holdDir = null;
    }
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("lostpointercapture", release);
  }

  var swipe = null;
  canvas.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  canvas.addEventListener("pointerup", function (e) {
    if (!swipe || swipe.id !== e.pointerId) return;
    var dx = e.clientX - swipe.x;
    var dy = e.clientY - swipe.y;
    swipe = null;
    var ax = Math.abs(dx);
    var ay = Math.abs(dy);
    if (match.state === "ready" || match.state === "gameover" || match.state === "victory") {
      begin();
      return;
    }
    if (match.state === "paused") {
      doPause();
      return;
    }
    if (Math.max(ax, ay) < 24) {
      queueHop("up");
      return;
    }
    if (ax > ay) queueHop(dx > 0 ? "right" : "left");
    else queueHop(dy > 0 ? "down" : "up");
  });
  canvas.addEventListener("pointercancel", function () { swipe = null; });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  document.addEventListener("touchmove", function (e) {
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && match.state === "playing") doPause();
  });

  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

  document.getElementById("start-btn").addEventListener("click", begin);
  document.getElementById("resume-btn").addEventListener("click", doPause);
  document.getElementById("again-btn").addEventListener("click", begin);
  document.getElementById("victory-again").addEventListener("click", begin);
  document.getElementById("open-board").addEventListener("click", openBoard);
  document.getElementById("pause-board").addEventListener("click", openBoard);
  document.getElementById("over-board").addEventListener("click", openBoard);
  document.getElementById("victory-board").addEventListener("click", openBoard);
  document.getElementById("board-back").addEventListener("click", function () {
    boardOpen = false;
    syncOverlay();
  });
  document.getElementById("copy-score").addEventListener("click", copyScore);
  document.getElementById("victory-copy").addEventListener("click", copyScore);
  document.getElementById("retry-submit").addEventListener("click", submitOfficial);
  document.getElementById("victory-retry").addEventListener("click", submitOfficial);
  if (navigator.share) {
    var shareBtn = document.getElementById("share-score");
    shareBtn.hidden = false;
    shareBtn.addEventListener("click", shareScore);
  }
  var nameInput = document.getElementById("player-name");
  if (nameInput && savedName) nameInput.value = savedName;
  document.getElementById("pause-btn").addEventListener("click", doPause);
  document.getElementById("restart-btn").addEventListener("click", doRestart);
  document.getElementById("sound-btn").addEventListener("click", function () {
    setSound(!soundOn);
    if (soundOn) {
      ensureAudio();
      blip(660, 0.07, "square", 0.04);
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll(".dpad button"), bindPad);

  var hero = document.querySelector(".hero");
  if (hero) hero.addEventListener("error", function () { hero.style.display = "none"; });

  setSound(soundOn);
  resize();
  syncOverlay();
  requestAnimationFrame(frame);

  window.SNIBBU = {
    get match() { return match; },
    logic: L,
    start: begin,
    restart: doRestart,
    pause: doPause,
    hop: function (dir) { queueHop(dir); },
    resize: resize,
    sprite: frogSprite,
    debugSetLevel: function (level) { return L.debugSetLevel(match, level); },
  };
  if (!practiceOnly) {
    fetch("/api/contest").then(function (res) {
      if (!res.ok) throw new Error("contest");
      serverReachable = true;
      syncOverlay();
    }).catch(function () {
      serverReachable = false;
      syncOverlay();
    });
  } else {
    syncOverlay();
  }
})();
