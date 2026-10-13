import { FastifyInstance } from "fastify";
import { z } from "zod";
import { sshManager } from "../services/ssh/manager.js";
import { requireAuth } from "../auth/session.js";
import { badRequest, notFound, sendError } from "../util/errors.js";
import { audit } from "../services/audit.js";

export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Create a terminal session for a connection and return a one-time ticket
   * used to open the WebSocket.
   */
  app.post("/api/connections/:id/session", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          cols: z.number().int().min(2).max(500).optional(),
          rows: z.number().int().min(2).max(300).optional(),
        })
        .parse(request.body ?? {});
      // createTicket enforces both ownership and per-user session limits.
      const ticket = await sshManager.createTicket(request.user!.id, id, body);
      return reply.status(201).send(ticket);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Issue a fresh ticket to reattach to a live session after a WS drop. */
  app.post("/api/terminal/:sessionId/reattach", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
      const ticket = sshManager.reattachTicket(request.user!.id, sessionId);
      if (!ticket) return sendError(reply, notFound("Terminal session not found or already closed"));
      return reply.send(ticket);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** List the caller's live terminal sessions. */
  app.get("/api/terminal", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const sessions = sshManager.listForUser(request.user!.id);
      return reply.send({
        sessions: sessions.map((s) => ({
          sessionId: s.id,
          connectionId: s.connectionId,
          label: s.label,
          status: s.status,
          createdAt: s.createdAt,
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Terminate a terminal session. */
  app.delete("/api/terminal/:sessionId", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
      const session = sshManager.get(sessionId);
      if (!session || session.userId !== request.user!.id) {
        return sendError(reply, notFound("Terminal session not found"));
      }
      sshManager.destroy(session, "Terminated by user");
      await audit("terminal.terminated", {
        userId: request.user!.id,
        target: session.connectionId,
        meta: { sessionId },
      });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
