#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/deploy/.env"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"

# ── Load .env ──
if [[ -f "${ENV_FILE}" ]]; then
    set -a
    source "${ENV_FILE}"
    set +a
fi

FRONTEND_IMAGE="${FRONTEND_IMAGE:-glm-ocr-frontend:local}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER_NAME:-glm-ocr-frontend}"
DOCKERFILE="${REPO_ROOT}/deploy/images/frontend/Dockerfile"
NPM_REGISTRY_URL="${NPM_REGISTRY_URL:-https://registry.npmmirror.com}"

echo "==> Rebuilding frontend image: ${FRONTEND_IMAGE}"
echo "    Dockerfile : ${DOCKERFILE}"
echo "    Context    : ${REPO_ROOT}"

docker build \
    --build-arg NPM_REGISTRY_URL="${NPM_REGISTRY_URL}" \
    -t "${FRONTEND_IMAGE}" \
    -f "${DOCKERFILE}" \
    "${REPO_ROOT}"

echo ""
echo "==> Restarting frontend container: ${FRONTEND_CONTAINER}"

cd "${REPO_ROOT}/deploy"

# Stop and remove the old container, then recreate
docker compose -f "${COMPOSE_FILE}" up -d --force-recreate --no-deps frontend

echo ""
echo "Done. Frontend is running at http://localhost:${FRONTEND_HOST_PORT:-3000}"
