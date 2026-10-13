# ⚡ XTerminal

**A secure, self-hosted web SSH client and server connection manager.**

XTerminal lets you securely connect to and manage remote servers directly from your browser. It combines a real interactive SSH terminal with encrypted credential storage, host-key verification, multi-factor authentication, and centralized connection management.

Built with **Fastify, React, PostgreSQL, WebSockets, and xterm.js**, XTerminal provides a modern interface for managing SSH connections without requiring an SSH client in the browser.

## ✨ Features

- 🖥️ **Interactive SSH Terminal** — Real PTY-backed SSH shells powered by `ssh2`, WebSockets, and xterm.js.
- 🔐 **Encrypted Credential Vault** — Protect stored passwords, private keys, and passphrases using AES-256-GCM envelope encryption.
- 🛡️ **Host-Key Verification** — Explicit trust for unknown hosts and automatic connection rejection when a previously trusted host key changes.
- 🔑 **Multiple Authentication Methods** — SSH password authentication, private keys, saved credentials, and one-hop jump hosts.
- 🔒 **Secure Authentication** — Argon2id password hashing, HTTP-only session cookies, email verification, and password reset.
- 📱 **Two-Factor Authentication** — TOTP-based 2FA and WebAuthn/FIDO2 security keys for account authentication.
- 🗂️ **Connection Management** — Organize servers with groups, tags, and favorites.
- 🧩 **SSH Key Management** — Manage SSH keys and associate credentials with saved connections.
- 📋 **Audit Logging** — Track supported security-sensitive actions.
- 🖱️ **Multiple Terminal Tabs** — Work with multiple sessions, resize terminals, search scrollback, and customize terminal themes.
- ⚡ **Command Palette** — Quickly navigate supported actions using `Ctrl + K`.
- 🔄 **Session Reconnection** — Reattach to an existing SSH session during the configured WebSocket reconnect grace period.
- 🚦 **Resource Limits** — Configure per-user connection and live-session limits, SSH connection timeouts, and idle timeouts.
- 🐳 **Docker Support** — Deploy using Docker Compose or install directly on a VPS.
- 🩺 **Health Checks** — Monitor application liveness and database readiness.

## 🏗️ Architecture

The browser communicates with XTerminal over HTTP(S) and WebSockets. The backend handles authentication, connection management, and SSH communication.

```text
┌───────────────────────────────┐
│          Web Browser          │
│       React + xterm.js        │
└───────────────┬───────────────┘
                │
             HTTPS/WSS
                │
┌───────────────▼───────────────┐
│           XTerminal           │
│       Fastify + Node.js       │
│                               │
│  Authentication & Sessions    │
│  SSH Connection Management    │
│  Encrypted Credential Vault   │
│  Host-Key Verification        │
└────────┬─────────────┬────────┘
         │             │
         ▼             ▼
┌──────────────┐  ┌────────────────┐
│  PostgreSQL  │  │ Remote Servers │
│              │  │   SSH / TCP    │
└──────────────┘  └────────────────┘
```

**Important:** The browser does not connect directly to remote SSH servers. All SSH connections are established and managed by the XTerminal backend.

## 🚀 Getting Started

### Option 1: Docker Compose (Recommended)

#### Prerequisites

- Git
- Docker Engine
- Docker Compose
- A domain name for production deployments (recommended)

#### 1. Clone the repository

Replace `<repository-url>` with the actual Git repository URL.

```bash
git clone <repository-url> xterminal
cd xterminal
```

#### 2. Configure environment variables

```bash
cp .env.example .env
```

Generate secure secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 16
```

Configure the generated values in `.env`:

```dotenv
SESSION_SECRET=<first-generated-secret>
ENCRYPTION_KEY=<second-generated-secret>
POSTGRES_PASSWORD=<third-generated-secret>
```

Configure the application URL and WebAuthn settings for the deployment environment.

For a production domain such as `terminal.example.com`:

```dotenv
APP_URL=https://terminal.example.com
WEBAUTHN_RP_ID=terminal.example.com
WEBAUTHN_ORIGIN=https://terminal.example.com
```

Keep all secrets private. Never commit your production `.env` file to Git.

#### 3. Start XTerminal

```bash
docker compose up -d --build
```

Check the container status:

```bash
docker compose ps
```

View application logs:

```bash
docker compose logs -f
```

Database migrations are applied automatically during container startup, according to the configured entrypoint.

#### 4. Open XTerminal

For a local deployment, open:

```text
http://localhost:7132
```

For a production deployment, open the HTTPS URL configured for your domain.

Register an account, configure your security settings, add an SSH connection, and click **Connect**.

---

### Option 2: Bare-Metal VPS Installation

#### Prerequisites

- Node.js 22
- pnpm 9
- PostgreSQL
- Git

#### 1. Clone the repository

```bash
git clone <repository-url> xterminal
cd xterminal
```

#### 2. Install dependencies

```bash
pnpm install
```

#### 3. Configure the environment

```bash
cp .env.example .env
```

Configure the PostgreSQL connection string and required secrets.

Example:

```dotenv
PORT=7132
HOST=0.0.0.0
DATABASE_URL=postgresql://xterminal:YOUR_PASSWORD@127.0.0.1:5432/xterminal
SESSION_SECRET=YOUR_GENERATED_SESSION_SECRET
ENCRYPTION_KEY=YOUR_GENERATED_ENCRYPTION_KEY
```

Use strong, independently generated secrets rather than the example placeholders.

#### 4. Generate Prisma Client and run migrations

```bash
pnpm prisma generate
pnpm prisma:migrate
```

The migration command should apply the repository's deployment migrations to the configured database.

#### 5. Build the application

```bash
pnpm build
```

#### 6. Start the application

```bash
pnpm start
```

The application serves its API and built web interface on port `7132` by default.

### Development Mode

Start the API with hot reload:

```bash
pnpm dev
```

Start the Vite development server separately:

```bash
pnpm dev:web
```

The development web server runs on port `5173` and proxies API, WebSocket, and health-check requests as configured.

## ⚙️ Environment Variables

See `.env.example` for the complete configuration reference.

| Variable | Description |
|---|---|
| `PORT` | HTTP server port; default `7132` |
| `HOST` | HTTP bind address; default `0.0.0.0` |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret used for session-cookie signing |
| `ENCRYPTION_KEY` | Master key used to protect stored credentials |
| `APP_URL` | Public application URL used in account-related links |
| `WEBAUTHN_RP_ID` | WebAuthn relying-party domain |
| `WEBAUTHN_ORIGIN` | Expected WebAuthn origin |
| `MAX_CONNECTIONS_PER_USER` | Per-user connection limit |
| `MAX_ACTIVE_SESSIONS_PER_USER` | Per-user active terminal-session limit |
| `SSH_CONNECTION_TIMEOUT` | SSH connection timeout in milliseconds |
| `SSH_IDLE_TIMEOUT` | SSH idle timeout in milliseconds |
| `SMTP_URL` | Optional SMTP configuration for email delivery |

### Critical Security Notes

- Generate unique, high-entropy values for `SESSION_SECRET` and `ENCRYPTION_KEY`.
- Back up `ENCRYPTION_KEY` securely. **Losing this key can make stored credentials permanently unrecoverable.**
- Keep production secrets out of source control, logs, and public repositories.
- Configure `APP_URL`, `WEBAUTHN_RP_ID`, and `WEBAUTHN_ORIGIN` to match the actual production domain.
- Production startup requires the session and encryption secrets to be configured.

## 🌐 Reverse Proxy Configuration

For production, place XTerminal behind an HTTPS reverse proxy such as Nginx or Caddy.

An annotated Nginx example is available at:

`docker/nginx.conf.example`

A minimal Nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name terminal.example.com;

    # Configure your TLS certificate and key here.

    location /ws/ {
        proxy_pass http://127.0.0.1:7132;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:7132;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

This is an illustrative proxy configuration. Configure TLS certificates, HTTP-to-HTTPS redirection, trusted proxy handling, and other production requirements before exposing the application.

**WebSocket support is required** for interactive terminals. Ensure the reverse proxy and any CDN or tunnel in front of XTerminal permit WebSocket connections and sufficiently long-lived sessions.

## 🔑 SSH Authentication

XTerminal supports the following connection methods:

- **Password:** Authenticate with an SSH username and password.
- **Private Key:** Authenticate using supported private-key formats, including ED25519, RSA, ECDSA, and OpenSSH keys.
- **Saved Credentials:** Reuse credentials stored in the encrypted vault.
- **Jump Host:** Route a connection through one configured SSH jump host.
- **Key Passphrase:** Use encrypted private keys with their passphrases.

### SSH Certificates

OpenSSH certificate credentials can be stored and associated with connections, but client-side certificate authentication is not currently supported by the underlying `ssh2` library. Attempting to connect using the certificate authentication method returns an explicit error.

Use a supported password or private-key authentication method instead.

### FIDO2 SSH Keys

Hardware-backed SSH keys using `*-sk` require appropriate access to the hardware-backed key through the server-side environment, such as a supported SSH agent setup. Browser-side hardware-key authentication for SSH connections is not provided.

This is separate from **WebAuthn/FIDO2 account login**, which is supported.

## 🔒 Security

XTerminal is designed with security controls across authentication, credential storage, SSH host verification, and session management.

### Credential Protection

- AES-256-GCM encryption for stored SSH credentials.
- Envelope encryption using `ENCRYPTION_KEY`.
- Argon2id password hashing.
- HTTP-only session cookies.
- TOTP-based two-factor authentication.
- WebAuthn/FIDO2 account authentication.

### SSH Host-Key Verification

Host-key verification helps protect against connecting to an impersonated server.

1. An unknown SSH host requires explicit trust.
2. The user can trust the host for the current connection or save the trust decision.
3. A previously trusted host presenting a changed key is rejected.
4. Host-key verification must not be bypassed simply to make a connection succeed.

### Session and Resource Management

- One-time terminal-session tickets.
- Authentication and origin checks on WebSocket connections.
- Per-user connection and live-session limits.
- SSH connection and idle timeouts.
- Terminal cleanup when sessions are terminated or their reconnect grace period expires.

Review [`SECURITY.md`](SECURITY.md) for security reporting instructions and additional guidance.

## 🧪 Testing

Run the project's test suite:

```bash
pnpm test
```

The test suite covers several key areas.

### Cryptography and Validation

- Credential encryption and decryption.
- Encryption tampering detection.
- Host-key fingerprints.
- TOTP functionality.
- Request-schema validation.

### Authentication and Authorization

- Account registration and password hashing.
- Session cookies and revocation.
- Authorization and cross-user isolation.
- Connection and terminal access controls.

### SSH Integration

The SSH integration tests use a real in-process `ssh2` SSH server over TCP. Coverage includes:

- Password authentication.
- PTY creation, input, output, and terminal resizing.
- Command execution and disconnects.
- Host-key trust prompts and changed-key rejection.
- Invalid credentials and session limits.
- One-time session tickets.

### WebSocket Terminal

WebSocket tests cover authentication failures, ticket validation, terminal attachment, host trust, input/output, resizing, termination, malformed frames, and reconnecting to the same session during the grace period.

Some route-level tests use an in-memory Prisma mock. PostgreSQL-specific behavior, such as database constraints, migrations, and cascading operations, should also be validated against a real database deployment.

## 🩺 Health Checks

XTerminal exposes health endpoints for monitoring.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Application liveness |
| `GET /api/health` | Readiness check, including PostgreSQL connectivity |

Use these endpoints for deployment monitoring and service health checks.

## 🗂️ Project Structure

```text
xterminal/
├── apps/
│   ├── api/                 # Fastify API and SSH backend
│   └── web/                 # React + Vite frontend
├── packages/
│   ├── types/               # Shared DTO and WebSocket types
│   ├── validation/          # Shared Zod schemas
│   ├── crypto/              # Encryption, fingerprints, and TOTP
│   └── ui/                  # Shared UI components
├── prisma/                  # Database schema and migrations
├── docker/                  # Container entrypoint and Nginx example
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── SECURITY.md
└── README.md
```

## 🔄 Terminal Session Lifecycle

A typical terminal connection follows this sequence:

1. The browser requests a terminal session through `POST /api/connections/:id/session`.
2. The backend issues a one-time session ticket with a 60-second time-to-live.
3. The browser connects to the terminal WebSocket endpoint using the ticket.
4. The backend validates the ticket, session cookie, and request origin.
5. The backend connects to the remote SSH server and verifies its host key.
6. Once trusted and authenticated, an interactive PTY is opened.
7. Terminal input, output, and resize events are streamed over WebSockets.
8. If the WebSocket disconnects temporarily, the session can be reattached during the configured 30-second reconnect grace period.
9. If the grace period expires or the session is terminated, the SSH session and associated resources are cleaned up.

The reconnect mechanism is designed to preserve the same SSH session during temporary browser or network interruptions, rather than creating duplicate sessions.

## 📈 Current Limitations

XTerminal documents unsupported scenarios instead of presenting them as working features.

- **SSH certificate authentication:** Client-side offering of OpenSSH certificates is not supported by the current SSH library.
- **Hardware-backed SSH keys:** `*-sk` SSH authentication requires compatible server-side key access and is not equivalent to browser WebAuthn login.
- **Horizontal scaling:** WebAuthn challenges and terminal sessions are held in process memory. Multi-node deployment requires shared infrastructure, including Redis-backed session/challenge coordination and an appropriate routing strategy.
- **Email delivery:** If `SMTP_URL` is not configured, verification and password-reset links are written to server logs instead of being delivered by email.

For the intended single-node deployment, these constraints should be considered during setup and operation.

## 🛣️ Roadmap

Potential future improvements include:

- Shared session and WebAuthn challenge storage for horizontal scaling.
- Expanded SSH authentication support as the underlying libraries permit.
- More connection organization and administration tools.
- Additional operational monitoring and security controls.

This roadmap represents possible future work, not a guarantee that these features are already implemented.

## 🤝 Contributing

Contributions, bug reports, security improvements, and feature suggestions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make the changes and add or update tests.
4. Run the test suite.
5. Submit a pull request describing the changes.

Please report security vulnerabilities through the process documented in [`SECURITY.md`](SECURITY.md), rather than disclosing sensitive details publicly.

## 📜 License

See The License In [`LICENSE`](LICENSE)

## 💙 Acknowledgements

XTerminal builds on excellent open-source technologies, including:

- [Fastify](https://fastify.dev/)
- [React](https://react.dev/)
- [Vite](https://vite.dev/)
- [PostgreSQL](https://www.postgresql.org/)
- [Prisma](https://www.prisma.io/)
- [xterm.js](https://xtermjs.org/)
- [ssh2](https://github.com/mscdex/ssh2)
- [WebAuthn](https://webauthn.io/)

---

**XTerminal — Your servers. Your infrastructure. Your control.** ⚡
