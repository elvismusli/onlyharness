#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-onlyharness-smoke}"
ENV_FILE="${ENV_FILE:-$ROOT/infra/production.env}"
BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:8088}"
VITE_HARNESS_API_URL="${VITE_HARNESS_API_URL:-$BASE_URL/api}"
RESOURCE_ARCHIVE_DIR="${RESOURCE_ARCHIVE_DIR:-$ROOT/.tmp/resource-archives-smoke}"
RESOURCE_IMPORT_ARCHIVE_DIR="${RESOURCE_IMPORT_ARCHIVE_DIR:-$ROOT/.tmp/resource-import-archives-smoke}"
export VITE_HARNESS_API_URL
export RESOURCE_ARCHIVE_DIR
export RESOURCE_IMPORT_ARCHIVE_DIR

cleanup() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$ROOT/infra/production-compose.yml" \
    -f "$ROOT/infra/production-smoke.override.yml" \
    down -v >/dev/null 2>&1 || true
  rm -rf "$RESOURCE_ARCHIVE_DIR"
  rm -rf "$RESOURCE_IMPORT_ARCHIVE_DIR"
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
mkdir -p "$RESOURCE_IMPORT_ARCHIVE_DIR"
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
docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$ROOT/infra/production-compose.yml" \
  -f "$ROOT/infra/production-smoke.override.yml" \
  exec -T api node --input-type=module -e 'const storage = await import("./apps/harness-api/dist/resource-releases.js"); const result = storage.probeResourceImportArchiveStorage(); if (!result.ok) { console.error(JSON.stringify(result)); process.exit(1); } console.log(JSON.stringify(result));'
docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$ROOT/infra/production-compose.yml" \
  -f "$ROOT/infra/production-smoke.override.yml" \
  exec -T api node scripts/check-share-fonts.mjs
docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$ROOT/infra/production-compose.yml" \
  -f "$ROOT/infra/production-smoke.override.yml" \
  exec -T api node scripts/check-share-unicode-render.mjs
curl -fsS "$BASE_URL/api/showroom/capabilities?limit=12" | node "$ROOT/scripts/check-superskill-showroom-response.mjs" approved
curl -fsS "$BASE_URL/api/showroom/selected?limit=12" | node "$ROOT/scripts/check-superskill-showroom-response.mjs" selected
curl -fsS "$BASE_URL/api/resources?q=superpowers&limit=1" | grep -q '"id":"github:obra/superpowers"'
legacy_archive_response="$(mktemp)"
test "$(curl -sS -o "$legacy_archive_response" -w '%{http_code}' "$BASE_URL/api/resources/github%3Aobra%2Fsuperpowers/archive")" = "409"
grep -q '"code":"RESOURCE_ARCHIVE_NOT_HOSTED"' "$legacy_archive_response"
rm -f "$legacy_archive_response"
curl -fsS "$BASE_URL/api/leaderboard?limit=1" | grep -q '"items"'
curl -fsS "$BASE_URL/server.json" | grep -q '"name": "com.onlyharness/registry"'
curl -fsS "$BASE_URL/.well-known/oauth-protected-resource" | grep -q '"resource": "https://superskill.sh/mcp"'
curl -fsSI "$BASE_URL/.well-known/oauth-protected-resource" | tr -d '\r' | grep -qi '^content-type: application/json'
test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/.well-known/oauth-authorization-server")" = "404"
index_html="$(curl -fsS "$BASE_URL/")"
[[ "$index_html" == *"SuperSkill"* ]]
[[ "$index_html" == *"one link for every agent skill"* ]]
[[ "$index_html" == *'rel="canonical" href="https://superskill.sh/"'* ]]
curl -fsSI "$BASE_URL/favicon.ico" | tr -d '\r' | grep -qi '^content-type: image/vnd.microsoft.icon\|^content-type: image/x-icon'
curl -fsSI "$BASE_URL/manifest.webmanifest" | tr -d '\r' | grep -qi '^content-type: application/manifest+json\|^content-type: application/json'
bootstrap_json="$(curl -fsS "$BASE_URL/api/superskill/install")"
[[ "$bootstrap_json" == *'"action":"install_superskill"'* ]]
[[ "$bootstrap_json" == *'superskill install https://superskill.sh/api/superskill/install --auto'* ]]
share_key="Z2l0aHViOm9icmEvc3VwZXJwb3dlcnM"
share_html="$(curl -fsS -A 'TelegramBot (like TwitterBot)' "$BASE_URL/r/$share_key")"
[[ "$share_html" == *'property="og:title"'* ]]
grep -qi 'superpowers' <<<"$share_html"
[[ "$share_html" == *"https://superskill.sh/og/r/$share_key"* ]]
share_png="$(mktemp)"
curl -fsS "$BASE_URL/og/r/$share_key" -o "$share_png"
node "$ROOT/scripts/check-share-png.mjs" "$share_png"
rm -f "$share_png"
capability_html="$(curl -fsS -A 'TelegramBot (like TwitterBot)' "$BASE_URL/c/deep-market-researcher")"
[[ "$capability_html" == *'property="og:title"'* ]]
grep -qi 'deep market researcher' <<<"$capability_html"
[[ "$capability_html" == *'https://superskill.sh/og/c/deep-market-researcher'* ]]
capability_png="$(mktemp)"
curl -fsS "$BASE_URL/og/c/deep-market-researcher" -o "$capability_png"
node "$ROOT/scripts/check-share-png.mjs" "$capability_png"
rm -f "$capability_png"
checkout_html="$(curl -fsS "$BASE_URL/checkout?owner=harnesses&repo=deep-market-researcher&version=0.2.0&provider_ref=manual_smoke")"
[[ "$checkout_html" == *"SuperSkill"* ]]
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
  SMOKE_API_URL="$BASE_URL/api" SMOKE_EXPECT_EMAIL_CONFIRMATION="${SMOKE_EXPECT_EMAIL_CONFIRMATION:-1}" SMOKE_AUTH_RATE_LIMIT_OK="${SMOKE_AUTH_RATE_LIMIT_OK:-1}" SMOKE_EMAIL_REDIRECT_TO="${SMOKE_EMAIL_REDIRECT_TO:-https://superskill.sh}" npm run smoke:prod-auth --silent
)

echo "Production compose smoke passed at $BASE_URL"
