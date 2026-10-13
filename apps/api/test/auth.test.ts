/**
 * Auth + cross-user authorization tests (spec §30: auth, authorization,
 * connections CRUD) using the in-memory prisma mock.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedUser, type MockPrisma } from "./bootstrap";
import { buildApp } from "../src/app";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let prisma: MockPrisma;

beforeEach(async () => {
  prisma = resetDb();
  app = await buildApp();
  await app.ready();
});

async function loginAs(prisma: MockPrisma, email: string, password: string) {
  const { hash } = await import("argon2");
  const passwordHash = await hash(password, { type: 2, memoryCost: 8192, timeCost: 2, parallelism: 1 });
  const user = prisma.user.create({ data: { email, passwordHash, emailVerified: true } });
  return { userId: user.id as string, ...(await sessionFor(prisma, user.id as string)) };
}

/** Create an additional browser session for an existing user. */
async function sessionFor(prisma: MockPrisma, userId: string) {
  const { randomToken, sha256Hex } = await import("@xterminal/crypto");
  const token = randomToken(32);
  prisma.authSession.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { cookie: `xt_session=${token}` };
}

describe("health", () => {
  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("registration", () => {
  it("rejects a short password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "a@example.com", password: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate email", async () => {
    prisma.user.create({ data: { email: "a@example.com", passwordHash: "x" } });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "a@example.com", password: "a-really-long-password" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("registers, hashes the password, and sets an httpOnly cookie session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "new@example.com", password: "a-really-long-password", name: "New" },
    });
    expect(res.statusCode).toBe(201);
    const rawCookie = res.headers["set-cookie"];
    const setCookie = (Array.isArray(rawCookie) ? rawCookie : [String(rawCookie)]).filter(Boolean);
    const sessionCookie = setCookie.find((c) => c.startsWith("xt_session="));
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie).toMatch(/httponly/i);
    expect(sessionCookie).toMatch(/samesite=lax/i);

    const token = sessionCookie!.split(";")[0]!.split("=")[1]!;
    // Only the hash of the token is stored.
    const stored = prisma.authSession.findFirst({ where: {} });
    expect(stored).toBeTruthy();
    const { sha256Hex } = await import("@xterminal/crypto");
    expect(stored!.tokenHash).toBe(sha256Hex(token));
    // Password itself is never stored.
    const { mockTables } = await import("./mock-prisma");
    expect(JSON.stringify(mockTables.user.rows)).not.toContain("a-really-long-password");
  });
});

describe("sessions", () => {
  it("rejects anonymous access to protected routes", async () => {
    for (const url of ["/api/auth/me", "/api/connections", "/api/terminal", "/api/groups"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });

  it("invalid token gets 401, not 500", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: "xt_session=totally-invalid-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("revoked sessions no longer authenticate", async () => {
    const { cookie } = await seedUser(prisma);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("logout-all revokes every session", async () => {
    const alice = await loginAs(prisma, "alice@example.com", "password-12345678");
    const aliceSecondDevice = await sessionFor(prisma, alice.userId); // same user, second browser
    await app.inject({ method: "POST", url: "/api/auth/sessions/logout-all", headers: { cookie: alice.cookie } });
    for (const cookie of [alice.cookie, aliceSecondDevice.cookie]) {
      expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
    }
  });

  it("a session for one user cannot be used by listing another's sessions", async () => {
    const alice = await seedUser(prisma, { email: "alice@example.com" });
    const bob = await seedUser(prisma, { email: "bob@example.com" });
    const res = await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: alice.cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const s of body.sessions) {
      const row = prisma.authSession.findUnique({ where: { id: s.id } });
      expect(row!.userId).toBe(alice.userId);
      expect(row!.userId).not.toBe(bob.userId);
    }
  });
});

describe("cross-user isolation (authorization)", () => {
  let alice: { userId: string; cookie: string };
  let bob: { userId: string; cookie: string };

  beforeEach(async () => {
    alice = await seedUser(prisma, { email: "alice@example.com" });
    bob = await seedUser(prisma, { email: "bob@example.com" });
  });

  async function createConnection(cookie: string, host = "server1.internal"): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { cookie },
      payload: { host, port: 22, username: "root", authMethod: "PASSWORD", password: "ssh-password-1" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().connection.id as string;
  }

  it("users only see their own connections", async () => {
    await createConnection(alice.cookie, "alice-host.internal");
    await createConnection(bob.cookie, "bob-host.internal");
    const aliceList = (await app.inject({ method: "GET", url: "/api/connections", headers: { cookie: alice.cookie } })).json();
    const bobList = (await app.inject({ method: "GET", url: "/api/connections", headers: { cookie: bob.cookie } })).json();
    expect(aliceList.connections).toHaveLength(1);
    expect(aliceList.connections[0].host).toBe("alice-host.internal");
    expect(bobList.connections).toHaveLength(1);
    expect(bobList.connections[0].host).toBe("bob-host.internal");
  });

  it("bob cannot read, mutate, or delete alice's connection", async () => {
    const id = await createConnection(alice.cookie);
    expect((await app.inject({ method: "GET", url: `/api/connections/${id}`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/connections/${id}`,
          headers: { cookie: bob.cookie },
          payload: { nickname: "hacked" },
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/connections/${id}`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
    // Alice's data is untouched.
    const aliceView = (await app.inject({ method: "GET", url: `/api/connections/${id}`, headers: { cookie: alice.cookie } })).json();
    expect(aliceView.connection.nickname).toBeNull();
  });

  it("bob cannot open a terminal session for alice's connection", async () => {
    const id = await createConnection(alice.cookie);
    const res = await app.inject({
      method: "POST",
      url: `/api/connections/${id}/session`,
      headers: { cookie: bob.cookie },
      payload: {},
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.json()).not.toHaveProperty("token");
  });

  it("bob cannot delete alice's groups or tags", async () => {
    const group = (
      await app.inject({
        method: "POST",
        url: "/api/groups",
        headers: { cookie: alice.cookie },
        payload: { name: "prod" },
      })
    ).json().group;
    expect((await app.inject({ method: "DELETE", url: `/api/groups/${group.id}`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
    expect(prisma.connectionGroup.findUnique({ where: { id: group.id } })).toBeTruthy();
  });

  it("bob cannot reference alice's SSH key as his own connection's key", async () => {
    // Alice stores a (mock) key row directly.
    const key = prisma.sshKey.create({ data: { userId: alice.userId, name: "alice-key", keyCipher: "v1:x", fingerprint: "SHA256:abc", keyType: "ssh-ed25519" } });
    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { cookie: bob.cookie },
      payload: { host: "evil", port: 22, username: "root", authMethod: "KEY", sshKeyId: key.id as string },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("KEY_NOT_FOUND");
  });

  it("bob cannot terminate alice's terminal session", async () => {
    const id = await createConnection(alice.cookie);
    const { sessionId } = (
      await app.inject({
        method: "POST",
        url: `/api/connections/${id}/session`,
        headers: { cookie: alice.cookie },
        payload: { cols: 80, rows: 24 },
      })
    ).json();
    expect(
      (await app.inject({ method: "DELETE", url: `/api/terminal/${sessionId}`, headers: { cookie: bob.cookie } })).statusCode,
    ).toBe(404);
    // And cannot reattach either.
    expect(
      (await app.inject({ method: "POST", url: `/api/terminal/${sessionId}/reattach`, headers: { cookie: bob.cookie } })).statusCode,
    ).toBe(404);
  });
});

describe("connection validation + vault", () => {
  it("rejects PASSWORD auth without a password", async () => {
    const { cookie } = await seedUser(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { cookie },
      payload: { host: "h", port: 22, username: "u", authMethod: "PASSWORD" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("stores the SSH password encrypted, never returns it", async () => {
    const { cookie } = await seedUser(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { cookie },
      payload: { host: "vault-test", port: 2222, username: "deploy", authMethod: "PASSWORD", password: "super-secret-ssh-pw" },
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json().connection;
    expect(dto.hasPassword).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("super-secret-ssh-pw");
    const row = prisma.connection.findUnique({ where: { id: dto.id } });
    expect(row!.passwordCipher).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("super-secret-ssh-pw");
  });

  it("enforces the per-user connection limit", async () => {
    const { cookie } = await seedUser(prisma);
    const { config } = await import("../src/config");
    const original = config.limits.maxConnectionsPerUser;
    config.limits.maxConnectionsPerUser = 3;
    try {
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/connections",
          headers: { cookie },
          payload: { host: `h${i}`, port: 22, username: "u", authMethod: "PASSWORD", password: "pw-123456" },
        });
        expect(res.statusCode).toBe(201);
      }
      const res = await app.inject({
        method: "POST",
        url: "/api/connections",
        headers: { cookie },
        payload: { host: "h4", port: 22, username: "u", authMethod: "PASSWORD", password: "pw-123456" },
      });
      expect(res.statusCode).toBe(429);
    } finally {
      config.limits.maxConnectionsPerUser = original;
    }
  });
});
