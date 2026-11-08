export function sanitizeName(name: unknown): string;
export function loadContest(env: Record<string, string | undefined>, now?: Date): {
  enabled: boolean; open: boolean; phase: string; timezone: string | null;
  startsAt: string | null; endsAt: string | null;
  rules: string | null; prizes: string | null; eligibility: string | null;
};
