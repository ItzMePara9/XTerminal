import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSshKeySchema, createCertificateSchema } from "@xterminal/validation";
import { encryptSecret, sshFingerprint } from "@xterminal/crypto";
// ssh2 is CommonJS: Node's ESM interop cannot statically detect its named
// exports, so pull it in via the default export and destructure.
import ssh2 from "ssh2";
const { utils: ssh2Utils } = ssh2;
import { prisma, logger } from "../context.js";
import { requireAuth } from "../auth/session.js";
import { badRequest, notFound, sendError } from "../util/errors.js";
import { audit } from "../services/audit.js";

type ParsedKey = { type?: string; getPublicPart?: () => Buffer };

/**
 * Parse and validate a private key. Throws a user-facing error when the key
 * cannot be parsed (wrong format, or encrypted key without a passphrase).
 */
function parsePrivateKey(
  privateKey: string,
  passphrase?: string | null,
): { fingerprint: string | null; keyType: string | null } {
  const parsed = ssh2Utils.parseKey(privateKey, passphrase ?? undefined) as
    | ParsedKey
    | ParsedKey[]
    | Error
    | undefined;
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!key || key instanceof Error || !key.type) {
    throw badRequest(
      "Could not parse private key" +
        (passphrase ? "" : " - if the key is encrypted, provide its passphrase"),
      "INVALID_KEY",
    );
  }
  const pub = key.getPublicPart?.();
  return { fingerprint: pub ? sshFingerprint(pub) : null, keyType: key.type };
}

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // SSH keys
  // -------------------------------------------------------------------------
  app.get("/api/ssh-keys", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const keys = await prisma.sshKey.findMany({
        where: { userId: request.user!.id },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          fingerprint: k.fingerprint,
          keyType: k.keyType,
          hasPassphrase: !!k.passphraseCipher,
          createdAt: k.createdAt,
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/ssh-keys", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = createSshKeySchema.parse(request.body);
      const existing = await prisma.sshKey.findFirst({
        where: { userId: request.user!.id, name: input.name },
      });
      if (existing) {
        return sendError(reply, badRequest("A key with this name already exists", "KEY_EXISTS"));
      }
      const { fingerprint, keyType } = parsePrivateKey(input.privateKey, input.passphrase);
      const key = await prisma.sshKey.create({
        data: {
          userId: request.user!.id,
          name: input.name,
          privateKeyCipher: encryptSecret(input.privateKey),
          passphraseCipher: input.passphrase ? encryptSecret(input.passphrase) : null,
          fingerprint,
          keyType,
        },
      });
      await audit("sshkey.created", { userId: request.user!.id, target: key.id, meta: { keyType } });
      return reply.status(201).send({
        key: {
          id: key.id,
          name: key.name,
          fingerprint: key.fingerprint,
          keyType: key.keyType,
          hasPassphrase: !!key.passphraseCipher,
          createdAt: key.createdAt,
        },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/ssh-keys/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.sshKey.deleteMany({
        where: { id, userId: request.user!.id },
      });
      if (deleted.count === 0) return sendError(reply, notFound("SSH key not found"));
      await audit("sshkey.deleted", { userId: request.user!.id, target: id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // SSH certificates
  // -------------------------------------------------------------------------
  app.get("/api/certificates", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const certs = await prisma.sshCertificate.findMany({
        where: { userId: request.user!.id },
        orderBy: { createdAt: "desc" },
        include: { key: { select: { name: true } } },
      });
      return reply.send({
        certificates: certs.map((c) => ({
          id: c.id,
          name: c.name,
          keyId: c.keyId,
          keyName: c.key?.name ?? null,
          createdAt: c.createdAt,
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/certificates", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = createCertificateSchema.parse(request.body);
      const existing = await prisma.sshCertificate.findFirst({
        where: { userId: request.user!.id, name: input.name },
      });
      if (existing) {
        return sendError(reply, badRequest("A certificate with this name already exists", "CERT_EXISTS"));
      }
      if (input.keyId) {
        const key = await prisma.sshKey.findFirst({
          where: { id: input.keyId, userId: request.user!.id },
        });
        if (!key) return sendError(reply, badRequest("Referenced SSH key not found", "KEY_NOT_FOUND"));
      }
      const cert = await prisma.sshCertificate.create({
        data: {
          userId: request.user!.id,
          name: input.name,
          certificate: input.certificate,
          keyId: input.keyId ?? null,
        },
      });
      await audit("certificate.created", { userId: request.user!.id, target: cert.id });
      return reply.status(201).send({
        certificate: {
          id: cert.id,
          name: cert.name,
          keyId: cert.keyId,
          keyName: null,
          createdAt: cert.createdAt,
        },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/certificates/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.sshCertificate.deleteMany({
        where: { id, userId: request.user!.id },
      });
      if (deleted.count === 0) return sendError(reply, notFound("Certificate not found"));
      await audit("certificate.deleted", { userId: request.user!.id, target: id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Known hosts
  // -------------------------------------------------------------------------
  app.get("/api/known-hosts", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const hosts = await prisma.knownHost.findMany({
        where: { userId: request.user!.id },
        orderBy: [{ host: "asc" }, { port: "asc" }],
      });
      return reply.send({
        knownHosts: hosts.map((h) => ({
          id: h.id,
          host: h.host,
          port: h.port,
          keyType: h.keyType,
          fingerprint: h.fingerprint,
          trustedAt: h.trustedAt,
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/known-hosts/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.knownHost.deleteMany({
        where: { id, userId: request.user!.id },
      });
      if (deleted.count === 0) return sendError(reply, notFound("Known host not found"));
      await audit("knownhost.deleted", { userId: request.user!.id, target: id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  logger.debug("key routes registered");
}
