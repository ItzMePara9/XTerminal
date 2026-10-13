import { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  changePasswordSchema,
  updateProfileSchema,
} from "@xterminal/validation";
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  randomToken,
  sha256Hex,
  totpUri,
  verifyTotp,
} from "@xterminal/crypto";
import { prisma, logger } from "../context.js";
import { config } from "../config.js";
import {
  clearSessionCookie,
  createSession,
  loadSession,
  requireAuth,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
} from "../auth/session.js";
import { badRequest, conflict, sendError, unauthorized } from "../util/errors.js";
import { audit } from "../services/audit.js";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/mailer.js";

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

function requestMeta(request: { headers: Record<string, unknown>; ip?: string }) {
  return {
    userAgent: (request.headers["user-agent"] as string) ?? null,
    ip: request.ip ?? null,
  };
}

/** Stricter brute-force protection for credential endpoints. */
const AUTH_RATE_LIMIT = {
  rateLimit: {
    max: 10,
    timeWindow: "1 minute",
  },
} as const;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // POST /api/auth/register
  // -------------------------------------------------------------------------
  app.post("/api/auth/register", { config: AUTH_RATE_LIMIT }, async (request, reply) => {
    try {
      const input = registerSchema.parse(request.body);

      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) {
        return sendError(reply, conflict("An account with this email already exists", "EMAIL_TAKEN"));
      }

      const passwordHash = await argon2.hash(input.password, ARGON2_OPTS);
      const verifyToken = randomToken(32);

      const user = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name ?? null,
          passwordHash,
          emailVerifyToken: sha256Hex(verifyToken),
          emailVerifyAt: null,
        },
      });

      await sendVerificationEmail(user.email, verifyToken);
      await audit("user.register", { userId: user.id, ip: request.ip });

      // Do not auto-login when verification is required.
      if (config.emailVerificationRequired) {
        return reply.status(201).send({
          message: "Account created. Check your email to verify your address before logging in.",
          emailSent: true,
        });
      }

      const { token } = await createSession(user.id, requestMeta(request));
      setSessionCookie(reply, token);
      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          totpEnabled: false,
          hasSecurityKey: false,
          createdAt: user.createdAt,
        },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/login
  // -------------------------------------------------------------------------
  app.post("/api/auth/login", { config: AUTH_RATE_LIMIT }, async (request, reply) => {
    try {
      const input = loginSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user) {
        await audit("user.login_failed", { ip: request.ip, meta: { email: input.email } });
        return sendError(reply, unauthorized("Invalid email or password", "INVALID_CREDENTIALS"));
      }

      const valid = await argon2
        .verify(user.passwordHash, input.password)
        .catch(() => false);
      if (!valid) {
        await audit("user.login_failed", { userId: user.id, ip: request.ip });
        return sendError(reply, unauthorized("Invalid email or password", "INVALID_CREDENTIALS"));
      }

      if (config.emailVerificationRequired && !user.emailVerified) {
        return sendError(reply, unauthorized("Email address not verified", "EMAIL_NOT_VERIFIED"));
      }

      if (user.totpEnabled) {
        if (!input.totpCode) {
          return sendError(reply, unauthorized("TOTP code required", "TOTP_REQUIRED"));
        }
        const secret = decryptSecret(user.totpSecret!);
        if (!verifyTotp(secret, input.totpCode)) {
          return sendError(reply, unauthorized("Invalid TOTP code", "INVALID_TOTP"));
        }
      }

      const { token } = await createSession(user.id, requestMeta(request));
      setSessionCookie(reply, token);
      await audit("user.login", { userId: user.id, ip: request.ip });

      const hasSecurityKey =
        (await prisma.webAuthnCredential.count({ where: { userId: user.id } })) > 0;

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          totpEnabled: user.totpEnabled,
          hasSecurityKey,
          createdAt: user.createdAt,
        },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me
  // -------------------------------------------------------------------------
  app.get("/api/auth/me", async (request, reply) => {
    try {
      const user = await loadSession(request);
      if (!user) return sendError(reply, unauthorized());
      const [row, hasSecurityKey] = await Promise.all([
        prisma.user.findUnique({ where: { id: user.id } }),
        prisma.webAuthnCredential.count({ where: { userId: user.id } }),
      ]);
      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          totpEnabled: user.totpEnabled,
          hasSecurityKey: hasSecurityKey > 0,
          createdAt: row?.createdAt ?? new Date().toISOString(),
        },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/logout
  // -------------------------------------------------------------------------
  app.post("/api/auth/logout", async (request, reply) => {
    try {
      const user = await loadSession(request);
      if (user) {
        await revokeSession(user.sessionId, user.id);
        await audit("user.logout", { userId: user.id, ip: request.ip });
      }
      clearSessionCookie(reply);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/sessions  |  DELETE /api/auth/sessions/:id  |  POST .../logout-all
  // -------------------------------------------------------------------------
  app.get("/api/auth/sessions", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const sessions = await prisma.authSession.findMany({
        where: { userId: request.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({
        sessions: sessions.map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ip: s.ip,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          current: s.id === request.user!.sessionId,
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/auth/sessions/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      await revokeSession(id, request.user!.id);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/auth/sessions/logout-all", { preHandler: requireAuth }, async (request, reply) => {
    try {
      await revokeAllSessions(request.user!.id);
      clearSessionCookie(reply);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Email verification
  // -------------------------------------------------------------------------
  app.post("/api/auth/verify-email", async (request, reply) => {
    try {
      const { token } = verifyEmailSchema.parse(request.body);
      const user = await prisma.user.findFirst({
        where: { emailVerifyToken: sha256Hex(token) },
      });
      if (!user) return sendError(reply, badRequest("Invalid or expired verification token", "INVALID_TOKEN"));
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          emailVerifyToken: null,
          emailVerifyAt: new Date(),
        },
      });
      await audit("user.email_verified", { userId: user.id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/auth/resend-verification", async (request, reply) => {
    try {
      const { email } = z.object({ email: z.string().email() }).parse(request.body);
      const user = await prisma.user.findUnique({ where: { email } });
      // Do not reveal whether the account exists.
      if (user && !user.emailVerified) {
        const token = randomToken(32);
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifyToken: sha256Hex(token) },
        });
        await sendVerificationEmail(email, token);
      }
      return reply.send({ ok: true, message: "If the account exists and is unverified, a new email has been sent." });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------
  app.post("/api/auth/forgot-password", { config: AUTH_RATE_LIMIT }, async (request, reply) => {
    try {
      const { email } = forgotPasswordSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email } });
      // Always respond OK to avoid account enumeration.
      if (user) {
        const token = randomToken(32);
        await prisma.user.update({
          where: { id: user.id },
          data: { resetToken: sha256Hex(token), resetTokenAt: new Date() },
        });
        await sendPasswordResetEmail(email, token);
        await audit("user.password_reset", { userId: user.id, ip: request.ip, meta: { requested: true } });
      }
      return reply.send({ ok: true, message: "If the account exists, a reset link has been sent." });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/auth/reset-password", async (request, reply) => {
    try {
      const { token, password } = resetPasswordSchema.parse(request.body);
      const user = await prisma.user.findFirst({ where: { resetToken: sha256Hex(token) } });
      if (
        !user ||
        !user.resetTokenAt ||
        Date.now() - user.resetTokenAt.getTime() > config.resetTokenTtlMs
      ) {
        return sendError(reply, badRequest("Invalid or expired reset token", "INVALID_TOKEN"));
      }
      const passwordHash = await argon2.hash(password, ARGON2_OPTS);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, resetToken: null, resetTokenAt: null },
      });
      // Invalidate every existing session after a password reset.
      await revokeAllSessions(user.id);
      await audit("user.password_reset", { userId: user.id, ip: request.ip });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Change password (authed)
  // -------------------------------------------------------------------------
  app.post("/api/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user) return sendError(reply, unauthorized());
      const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
      if (!valid) {
        return sendError(reply, unauthorized("Current password is incorrect", "INVALID_CREDENTIALS"));
      }
      const passwordHash = await argon2.hash(newPassword, ARGON2_OPTS);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await audit("user.password_changed", { userId: user.id, ip: request.ip });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------
  app.patch("/api/auth/profile", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { name } = updateProfileSchema.parse(request.body);
      const user = await prisma.user.update({
        where: { id: request.user!.id },
        data: { name: name ?? null },
      });
      return reply.send({ user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // TOTP 2FA
  // -------------------------------------------------------------------------
  app.post("/api/auth/totp/setup", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
      if (user?.totpEnabled) {
        return sendError(reply, conflict("TOTP is already enabled", "TOTP_ENABLED"));
      }
      const secret = generateTotpSecret();
      // Store the pending secret encrypted; only activated after code verification.
      await prisma.user.update({
        where: { id: user!.id },
        data: { totpSecret: encryptSecret(secret), totpEnabled: false },
      });
      return reply.send({ secret, uri: totpUri(secret, user!.email) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/auth/totp/enable", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
      const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user?.totpSecret) {
        return sendError(reply, badRequest("Run TOTP setup first", "TOTP_NOT_SETUP"));
      }
      const secret = decryptSecret(user.totpSecret);
      if (!verifyTotp(secret, code)) {
        return sendError(reply, badRequest("Invalid code", "INVALID_TOTP"));
      }
      await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
      await audit("user.totp_enabled", { userId: user.id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/auth/totp/disable", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
      const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user?.totpEnabled) {
        return sendError(reply, badRequest("TOTP is not enabled", "TOTP_NOT_ENABLED"));
      }
      const secret = decryptSecret(user.totpSecret!);
      if (!verifyTotp(secret, code)) {
        return sendError(reply, badRequest("Invalid code", "INVALID_TOTP"));
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { totpSecret: null, totpEnabled: false },
      });
      await audit("user.totp_disabled", { userId: user.id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  logger.debug("auth routes registered");
}
