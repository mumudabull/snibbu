"use strict";

function loadContest(env, now) {
  env = env || {};
  now = now || new Date();
  const disabled = {
    enabled: false,
    open: false,
    phase: "disabled",
    timezone: null,
    startsAt: null,
    endsAt: null,
    rules: null,
    prizes: null,
    eligibility: null,
  };
  if (String(env.CONTEST_ENABLED || "").toLowerCase() !== "true") return disabled;

  const timezone = String(env.CONTEST_TIMEZONE || "").trim();
  const rules = String(env.CONTEST_RULES || "").trim();
  const prizes = String(env.CONTEST_PRIZES || "").trim();
  const eligibility = String(env.CONTEST_ELIGIBILITY || "").trim();
  const startMs = Date.parse(String(env.CONTEST_START || "").trim());
  const endMs = Date.parse(String(env.CONTEST_END || "").trim());
  let tzOk = false;
  if (timezone) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(now);
      tzOk = true;
    } catch (err) {
      tzOk = false;
    }
  }
  const complete = tzOk && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && rules && prizes && eligibility;
  if (!complete) {
    return {
      enabled: false,
      open: false,
      phase: "incomplete",
      timezone: null,
      startsAt: null,
      endsAt: null,
      rules: null,
      prizes: null,
      eligibility: null,
    };
  }
  const t = now.getTime();
  let phase = "open";
  let open = true;
  if (t < startMs) {
    phase = "before";
    open = false;
  } else if (t >= endMs) {
    phase = "after";
    open = false;
  }
  return {
    enabled: true,
    open: open,
    phase: phase,
    timezone: timezone,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    rules: rules,
    prizes: prizes,
    eligibility: eligibility,
  };
}

function sanitizeName(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/[\u0000-\u001F\u007F]/g, "");
  s = s.replace(/[<>]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  const chars = Array.from(s);
  if (chars.length > 16) s = chars.slice(0, 16).join("").trim();
  if (!s) s = "Snibbu";
  return s;
}

module.exports = { loadContest: loadContest, sanitizeName: sanitizeName };
