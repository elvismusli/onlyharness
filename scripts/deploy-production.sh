#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-37.27.104.125}"
SERVER_USER="${SERVER_USER:-root}"
SSH_TARGET="${SSH_TARGET:-$SERVER_USER@$SERVER_HOST}"
SERVER_PATH="${SERVER_PATH:-/opt/onlyharness}"
ENV_FILE="${ENV_FILE:-infra/production.env}"
ALLOW_STOP_EXISTING_CADDY="${ALLOW_STOP_EXISTING_CADDY:-0}"
DEPLOY_MODE="${DEPLOY_MODE:-system-caddy}"
ONLYHARNESS_WEB_PORT="${ONLYHARNESS_WEB_PORT:-8097}"
COMPOSE_FILES="-f infra/production-compose.yml"
if [[ "$DEPLOY_MODE" == "system-caddy" ]]; then
  COMPOSE_FILES="$COMPOSE_FILES -f infra/production-system-caddy.override.yml"
elif [[ "$DEPLOY_MODE" != "standalone" ]]; then
  echo "Unknown DEPLOY_MODE=$DEPLOY_MODE. Use system-caddy or standalone." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy infra/production.env.example and fill Supabase key plus HARNESS_WEBHOOK_TOKEN." >&2
  exit 1
fi

ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" "mkdir -p '$SERVER_PATH'"

ssh "$SSH_TARGET" "ALLOW_STOP_EXISTING_CADDY='$ALLOW_STOP_EXISTING_CADDY' DEPLOY_MODE='$DEPLOY_MODE' ONLYHARNESS_WEB_PORT='$ONLYHARNESS_WEB_PORT' bash -s" <<'REMOTE_PREFLIGHT'
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed on the server. Install Docker Engine and rerun deploy." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available on the server." >&2
  exit 1
fi

if [[ "$DEPLOY_MODE" == "system-caddy" ]]; then
  port_users="$(ss -ltnp '( sport = :80 or sport = :443 )' 2>/dev/null | tail -n +2 || true)"
  if [[ -n "$port_users" && ! "$port_users" =~ [Cc]addy ]]; then
    echo "Ports 80/443 are used by a non-Caddy process; refusing system-caddy deploy." >&2
    echo "$port_users" >&2
    exit 1
  fi
  upstream_users="$(ss -ltnp 2>/dev/null | awk -v port=":$ONLYHARNESS_WEB_PORT" '$4 ~ port { print }' || true)"
  existing_onlyharness="$(docker ps --filter 'label=com.docker.compose.service=web' --format '{{.Names}} {{.Ports}}' | grep -F "127.0.0.1:${ONLYHARNESS_WEB_PORT}->80/tcp" || true)"
  if [[ -n "$upstream_users" && -z "$existing_onlyharness" ]]; then
    echo "Port $ONLYHARNESS_WEB_PORT is already used by another process; choose ONLYHARNESS_WEB_PORT." >&2
    echo "$upstream_users" >&2
    exit 1
  fi
else
  port_users="$(ss -ltnp '( sport = :80 or sport = :443 )' 2>/dev/null | tail -n +2 || true)"
  if [[ -n "$port_users" ]]; then
    existing_onlyharness="$(docker ps --filter 'label=com.docker.compose.service=web' --format '{{.Names}} {{.Ports}}' | grep -E '(^|, )0\\.0\\.0\\.0:80->80/tcp|(^|, ):::80->80/tcp|(^|, )80/tcp' || true)"
    if [[ -n "$existing_onlyharness" ]]; then
      :
    elif grep -qi 'caddy' <<<"$port_users"; then
      if [[ "$ALLOW_STOP_EXISTING_CADDY" == "1" ]]; then
        if systemctl list-unit-files caddy.service >/dev/null 2>&1; then
          systemctl stop caddy || true
          systemctl disable caddy || true
        else
          pkill -x caddy || true
        fi
      else
        echo "Ports 80/443 are currently used by Caddy. Rerun with ALLOW_STOP_EXISTING_CADDY=1 if this server is dedicated to OnlyHarness." >&2
        echo "$port_users" >&2
        exit 1
      fi
    else
      echo "Ports 80/443 are already used by another process; refusing to deploy over it." >&2
      echo "$port_users" >&2
      exit 1
    fi
  fi
fi
REMOTE_PREFLIGHT

rsync -az --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude .env.local \
  --exclude apps/registry-web/.env.local \
  --exclude infra/production.env \
  --exclude .playwright-cli \
  --exclude output \
  --exclude supabase/.temp \
  ./ "$SSH_TARGET:$SERVER_PATH/"

rsync -az "$ENV_FILE" "$SSH_TARGET:$SERVER_PATH/infra/production.env"

ssh "$SSH_TARGET" "cd '$SERVER_PATH' && docker compose --env-file infra/production.env $COMPOSE_FILES up -d --build"

if [[ "$DEPLOY_MODE" == "system-caddy" ]]; then
  ssh "$SSH_TARGET" "ONLYHARNESS_WEB_PORT='$ONLYHARNESS_WEB_PORT' bash -s" <<'REMOTE_CADDY'
set -euo pipefail
cat > /etc/caddy/sites/onlyharness.caddy <<CADDY
onlyharness.com, www.onlyharness.com {
	encode zstd gzip

	reverse_proxy 127.0.0.1:${ONLYHARNESS_WEB_PORT} {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-Proto https
	}

	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		-Server
	}
}
CADDY
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
REMOTE_CADDY
fi

ssh "$SSH_TARGET" "cd '$SERVER_PATH' && docker compose --env-file infra/production.env $COMPOSE_FILES ps"
ssh "$SSH_TARGET" "cd '$SERVER_PATH' && docker compose --env-file infra/production.env $COMPOSE_FILES exec -T api node -e 'fetch(\"http://127.0.0.1:8787/healthz\").then(async (r) => { if (!r.ok) throw new Error(await r.text()); console.log(await r.text()); })'"
