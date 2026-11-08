import { Worker } from "node:worker_threads";
import type { Frame } from "@workspace/snibbu-upstream/validate";

type ReplayResult = ReturnType<typeof import("@workspace/snibbu-upstream/validate").replaySubmission>;
type ValidationResult = {
  result: ReplayResult;
  frames: Frame[];
  input: { score?: number; level?: number };
};
type Job = {
  id: number;
  seed: number;
  body: Uint8Array;
  resolve: (result: ValidationResult) => void;
  reject: (error: Error) => void;
};
type Slot = { worker: Worker; job: Job | null; failed: boolean };

const WORKER_COUNT = 2;
const MAX_QUEUED_REPLAYS = 32;

class ReplayPool {
  private nextId = 1;
  private readonly queue: Job[] = [];
  private readonly slots: Slot[] = [];

  constructor() {
    for (let i = 0; i < WORKER_COUNT; i++) this.spawn();
  }

  validate(seed: number, body: Uint8Array): Promise<ValidationResult> {
    if (this.queue.length >= MAX_QUEUED_REPLAYS) {
      return Promise.reject(new Error("Replay validation capacity is full."));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, seed, body, resolve, reject });
      this.dispatch();
    });
  }

  private spawn(): void {
    const slot: Slot = {
      worker: new Worker(new URL("./replay-worker.mjs", import.meta.url)),
      job: null,
      failed: false,
    };
    this.slots.push(slot);
    slot.worker.on("message", (message: {
      id: number;
      frames?: Frame[];
      result?: ReplayResult;
      input?: { score?: number; level?: number };
      validationError?: string;
      error?: string;
    }) => {
      if (!slot.job || slot.job.id !== message.id) return;
      const job = slot.job;
      slot.job = null;
      if (message.validationError) job.reject(new Error(`Invalid replay: ${message.validationError}`));
      else if (message.error || !message.result || !message.frames || !message.input) {
        job.reject(new Error(message.error ?? "Replay validation failed."));
      } else job.resolve({ result: message.result, frames: message.frames, input: message.input });
      this.dispatch();
    });
    slot.worker.on("error", error => this.replace(
      slot,
      error instanceof Error ? error : new Error(String(error)),
    ));
    slot.worker.on("exit", code => {
      if (code !== 0) this.replace(slot, new Error(`Replay worker exited with code ${code}.`));
    });
    this.dispatch();
  }

  private replace(slot: Slot, error: Error): void {
    if (slot.failed) return;
    slot.failed = true;
    if (slot.job) {
      slot.job.reject(error);
      slot.job = null;
    }
    const index = this.slots.indexOf(slot);
    if (index !== -1) this.slots.splice(index, 1);
    void slot.worker.terminate();
    this.spawn();
    this.dispatch();
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.worker.postMessage({ id: job.id, seed: job.seed, body: job.body });
    }
  }
}

export const replayPool = new ReplayPool();
