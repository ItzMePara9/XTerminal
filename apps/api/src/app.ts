import path from "node:path";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { logger } from "./context.js";
import { ApiError } from "./util/errors.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { webauthnRoutes } from "./routes/webauthn.js";
import { connectionRoutes } from "./routes/connections.js";
import { keyRoutes } from "./routes/keys.js";
import { terminalRoutes } from "./routes/terminal.js";
import { terminalWsRoute } from "./routes/ws-terminal.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger as unknown as FastifyBaseLogger,
    bodyLimit: config.bodyLimit,
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(cookie, {
    secret: config.sessionSecret || undefined,
    parseOptions: {},
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    // Health checks and WebSockets must not be rate limited.
    keyGenerator: (request: { ip: string }) => request.ip,
    skip: (request: { url: string }) =>
      request.url === "/health" ||
      request.url === "/api/health" ||
      request.url.startsWith("/ws/") ||
      request.url.startsWith("/assets/"),
  } as never);

  await app.register(websocket);

  // Same-origin by default; explicit origins can be added here.
  await app.register(cors, { origin: false });

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(webauthnRoutes);
  await app.register(connectionRoutes);
  await app.register(keyRoutes);
  await app.register(terminalRoutes);
  await app.register(terminalWsRoute);

  app.setNotFoundHandler((request, reply) => {
    // SPA fallback: serve index.html for client-side routes.
    const url = request.raw.url ?? "/";
    if (
      request.method === "GET" &&
      !url.startsWith("/api/") &&
      !url.startsWith("/ws/") &&
      !path.extname(url)
    ) {
      const webDist = resolveWebDist();
      if (webDist) {
        return reply.sendFile("index.html");
      }
    }
    return reply.status(404).send({ error: "NOT_FOUND", message: "Not found" });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    // Rate limit errors from the plugin
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: "RATE_LIMITED",
        message: "Too many requests - slow down",
      });
    }
    // Zod validation
    const validation = (error as { validation?: unknown }).validation;
    if (validation) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: error.message,
      });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({
      error: "INTERNAL",
      message: "Internal server error",
    });
  });

  // Serve the built web app (apps/web/dist) when present.
  const webDist = resolveWebDist();
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
    logger.info({ root: webDist }, "serving web app");
  } else {
    logger.warn("apps/web/dist not found - API-only mode (run `pnpm build`)");
  }

  return app;
}

function resolveWebDist(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "../web/dist"), // from apps/api
    path.resolve(process.cwd(), "apps/web/dist"), // from repo root
    path.resolve(import.meta.dirname ?? process.cwd(), "../../web/dist"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}
