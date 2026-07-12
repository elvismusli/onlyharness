#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-onlyharness-smoke}"
ENV_FILE="${ENV_FILE:-$ROOT/infra/production.env}"
BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:8088}"
VITE_HARNESS_API_URL="${VITE_HARNESS_API_URL:-$BASE_URL/api}"
RESOURCE_ARCHIVE_DIR="${RESOURCE_ARCHIVE_DIR:-$ROOT/.tmp/resource-archives-smoke}"
export VITE_HARNESS_API_URL
export RESOURCE_ARCHIVE_DIR

cleanup() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$ROOT/infra/production-compose.yml" \
    -f "$ROOT/infra/production-smoke.override.yml" \
    down -v >/dev/null 2>&1 || true
  rm -rf "$RESOURCE_ARCHIVE_DIR"
}

wait_for() {
  local url="$1"
  local deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

trap cleanup EXIT

mkdir -p "$RESOURCE_ARCHIVE_DIR"
RESOURCE_ARCHIVE_MAX_BYTES=10000000 npx tsx "$ROOT/scripts/sync-resource-archives.ts" --only github:obra/superpowers >/dev/null

docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$ROOT/infra/production-compose.yml" \
  -f "$ROOT/infra/production-smoke.override.yml" \
  up -d --build

for seed_dir in directories resources harness-versions superskill; do
  if [ -d "$ROOT/data/$seed_dir" ]; then
    docker compose \
      --project-name "$PROJECT_NAME" \
      --env-file "$ENV_FILE" \
      -f "$ROOT/infra/production-compose.yml" \
      -f "$ROOT/infra/production-smoke.override.yml" \
      cp "$ROOT/data/$seed_dir" api:/app/data/
  fi
done

docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$ROOT/infra/production-compose.yml" \
  -f "$ROOT/infra/production-smoke.override.yml" \
  restart api

wait_for "$BASE_URL/api/healthz"
curl -fsS "$BASE_URL/api/showroom/capabilities?limit=12" | node -e 'let body = ""; process.stdin.on("data", (chunk) => body += chunk).on("end", () => { const value = JSON.parse(body); if (!Array.isArray(value.items)) process.exit(1); });'
curl -fsS "$BASE_URL/api/resources?q=superpowers&limit=1" | grep -q '"id":"github:obra/superpowers"'
curl -fsS "$BASE_URL/api/resources/github%3Aobra%2Fsuperpowers/archive" -o /dev/null
curl -fsS "$BASE_URL/api/leaderboard?limit=1" | grep -q '"items"'
curl -fsS "$BASE_URL/server.json" | grep -q '"name": "com.onlyharness/registry"'
curl -fsS "$BASE_URL/.well-known/oauth-protected-resource" | grep -q '"resource": "https://onlyharness.com/mcp"'
curl -fsSI "$BASE_URL/.well-known/oauth-protected-resource" | tr -d '\r' | grep -qi '^content-type: application/json'
curl -fsS "$BASE_URL/.well-known/oauth-authorization-server" | grep -q '"issuer": "https://onlyharness.com"'
curl -fsSI "$BASE_URL/.well-known/oauth-authorization-server" | tr -d '\r' | grep -qi '^content-type: application/json'
index_html="$(curl -fsS "$BASE_URL/")"
[[ "$index_html" == *"OnlyHarness"* ]]
checkout_html="$(curl -fsS "$BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher&version=0.2.0&provider_ref=manual_smoke")"
[[ "$checkout_html" == *"OnlyHarness"* ]]
web_asset="$(node -e 'const html = process.argv[1] ?? ""; const match = html.match(/src="(\/assets\/[^"]+\.js)"/); if (!match) process.exit(1); console.log(match[1]);' "$index_html")"
test -n "$web_asset"
web_js="$(curl -fsS "$BASE_URL$web_asset")"
[[ "$web_js" == *"$VITE_HARNESS_API_URL"* ]]
(
  cd "$ROOT"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  SMOKE_API_URL="$BASE_URL/api" SMOKE_EXPECT_EMAIL_CONFIRMATION="${SMOKE_EXPECT_EMAIL_CONFIRMATION:-1}" SMOKE_AUTH_RATE_LIMIT_OK="${SMOKE_AUTH_RATE_LIMIT_OK:-1}" npm run smoke:prod-auth --silent
)

echo "Production compose smoke passed at $BASE_URL"
