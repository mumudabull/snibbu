import { parentPort } from "node:worker_threads";
import { SubmitRunBody } from "@workspace/api-zod";
import { parseFrames, replaySubmission } from "@workspace/snibbu-upstream/validate";

if (!parentPort) throw new Error("Replay worker requires a parent thread.");

parentPort.on("message", ({ id, seed, body }: { id: number; seed: number; body: Uint8Array }) => {
  try {
    let input;
    try {
      input = JSON.parse(Buffer.from(body).toString("utf8"));
    } catch {
      parentPort!.postMessage({ id, validationError: "Invalid JSON." });
      return;
    }
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => !["frames", "score", "level"].includes(key))) {
      parentPort!.postMessage({ id, validationError: "Invalid gameplay replay." });
      return;
    }
    const scalarInput = SubmitRunBody.pick({ score: true, level: true }).strict().safeParse({
      score: input.score,
      level: input.level,
    });
    if (!scalarInput.success) {
      parentPort!.postMessage({ id, validationError: "Invalid gameplay replay." });
      return;
    }
    const parsed = parseFrames(input);
    if (parsed.error || !parsed.frames) {
      parentPort!.postMessage({ id, validationError: parsed.error ?? "Invalid gameplay replay." });
      return;
    }
    parentPort!.postMessage({
      id,
      frames: parsed.frames,
      result: replaySubmission(seed, parsed.frames),
      input: scalarInput.data,
    });
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: error instanceof Error ? error.message : "Replay validation failed.",
    });
  }
});
