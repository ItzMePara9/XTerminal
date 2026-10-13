/**
 * WebSocket terminal endpoint tests (spec §30: WebSocket).
 * Runs the real Fastify app on an ephemeral port and opens real WebSocket
 * connections with the `ws` client. The SSH target is a real in-process
 * ssh2 server (see ssh.test.ts for the deep SSH assertions); here we focus
 * on the handshake, ticket, and protocol framing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedUser, type MockPrisma } from "./bootstrap";
import { buildApp } from "../src/app";
import { sshManager } from "../src/services/ssh/manager";
import { Server, utils as ssh2Utils } from "ssh2";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { encryptSecret, randomToken } from "@xterminal/crypto";

const USERNAME = "tester";
const PASSWORD = "ws-test-password";

let app: FastifyInstance;
let baseUrl = "";
let prisma: MockPrisma;
let sshServer: { port: number; close: () => Promise<void> };
let connectionId: string;
let user: { userId: string; cookie: string };

async function startSshServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const { private: privateKey } = ssh2Utils.generateKeyPairSync("ed25519") as unknown as { private: string };
  const server = new Server({ hostKeys: [privateKey] as unknown as Buffer[] });
  server.on("connection", (conn) => {
    conn.on("authentication", (ctx) => {
      const { method, username, password } = ctx as unknown as { method: string; username: string; password?: string };
      if (method === "password" && username === USERNAME && password === PASSWORD) ctx.accept();
      else ctx.reject(["password"]);
    });
    conn.on("ready", () => {
      conn.on("session", (accept) => {
        const session = accept();
        session.on("pty", (a) => a?.());
        session.on("shell", (a) => {
          const stream = a();
          stream.write("shell:ready\r\n");
          stream.on("data", (d: Buffer) => stream.write(`echo:${JSON.stringify(d.toString("utf8"))}`));
        });
      });
    });
    conn.on("error", () => {});
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
  });
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Open a WS and collect frames until closed or a predicate matches. */
class WsCollector {
  ws: WebSocket;
  frames: Record<string, unknown>[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: { pred: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void }[] = [];

  constructor(url: string, headers: Record<string, string>) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      this.frames.push(f);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(f)) {
          w.resolve(f);
          return false;
        }
        return true;
      });
    });
    this.ws.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
  }

  async waitFor(pred: (f: Record<string, unknown>) => boolean, timeoutMs = 8000): Promise<Record<string, unknown>> {
    const existing = this.frames.find(pred);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout; frames so far: ${JSON.stringify(this.frames)}`)),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame));
  }

  close(): void {
    this.ws.close();
  }
}

function wsUrl(sessionId: string, token: string): string {
  return `${baseUrl.replace("http", "ws")}/ws/terminal/${sessionId}?token=${token}`;
}

beforeAll(async () => {
  sshServer = await startSshServer();
});

afterAll(async () => {
  sshManager.shutdownAll();
  await sshServer.close();
  await app?.close();
});

beforeEach(async () => {
  prisma = resetDb();
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr !== "object") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
  user = await seedUser(prisma);
  const conn = prisma.connection.create({
    data: {
      userId: user.userId,
      nickname: "ws-conn",
      host: "127.0.0.1",
      port: sshServer.port,
      username: USERNAME,
      authMethod: "PASSWORD",
      passwordCipher: encryptSecret(PASSWORD),
    },
  });
  connectionId = conn.id as string;
});

afterEach(async () => {
  sshManager.shutdownAll();
  await app.close();
});

async function createTicket(): Promise<{ sessionId: string; token: string }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/connections/${connectionId}/session`,
    headers: { cookie: user.cookie },
    payload: { cols: 80, rows: 24 },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe("terminal websocket endpoint", () => {
  it("requires an authenticated session (4401)", async () => {
    const { sessionId, token } = await createTicket();
    const ws = new WsCollector(wsUrl(sessionId, token), {});
    const closed = await new Promise<{ code: number }>((resolve) => {
      ws.ws.on("close", (code) => resolve({ code }));
    });
    expect(closed.code).toBe(4401);
  });

  it("rejects an invalid ticket (4404)", async () => {
    const { sessionId } = await createTicket();
    const ws = new WsCollector(wsUrl(sessionId, randomToken(32)), { cookie: user.cookie });
    const closed = await new Promise<{ code: number }>((resolve) => {
      ws.ws.on("close", (code) => resolve({ code }));
    });
    expect(closed.code).toBe(4404);
  });

  it("rejects a ticket created by another user (4403)", async () => {
    const { sessionId, token } = await createTicket();
    const stranger = await seedUser(prisma, { email: "stranger@example.com" });
    const ws = new WsCollector(wsUrl(sessionId, token), { cookie: stranger.cookie });
    const closed = await new Promise<{ code: number }>((resolve) => {
      ws.ws.on("close", (code) => resolve({ code }));
    });
    expect(closed.code).toBe(4403);
  });

  it("runs the full protocol: attach, host-key prompt, trust, PTY echo, ping, exit status", async () => {
    const { sessionId, token } = await createTicket();
    const ws = new WsCollector(wsUrl(sessionId, token), { cookie: user.cookie });

    const attached = await ws.waitFor((f) => f.t === "attached");
    expect(attached.sessionId).toBe(sessionId);
    expect(attached.cols).toBe(80);
    expect(attached.rows).toBe(24);

    const prompt = await ws.waitFor((f) => f.t === "hostkey-required");
    expect((prompt as { fingerprint?: string }).fingerprint).toMatch(/^SHA256:/);

    ws.send({ t: "trust", mode: "save" });
    await ws.waitFor((f) => f.t === "status" && f.status === "connected");

    // The trusted key was saved for this user only.
    expect(prisma.knownHost.findFirst({ where: { userId: user.userId } })).toBeTruthy();

    // Wait for the PTY itself (the "connected" status precedes shell setup).
    await ws.waitFor((f) => {
      if (f.t !== "data" || typeof f.d !== "string") return false;
      return Buffer.from(f.d as string, "base64").toString("utf8").includes("shell:ready");
    });

    // Data round-trips through the real SSH server.
    ws.send({ t: "data", d: Buffer.from("whoami\n").toString("base64") });
    await ws.waitFor((f) => {
      if (f.t !== "data" || typeof f.d !== "string") return false;
      return Buffer.from(f.d as string, "base64").toString("utf8").includes("whoami");
    });

    ws.send({ t: "ping" });
    await ws.waitFor((f) => f.t === "pong");

    ws.send({ t: "resize", cols: 120, rows: 40 });
    // Session keeps the new dimensions.
    await new Promise((r) => setTimeout(r, 200));
    expect(sshManager.get(sessionId)!.cols).toBe(120);
    expect(sshManager.get(sessionId)!.rows).toBe(40);

    // Terminate via the REST endpoint closes the socket and the SSH session.
    const res = await app.inject({
      method: "DELETE",
      url: `/api/terminal/${sessionId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const closed = await new Promise<{ code: number }>((resolve) => {
      if (ws.closed) resolve(ws.closed);
      else ws.ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    expect(closed.code).toBe(1000);
    expect(sshManager.get(sessionId)).toBeUndefined();
  });

  it("closing the socket keeps the SSH session reattachable within the grace window", async () => {
    const { sessionId, token } = await createTicket();
    const ws = new WsCollector(wsUrl(sessionId, token), { cookie: user.cookie });
    await ws.waitFor((f) => f.t === "attached");
    await ws.waitFor((f) => f.t === "hostkey-required");
    ws.send({ t: "trust", mode: "save" });
    await ws.waitFor((f) => f.t === "status" && f.status === "connected");
    ws.close();

    // Within the grace period the session still exists and can be reattached.
    await new Promise((r) => setTimeout(r, 200));
    expect(sshManager.get(sessionId)).toBeTruthy();

    const res = await app.inject({
      method: "POST",
      url: `/api/terminal/${sessionId}/reattach`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { sessionId: again, token: token2 } = res.json();
    expect(again).toBe(sessionId);

    const ws2 = new WsCollector(wsUrl(again, token2), { cookie: user.cookie });
    await ws2.waitFor((f) => f.t === "attached");
    await ws2.waitFor((f) => f.t === "status" && f.status === "connected");

    // Still exactly one terminal session for this user (no duplicate).
    const list = await app.inject({ method: "GET", url: "/api/terminal", headers: { cookie: user.cookie } });
    expect(list.json().sessions).toHaveLength(1);
    ws2.close();
  });

  it("rejects malformed frames without killing the connection", async () => {
    const { sessionId, token } = await createTicket();
    const ws = new WsCollector(wsUrl(sessionId, token), { cookie: user.cookie });
    await ws.waitFor((f) => f.t === "attached");
    await ws.waitFor((f) => f.t === "hostkey-required");
    ws.send({ t: "data", d: 12345 }); // invalid: d must be a string
    ws.send("this is not json");
    const errFrame = await ws.waitFor((f) => f.t === "error" && f.code === "BAD_FRAME");
    expect(errFrame.message).toContain("Malformed");
    // The socket is still open and functional.
    ws.send({ t: "trust", mode: "once" });
    await ws.waitFor((f) => f.t === "status" && f.status === "connected");
    ws.close();
  });
});
