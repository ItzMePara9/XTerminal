import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ClientFrame } from "@xterminal/types";
import { sshManager } from "../services/ssh/manager.js";
import { loadSession } from "../auth/session.js";
import { config } from "../config.js";
import { logger } from "../context.js";

const clientFrameSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("data"), d: z.string().min(1).max(64 * 1024) }),
  z.object({
    t: z.literal("resize"),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(300),
  }),
  z.object({ t: z.literal("trust"), mode: z.enum(["once", "save"]) }),
  z.object({ t: z.literal("cancel") }),
  z.object({ t: z.literal("ping") }),
  z.object({
    t: z.literal("hello"),
    cols: z.number().int().min(2).max(500).optional(),
    rows: z.number().int().min(2).max(300).optional(),
  }),
]);

function reject(socket: { close: (code: number, reason: string) => void }, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    /* ignore */
  }
}

export async function terminalWsRoute(app: FastifyInstance): Promise<void> {
  app.get("/ws/terminal/:sessionId", { websocket: true }, async (socket, request) => {
    try {
      // 1. Authenticate via the session cookie (WS handshakes carry cookies).
      const user = await loadSession(request);
      if (!user) {
        reject(socket, 4401, "Authentication required");
        return;
      }

      // 2. Origin check (browsers always send Origin on WS handshakes).
      const origin = request.headers.origin;
      if (origin && config.isProd && origin !== config.webauthn.origin && origin !== config.appUrl) {
        reject(socket, 4403, "Origin not allowed");
        return;
      }

      // 3. Validate + consume the one-time ticket.
      const params = z
        .object({ sessionId: z.string().min(10).max(128) })
        .parse(request.params);
      const query = z
        .object({ token: z.string().min(20).max(200) })
        .parse(request.query);
      const session = sshManager.consumeTicket(params.sessionId, query.token);
      if (!session) {
        reject(socket, 4404, "Invalid or expired terminal ticket");
        return;
      }
      if (session.userId !== user.id) {
        // Ownership check: a ticket for another user's session is invalid.
        logger.warn(
          { userId: user.id, sessionId: params.sessionId },
          "ws: user attempted to attach to another user's terminal",
        );
        reject(socket, 4403, "Forbidden");
        return;
      }
      if (session.ws) {
        reject(socket, 4409, "Session already attached");
        return;
      }

      // 4. Bind the socket.
      session.ws = socket;
      session.cancelGrace();
      session.touchIdle(sshManager);
      session.send({ t: "attached", sessionId: session.id, cols: session.cols, rows: session.rows });

      if (!session.started) {
        void sshManager.start(session);
      } else {
        // Reattach: replay output produced while the browser was away.
        session.setStatus(session.status === "failed" ? "failed" : "reconnecting");
        session.flushReplay();
        session.setStatus("connected");
      }

      socket.on("message", (raw: unknown) => {
        let frame: ClientFrame;
        try {
          const text = typeof raw === "string" ? raw : Buffer.from(raw as Buffer).toString("utf8");
          frame = clientFrameSchema.parse(JSON.parse(text));
        } catch {
          session.send({ t: "error", message: "Malformed frame", code: "BAD_FRAME" });
          return;
        }
        session.handleClientFrame(sshManager, frame);
      });

      socket.on("close", () => {
        if (session.isDestroyed) return;
        session.ws = null;
        // Keep the SSH session alive briefly so the browser can reconnect
        // to the same session instead of duplicating it.
        session.startGrace(sshManager);
      });

      socket.on("error", (err: Error) => {
        logger.debug({ err, sessionId: session.id }, "ws: socket error");
      });

      logger.info(
        { userId: user.id, sessionId: session.id },
        "ws: terminal attached",
      );
    } catch (err) {
      logger.error({ err }, "ws: terminal handshake failed");
      reject(socket, 4500, "Internal error");
    }
  });

  logger.debug("terminal ws route registered");
}
