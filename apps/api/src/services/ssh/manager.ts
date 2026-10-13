// ssh2 is CommonJS: Node's ESM interop cannot statically detect its named
// exports, so pull it in via the default export and destructure. (Type-only
// imports are erased at compile time and are safe as named imports.)
import ssh2 from "ssh2";
import type { ClientChannel, ConnectConfig } from "ssh2";
const { Client } = ssh2;
import { decryptSecret, randomToken, sha256Hex } from "@xterminal/crypto";
import type { ClientFrame, ServerFrame, TerminalStatus } from "@xterminal/types";
import type { WebSocket } from "ws";
import { prisma, logger } from "../../context.js";
import { config } from "../../config.js";
import { tooMany, notFound } from "../../util/errors.js";
import { audit } from "../audit.js";
import { fingerprintHostKey } from "./hostkey.js";

export interface SshAuth {
  password?: string;
  privateKey?: string;
  passphrase?: string;
  certificate?: string;
}

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  label: string;
}

interface PendingHostKey {
  host: string;
  port: number;
  fingerprint: string;
  keyType: string;
  resolve: (decision: "once" | "save" | "cancel" | "timeout") => void;
  timer: NodeJS.Timeout;
}

const HOSTKEY_DECISION_TIMEOUT_MS = 60_000;
const MAX_REPLAY_BUFFER = 256 * 1024;

export class TerminalSession {
  readonly id: string;
  readonly userId: string;
  readonly connectionId: string;
  readonly createdAt = new Date();

  label: string;
  status: TerminalStatus = "connecting";
  cols = 80;
  rows = 24;
  exitCode: number | null = null;
  /** Set once SSH connection establishment has been kicked off. */
  started = false;

  ws: WebSocket | null = null;
  conn: Client | null = null;
  jumpConn: Client | null = null;
  stream: ClientChannel | null = null;

  /** One-time ticket binding this session to the browser that created it. */
  ticket: { tokenHash: string; expiresAt: number } | null = null;

  private pendingHostKey: PendingHostKey | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private replayBuffer: Buffer[] = [];
  private replaySize = 0;
  private destroyed = false;

  constructor(opts: {
    id: string;
    userId: string;
    connectionId: string;
    label: string;
    cols?: number;
    rows?: number;
  }) {
    this.id = opts.id;
    this.userId = opts.userId;
    this.connectionId = opts.connectionId;
    this.label = opts.label;
    if (opts.cols) this.cols = opts.cols;
    if (opts.rows) this.rows = opts.rows;
  }

  setStatus(status: TerminalStatus, detail?: string): void {
    this.status = status;
    this.send({ t: "status", status, detail });
  }

  send(frame: ServerFrame): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      try {
        this.ws.send(JSON.stringify(frame));
      } catch (err) {
        logger.debug({ err, sessionId: this.id }, "ws send failed");
      }
    }
  }

  /** Queue output while the browser is briefly disconnected (reconnect grace). */
  buffer(data: Buffer): void {
    if (this.replaySize < MAX_REPLAY_BUFFER) {
      this.replayBuffer.push(data);
      this.replaySize += data.length;
    }
  }

  flushReplay(): void {
    if (this.replayBuffer.length === 0) return;
    const merged = Buffer.concat(this.replayBuffer);
    this.replayBuffer = [];
    this.replaySize = 0;
    this.send({ t: "data", d: merged.toString("base64") });
  }

  touchIdle(manager: SshSessionManager): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      logger.info({ sessionId: this.id, userId: this.userId }, "ssh: idle timeout");
      manager.destroy(this, "Idle timeout");
    }, config.limits.sshIdleTimeoutMs);
    this.idleTimer.unref?.();
  }

  startGrace(manager: SshSessionManager): void {
    this.cancelGrace();
    this.graceTimer = setTimeout(() => {
      logger.info({ sessionId: this.id, userId: this.userId }, "ssh: reconnect grace expired");
      manager.destroy(this, "Reconnect window expired");
    }, config.limits.wsReconnectGraceMs);
    this.graceTimer.unref?.();
  }

  cancelGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  /**
   * Verify a host key: auto-accept only when it matches a previously trusted
   * fingerprint. Unknown keys are surfaced to the browser; changed keys are
   * always rejected outright.
   */
  async verifyHostKey(host: string, port: number, key: unknown): Promise<boolean> {
    const { fingerprint, keyType } = fingerprintHostKey(key);
    const known = await prisma.knownHost.findFirst({
      where: { userId: this.userId, host, port },
    });

    if (known) {
      if (known.fingerprint === fingerprint) return true;
      // NEVER automatically accept a changed host key.
      logger.warn(
        { userId: this.userId, host, port },
        "ssh: host key changed - rejecting",
      );
      this.setStatus("failed", "Host key changed");
      this.send({
        t: "hostkey-changed",
        fingerprint,
        knownFingerprint: known.fingerprint,
        host,
        port,
      });
      await audit("ssh.hostkey_rejected", {
        userId: this.userId,
        target: `${host}:${port}`,
        meta: { reason: "changed", fingerprint },
      });
      return false;
    }

    this.setStatus("verifying-host-key");
    this.send({ t: "hostkey-required", fingerprint, keyType, host, port });

    const decision = await new Promise<"once" | "save" | "cancel" | "timeout">((resolve) => {
      const timer = setTimeout(() => {
        logger.info({ sessionId: this.id, host }, "ssh: host key decision timeout");
        resolve("timeout");
      }, HOSTKEY_DECISION_TIMEOUT_MS);
      this.pendingHostKey = { host, port, fingerprint, keyType, resolve, timer };
    });
    this.pendingHostKey = null;

    if (decision === "save") {
      await prisma.knownHost.upsert({
        where: { userId_host_port: { userId: this.userId, host, port } },
        update: { fingerprint, keyType, trustedAt: new Date() },
        create: { userId: this.userId, host, port, fingerprint, keyType },
      });
      await audit("knownhost.trusted", {
        userId: this.userId,
        target: `${host}:${port}`,
        meta: { fingerprint, keyType, saved: true },
      });
    } else if (decision === "once") {
      await audit("knownhost.trusted", {
        userId: this.userId,
        target: `${host}:${port}`,
        meta: { fingerprint, keyType, saved: false },
      });
    }
    return decision === "once" || decision === "save";
  }

  /** Resolve a pending "trust this host?" prompt from the browser. */
  resolveHostKey(mode: "once" | "save" | "cancel"): boolean {
    const pending = this.pendingHostKey;
    if (!pending) return false;
    clearTimeout(pending.timer);
    if (mode === "cancel") {
      audit("ssh.hostkey_rejected", {
        userId: this.userId,
        target: `${pending.host}:${pending.port}`,
        meta: { reason: "user_cancelled" },
      });
    }
    pending.resolve(mode);
    return true;
  }

  handleClientFrame(manager: SshSessionManager, frame: ClientFrame): void {
    this.touchIdle(manager);
    switch (frame.t) {
      case "data": {
        if (this.stream) {
          const buf = Buffer.from(frame.d, "base64");
          this.stream.write(buf);
        }
        break;
      }
      case "resize": {
        const cols = Math.min(Math.max(frame.cols, 2), 500);
        const rows = Math.min(Math.max(frame.rows, 2), 300);
        this.cols = cols;
        this.rows = rows;
        if (this.stream) this.stream.setWindow(rows, cols, 480, 640);
        break;
      }
      case "trust": {
        this.resolveHostKey(frame.mode);
        break;
      }
      case "cancel": {
        manager.destroy(this, "Cancelled by user");
        break;
      }
      case "ping": {
        this.send({ t: "pong" });
        break;
      }
      case "hello": {
        if (frame.cols) this.cols = Math.min(Math.max(frame.cols, 2), 500);
        if (frame.rows) this.rows = Math.min(Math.max(frame.rows, 2), 300);
        if (this.stream) this.stream.setWindow(this.rows, this.cols, 480, 640);
        break;
      }
    }
  }

  teardownSsh(): void {
    this.destroyed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.cancelGrace();
    if (this.pendingHostKey) {
      clearTimeout(this.pendingHostKey.timer);
      this.pendingHostKey.resolve("cancel");
      this.pendingHostKey = null;
    }
    try {
      this.stream?.close();
    } catch {
      /* already closed */
    }
    this.stream = null;
    try {
      this.conn?.end();
    } catch {
      /* already closed */
    }
    this.conn = null;
    try {
      this.jumpConn?.end();
    } catch {
      /* already closed */
    }
    this.jumpConn = null;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}

/**
 * Registry of live terminal sessions. Terminal sessions are intentionally
 * in-memory: a restart of the API process ends every SSH session (there is
 * nothing meaningful to resume across a server restart).
 */
export class SshSessionManager {
  private sessions = new Map<string, TerminalSession>();

  activeCountForUser(userId: string): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.userId === userId) n++;
    return n;
  }

  get(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  listForUser(userId: string): TerminalSession[] {
    return [...this.sessions.values()].filter((s) => s.userId === userId);
  }

  /** Create a session and a one-time attach ticket for a connection. */
  async createTicket(
    userId: string,
    connectionId: string,
    opts: { cols?: number; rows?: number },
  ): Promise<{ sessionId: string; token: string }> {
    const active = this.activeCountForUser(userId);
    if (active >= config.limits.maxActiveSessionsPerUser) {
      throw tooMany(
        `You already have ${active} active terminal sessions (limit ${config.limits.maxActiveSessionsPerUser})`,
        "SESSION_LIMIT",
      );
    }

    const connection = await prisma.connection.findFirst({
      where: { id: connectionId, userId },
      include: { sshKey: true, certificate: true, jumpConnection: true },
    });
    if (!connection) {
      throw notFound("Connection not found", "NOT_FOUND");
    }

    const sessionId = randomToken(16);
    const token = randomToken(32);
    const label = connection.nickname ?? `${connection.username}@${connection.host}`;

    const session = new TerminalSession({
      id: sessionId,
      userId,
      connectionId,
      label,
      cols: opts.cols,
      rows: opts.rows,
    });
    session.ticket = { tokenHash: sha256Hex(token), expiresAt: Date.now() + config.limits.ticketTtlMs };
    this.sessions.set(sessionId, session);
    return { sessionId, token };
  }

  /** Issue a fresh ticket for reattaching to a still-live session. */
  reattachTicket(userId: string, sessionId: string): { sessionId: string; token: string } | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId || session.isDestroyed) return null;
    const token = randomToken(32);
    session.ticket = { tokenHash: sha256Hex(token), expiresAt: Date.now() + config.limits.ticketTtlMs };
    return { sessionId, token };
  }

  /** Validate and consume a one-time ticket during the WS handshake. */
  consumeTicket(sessionId: string, token: string): TerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.ticket) return null;
    if (Date.now() > session.ticket.expiresAt) return null;
    if (session.ticket.tokenHash !== sha256Hex(token)) return null;
    session.ticket = null; // one-time use
    return session;
  }

  destroy(session: TerminalSession, reason: string): void {
    if (session.isDestroyed) return;
    logger.info(
      { sessionId: session.id, userId: session.userId, connectionId: session.connectionId, reason },
      "ssh: session ended",
    );
    session.setStatus("closed", reason);
    session.teardownSsh();
    if (session.ws && session.ws.readyState <= 1) {
      try {
        session.ws.close(1000, reason);
      } catch {
        /* ignore */
      }
    }
    session.ws = null;
    this.sessions.delete(session.id);
    void audit("ssh.session_ended", {
      userId: session.userId,
      target: session.connectionId,
      meta: { reason, sessionId: session.id },
    });
  }

  shutdownAll(): void {
    for (const session of [...this.sessions.values()]) {
      this.destroy(session, "Server shutting down");
    }
  }

  // -----------------------------------------------------------------------
  // SSH connection establishment
  // -----------------------------------------------------------------------

  /** Build ssh2 connect options for a target. */
  private connectOptions(target: SshTarget, sock?: NodeJS.ReadableStream): ConnectConfig {
    const opts: ConnectConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      readyTimeout: config.limits.sshConnectionTimeoutMs,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      ...(sock ? { sock: sock as never } : {}),
    };
    const auth = target.auth;
    if (auth.password) opts.password = auth.password;
    if (auth.privateKey) {
      opts.privateKey = auth.privateKey;
      if (auth.passphrase) opts.passphrase = auth.passphrase;
    }
    if (auth.certificate) {
      // ssh2 has no support for offering OpenSSH certificates as a client.
      // Fail honestly instead of silently falling back to bare-key auth
      // (which would connect under different credentials than configured).
      throw new Error(
        "SSH certificate authentication is not supported: the ssh2 library " +
          "cannot present client certificates. Use PASSWORD or KEY auth, or " +
          "configure the certificate on the server's ssh-agent instead.",
      );
    }
    return opts;
  }

  /**
   * Connect to one SSH target with interactive host-key verification routed
   * to the browser over the session's WebSocket.
   */
  private connectTarget(
    session: TerminalSession,
    target: SshTarget,
    sock?: NodeJS.ReadableStream,
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;

      // IMPORTANT: when the callback form is used, return undefined — ssh2
      // treats any non-undefined return value as the final synchronous
      // verdict, which would accept the host key before the user decides.
      const hostVerifier = (
        key: unknown,
        callback?: (accept: boolean) => void,
      ): boolean | Promise<boolean> | undefined => {
        const decision = session
          .verifyHostKey(target.host, target.port, key)
          .catch(() => false);
        if (typeof callback === "function") {
          decision.then((ok) => callback(ok));
          return undefined; // pending; the callback decides
        }
        return decision;
      };

      conn.once("ready", () => {
        if (settled) return;
        settled = true;
        resolve(conn);
      });

      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        reject(err);
      };

      conn.once("error", fail);
      conn.once("close", () => {
        if (!settled) fail(new Error("Connection closed unexpectedly"));
      });

      try {
        conn.connect({
          ...this.connectOptions(target, sock),
          hostVerifier: hostVerifier as never,
        });
      } catch (err) {
        fail(err as Error);
      }
    });
  }

  /** Resolve credentials + jump chain for a stored connection. */
  async resolveTarget(userId: string, connectionId: string): Promise<{
    target: SshTarget;
    jump: SshTarget | null;
  } | null> {
    const connection = await prisma.connection.findFirst({
      where: { id: connectionId, userId },
      include: { sshKey: true, certificate: true },
    });
    if (!connection) return null;

    const auth: SshAuth = {};
    if (connection.authMethod === "PASSWORD") {
      if (!connection.passwordCipher) throw new Error("Connection has no stored password");
      auth.password = decryptSecret(connection.passwordCipher);
    } else {
      // KEY or CERT: key text comes from the connection itself or a saved key.
      if (connection.privateKeyCipher) {
        auth.privateKey = decryptSecret(connection.privateKeyCipher);
        if (connection.passphraseCipher) {
          auth.passphrase = decryptSecret(connection.passphraseCipher);
        }
      } else if (connection.sshKey) {
        auth.privateKey = decryptSecret(connection.sshKey.privateKeyCipher);
        if (connection.sshKey.passphraseCipher) {
          auth.passphrase = decryptSecret(connection.sshKey.passphraseCipher);
        }
      } else {
        throw new Error("Connection has no private key configured");
      }
      if (connection.authMethod === "CERT") {
        if (!connection.certificate) {
          throw new Error("Connection has no SSH certificate configured");
        }
        auth.certificate = connection.certificate.certificate;
      }
    }

    const target: SshTarget = {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      auth,
      label: connection.nickname ?? `${connection.username}@${connection.host}`,
    };

    let jump: SshTarget | null = null;
    if (connection.jumpConnectionId) {
      const jumpResolved = await this.resolveTarget(userId, connection.jumpConnectionId);
      // Guard against accidental self-reference loops of depth 1.
      if (jumpResolved && jumpResolved.target.host !== connection.host) {
        jump = jumpResolved.target;
      }
    }
    return { target, jump };
  }

  /** Establish the full connection chain and open a PTY shell. */
  async start(session: TerminalSession): Promise<void> {
    session.started = true;
    try {
      const resolved = await this.resolveTarget(session.userId, session.connectionId);
      if (!resolved) {
        session.setStatus("failed", "Connection not found");
        this.destroy(session, "Connection not found");
        return;
      }

      session.setStatus("connecting");
      let sock: NodeJS.ReadableStream | undefined;
      if (resolved.jump) {
        session.setStatus("connecting", `via jump host ${resolved.jump.host}`);
        const jumpConn = await this.connectTarget(session, resolved.jump);
        session.jumpConn = jumpConn;
        jumpConn.once("close", () => {
          if (!session.isDestroyed) this.destroy(session, "Jump host connection closed");
        });
        sock = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
          jumpConn.forwardOut(
            "127.0.0.1",
            0,
            resolved.target.host,
            resolved.target.port,
            (err, channel) => {
              if (err) reject(err);
              else resolve(channel as unknown as NodeJS.ReadableStream);
            },
          );
        });
      }

      session.setStatus("authenticating");
      const conn = await this.connectTarget(session, resolved.target, sock);
      session.conn = conn;

      conn.once("close", () => {
        if (!session.isDestroyed) {
          session.send({ t: "exit", code: session.exitCode });
          this.destroy(session, "SSH connection closed");
        }
      });
      conn.once("error", (err) => {
        if (!session.isDestroyed) {
          session.send({ t: "error", message: `SSH error: ${err.message}` });
        }
      });

      session.setStatus("connected");
      session.touchIdle(this);

      await new Promise<void>((resolve, reject) => {
        conn.shell(
          { term: "xterm-256color", cols: session.cols, rows: session.rows },
          (err, stream) => {
            if (err) return reject(err);
            session.stream = stream;

            stream.on("data", (data: Buffer) => {
              if (session.ws && session.ws.readyState === session.ws.OPEN) {
                session.send({ t: "data", d: data.toString("base64") });
              } else {
                session.buffer(data);
              }
            });
            const stderr = (stream as unknown as { stderr?: NodeJS.ReadableStream }).stderr;
            stderr?.on("data", (data: Buffer) => {
              session.send({ t: "data", d: data.toString("base64") });
            });
            stream.on("close", () => {
              session.send({ t: "exit", code: session.exitCode });
              if (!session.isDestroyed) this.destroy(session, "Shell closed");
            });
            resolve();
          },
        );
      });

      logger.info(
        { sessionId: session.id, userId: session.userId, connectionId: session.connectionId },
        "ssh: session started",
      );
      await audit("ssh.session_started", {
        userId: session.userId,
        target: session.connectionId,
        meta: { sessionId: session.id },
      });
      await prisma.connection.update({
        where: { id: session.connectionId },
        data: { lastConnectedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "SSH connection failed";
      logger.warn(
        { err: message, sessionId: session.id, userId: session.userId },
        "ssh: connection failed",
      );
      session.setStatus("failed", message);
      session.send({ t: "error", message, code: "SSH_ERROR" });
      this.destroy(session, `Connection failed: ${message}`);
    }
  }
}

export const sshManager = new SshSessionManager();
