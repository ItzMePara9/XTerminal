import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { prisma, logger } from "../context.js";
import { config } from "../config.js";
import { requireAuth, createSession, setSessionCookie } from "../auth/session.js";
import { badRequest, sendError, unauthorized } from "../util/errors.js";
import { audit } from "../services/audit.js";
import { renameSecurityKeySchema } from "@xterminal/validation";

/**
 * WebAuthn challenges are held in memory with a short TTL. This binds the
 * browser to a single app instance; horizontal scaling requires moving this
 * store to Redis (documented in README).
 */
const challenges = new Map<string, { challenge: string; expiresAt: number }>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function storeChallenge(key: string, challenge: string): void {
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (challenges.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of challenges) {
      if (v.expiresAt < now) challenges.delete(k);
    }
  }
  challenges.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

function takeChallenge(key: string): string | null {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

function rpID(): string {
  return config.webauthn.rpID;
}

function expectedOrigin(): string {
  return config.webauthn.origin || config.appUrl;
}

export async function webauthnRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Registration (requires an authenticated session)
  // -------------------------------------------------------------------------
  app.get("/api/security-keys/register/options", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: request.user!.id },
        include: { webauthnCredentials: true },
      });
      if (!user) return sendError(reply, unauthorized());

      const options = await generateRegistrationOptions({
        rpName: config.webauthn.rpName,
        rpID: rpID(),
        userName: user.email,
        userDisplayName: user.name ?? user.email,
        userID: isoUint8Array.fromUTF8String(user.id),
        attestationType: "none",
        excludeCredentials: user.webauthnCredentials.map((cred) => ({
          id: cred.id,
          transports: cred.transports as AuthenticatorTransport[],
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      storeChallenge(`reg:${user.id}`, options.challenge);
      return reply.send(options);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/security-keys/register", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const body = z
        .object({
          name: z.string().trim().min(1).max(120),
          response: z.record(z.unknown()),
        })
        .parse(request.body);

      const challenge = takeChallenge(`reg:${request.user!.id}`);
      if (!challenge) {
        return sendError(reply, badRequest("Challenge expired - try again", "CHALLENGE_EXPIRED"));
      }

      const verification = await verifyRegistrationResponse({
        response: body.response as never,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigin(),
        expectedRPID: rpID(),
        requireUserVerification: false,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return sendError(reply, badRequest("Security key registration failed", "WEBAUTHN_FAILED"));
      }

      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
      await prisma.webAuthnCredential.create({
        data: {
          id: credentialID,
          userId: request.user!.id,
          publicKey: Buffer.from(credentialPublicKey),
          counter,
          transports: (body.response as { transports?: string[] }).transports ?? [],
          name: body.name,
        },
      });
      await audit("webauthn.registered", {
        userId: request.user!.id,
        target: body.name,
        ip: request.ip,
      });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // List / rename / remove keys
  // -------------------------------------------------------------------------
  app.get("/api/security-keys", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const keys = await prisma.webAuthnCredential.findMany({
        where: { userId: request.user!.id },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/api/security-keys/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { name } = renameSecurityKeySchema.parse(request.body);
      // Ownership enforced by the userId filter.
      const updated = await prisma.webAuthnCredential.updateMany({
        where: { id, userId: request.user!.id },
        data: { name },
      });
      if (updated.count === 0) return sendError(reply, badRequest("Security key not found", "NOT_FOUND"));
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/security-keys/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.webAuthnCredential.deleteMany({
        where: { id, userId: request.user!.id },
      });
      if (deleted.count === 0) return sendError(reply, badRequest("Security key not found", "NOT_FOUND"));
      await audit("webauthn.removed", { userId: request.user!.id, target: id, ip: request.ip });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Authentication (login with a security key)
  // -------------------------------------------------------------------------
  app.post("/api/auth/webauthn/options", async (request, reply) => {
    try {
      const { email } = z.object({ email: z.string().email().optional() }).parse(request.body ?? {});
      let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;

      if (email) {
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          include: { webauthnCredentials: true },
        });
        if (user && user.webauthnCredentials.length > 0) {
          allowCredentials = user.webauthnCredentials.map((c) => ({
            id: c.id,
            transports: c.transports as AuthenticatorTransport[],
          }));
        }
      }

      const options = await generateAuthenticationOptions({
        rpID: rpID(),
        userVerification: "preferred",
        allowCredentials,
      });

      // Keyed by a random id returned to the client, not by user, so that an
      // unauthenticated caller cannot poison another user's challenge slot.
      const requestId = isoBase64URL.fromUTF8String(
        `${Math.random().toString(36).slice(2)}${Date.now()}`,
      );
      storeChallenge(`auth:${requestId}`, options.challenge);
      return reply.send({ requestId, options });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/auth/webauthn/verify", async (request, reply) => {
    try {
      const body = z
        .object({
          requestId: z.string().min(4).max(200),
          email: z.string().email().optional(),
          response: z.record(z.unknown()),
        })
        .parse(request.body);

      const challenge = takeChallenge(`auth:${body.requestId}`);
      if (!challenge) {
        return sendError(reply, badRequest("Challenge expired - try again", "CHALLENGE_EXPIRED"));
      }

      const credentialId = (body.response as { id?: string }).id;
      if (!credentialId) {
        return sendError(reply, badRequest("Missing credential id", "WEBAUTHN_FAILED"));
      }

      // Locate the credential. If the user supplied an email we additionally
      // constrain the lookup to that user.
      const dbCred = await prisma.webAuthnCredential.findFirst({
        where: { id: credentialId },
        include: { user: true },
      });
      if (!dbCred || (body.email && dbCred.user.email !== body.email.toLowerCase())) {
        return sendError(reply, unauthorized("Unknown security key", "WEBAUTHN_FAILED"));
      }
      if (config.emailVerificationRequired && !dbCred.user.emailVerified) {
        return sendError(reply, unauthorized("Email address not verified", "EMAIL_NOT_VERIFIED"));
      }

      const verification = await verifyAuthenticationResponse({
        response: body.response as never,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigin(),
        expectedRPID: rpID(),
        authenticator: {
          credentialID: dbCred.id,
          credentialPublicKey: new Uint8Array(dbCred.publicKey),
          counter: dbCred.counter,
          transports: dbCred.transports as AuthenticatorTransport[],
        },
        requireUserVerification: false,
      });

      if (!verification.verified) {
        logger.warn({ userId: dbCred.userId }, "webauthn: verification failed");
        return sendError(reply, unauthorized("Security key verification failed", "WEBAUTHN_FAILED"));
      }

      const { authenticationInfo } = verification;
      if (authenticationInfo.newCounter <= dbCred.counter) {
        // Possible cloned credential - refuse and revoke.
        await prisma.webAuthnCredential.delete({ where: { id: dbCred.id } });
        logger.error({ userId: dbCred.userId }, "webauthn: counter regression detected, credential revoked");
        return sendError(reply, unauthorized("Credential validation failed - key removed", "WEBAUTHN_CLONE"));
      }

      await prisma.webAuthnCredential.update({
        where: { id: dbCred.id },
        data: { counter: authenticationInfo.newCounter, lastUsedAt: new Date() },
      });

      const { token } = await createSession(dbCred.user.id, {
        userAgent: (request.headers["user-agent"] as string) ?? null,
        ip: request.ip,
      });
      setSessionCookie(reply, token);
      await audit("webauthn.login", { userId: dbCred.user.id, ip: request.ip });

      const hasSecurityKey =
        (await prisma.webAuthnCredential.count({ where: { userId: dbCred.user.id } })) > 0;
      return reply.send({
        user: {
          id: dbCred.user.id,
          email: dbCred.user.email,
          name: dbCred.user.name,
          emailVerified: dbCred.user.emailVerified,
          totpEnabled: dbCred.user.totpEnabled,
          hasSecurityKey,
          createdAt: dbCred.user.createdAt,
        },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  logger.debug("webauthn routes registered");
}
