import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/errorHandler";
import { loadAuth } from "./middlewares/auth";
import { pool } from "@workspace/db";

const PgSession = connectPgSimple(session);

const app: Express = express();

// Trust exactly one reverse-proxy hop (Replit's edge / Nginx layer).
// Required so that express-session emits secure cookies behind HTTPS proxies.
app.set("trust proxy", 1);

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

/**
 * CORS policy:
 *   Development  — ALLOWED_ORIGINS env var, or fall back to any *.replit.dev origin.
 *   Production   — ALLOWED_ORIGINS env var must be set explicitly (comma-separated list).
 * We never reflect `origin: true` in production to avoid cross-origin credential leakage.
 */
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
const allowedOrigins: (string | RegExp)[] = allowedOriginsEnv
  ? allowedOriginsEnv.split(",").map((o) => o.trim())
  : [/\.replit\.dev$/, /\.replit\.app$/, /^http:\/\/localhost(:\d+)?$/];

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / server-to-server requests (no Origin header)
      if (!origin) return callback(null, true);
      const allowed = allowedOrigins.some((rule) =>
        typeof rule === "string" ? rule === origin : rule.test(origin),
      );
      if (allowed) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required");
}

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: sessionSecret,
    name: "sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    },
  }),
);

// Load auth context on every request
app.use(loadAuth);

app.use("/api", router);

app.use(errorHandler);

export default app;
