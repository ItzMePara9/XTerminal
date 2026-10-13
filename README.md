# XTerminal

A **self-hosted web SSH client and server connection manager**. Run it on your
own VPS, open it in a browser, and get a real SSH terminal (xterm.js over
WebSocket → backend SSH connection) with a credential vault, host-key
verification, groups, tags, 2FA and FIDO2 security keys.

```
Browser ── HTTPS/WSS ──► XTerminal (Fastify + React)
                          │  auth · connections · vault · sessions
                          ▼
                       PostgreSQL
XTerminal ────── SSH ─────► your servers
```

The browser never connects to SSH servers directly — the XTerminal backend
establishes and manages every SSH connection.

---

## Features

- **Real SSH terminal** — PTY-backed interactive shells via [ssh2], streamed
  over WebSocket to xterm.js. Resize, scrollback, search, themes, multiple tabs.
- **Host-key verification** — unknown hosts must be trusted explicitly
  (once or saved); a changed host key always aborts the connection.
- **Credential vault** — passwords, private keys and passphrases encrypted at
  rest with AES-256-GCM (envelope encryption under `ENCRYPTION_KEY`).
- **Auth methods** — password, private key (ED25519 / RSA / ECDSA / OpenSSH),
  key + passphrase, saved keys, jump host (one hop).
- **Accounts** — Argon2id password hashing, HTTP-only session cookies, email
  verification, password reset, TOTP 2FA, WebAuthn/FIDO2 security keys,
  session listing and revocation.
- **Management** — connections, groups, tags, favorites, SSH keys, known
  hosts, command palette (`Ctrl+K`), audit log.
- **Resource limits** — per-user connection and live-session caps, SSH
  connect/idle timeouts, guaranteed cleanup of PTYs when sockets close.

### Honestly documented limitations

- **SSH certificate auth (`CERT`)**: the underlying [ssh2] library does not
  support *offering* OpenSSH certificates as a client. Certificates can be
  stored and associated with connections, but connecting with `CERT` returns a
  clear error instead of pretending to work. Use `PASSWORD` or `KEY`
  authentication. If ssh2 adds support, the plumbing is already in place.
- **FIDO2-backed SSH keys (`*-sk`)**: requires a hardware-backed key present
  to the *server* (e.g. via an SSH agent on the VPS). Not supported for
  browser-side keys. Account login with FIDO2 (WebAuthn) is fully supported —
  these are different things.
- **Horizontal scaling**: WebAuthn challenges and terminal sessions live in
  process memory. For a single-node deployment (the intended use) this is
  correct; multi-node would need Redis for both.
- **Email**: when `SMTP_URL` is unset, verification/reset links are written to
  the server log instead of being emailed. Nothing is faked.

---

## Quick start (Docker, recommended)

```bash
git clone <your repo> xterminal && cd xterminal
cp .env.example .env

# generate secrets
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"  >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env

# edit .env: set APP_URL / WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN to your domain
docker compose up -d --build
```

Then open `http://localhost:7132` (or your domain), register an account,
create a connection, and click **Connect**.

Migrations are applied automatically on container start.

## Quick start (bare metal / VPS, Node 22 + pnpm 9 + PostgreSQL)

```bash
cp .env.example .env      # fill in DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY
pnpm install
pnpm prisma generate
pnpm prisma:migrate       # prisma migrate deploy
pnpm build
pnpm start                # serves API + built SPA on :7132
```

Development with hot reload:

```bash
pnpm dev        # API on :7132 (tsx watch)
pnpm dev:web    # Vite dev server on :5173, proxies /api, /ws, /health
```

## Environment variables

See [.env.example](.env.example). The critical ones:

| Variable | Purpose |
| --- | --- |
| `PORT` / `HOST` | HTTP listener (default `0.0.0.0:7132`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session cookie signing secret (`openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | Vault master key for AES-256-GCM (`openssl rand -hex 32`). **Losing it makes stored credentials unrecoverable.** |
| `APP_URL` | Public URL (email links) |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` | Must match your real domain in production |
| `MAX_CONNECTIONS_PER_USER` / `MAX_ACTIVE_SESSIONS_PER_USER` | Resource caps |
| `SSH_CONNECTION_TIMEOUT` / `SSH_IDLE_TIMEOUT` | SSH timeouts (ms) |
| `SMTP_URL` | Optional; when empty mail is logged instead |

In production the server refuses to start without `SESSION_SECRET` and
`ENCRYPTION_KEY`.

## Reverse proxy (Nginx)

A complete annotated config lives in
[docker/nginx.conf.example](docker/nginx.conf.example). The essential part —
WebSocket forwarding for `/ws/*`:

```nginx
location /ws/ {
    proxy_pass http://127.0.0.1:7132;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # terminals are long-lived
    proxy_buffering off;
}

location / {
    proxy_pass http://127.0.0.1:7132;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Remember to set `APP_URL=https://terminal.example.com`,
`WEBAUTHN_RP_ID=terminal.example.com` and
`WEBAUTHN_ORIGIN=https://terminal.example.com` — WebAuthn strictly enforces
the origin. Cloudflare/Caddy users: ensure WebSockets are enabled (they are by
default in Caddy; in Cloudflare turn off any websocket-disabled setting).

## Architecture

```
xterminal/
├── apps/
│   ├── api/          Fastify server: auth, connections, vault, SSH sessions,
│   │                 WebSocket terminal, static SPA hosting
│   └── web/          React + Vite + Tailwind SPA (xterm.js UI)
├── packages/
│   ├── types/        shared DTO + WS protocol types
│   ├── validation/   Zod schemas shared by client and server
│   ├── crypto/       AES-256-GCM vault, fingerprints, TOTP
│   └── ui/           shared UI primitives
├── prisma/           schema + migrations
├── docker/           entrypoint + nginx example
├── Dockerfile
└── docker-compose.yml
```

### Terminal data flow

1. `POST /api/connections/:id/session` → one-time ticket (60 s TTL)
2. `WS /ws/terminal/:sessionId?token=…` → ticket consumed, session cookie +
   origin checked
3. Backend connects over SSH (host key verified against `KnownHost`, unknown
   keys prompt in the browser, changed keys abort)
4. PTY shell opened; stdin/stdout framed as base64 JSON over the WebSocket
5. Socket drop → session kept for `WS_RECONNECT_GRACE` (30 s) so the browser
   can reattach to the *same* SSH session; after that everything is torn down

## Health checks

- `GET /health` → `{"status":"ok"}` (liveness)
- `GET /api/health` → includes PostgreSQL connectivity (readiness)

## Tests

```bash
pnpm test
```

- `packages/crypto` — vault encryption round-trip, tampering, fingerprints,
  TOTP.
- `packages/validation` — request schema validation.
- `apps/api` —
  - **auth & authorization** (`test/auth.test.ts`): registration, Argon2
    hashing, httpOnly session cookies, revocation, and cross-user isolation
    (bob cannot read/mutate/terminate/open terminals for alice's data). Runs
    against the real Fastify app with an in-memory Prisma mock that honors
    `where` filtering — no PostgreSQL needed.
  - **SSH integration** (`test/ssh.test.ts`): connect, password auth, PTY
    with correct term/dimensions, input round-trip, resize, exec, disconnect,
    host-key trust prompts (once / save), changed-host-key rejection, wrong
    credentials, session limits, one-time tickets — all against a real
    **in-process ssh2 SSH server** over TCP on 127.0.0.1. Nothing on the SSH
    path is mocked.
  - **WebSocket terminal** (`test/ws-terminal.test.ts`): the full endpoint
    through a real listening server and real `ws` client — auth (4401),
    invalid ticket (4404), foreign ticket (4403), attach/trust/echo/ping/
    resize/terminate, reconnect-within-grace without session duplication,
    malformed-frame handling.

  The in-memory Prisma mock covers route-level query semantics (ownership
  filters, includes); database-level constraints (uniques, cascades,
  migrations) are exercised by the real PostgreSQL deployment in
  docker-compose.

## Security

See [SECURITY.md](SECURITY.md).

[ssh2]: https://github.com/mscdex/ssh2
