import { prisma, logger } from "../context.js";

export type AuditAction =
  | "user.register"
  | "user.login"
  | "user.login_failed"
  | "user.logout"
  | "user.logout_all"
  | "user.password_changed"
  | "user.password_reset"
  | "user.email_verified"
  | "user.totp_enabled"
  | "user.totp_disabled"
  | "webauthn.registered"
  | "webauthn.login"
  | "webauthn.removed"
  | "connection.created"
  | "connection.updated"
  | "connection.deleted"
  | "group.created"
  | "group.updated"
  | "group.deleted"
  | "sshkey.created"
  | "sshkey.deleted"
  | "certificate.created"
  | "certificate.deleted"
  | "knownhost.trusted"
  | "knownhost.deleted"
  | "ssh.session_started"
  | "ssh.session_ended"
  | "ssh.hostkey_rejected"
  | "terminal.terminated";

export async function audit(
  action: AuditAction,
  opts: {
    userId?: string | null;
    target?: string | null;
    ip?: string | null;
    meta?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: opts.userId ?? null,
        target: opts.target ?? null,
        ip: opts.ip ?? null,
        meta: (opts.meta ?? undefined) as never,
      },
    });
    logger.debug({ action, userId: opts.userId, target: opts.target }, `audit: ${action}`);
  } catch (err) {
    // Auditing must never break the request path.
    logger.error({ err, action }, "audit: failed to write audit log");
  }
}
