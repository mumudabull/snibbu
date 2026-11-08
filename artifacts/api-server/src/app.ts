import express, { type Express, type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Replit's managed proxy forwards the visitor IP; Express req.ip uses it only
// when proxy trust is enabled. Never read X-Forwarded-For directly in routes.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
app.use(
  "/api/runs/:runId/submit",
  express.raw({ type: "application/json", limit: 1000000 }),
);
app.use(express.json({ limit: 1000000 }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err }, "Request failed");
  const code = typeof err === "object" && err && "status" in err ? Number(err.status) : 500;
  res.status(code === 413 ? 413 : code === 400 ? 400 : 500).json({ error: code === 413 ? "Replay is too large." : code === 400 ? "Invalid JSON." : "Service temporarily unavailable. Please try again." });
});

export default app;
