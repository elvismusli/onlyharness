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
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://superskill.sh}"
SUPERSKILL_APEX_URL="${SUPERSKILL_APEX_URL:-https://superskill.sh}"
SUPERSKILL_WWW_URL="${SUPERSKILL_WWW_URL:-https://www.superskill.sh}"
RUN_DEPLOY_SMOKE="${RUN_DEPLOY_SMOKE:-1}"
DEPLOY_SMOKE_ACCESS_TOKEN="${DEPLOY_SMOKE_ACCESS_TOKEN:-}"
RESOURCE_ARCHIVE_DIR="${RESOURCE_ARCHIVE_DIR:-/var/lib/onlyharness/resource-archives}"
RESOURCE_IMPORT_ARCHIVE_DIR="${RESOURCE_IMPORT_ARCHIVE_DIR:-/var/lib/onlyharness/resource-import-archives}"
SUPERSKILL_SUBJECT_SALT_PATH="${SUPERSKILL_SUBJECT_SALT_PATH:-/var/lib/onlyharness/superskill-subject-salt}"
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
for required_auth_var in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  required_auth_value="$(sed -n "s/^[[:space:]]*${required_auth_var}[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1 | tr -d '[:space:]')"
  if [[ -z "$required_auth_value" ]]; then
    echo "$required_auth_var is required for production authentication; refusing deploy." >&2
    exit 1
  fi
done
configured_import_archive_dir="$(sed -n 's/^[[:space:]]*RESOURCE_IMPORT_ARCHIVE_DIR[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1 | tr -d '[:space:]')"
RESOURCE_IMPORT_ARCHIVE_DIR="${configured_import_archive_dir:-$RESOURCE_IMPORT_ARCHIVE_DIR}"
if [[ ! "$RESOURCE_IMPORT_ARCHIVE_DIR" =~ ^/[A-Za-z0-9._/-]+$ || "$RESOURCE_IMPORT_ARCHIVE_DIR" == *".."* ]]; then
  echo "RESOURCE_IMPORT_ARCHIVE_DIR must be an absolute traversal-free path; refusing deploy." >&2
  exit 1
fi
if [[ "$RUN_DEPLOY_SMOKE" == "1" && -z "$DEPLOY_SMOKE_ACCESS_TOKEN" ]]; then
  echo "DEPLOY_SMOKE_ACCESS_TOKEN is required for authenticated containment proof." >&2
  exit 1
fi

configured_publish_flag="$(sed -n 's/^[[:space:]]*HOSTED_RESOURCE_PUBLISH_ENABLED[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1 | tr -d '[:space:]')"
configured_publish_flag="${configured_publish_flag:-false}"
if [[ "$configured_publish_flag" != "false" ]]; then
  echo "HOSTED_RESOURCE_PUBLISH_ENABLED must remain false during containment; refusing deploy." >&2
  exit 1
fi
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" "mkdir -p '$SERVER_PATH' '$RESOURCE_ARCHIVE_DIR' '$RESOURCE_IMPORT_ARCHIVE_DIR'"
ssh "$SSH_TARGET" "SERVER_PATH='$SERVER_PATH' RESOURCE_ARCHIVE_DIR='$RESOURCE_ARCHIVE_DIR' RESOURCE_IMPORT_ARCHIVE_DIR='$RESOURCE_IMPORT_ARCHIVE_DIR' SUPERSKILL_SUBJECT_SALT_PATH='$SUPERSKILL_SUBJECT_SALT_PATH' bash -s" <<'REMOTE_ARCHIVES_PREFLIGHT'
set -euo pipefail
mkdir -p "$RESOURCE_ARCHIVE_DIR"
install -d -m 0750 "$RESOURCE_IMPORT_ARCHIVE_DIR"
install -d -m 0700 "$(dirname "$SUPERSKILL_SUBJECT_SALT_PATH")"
if [ ! -f "$SUPERSKILL_SUBJECT_SALT_PATH" ]; then
  umask 077
  temporary_salt="${SUPERSKILL_SUBJECT_SALT_PATH}.tmp.$$"
  openssl rand -hex 32 > "$temporary_salt"
  chmod 0600 "$temporary_salt"
  mv "$temporary_salt" "$SUPERSKILL_SUBJECT_SALT_PATH"
fi
if [ "$(tr -d '\r\n' < "$SUPERSKILL_SUBJECT_SALT_PATH" | wc -c | tr -d ' ')" -lt 32 ]; then
  echo "Persistent SuperSkill subject salt is invalid; refusing deploy." >&2
  exit 1
fi
if [ -d "$SERVER_PATH/data/resources/archives" ]; then
  find "$SERVER_PATH/data/resources/archives" -maxdepth 1 -name '*.tar.gz' -exec mv -n {} "$RESOURCE_ARCHIVE_DIR"/ \;
fi
REMOTE_ARCHIVES_PREFLIGHT

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
  --exclude .git \
  --exclude node_modules \
  --exclude .env \
  --exclude .env.local \
  --exclude apps/registry-web/.env.local \
  --exclude infra/production.env \
  --exclude .playwright-cli \
  --exclude output \
  --exclude supabase/.temp \
  --exclude 'data/resources/archives/*.tar.gz' \
  ./ "$SSH_TARGET:$SERVER_PATH/"

rsync -az "$ENV_FILE" "$SSH_TARGET:$SERVER_PATH/infra/production.env"

# Preserve the pseudonymous user-subject salt outside the synced repository.
# The secret is generated once on the server and never crosses stdout or git.
ssh "$SSH_TARGET" "SERVER_PATH='$SERVER_PATH' SUPERSKILL_SUBJECT_SALT_PATH='$SUPERSKILL_SUBJECT_SALT_PATH' bash -s" <<'REMOTE_SUBJECT_SALT'
set -euo pipefail
env_file="$SERVER_PATH/infra/production.env"
temporary_env="${env_file}.tmp.$$"
grep -v -e '^SUPERSKILL_SUBJECT_SALT=' -e '^ONLYHARNESS_QA_EMAIL=' -e '^ONLYHARNESS_QA_PASSWORD=' "$env_file" > "$temporary_env" || true
printf 'SUPERSKILL_SUBJECT_SALT=' >> "$temporary_env"
tr -d '\r\n' < "$SUPERSKILL_SUBJECT_SALT_PATH" >> "$temporary_env"
printf '\n' >> "$temporary_env"
chmod 0600 "$temporary_env"
mv "$temporary_env" "$env_file"
REMOTE_SUBJECT_SALT

ssh "$SSH_TARGET" "cd '$SERVER_PATH' && env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES config | grep -q 'HOSTED_RESOURCE_PUBLISH_ENABLED: \"false\"'"

ssh "$SSH_TARGET" "SERVER_PATH='$SERVER_PATH' RESOURCE_ARCHIVE_DIR='$RESOURCE_ARCHIVE_DIR' bash -s" <<'REMOTE_ARCHIVES'
set -euo pipefail
mkdir -p "$RESOURCE_ARCHIVE_DIR"
if [ -d "$SERVER_PATH/data/resources/archives" ]; then
  find "$SERVER_PATH/data/resources/archives" -maxdepth 1 -name '*.tar.gz' -exec mv -n {} "$RESOURCE_ARCHIVE_DIR"/ \;
fi
REMOTE_ARCHIVES

ssh "$SSH_TARGET" "cd '$SERVER_PATH' && env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES build"
ssh "$SSH_TARGET" "cd '$SERVER_PATH' && env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES run --rm --no-deps api node --input-type=module -e 'const storage = await import(\"./apps/harness-api/dist/resource-releases.js\"); const probe = storage.probeResourceImportArchiveStorage(); if (!probe.ok) { console.error(JSON.stringify(probe)); process.exit(1); } const reconciliation = await storage.reconcileResourceReleases({pendingMaxAgeMs:0}); if (reconciliation.store === \"unavailable\") { console.error(JSON.stringify({ok:false,code:\"RELEASE_STORE_UNAVAILABLE\"})); process.exit(1); } const inventory = storage.verifyResourceReleaseInventory(); if (!inventory.ok) { console.error(JSON.stringify({ok:false,code:\"ARCHIVE_PARITY_FAILED\",failures:inventory.failures})); process.exit(1); } console.log(JSON.stringify({ok:true,code:\"RESOURCE_IMPORT_STORAGE_READY\",reconciliation,inventory}));'"
ssh "$SSH_TARGET" "cd '$SERVER_PATH' && env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES up -d --no-build"

# The api data volume shadows the image's /app/data: seed committed catalog
# data into the volume so directory/resource shelves survive on prod.
for seed_dir in directories resources harness-versions superskill; do
  ssh "$SSH_TARGET" "cd '$SERVER_PATH' && if [ -d data/$seed_dir ]; then env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES cp data/$seed_dir api:/app/data/; fi"
done
ssh "$SSH_TARGET" "cd '$SERVER_PATH' && env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES restart api"

if [[ "$DEPLOY_MODE" == "system-caddy" ]]; then
  ssh "$SSH_TARGET" "ONLYHARNESS_WEB_PORT='$ONLYHARNESS_WEB_PORT' bash -s" <<'REMOTE_CADDY'
set -euo pipefail
cat > /etc/caddy/sites/onlyharness.caddy <<CADDY
www.superskill.sh {
	redir https://superskill.sh{uri} permanent

	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		-Server
	}
}

superskill.sh {
	encode zstd gzip

	@unsupported_oauth_as path /.well-known/oauth-authorization-server
	respond @unsupported_oauth_as 404

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

onlyharness.com, www.onlyharness.com {
	encode zstd gzip

	@unsupported_oauth_as path /.well-known/oauth-authorization-server
	respond @unsupported_oauth_as 404

	@machine path /api/* /mcp* /.well-known/oauth-protected-resource /.well-known/mcp-registry-auth /server.json
	handle @machine {
		reverse_proxy 127.0.0.1:${ONLYHARNESS_WEB_PORT} {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
			header_up X-Forwarded-For {remote_host}
			header_up X-Forwarded-Proto {scheme}
		}
	}

	handle {
		redir https://superskill.sh{uri} permanent
	}
}
CADDY
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
REMOTE_CADDY
fi

ssh "$SSH_TARGET" "cd '$SERVER_PATH' && env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES ps"
ssh "$SSH_TARGET" "SERVER_PATH='$SERVER_PATH' COMPOSE_FILES='$COMPOSE_FILES' bash -s" <<'REMOTE_HEALTH'
set -euo pipefail
cd "$SERVER_PATH"
for _ in $(seq 1 45); do
  if env HOSTED_RESOURCE_PUBLISH_ENABLED=false docker compose --env-file infra/production.env $COMPOSE_FILES exec -T api node -e 'fetch("http://127.0.0.1:8787/healthz").then(async (r) => { if (!r.ok) throw new Error(await r.text()); console.log(await r.text()); })' 2>/dev/null; then
    exit 0
  fi
  sleep 1
done
echo "Timed out waiting for production API health" >&2
exit 1
REMOTE_HEALTH

if [[ "$RUN_DEPLOY_SMOKE" == "1" ]]; then
  superskill_redirect_headers="$(curl -fsSI "$SUPERSKILL_WWW_URL/deploy-canonical-smoke?source=deploy" | tr -d '\r')"
  grep -Eq '^HTTP/[0-9.]+ 30[18]([[:space:]]|$)' <<<"$superskill_redirect_headers"
  grep -Fqi "location: $SUPERSKILL_APEX_URL/deploy-canonical-smoke?source=deploy" <<<"$superskill_redirect_headers"
  grep -qi '^strict-transport-security:' <<<"$superskill_redirect_headers"
  curl -fsS "$SUPERSKILL_APEX_URL/" | grep -q 'SuperSkill'
  curl -fsS "$PUBLIC_BASE_URL/api/healthz" | grep -q '"ok":true'
  curl -fsS "$PUBLIC_BASE_URL/api/showroom/capabilities?limit=12" | node scripts/check-superskill-showroom-response.mjs approved
  curl -fsS "$PUBLIC_BASE_URL/api/showroom/selected?limit=12" | node scripts/check-superskill-showroom-response.mjs selected
  curl -fsS "$PUBLIC_BASE_URL/api/resources?q=superpowers&limit=1" | grep -q '"id":"github:obra/superpowers"'
  curl -fsS "$PUBLIC_BASE_URL/api/resources/github%3Aobra%2Fsuperpowers/archive" -o /dev/null
  containment_response="$(mktemp)"
  containment_status="$(curl -sS -o "$containment_response" -w '%{http_code}' -X POST "$PUBLIC_BASE_URL/api/imports/resource-package" \
    -H 'Content-Type: application/json' \
    --data '{"name":"deploy-containment-probe","resourceType":"guide","files":[{"path":"README.md","content":"# Deploy containment probe\\n\\nThis unauthenticated request must never publish."}]}')"
  test "$containment_status" = "401"
  grep -q '"code":"AUTH_REQUIRED"' "$containment_response"
  ! grep -Eq '/var/lib|/app/|tar:|stderr' "$containment_response"
  containment_status="$(printf 'Authorization: Bearer %s\n' "$DEPLOY_SMOKE_ACCESS_TOKEN" | curl -sS -o "$containment_response" -w '%{http_code}' -X POST "$PUBLIC_BASE_URL/api/imports/resource-package" \
    -H 'Content-Type: application/json' \
    -H @- \
    --data '{"name":"deploy-containment-probe","resourceType":"guide","files":[{"path":"README.md","content":"# Deploy containment probe\\n\\nThis authenticated request must remain disabled."}]}')"
  test "$containment_status" = "503"
  grep -q '"code":"PUBLISH_DISABLED"' "$containment_response"
  ! grep -Eq '/var/lib|/app/|tar:|stderr' "$containment_response"
  rm -f "$containment_response"
  curl -fsS "$PUBLIC_BASE_URL/server.json" | grep -q '"name": "com.onlyharness/registry"'
  curl -fsS "$PUBLIC_BASE_URL/.well-known/oauth-protected-resource" | grep -q '"resource": "https://superskill.sh/mcp"'
  curl -fsSI "$PUBLIC_BASE_URL/.well-known/oauth-protected-resource" | tr -d '\r' | grep -qi '^content-type: application/json'
  test "$(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC_BASE_URL/.well-known/oauth-authorization-server")" = "404"
  curl -fsS "$PUBLIC_BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher&version=0.2.0&provider_ref=manual_deploy_smoke" | grep -q "SuperSkill"
  curl -fsS -X POST "$PUBLIC_BASE_URL/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-smoke","version":"0"}}}' \
    | grep -Eq '"name"[[:space:]]*:[[:space:]]*"superskill"'
  curl -fsS -X POST "$PUBLIC_BASE_URL/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_resources","arguments":{"query":"superpowers","limit":1}}}' \
    | grep -q 'github:obra/superpowers'
  echo "Deploy public smoke passed at $PUBLIC_BASE_URL"
fi
