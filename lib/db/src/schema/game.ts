import { pgTable, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const gameRuns = pgTable("game_runs", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  seed: integer("seed").notNull(),
  version: integer("version").notNull().default(1),
  mode: text("mode").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  displayName: text("display_name"),
  score: integer("score"),
  highestLevel: integer("highest_level"),
  ticks: integer("ticks"),
  replay: jsonb("replay"),
  review: boolean("review").notNull().default(false),
  reviewReasons: jsonb("review_reasons"),
});
export const insertGameRunSchema = createInsertSchema(gameRuns);

export const contestSettings = pgTable("contest_settings", {
  id: integer("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  prizes: text("prizes"),
  rules: text("rules"),
  eligibility: text("eligibility"),
});
export const insertContestSettingsSchema = createInsertSchema(contestSettings);

export const gameRateLimits = pgTable("game_rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
