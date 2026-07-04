#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-onlyharness-smoke}"
ENV_FILE="${ENV_FILE:-$ROOT/infra/production.env}"
BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:8088}"

cleanup() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$ROOT/infra/production-compose.yml" \
    -f "$ROOT/infra/production-smoke.override.yml" \
    down -v >/dev/null 2>&1 || true
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

docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$ROOT/infra/production-compose.yml" \
  -f "$ROOT/infra/production-smoke.override.yml" \
  up -d --build

wait_for "$BASE_URL/api/healthz"
curl -fsS "$BASE_URL/api/leaderboard?limit=1" | grep -q '"items"'
curl -fsS "$BASE_URL/" | grep -q "OnlyHarness"
(
  cd "$ROOT"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  SMOKE_API_URL="$BASE_URL/api" npm run smoke:prod-auth --silent
)

echo "Production compose smoke passed at $BASE_URL"
