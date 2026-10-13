import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config.js";
import { logger } from "../context.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.smtpUrl) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport(config.smtpUrl);
  }
  return transporter;
}

/**
 * Send an email. When SMTP is not configured the link is written to the
 * server log instead so self-hosted setups without mail can still complete
 * the flow. This is explicitly documented, never faked success.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ sent: boolean }> {
  const tx = getTransporter();
  if (!tx) {
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "mail: SMTP_URL not configured, delivering to log instead",
    );
    logger.info({ to: opts.to }, `mail: ${opts.text}`);
    return { sent: false };
  }
  await tx.sendMail({
    from: config.emailFrom,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
  return { sent: true };
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: "Verify your XTerminal account",
    text: `Welcome to XTerminal.\n\nVerify your email address:\n${url}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome to XTerminal.</p><p><a href="${url}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: "Reset your XTerminal password",
    text: `A password reset was requested for your XTerminal account.\n\nReset it here:\n${url}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
    html: `<p>A password reset was requested for your XTerminal account.</p><p><a href="${url}">Reset your password</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
  });
}
