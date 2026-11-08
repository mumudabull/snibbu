import { pgTable, uuid, integer, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const snibbuRuns = pgTable("runs", {
  id: uuid("id").primaryKey(),
  seed: integer("seed").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submitExpiresAt: timestamp("submit_expires_at", { withTimezone: true }).notNull(),
  submitted: boolean("submitted").notNull().default(false),
  contestEligible: boolean("contest_eligible").notNull().default(false),
});
export const insertSnibbuRunSchema = createInsertSchema(snibbuRuns);

export const snibbuSubmissions = pgTable("submissions", {
  runId: uuid("run_id").primaryKey().references(() => snibbuRuns.id),
  score: integer("score").notNull(),
  level: integer("level").notNull(),
  victory: boolean("victory").notNull(),
  durationMs: integer("duration_ms").notNull(),
  hopCount: integer("hop_count").notNull(),
  reviewStatus: text("review_status").notNull(),
  flagReasons: jsonb("flag_reasons").notNull().default([]),
  prizeEligible: boolean("prize_eligible").notNull().default(false),
  contestEntry: boolean("contest_entry").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  log: jsonb("log").notNull(),
}, table => [
  index("submissions_rank").on(table.score.desc(), table.level.desc(), table.victory.desc(), table.createdAt.asc(), table.runId.asc()),
]);
export const insertSnibbuSubmissionSchema = createInsertSchema(snibbuSubmissions);
