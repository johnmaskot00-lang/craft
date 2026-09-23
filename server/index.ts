import express, { type Request, Response, NextFunction } from "express";
import { isMainThread, workerData } from "node:worker_threads";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startWatchdog } from "./watchdog";
import { createServer } from "http";

// The watchdog worker thread loads THIS bundle (dist/index.cjs) to reach the
// worker branch in ./watchdog. Everything below is main-thread only: without this
// guard the worker would create a second Express app, HTTP server and DB pool.
const isWatchdogWorker = !isMainThread && !!(workerData as any)?.__craftWatchdog;

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

// Route-specific JSON limits — avoid a blanket 50mb + rawBody double-buffer on every
// /api/projects request (that previously doubled heap under concurrent generates).
app.use("/api/upload-image", express.json({ limit: "25mb" }));
app.use("/api/projects", express.json({ limit: "12mb" }));
app.use("/api/seo", express.json({ limit: "2mb" }));

// Small default limit everywhere else — protects against oversized-body DoS,
// especially on the public, unauthenticated lead-intake endpoint.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    // Never retain the real response body for access logs — nested HTML/code
    // fields used to slip past the old top-level check and JSON.stringify
    // aborted the process under GC (JsonStringify → FATAL ERROR).
    try {
      if (bodyJson == null) {
        capturedJsonResponse = undefined;
      } else if (typeof bodyJson === "string") {
        capturedJsonResponse = { _truncated: true, bytes: bodyJson.length };
      } else if (Array.isArray(bodyJson)) {
        capturedJsonResponse = { _truncated: true, items: bodyJson.length };
      } else if (typeof bodyJson === "object") {
        const o = bodyJson as Record<string, unknown>;
        const keys = Object.keys(o);
        capturedJsonResponse = {
          _truncated: true,
          keys: keys.length,
          message: typeof o.message === "string" ? o.message.slice(0, 120) : undefined,
          state: typeof o.state === "string" ? o.state : undefined,
        };
      } else {
        capturedJsonResponse = { _truncated: true, t: typeof bodyJson };
      }
    } catch {
      capturedJsonResponse = { _truncated: true };
    }
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        try {
          const s = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${s.length > 400 ? `${s.slice(0, 400)}…` : s}`;
        } catch {
          /* ignore */
        }
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  if (isWatchdogWorker) return; // worker thread: ./watchdog owns this thread

  // Register process-level handlers BEFORE the async boot work (DB, routes).
  // Previously they were installed only after `await registerRoutes(...)`, so a
  // SIGTERM arriving during startup was never handled.
  const shutdown = (signal: string) => {
    console.warn(`[boot] ${signal} — closing HTTP server`);
    httpServer.close(() => {
      console.warn("[boot] HTTP server closed");
      process.exit(0);
    });
    // Idle keep-alive sockets keep close() pending — drop them explicitly.
    (httpServer as any).closeIdleConnections?.();
    setTimeout(() => {
      (httpServer as any).closeAllConnections?.();
      process.exit(1);
    }, 12_000).unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    console.error("[boot] unhandledRejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[boot] uncaughtException:", err);
    // Exit so Amvera can restart a clean process instead of a wedged one.
    setTimeout(() => process.exit(1), 500).unref?.();
  });

  // Worker-thread watchdog: arm before boot so a hang during startup is caught too.
  startWatchdog();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
