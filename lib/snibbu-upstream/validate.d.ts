export interface Frame { dt: number; hop: string | null }
export function parseFrames(body: unknown): { error?: string; frames?: Frame[] };
export function replaySubmission(seed: number, frames: Frame[]): {
  score: number; level: number; victory: boolean; state: string;
  totalMs: number; hopCount: number; flags: string[]; reviewStatus: string;
};
