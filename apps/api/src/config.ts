import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  host: process.env.HOST ?? "0.0.0.0",
  port: num("PORT", 7132),
  appUrl: (process.env.APP_URL ?? `http://localhost:${num("PORT", 7132)}`).replace(/\/$/, ""),

  sessionSecret: process.env.SESSION_SECRET ?? "",
  sessionCookieName: "xt_session",
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  resetTokenTtlMs: 60 * 60 * 1000, // 1 hour
  emailVerifyTokenTtlMs: 24 * 60 * 60 * 1000,

  smtpUrl: process.env.SMTP_URL ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "XTerminal <no-reply@localhost>",
  emailVerificationRequired: bool("EMAIL_VERIFICATION_REQUIRED", false),

  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME ?? "XTerminal",
    rpID: process.env.WEBAUTHN_RP_ID ?? "localhost",
    origin: process.env.WEBAUTHN_ORIGIN ?? "",
  },

  limits: {
    maxConnectionsPerUser: num("MAX_CONNECTIONS_PER_USER", 200),
    maxActiveSessionsPerUser: num("MAX_ACTIVE_SESSIONS_PER_USER", 10),
    sshConnectionTimeoutMs: num("SSH_CONNECTION_TIMEOUT", 15000),
    sshIdleTimeoutMs: num("SSH_IDLE_TIMEOUT", 3600000),
    wsReconnectGraceMs: num("WS_RECONNECT_GRACE", 30000),
    ticketTtlMs: 60_000,
  },

  bodyLimit: 512 * 1024, // generous enough for pasted keys, still bounded
  redisUrl: process.env.REDIS_URL ?? "",
};

export function assertProductionConfig(): void {
  const problems: string[] = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    problems.push("SESSION_SECRET must be set (openssl rand -hex 32)");
  }
  if (!process.env.ENCRYPTION_KEY) {
    problems.push("ENCRYPTION_KEY must be set (openssl rand -hex 32)");
  }
  if (problems.length > 0) {
    throw new Error(
      "Refusing to start in production with unsafe configuration:\n  - " +
        problems.join("\n  - "),
    );
  }
}
