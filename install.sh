#!/usr/bin/env bash
set -Eeuo pipefail

# XTerminal bare-metal installer for Debian/Ubuntu.
# Run from the repository root: bash install.sh

APP_NAME="xterminal"
APP_USER="xterminal"
APP_GROUP="xterminal"
APP_PORT="7132"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
NGINX_FILE="/etc/nginx/sites-available/${APP_NAME}"
BACKUP_DIR="/var/backups/${APP_NAME}/$(date '+%Y%m%d-%H%M%S')"

# ANSI true-color helpers. Set NO_COLOR=1 for plain output in logs/CI.
if [[ -z "${NO_COLOR:-}" && -t 1 ]]; then
  COLOR_ENABLED=1
else
  COLOR_ENABLED=0
fi

rgb() {
  local r="$1" g="$2" b="$3"
  if [[ "${COLOR_ENABLED}" -eq 1 ]]; then
    printf '\033[38;2;%s;%s;%sm' "$r" "$g" "$b"
  fi
}

reset_color() { [[ "${COLOR_ENABLED}" -eq 1 ]] && printf '\033[0m'; }

typewrite() {
  local text="$1" delay="${2:-0.012}" i char color_index
  local -a colors=("255 0 90" "255 120 0" "255 240 0" "0 255 120" "0 210 255" "130 80 255")
  for ((i = 0; i < ${#text}; i++)); do
    char="${text:i:1}"
    color_index=$((i % ${#colors[@]}))
    printf '%s%s%s' "$(rgb ${colors[color_index]})" "${char}" "$(reset_color)"
    sleep "${delay}"
  done
}

banner() {
  local line
  printf '\n'
  while IFS= read -r line; do
    if [[ "${COLOR_ENABLED}" -eq 1 ]]; then
      printf '%s%s%s\n' "$(rgb 255 0 90)" "${line}" "$(reset_color)"
    else
      printf '%s\n' "${line}"
    fi
  done <<'BANNER'
 __  __ _______ _________ ____  __  __ ___ _   _    _    _
 \ \/ /|__   __|__   __|  _ \|  \/  |_ _| \ | |  / \  | |
  \  /    | |     | |  | |_) | |\/| || ||  \| | / _ \ | |
  /  \    | |     | |  |  _ <| |  | || || |\  |/ ___ \| |___
 /_/\_\   |_|     |_|  |_| \_\_|  |_|___|_| \_/_/   \_\_____| 
BANNER
  printf '\n'
}

log() {
  local message="[$(date '+%H:%M:%S')] $*"
  printf '\n'
  typewrite "${message}" 0.008
  printf '\n'
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  printf 'Recovery: inspect the service with: journalctl -u %s -n 100\n' "${APP_NAME}" >&2
  printf 'The previous application files and database migrations are not automatically rolled back.\n' >&2
  exit 1
}
trap 'die "Installation failed on line ${LINENO}. Existing files and database migrations were not automatically rolled back."' ERR

[[ "${EUID}" -eq 0 ]] || die "Run this script as root (for example: sudo bash install.sh)."
command -v apt-get >/dev/null || die "This installer supports Debian/Ubuntu systems with apt-get."

banner
DEFAULT_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
read -r -p "Where is your XTerminal directory? [${DEFAULT_APP_DIR}]: " APP_DIR
APP_DIR="${APP_DIR:-${DEFAULT_APP_DIR}}"
APP_DIR="${APP_DIR%/}"
[[ -d "${APP_DIR}" ]] || die "Directory does not exist: ${APP_DIR}"
[[ -f "${APP_DIR}/package.json" && -f "${APP_DIR}/.env.example" ]] || die "That directory does not look like the XTerminal repository."
install -d -m 700 "${BACKUP_DIR}"
[[ -f "${APP_DIR}/.env" ]] && cp -p "${APP_DIR}/.env" "${BACKUP_DIR}/.env"
[[ -f "${NGINX_FILE}" ]] && cp -p "${NGINX_FILE}" "${BACKUP_DIR}/nginx.conf"
printf 'Pre-deployment backups will be stored in %s\n' "${BACKUP_DIR}"

read -r -p "Domain name (for example, terminal.example.com): " DOMAIN
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"
[[ "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || die "Invalid domain name: ${DOMAIN}"

read -r -p "Email for Let's Encrypt (leave blank to configure HTTP only): " CERTBOT_EMAIL
SCHEME="http"
if [[ -n "${CERTBOT_EMAIL}" ]]; then
  SCHEME="https"
else
  printf '\nWARNING: HTTP mode is for development/testing only. Production browsers require HTTPS for secure WebAuthn.\n'
  read -r -p "Type HTTP to continue without TLS: " HTTP_CONFIRM
  [[ "${HTTP_CONFIRM}" == "HTTP" ]] || die "HTTPS is required for production. Re-run with a Let's Encrypt email address."
fi

log "Installing OS dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx postgresql postgresql-contrib openssl build-essential python3

if ! command -v node >/dev/null || ! node --version | grep -Eq '^v22\.'; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v corepack >/dev/null; then
  npm install --global corepack
fi
corepack enable
corepack prepare pnpm@9.13.2 --activate

log "Creating application user and directories"
if ! getent group "${APP_GROUP}" >/dev/null; then groupadd --system "${APP_GROUP}"; fi
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${APP_GROUP}" --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
else
  usermod --gid "${APP_GROUP}" --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi

log "Configuring PostgreSQL"
systemctl enable --now postgresql
DB_PASSWORD="$(openssl rand -hex 24)"
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${APP_USER}'" | grep -q 1; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE USER ${APP_USER} PASSWORD '${DB_PASSWORD}';"
fi
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='${APP_NAME}'" | grep -q 1; then
  runuser -u postgres -- createdb -O "${APP_USER}" "${APP_NAME}"
fi
# Do not silently take ownership of an existing production database. Grant only
# the privileges Prisma needs, then verify the migration role can use it.
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${APP_NAME} TO ${APP_USER};"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "${APP_NAME}" -c "GRANT USAGE, CREATE ON SCHEMA public TO ${APP_USER};"
if ! runuser -u postgres -- psql -tAc "SELECT has_database_privilege('${APP_USER}', '${APP_NAME}', 'CONNECT')" | grep -q t \
  || ! runuser -u postgres -- psql -tAc "SELECT has_database_privilege('${APP_USER}', '${APP_NAME}', 'CREATE')" | grep -q t \
  || ! runuser -u postgres -- psql -tAc "SELECT has_database_privilege('${APP_USER}', '${APP_NAME}', 'TEMPORARY')" | grep -q t; then
  die "PostgreSQL role ${APP_USER} does not have the required privileges on ${APP_NAME}."
fi
runuser -u postgres -- pg_dump --format=custom --file="${BACKUP_DIR}/postgres.dump" "${APP_NAME}"

log "Preparing environment"
if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
fi

SESSION_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
python3 - "${APP_DIR}/.env" "${DOMAIN}" "${SCHEME}" "${SESSION_SECRET}" "${ENCRYPTION_KEY}" "${DB_PASSWORD}" <<'PY'
from pathlib import Path
import sys
from urllib.parse import quote

path = Path(sys.argv[1])
domain = sys.argv[2]
scheme = sys.argv[3]
session = sys.argv[4]
encryption = sys.argv[5]
db_password = sys.argv[6]
db_url = "postgresql://xterminal:{}@localhost:5432/xterminal".format(quote(db_password, safe=""))
values = {
    "NODE_ENV": "production",
    "DATABASE_URL": db_url,
    "HOST": "127.0.0.1",
    "SESSION_SECRET": session,
    "ENCRYPTION_KEY": encryption,
    "APP_URL": f"{scheme}://{domain}",
    "WEBAUTHN_RP_ID": domain,
    "WEBAUTHN_ORIGIN": f"{scheme}://{domain}",
}
lines = path.read_text().splitlines()
seen = set()
out = []
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0]
        if key in values:
            current = line.split("=", 1)[1]
            # Keep existing secrets when the installer is run again.
            secret_is_valid = len(current) == 64 and all(c in "0123456789abcdefABCDEF" for c in current)
            placeholder = current.lower() in {"change-me", "changeme", "replace-me", "your-secret-here", "secret"}
            preserve = key in {"DATABASE_URL", "SESSION_SECRET", "ENCRYPTION_KEY"} and current and not (
                key == "DATABASE_URL" and ("change-me" in current or current == "postgresql://xterminal@localhost:5432/xterminal")
            ) and (key == "DATABASE_URL" or (secret_is_valid and not placeholder))
            value = current if preserve else values[key]
            out.append(f"{key}={value}")
            seen.add(key)
            continue
    out.append(line)
for key, value in values.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
chmod 600 "${APP_DIR}/.env"

# Keep the PostgreSQL role password synchronized with the URL actually used by
# Prisma, including an existing custom password on a reinstall.
DB_URL_PASSWORD="$(python3 - "${APP_DIR}/.env" <<'PY'
from pathlib import Path
from urllib.parse import unquote, urlparse
import sys
for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        parsed = urlparse(line.split("=", 1)[1])
        if (parsed.hostname == "localhost" and (parsed.port or 5432) == 5432
                and parsed.username == "xterminal" and (parsed.path or "").lstrip("/") == "xterminal"):
            print(unquote(parsed.password or ""))
        break
PY
)"
if [[ -n "${DB_URL_PASSWORD}" ]]; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v password="${DB_URL_PASSWORD}" \
    -c "ALTER ROLE ${APP_USER} PASSWORD :'password';"
fi

log "Installing dependencies, generating Prisma client, and building XTerminal"
cd "${APP_DIR}"
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm prisma migrate deploy
pnpm build

log "Installing systemd service"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=XTerminal web SSH client
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=$(command -v pnpm) start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=full
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF
chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/.env"
chmod 640 "${APP_DIR}/.env"
systemctl daemon-reload
systemctl enable "${APP_NAME}"

log "Configuring Nginx"
cat > "${NGINX_FILE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /ws/ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sfn "${NGINX_FILE}" "/etc/nginx/sites-enabled/${APP_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [[ -n "${CERTBOT_EMAIL}" ]]; then
  log "Installing Certbot and requesting a certificate"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx --non-interactive --agree-tos --redirect --email "${CERTBOT_EMAIL}" -d "${DOMAIN}"
fi

log "Restarting XTerminal and checking health"
systemctl restart "${APP_NAME}"
systemctl is-active --quiet "${APP_NAME}" || {
  systemctl --no-pager --full status "${APP_NAME}" || true
  die "XTerminal did not start successfully. Check: journalctl -u ${APP_NAME} -n 100"
}
if ! curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${APP_PORT}/health" >/dev/null; then
  systemctl --no-pager --full status "${APP_NAME}" || true
  die "XTerminal is running but its health endpoint is not responding."
fi
if ! curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
  systemctl --no-pager --full status "${APP_NAME}" || true
  die "XTerminal liveness is healthy, but the PostgreSQL readiness check failed."
fi
if [[ -n "${CERTBOT_EMAIL}" ]]; then
  curl --fail --silent --show-error --max-time 15 "https://${DOMAIN}/health" >/dev/null || \
    die "HTTPS health check failed. Verify DNS, firewall ports 80/443, and the certificate."
fi

log "Installation complete"
printf 'Open: %s\n' "${CERTBOT_EMAIL:+https://${DOMAIN}}"
if [[ -z "${CERTBOT_EMAIL}" ]]; then printf 'Open: http://%s (add TLS with certbot later)\n' "${DOMAIN}"; fi
printf 'Service: systemctl status %s\n' "${APP_NAME}"
printf 'Logs:    journalctl -u %s -f\n' "${APP_NAME}"
