# Security Policy

This document explains how XTerminal handles secrets, what it protects
against, and what it deliberately does not do.

## Threat model

XTerminal is a self-hosted server that holds credentials for other servers and
opens SSH sessions on behalf of its users. Assumed adversaries:

- **An attacker with the PostgreSQL database** — should get ciphertext, never
  passwords, private keys or passphrases.
- **A logged-in user probing for other users' data** — every API query and
  terminal session is scoped by `userId`; cross-user access is rejected.
- **CSRF / token theft from the browser** — sessions live in `HttpOnly`
  cookies (never `localStorage`); terminal WebSocket opens require a valid
  session cookie *and* a one-time, 60-second ticket bound to the session.
- **MITM between XTerminal and the target SSH server** — host keys are
  verified with SHA256 fingerprints; unknown keys require explicit trust,
  changed keys always abort.
- **Credential leakage through logs** — the logger redacts auth headers,
  cookies, passwords, keys, passphrases and tokens; terminal contents are
  never logged.

The operator of the XTerminal server is *trusted* (it terminates the vault and
the SSH sessions — inherent to the product). The HTTP path to the browser must
be TLS (use the provided Nginx config or Caddy).

## Credential vault

- All secrets (SSH passwords, private keys, key passphrases, certificate
  PEMs) are encrypted with **AES-256-GCM** under a master key
  (`ENCRYPTION_KEY`, 32 bytes, hex/base64) before touching the database.
- Ciphertext format `v1:<iv>:<tag>:<data>` — random 12-byte IV per record,
  auth tag verified on every read; tampering fails closed.
- Secrets are decrypted only in memory, only for the duration of a connection
  attempt, and are never returned by any API endpoint.
- `ENCRYPTION_KEY` must be generated per deployment
  (`openssl rand -hex 32`), never committed, never logged. Losing it makes
  stored credentials unrecoverable (there is intentionally no escrow).
- A real key is never committed: `.env.example` documents the variable; the
  server refuses to start in production without it.

## Authentication & sessions

- Passwords hashed with **Argon2id** (m=64 MiB, t=3, p=4).
- Session tokens: 32 random bytes; only the SHA-256 hash is stored; delivered
  as `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookies. Tokens are
  never kept in `localStorage`.
- Sessions can be listed and revoked individually or all-at-once; password
  reset revokes every session.
- Optional email verification, TOTP 2FA (±1 step window), and WebAuthn/FIDO2
  security keys (with signature-counter clone detection).
- Rate limits on auth endpoints; login, reset and audit-worthy actions are
  recorded in the audit log (without credentials).

## SSH specifics

- **Host keys**: verified against per-user known hosts. Unknown key → user
  must choose *Trust Once* / *Trust & Save* / *Cancel*. **A changed host key
  is never accepted automatically** — the connection is refused.
- **Jump hosts**: the jump host's key is verified with the same rules before
  the target is contacted.
- Timeouts: connect (15 s default) and idle (1 h default) so abandoned
  sessions cannot linger; PTYs and TCP connections are torn down when the
  WebSocket closes or the grace period expires.
- Per-user caps on stored connections and concurrent live sessions.

## Transport & headers

- Helmet with a strict CSP, `X-Content-Type-Options`, frame denial, etc.
- WebSocket terminal endpoint checks the session cookie and (in production)
  the `Origin` header.
- Run behind TLS. `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` must match the public
  domain or WebAuthn will refuse to work (a safety feature of the platform).

## What is intentionally not claimed

- **SSH client certificates** are not supported (ssh2 limitation); using one
  fails with an explicit error rather than a silent fallback.
- **FIDO2 (`*-sk`) SSH keys** are not supported; account-login security keys
  (WebAuthn) are a separate, fully-working feature.
- **Multi-node deployments** are unsupported (challenges and terminal
  sessions are in-process).

## Reporting a vulnerability

This is a self-hosted personal deployment — please open an issue or contact
the operator of your instance privately. Include reproduction steps and
affected versions; do not include real credentials.
