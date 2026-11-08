"use strict";

const logic = require("../game/js/logic.js");

const DIRS = { up: true, down: true, left: true, right: true };
const MAX_FRAMES = 120000;

function parseFrames(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Body must be a JSON object." };
  }
  const frames = body.frames;
  if (!Array.isArray(frames)) return { error: "frames must be an array." };
  if (frames.length < 1 || frames.length > MAX_FRAMES) {
    return { error: "frames length is out of range." };
  }
  const clean = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      return { error: "A frame is malformed." };
    }
    if (Object.keys(frame).some(function (key) { return key !== "dt" && key !== "hop"; })) {
      return { error: "A frame contains an unknown field." };
    }
    if (!Number.isInteger(frame.dt) || frame.dt < 0 || frame.dt > 1000) {
      return { error: "Each dt must be an integer from 0 to 1000." };
    }
    let hop = null;
    if (frame.hop != null) {
      if (typeof frame.hop !== "string" || !DIRS[frame.hop]) return { error: "Unknown hop." };
      hop = frame.hop;
    }
    clean.push({ dt: frame.dt, hop: hop });
  }
  return { frames: clean };
}

function assess(result) {
  const flags = [];
  const completed = result.victory ? logic.MAX_LEVEL : Math.max(0, result.level - 1);
  const minMs = completed * 4000;
  if (result.totalMs < minMs) flags.push("implausible_duration");
  return flags;
}

function replaySubmission(seed, frames) {
  const result = logic.replay(seed, frames);
  const flags = assess(result);
  return {
    score: result.score,
    level: result.level,
    victory: result.victory,
    state: result.state,
    totalMs: result.totalMs,
    hopCount: result.hopCount,
    flags: flags,
    reviewStatus: flags.length ? "flagged" : "clean",
  };
}

module.exports = {
  MAX_FRAMES: MAX_FRAMES,
  parseFrames: parseFrames,
  assess: assess,
  replaySubmission: replaySubmission,
};
