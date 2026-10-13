import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createConnectionSchema,
  updateConnectionSchema,
  createGroupSchema,
  updateGroupSchema,
} from "@xterminal/validation";
import { decryptSecret, encryptSecret, sshFingerprint } from "@xterminal/crypto";
// ssh2 is CommonJS: Node's ESM interop cannot statically detect its named
// exports, so pull it in via the default export and destructure.
import ssh2 from "ssh2";
const { utils: ssh2Utils } = ssh2;
import { prisma, logger } from "../context.js";
import { config } from "../config.js";
import { requireAuth } from "../auth/session.js";
import { badRequest, notFound, sendError, tooMany } from "../util/errors.js";
import { audit } from "../services/audit.js";
import type { AuthMethod, ConnectionDto } from "@xterminal/types";

function connectionDto(
  c: {
    id: string;
    nickname: string | null;
    host: string;
    port: number;
    username: string;
    authMethod: string;
    groupId: string | null;
    sshKeyId: string | null;
    certificateId: string | null;
    jumpConnectionId: string | null;
    passwordCipher: string | null;
    passphraseCipher: string | null;
    favorite: boolean;
    lastConnectedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    group?: { name: string } | null;
    sshKey?: { name: string } | null;
    certificate?: { name: string } | null;
    tags?: { tag: { name: string } }[];
  },
): ConnectionDto {
  return {
    id: c.id,
    nickname: c.nickname,
    host: c.host,
    port: c.port,
    username: c.username,
    authMethod: c.authMethod as AuthMethod,
    groupId: c.groupId,
    groupName: c.group?.name ?? null,
    sshKeyId: c.sshKeyId,
    sshKeyName: c.sshKey?.name ?? null,
    certificateId: c.certificateId,
    certificateName: c.certificate?.name ?? null,
    jumpConnectionId: c.jumpConnectionId,
    hasPassword: !!c.passwordCipher,
    hasPassphrase: !!c.passphraseCipher,
    favorite: c.favorite,
    tags: (c.tags ?? []).map((t) => t.tag.name).sort(),
    lastConnectedAt: c.lastConnectedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const CONNECTION_INCLUDE = {
  group: { select: { name: true } },
  sshKey: { select: { name: true } },
  certificate: { select: { name: true } },
  tags: { include: { tag: true } },
} as const;

/** Validate that referenced entities belong to the user. */
async function validateReferences(
  userId: string,
  input: {
    sshKeyId?: string | null;
    certificateId?: string | null;
    groupId?: string | null;
    jumpConnectionId?: string | null;
  },
): Promise<void> {
  if (input.sshKeyId) {
    const key = await prisma.sshKey.findFirst({ where: { id: input.sshKeyId, userId } });
    if (!key) throw badRequest("SSH key not found", "KEY_NOT_FOUND");
  }
  if (input.certificateId) {
    const cert = await prisma.sshCertificate.findFirst({
      where: { id: input.certificateId, userId },
    });
    if (!cert) throw badRequest("Certificate not found", "CERT_NOT_FOUND");
  }
  if (input.groupId) {
    const group = await prisma.connectionGroup.findFirst({
      where: { id: input.groupId, userId },
    });
    if (!group) throw badRequest("Group not found", "GROUP_NOT_FOUND");
  }
  if (input.jumpConnectionId) {
    const jump = await prisma.connection.findFirst({
      where: { id: input.jumpConnectionId, userId },
    });
    if (!jump) throw badRequest("Jump host connection not found", "JUMP_NOT_FOUND");
  }
}

/** Create/refresh Tag rows and return the tag ids for a connection. */
async function resolveTagIds(userId: string, tags: string[] | undefined): Promise<string[]> {
  if (!tags) return [];
  const unique = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  const ids: string[] = [];
  for (const name of unique) {
    const tag = await prisma.tag.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
    });
    ids.push(tag.id);
  }
  return ids;
}

/** Key material for a connection, validated by actually parsing the key. */
async function keyMaterial(
  userId: string,
  input: {
    privateKey?: string | null;
    passphrase?: string | null;
    sshKeyId?: string | null;
  },
): Promise<{
  privateKeyCipher: string | null;
  passphraseCipher: string | null;
  keyFingerprint: string | null;
  keyType: string | null;
} | null> {
  if (input.privateKey) {
    const parsed = ssh2Utils.parseKey(input.privateKey, input.passphrase ?? undefined) as
      | { type?: string; getPublicPart?: () => Buffer }
      | undefined
      | Error;
    if (!parsed || parsed instanceof Error || !parsed.type) {
      throw badRequest(
        "Could not parse private key" +
          (input.passphrase ? "" : " - if it is encrypted, provide the passphrase"),
        "INVALID_KEY",
      );
    }
    const pub = parsed.getPublicPart?.();
    const fingerprint = pub ? sshFingerprint(pub) : null;
    return {
      privateKeyCipher: encryptSecret(input.privateKey),
      passphraseCipher: input.passphrase ? encryptSecret(input.passphrase) : null,
      keyFingerprint: fingerprint,
      keyType: parsed.type,
    };
  }
  return null;
}

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Connections CRUD
  // -------------------------------------------------------------------------
  app.get("/api/connections", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const connections = await prisma.connection.findMany({
        where: { userId: request.user!.id },
        include: CONNECTION_INCLUDE,
        orderBy: [{ favorite: "desc" }, { lastConnectedAt: "desc" }, { createdAt: "desc" }],
      });
      return reply.send({ connections: connections.map(connectionDto) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/connections", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = createConnectionSchema.parse(request.body);
      const userId = request.user!.id;

      const count = await prisma.connection.count({ where: { userId } });
      if (count >= config.limits.maxConnectionsPerUser) {
        return sendError(
          reply,
          tooMany(`Connection limit reached (${config.limits.maxConnectionsPerUser})`),
        );
      }

      await validateReferences(userId, input);

      const material = await keyMaterial(userId, input);

      const connection = await prisma.connection.create({
        data: {
          userId,
          nickname: input.nickname ?? null,
          host: input.host,
          port: input.port,
          username: input.username,
          authMethod: input.authMethod,
          passwordCipher: input.password ? encryptSecret(input.password) : null,
          privateKeyCipher: material?.privateKeyCipher ?? null,
          passphraseCipher: material?.passphraseCipher ?? null,
          sshKeyId: input.sshKeyId ?? null,
          certificateId: input.certificateId ?? null,
          groupId: input.groupId ?? null,
          jumpConnectionId: input.jumpConnectionId ?? null,
          favorite: input.favorite ?? false,
          tags: {
            create: (await resolveTagIds(userId, input.tags)).map((tagId) => ({ tagId })),
          },
        },
        include: CONNECTION_INCLUDE,
      });

      await audit("connection.created", { userId, target: connection.id, meta: { host: connection.host } });
      return reply.status(201).send({ connection: connectionDto(connection) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/api/connections/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const connection = await prisma.connection.findFirst({
        where: { id, userId: request.user!.id },
        include: CONNECTION_INCLUDE,
      });
      if (!connection) return sendError(reply, notFound("Connection not found"));
      return reply.send({ connection: connectionDto(connection) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/api/connections/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const input = updateConnectionSchema.parse(request.body);
      const userId = request.user!.id;

      const existing = await prisma.connection.findFirst({ where: { id, userId } });
      if (!existing) return sendError(reply, notFound("Connection not found"));

      await validateReferences(userId, input);
      const material = await keyMaterial(userId, input);
      const tagIds = await resolveTagIds(userId, input.tags);

      const data: Record<string, unknown> = {};
      if (input.nickname !== undefined) data.nickname = input.nickname ?? null;
      if (input.host !== undefined) data.host = input.host;
      if (input.port !== undefined) data.port = input.port;
      if (input.username !== undefined) data.username = input.username;
      if (input.authMethod !== undefined) data.authMethod = input.authMethod;
      if (input.password !== undefined) data.passwordCipher = input.password ? encryptSecret(input.password) : null;
      if (input.privateKey !== undefined) data.privateKeyCipher = material?.privateKeyCipher ?? null;
      if (input.passphrase !== undefined) data.passphraseCipher = material?.passphraseCipher ?? null;
      if (input.sshKeyId !== undefined) data.sshKeyId = input.sshKeyId ?? null;
      if (input.certificateId !== undefined) data.certificateId = input.certificateId ?? null;
      if (input.groupId !== undefined) data.groupId = input.groupId ?? null;
      if (input.jumpConnectionId !== undefined) data.jumpConnectionId = input.jumpConnectionId ?? null;
      if (input.favorite !== undefined) data.favorite = input.favorite;

      const connection = await prisma.connection.update({
        where: { id },
        data,
        include: CONNECTION_INCLUDE,
      });

      if (input.tags !== undefined) {
        await prisma.tagOnConnection.deleteMany({ where: { connectionId: id } });
        await prisma.tagOnConnection.createMany({
          data: tagIds.map((tagId) => ({ connectionId: id, tagId })),
        });
      }

      await audit("connection.updated", { userId, target: id });
      const refreshed = await prisma.connection.findUniqueOrThrow({
        where: { id },
        include: CONNECTION_INCLUDE,
      });
      return reply.send({ connection: connectionDto(refreshed) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/connections/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.connection.deleteMany({
        where: { id, userId: request.user!.id },
      });
      if (deleted.count === 0) return sendError(reply, notFound("Connection not found"));
      await audit("connection.deleted", { userId: request.user!.id, target: id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------
  app.get("/api/groups", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const groups = await prisma.connectionGroup.findMany({
        where: { userId: request.user!.id },
        orderBy: { name: "asc" },
        include: { _count: { select: { connections: true } } },
      });
      return reply.send({
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          color: g.color,
          connectionCount: g._count.connections,
          createdAt: g.createdAt,
        })),
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/groups", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = createGroupSchema.parse(request.body);
      const existing = await prisma.connectionGroup.findFirst({
        where: { userId: request.user!.id, name: input.name },
      });
      if (existing) return sendError(reply, badRequest("A group with this name already exists", "GROUP_EXISTS"));
      const group = await prisma.connectionGroup.create({
        data: { userId: request.user!.id, name: input.name, color: input.color ?? null },
      });
      await audit("group.created", { userId: request.user!.id, target: group.id });
      return reply.status(201).send({
        group: { id: group.id, name: group.name, color: group.color, connectionCount: 0, createdAt: group.createdAt },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/api/groups/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const input = updateGroupSchema.parse(request.body);
      const updated = await prisma.connectionGroup.updateMany({
        where: { id, userId: request.user!.id },
        data: { ...(input.name ? { name: input.name } : {}), ...(input.color !== undefined ? { color: input.color ?? null } : {}) },
      });
      if (updated.count === 0) return sendError(reply, notFound("Group not found"));
      await audit("group.updated", { userId: request.user!.id, target: id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/groups/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.connectionGroup.deleteMany({
        where: { id, userId: request.user!.id },
      });
      if (deleted.count === 0) return sendError(reply, notFound("Group not found"));
      await audit("group.deleted", { userId: request.user!.id, target: id });
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------
  app.get("/api/tags", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const tags = await prisma.tag.findMany({
        where: { userId: request.user!.id },
        orderBy: { name: "asc" },
      });
      return reply.send({ tags: tags.map((t) => ({ id: t.id, name: t.name })) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/api/tags/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.tag.deleteMany({ where: { id, userId: request.user!.id } });
      if (deleted.count === 0) return sendError(reply, notFound("Tag not found"));
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  logger.debug("connection routes registered");
}

export { connectionDto, CONNECTION_INCLUDE };
