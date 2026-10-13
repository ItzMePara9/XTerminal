# ⚡ XTerminal

**A secure, self-hosted web SSH client and server connection manager.**

XTerminal lets you securely connect to and manage remote servers directly from your browser. It combines a real interactive SSH terminal with encrypted credential storage, host-key verification, multi-factor authentication, and centralized connection management.

Built with **Fastify, React, PostgreSQL, WebSockets, and xterm.js**, XTerminal provides a modern interface for managing SSH connections without requiring an SSH client in the browser.

## Install

Run these three commands on your VPS:

```bash
git clone https://github.com/ItzMePara9/XTerminal.git
cd XTerminal
bash install.sh
```

The installer asks for your XTerminal directory and domain, then handles the application setup, PostgreSQL, Nginx, HTTPS, WebSockets, database migrations, and system service configuration automatically.

## ✨ Features

- 🖥️ **Interactive SSH Terminal** — Real PTY-backed SSH shells powered by `ssh2`, WebSockets, and xterm.js.
- 🔐 **Encrypted Credential Vault** — Protect passwords, private keys, and passphrases with AES-256-GCM encryption.
- 🛡️ **Host-Key Verification** — Explicitly trust unknown hosts and reject changed host keys.
- 🔑 **Multiple Authentication Methods** — Passwords, private keys, saved credentials, passphrases, and one-hop jump hosts.
- 🔒 **Secure Authentication** — Argon2id password hashing, HTTP-only sessions, email verification, and password reset.
- 📱 **Two-Factor Authentication** — TOTP and WebAuthn/FIDO2 security keys.
- 🗂️ **Connection Management** — Organize servers with groups, tags, and favorites.
- 🧩 **SSH Key Management** — Manage SSH keys and associate them with saved connections.
- 📋 **Audit Logging** — Track supported security-sensitive actions.
- 🖱️ **Multiple Terminal Tabs** — Resize terminals, search scrollback, and customize terminal themes.
- ⚡ **Command Palette** — Quickly navigate the application with `Ctrl + K`.
- 🔄 **Session Reconnection** — Reattach to an existing SSH session during the reconnect grace period.
- 🚦 **Resource Limits** — Configure connection, session, and SSH timeout limits.
- 🩺 **Health Checks** — Monitor application liveness and database readiness.

## 🏗️ Architecture

The browser communicates with XTerminal over HTTP(S) and WebSockets. The backend handles authentication, connection management, credential storage, and SSH communication.

```text
Browser ── HTTPS/WSS ──► XTerminal ── SSH ──► Remote servers
                          │
                          ├── Fastify API
                          ├── React + xterm.js interface
                          ├── PostgreSQL database
                          └── Encrypted credential vault
```

**Important:** The browser never connects directly to remote SSH servers. All SSH connections are established and managed by the XTerminal backend.

## 🔒 Security

- Credentials are encrypted at rest with AES-256-GCM.
- Passwords are protected with Argon2id hashing.
- Sessions use HTTP-only cookies.
- WebSocket terminal sessions validate authentication and request origins.
- Unknown SSH host keys require explicit trust.
- Changed SSH host keys are rejected.
- TOTP and WebAuthn/FIDO2 account security are supported.

Keep your production secrets and encryption key private. Losing the encryption key can make stored credentials permanently unrecoverable.

## 🩺 Health Checks

XTerminal provides two health endpoints for monitoring:

- `GET /health` — Application liveness.
- `GET /api/health` — Application readiness, including PostgreSQL connectivity.

## ⚠️ Limitations

- OpenSSH certificate authentication is not currently offered by the underlying `ssh2` client library.
- Hardware-backed `*-sk` SSH keys require compatible server-side key access.
- WebAuthn challenges and terminal sessions are held in process memory, so horizontal scaling requires shared infrastructure.
- When SMTP is not configured, verification and password-reset links are written to the server logs.

## 💙 Built With

Fastify · React · PostgreSQL · WebSockets · xterm.js · Prisma · WebAuthn · ssh2
