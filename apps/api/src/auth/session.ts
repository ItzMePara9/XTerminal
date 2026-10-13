import { FastifyReply, FastifyRequest } from "fastify";
import { prisma, logger } from "../context.js";
import { config } from "../config.js";
import { sha256Hex, randomToken } from "@xterminal/crypto";
import { unauthorized } from "../util/errors.js";

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; sessionId: string }> {
  const token = randomToken(32);
  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
      expiresAt: new Date(Date.now() + config.sessionTtlMs),
    },
  });
  return { token, sessionId: "" };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.sessionCookieName, { path: "/" });
}

/** Load the session for this request (from cookie), if valid. */
export async function loadSession(
  request: FastifyRequest,
): Promise<AuthedUser | null> {
  const token = request.cookies[config.sessionCookieName];
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt < new Date()) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
    totpEnabled: session.user.totpEnabled,
    sessionId: session.id,
  };
}

/** Fastify preHandler that requires a logged-in user. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await loadSession(request);
  if (!user) {
    sendUnauthorized(reply);
    return;
  }
  request.user = user;
}

function sendUnauthorized(reply: FastifyReply): void {
  void reply.status(401).send({ error: "UNAUTHORIZED", message: "Authentication required" });
}

export async function revokeSession(sessionId: string, userId?: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: {
      id: sessionId,
      ...(userId ? { userId } : {}),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  logger.info({ userId }, "auth: all sessions revoked");
}
