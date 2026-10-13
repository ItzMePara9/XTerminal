import { FastifyInstance } from "fastify";
import { prisma } from "../context.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: "ok", database: "connected" });
    } catch (err) {
      return reply
        .status(503)
        .send({ status: "degraded", database: "unavailable" });
    }
  });
}
