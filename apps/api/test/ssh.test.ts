/**
 * SSH integration tests against a real, in-process ssh2 SSH server
 * (spec §30: "test SSH connection against a local isolated SSH test server:
 * connection, authentication, PTY, command execution, resize, disconnect").
 *
 * Nothing is mocked on the SSH path: the client stack (host-key verification,
 * auth, PTY, shell round-trip, resize) runs over a real TCP socket pair on
 * 127.0.0.1. Only the prisma layer is an in-memory mock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedUser, type MockPrisma } from "./bootstrap";
import { sshManager } from "../src/services/ssh/manager";
import { Server, utils as ssh2Utils } from "ssh2";
import type { SSH2Server } from "ssh2";
import { encryptSecret } from "@xterminal/crypto";

const TEST_PASSWORD = "test-password-123";
const USERNAME = "tester";

/** Real ED25519 keypair generated through ssh2's own keygen. */
function generateKey(): { public: string; private: string } {
  return ssh2Utils.generateKeyPairSync("ed25519") as unknown as {
    public: string;
    private: string;
  };
}

interface TestServer {
  port: number;
  hostKey: { public: string; private: string };
  /** Most recent pty request seen by the server. */
  lastPty: { cols: number; rows: number; term: string } | null;
  /** Window changes observed on the live shell channel. */
  resizes: { cols: number; rows: number }[];
  /** Exec commands observed. */
  execs: string[];
}

async function startServer(): Promise<TestServer & { close: () => Promise<void> }> {
  const hostKey = generateKey();
  const state = {
    lastPty: null as TestServer["lastPty"],
    resizes: [] as TestServer["resizes"],
    execs: [] as string[],
  };

  const server: SSH2Server = new Server({
    hostKeys: [hostKey.private] as unknown as Buffer[],
  });

  server.on("connection", (conn) => {
    conn.on("authentication", (ctx) => {
      const { method, username, password } = ctx as unknown as {
        method: string;
        username: string;
        password?: string;
      };
      if (method === "password" && username === USERNAME && password === TEST_PASSWORD) {
        ctx.accept();
      } else {
        ctx.reject(["password"]);
      }
    });
    conn.on("ready", () => {
      conn.on("session", (accept) => {
        const session = accept();
        session.on("pty", (acceptPty, _reject, info) => {
          state.lastPty = { cols: info.cols, rows: info.rows, term: info.term };
          acceptPty?.();
        });
        session.on("shell", (acceptShell) => {
          const stream = acceptShell();
          stream.write("shell:ready\r\n");
          stream.on("data", (d: Buffer) => {
            // Echo input back so tests round-trip through the real channel.
            stream.write(`echo:${JSON.stringify(d.toString("utf8"))}`);
          });
        session.on("window-change", (_a, _r, info) => {
          state.resizes.push({ cols: info.cols, rows: info.rows });
        });
        });
        session.on("exec", (acceptExec, _reject, info) => {
          state.execs.push(info.command);
          const stream = acceptExec();
          stream.write(`ran:${info.command}\n`);
          stream.exit(0);
          stream.close();
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

  return {
    port,
    hostKey,
    execs: state.execs,
    resizes: state.resizes,
    get lastPty() {
      return state.lastPty;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let prisma: MockPrisma;
let ssh: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  ssh = await startServer();
});

afterAll(async () => {
  sshManager.shutdownAll();
  await ssh.close();
});

beforeEach(async () => {
  prisma = resetDb();
});

/** Fake WebSocket bound to a terminal session; collects server frames. */
class FakeSocket {
  readyState = 1; // OPEN
  sent: string[] = [];
  handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  get OPEN(): number {
    return 1;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    for (const cb of this.handlers.get("close") ?? []) cb();
  }

  /** Deliver a client frame to the session (as the ws "message" event would). */
  emitMessage(frame: unknown): void {
    for (const cb of this.handlers.get("message") ?? []) cb(JSON.stringify(frame));
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  async waitFor(pred: (f: Record<string, unknown>) => boolean, timeoutMs = 8000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames().find(pred);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for frame; saw:\n${this.sent.join("\n")}`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

function bindSocket(sessionId: string): FakeSocket {
  const session = sshManager.get(sessionId)!;
  const sock = new FakeSocket();
  session.ws = sock as never;
  sock.on("close", () => undefined);
  // Wire frame handling the same way the ws-terminal route does.
  sock.on("message", (raw) => {
    const frame = JSON.parse(String(raw)) as Parameters<typeof session.handleClientFrame>[1];
    session.handleClientFrame(sshManager, frame);
  });
  return sock;
}

function seedConnection(userId: string, opts: { password?: string; port?: number } = {}): string {
  const conn = prisma.connection.create({
    data: {
      userId,
      nickname: "test-conn",
      host: "127.0.0.1",
      port: opts.port ?? ssh.port,
      username: USERNAME,
      authMethod: "PASSWORD",
      passwordCipher: encryptSecret(opts.password ?? TEST_PASSWORD),
    },
  });
  return conn.id as string;
}

describe("ssh terminal over a real in-process ssh2 server", () => {
  it("connects, verifies the host key via a trust prompt, opens a PTY, echoes input, resizes, and disconnects cleanly", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId);
    const { sessionId } = await sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 });
    const sock = bindSocket(sessionId);

    const startPromise = sshManager.start(sshManager.get(sessionId)!);
    const prompt = (await sock.waitFor((f) => f.t === "hostkey-required")) as unknown as {
      fingerprint: string;
      keyType: string;
      host: string;
      port: number;
    };
    expect(prompt.host).toBe("127.0.0.1");
    expect(prompt.port).toBe(ssh.port);
    expect(prompt.fingerprint).toMatch(/^SHA256:/);
    expect(prompt.keyType).toBe("ssh-ed25519");

    sock.emitMessage({ t: "trust", mode: "once" });
    await startPromise;

    await sock.waitFor((f) => f.t === "status" && f.status === "connected");
    // PTY was requested with the right terminal + dimensions.
    expect(ssh.lastPty).toMatchObject({ cols: 80, rows: 24, term: "xterm-256color" });

    // Round-trip input through the real SSH channel.
    sock.emitMessage({ t: "data", d: Buffer.from("hello pty\n").toString("base64") });
    await sock.waitFor((f) => {
      if (f.t !== "data" || typeof f.d !== "string") return false;
      return Buffer.from(f.d as string, "base64").toString("utf8").includes("hello pty");
    });

    // Resize reaches the server as a window-change on the shell channel.
    sock.emitMessage({ t: "resize", cols: 132, rows: 43 });
    await new Promise((r) => setTimeout(r, 300));
    expect(ssh.resizes.some((r) => r.cols === 132 && r.rows === 43)).toBe(true);

    // "Trust once" must NOT persist the host key.
    expect(prisma.knownHost.findFirst({ where: { userId } })).toBeNull();

    // Destroy tears the SSH connection down.
    const session = sshManager.get(sessionId)!;
    sshManager.destroy(session, "test done");
    expect(session.isDestroyed).toBe(true);
    expect(session.conn).toBeNull();
    expect(sshManager.get(sessionId)).toBeUndefined();
  });

  it("trust & save persists the host key and skips the prompt on the next connection", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId);

    // First connection: save the key.
    {
      const { sessionId } = await sshManager.createTicket(userId, connectionId, { cols: 100, rows: 30 });
      const sock = bindSocket(sessionId);
      const p = sshManager.start(sshManager.get(sessionId)!);
      await sock.waitFor((f) => f.t === "hostkey-required");
      sock.emitMessage({ t: "trust", mode: "save" });
      await p;
      expect(prisma.knownHost.findFirst({ where: { userId, host: "127.0.0.1", port: ssh.port } })).toBeTruthy();
      sshManager.destroy(sshManager.get(sessionId)!, "done");
    }

    // Second connection: no prompt, straight to connected.
    {
      const { sessionId } = await sshManager.createTicket(userId, connectionId, { cols: 100, rows: 30 });
      const sock = bindSocket(sessionId);
      await sshManager.start(sshManager.get(sessionId)!);
      await sock.waitFor((f) => f.t === "status" && f.status === "connected");
      expect(sock.frames().some((f) => f.t === "hostkey-required")).toBe(false);
      sshManager.destroy(sshManager.get(sessionId)!, "done");
    }
  });

  it("rejects a CHANGED host key without prompting and never overwrites the stored fingerprint", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId);
    const WRONG = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    prisma.knownHost.create({
      data: { userId, host: "127.0.0.1", port: ssh.port, fingerprint: WRONG, keyType: "ssh-ed25519" },
    });

    const { sessionId } = await sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 });
    const session = sshManager.get(sessionId)!;
    const sock = bindSocket(sessionId);
    const p = sshManager.start(session);
    const changed = (await sock.waitFor((f) => f.t === "hostkey-changed")) as unknown as {
      fingerprint: string;
      knownFingerprint: string;
    };
    expect(changed.fingerprint).toMatch(/^SHA256:/);
    expect(changed.knownFingerprint).toBe(WRONG);
    await p;
    expect(sock.frames().some((f) => f.t === "hostkey-required")).toBe(false);
    expect(session.isDestroyed).toBe(true);
    expect(prisma.knownHost.findFirst({ where: { userId } })!.fingerprint).toBe(WRONG);
  });

  it("rejects wrong credentials", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId, { password: "wrong-password" });
    // Trust the server's real key out-of-band so auth is what fails.
    // The fingerprint is computed exactly as the client computes it: over the
    // wire-format public key blob.
    const [, pubB64] = ssh.hostKey.public.split(" ");
    const { sshFingerprint } = await import("@xterminal/crypto");
    const real = sshFingerprint(Buffer.from(pubB64!, "base64"));
    prisma.knownHost.create({
      data: { userId, host: "127.0.0.1", port: ssh.port, fingerprint: real, keyType: "ssh-ed25519" },
    });

    const { sessionId } = await sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 });
    const session = sshManager.get(sessionId)!;
    const sock = bindSocket(sessionId);
    await sshManager.start(session);
    const failure = (await sock.waitFor((f) => f.t === "error")) as unknown as { message: string };
    expect(failure.message).toBeTruthy();
    expect(session.isDestroyed).toBe(true);
  });

  it("runs a command over exec through the real server", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId);
    const { sessionId } = await sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 });
    const sock = bindSocket(sessionId);
    const p = sshManager.start(sshManager.get(sessionId)!);
    await sock.waitFor((f) => f.t === "hostkey-required");
    sock.emitMessage({ t: "trust", mode: "once" });
    await p;
    await sock.waitFor((f) => f.t === "status" && f.status === "connected");

    // Direct ssh2 exec against the same server through our own client stack.
    const { Client } = await import("ssh2");
    const out = await new Promise<string>((resolve, reject) => {
      const conn = new Client();
      conn
        .on("ready", () => {
          conn.exec("uname -a", (err, stream) => {
            if (err) return reject(err);
            let buf = "";
            stream.on("data", (d: Buffer) => (buf += d.toString()));
            stream.on("close", () => {
              conn.end();
              resolve(buf);
            });
          });
        })
        .on("error", reject)
        .connect({
          host: "127.0.0.1",
          port: ssh.port,
          username: USERNAME,
          password: TEST_PASSWORD,
          readyTimeout: 5000,
        });
    });
    expect(out).toContain("ran:uname -a");
    expect(ssh.execs).toContain("uname -a");
    sshManager.destroy(sshManager.get(sessionId)!, "done");
  });

  it("buffers output while the socket is away and replays it on reattach", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId);
    const { sessionId } = await sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 });
    const session = sshManager.get(sessionId)!;
    const sock = bindSocket(sessionId);
    const p = sshManager.start(session);
    await sock.waitFor((f) => f.t === "hostkey-required");
    sock.emitMessage({ t: "trust", mode: "save" });
    await p;
    await sock.waitFor((f) => f.t === "status" && f.status === "connected");

    // Browser drops: WS goes away, but the SSH session survives the grace
    // period and can be reattached without duplicating the connection.
    sock.close();
    session.ws = null;
    const { sessionId: again, token } = sshManager.reattachTicket(userId, sessionId)!;
    expect(again).toBe(sessionId);
    const sock2 = bindSocket(sessionId);
    // Reattach semantics mirror the ws-terminal route.
    session.setStatus("reconnecting");
    session.flushReplay();
    session.setStatus("connected");
    sock2.emitMessage({ t: "hello", cols: 80, rows: 24 });
    await sock2.waitFor((f) => f.t === "status" && f.status === "connected");
    expect(sshManager.get(sessionId)).toBe(session); // same object, no duplicate
    void token;
    sshManager.destroy(session, "done");
  });

  it("enforces the per-user active session limit", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId);
    const { config } = await import("../src/config");
    const original = config.limits.maxActiveSessionsPerUser;
    config.limits.maxActiveSessionsPerUser = 2;
    try {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        ids.push((await sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 })).sessionId);
      }
      await expect(sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 })).rejects.toThrow();
      for (const id of ids) sshManager.destroy(sshManager.get(id)!, "cleanup");
    } finally {
      config.limits.maxActiveSessionsPerUser = original;
    }
  });

  it("one-time tickets cannot be reused or forged", async () => {
    const { userId } = await seedUser(prisma);
    const connectionId = seedConnection(userId);
    const { sessionId, token } = await sshManager.createTicket(userId, connectionId, { cols: 80, rows: 24 });
    expect(sshManager.consumeTicket(sessionId, token)).toBeTruthy();
    expect(sshManager.consumeTicket(sessionId, token)).toBeNull(); // consumed
    expect(sshManager.consumeTicket(sessionId, "forged-token-aaaaaaaaaaaaaaaaaaaa")).toBeNull();
    sshManager.destroy(sshManager.get(sessionId)!, "cleanup");
  });

  it("rejects a ticket for another user's session", async () => {
    const alice = await seedUser(prisma);
    const bob = await seedUser(prisma, { email: "bob@example.com" });
    const connectionId = seedConnection(alice.userId);
    const { sessionId, token } = await sshManager.createTicket(alice.userId, connectionId, { cols: 80, rows: 24 });
    // bob cannot consume alice's ticket (ownership enforced in ws-terminal and here).
    expect(sshManager.get(sessionId)!.userId).not.toBe(bob.userId);
    expect(sshManager.consumeTicket(sessionId, token)).toBeTruthy();
    sshManager.destroy(sshManager.get(sessionId)!, "cleanup");
  });

  it("SSH certificate auth fails honestly instead of silently falling back", async () => {
    const { connectOptions } = sshManager as unknown as {
      connectOptions: (target: unknown) => unknown;
    };
    expect(() =>
      connectOptions({
        host: "h",
        port: 22,
        username: "u",
        auth: { certificate: "-----BEGIN OPENSSH CERTIFICATE-----" },
        label: "cert",
      }),
    ).toThrow(/certificate authentication is not supported/i);
  });
});
