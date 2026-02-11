#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/deploy/.env"
ENV_EXAMPLE="${REPO_ROOT}/deploy/.env.example"

if [[ ! -f "${ENV_FILE}" && -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from .env.example"
fi

if [[ -f "${ENV_FILE}" ]]; then
    set -a
    source "${ENV_FILE}"
    set +a
fi

VLLM_IMAGE="${VLLM_IMAGE:-glm-ocr-vllm:nightly}"
PIPELINE_IMAGE="${PIPELINE_IMAGE:-glm-ocr-pipeline:local}"
BACKEND_IMAGE="${BACKEND_IMAGE:-glm-ocr-backend:local}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-glm-ocr-frontend:local}"

UPSTREAM_DIR="${REPO_ROOT}/upstream/glm-ocr"

if [[ -e "${UPSTREAM_DIR}/.git" ]]; then
    echo "Using existing upstream worktree: ${UPSTREAM_DIR}"
elif git -C "${REPO_ROOT}" ls-files --stage -- upstream/glm-ocr | rg -q .; then
    git -C "${REPO_ROOT}" submodule update --init upstream/glm-ocr
else
    echo "Missing upstream source at ${UPSTREAM_DIR}" >&2
    echo "Please ensure upstream/glm-ocr exists (or run: git add .gitmodules upstream/glm-ocr first)." >&2
    exit 1
fi

"${SCRIPT_DIR}/patch-queue-apply.sh"

docker build -t "${VLLM_IMAGE}" -f "${REPO_ROOT}/deploy/vllm/Dockerfile" "${REPO_ROOT}/deploy/vllm"
docker build -t "${PIPELINE_IMAGE}" -f "${REPO_ROOT}/upstream/glm-ocr/Dockerfile.pipeline" "${REPO_ROOT}/upstream/glm-ocr"
docker build -t "${BACKEND_IMAGE}" -f "${REPO_ROOT}/upstream/glm-ocr/apps/backend/Dockerfile" "${REPO_ROOT}/upstream/glm-ocr/apps/backend"
docker build -t "${FRONTEND_IMAGE}" -f "${REPO_ROOT}/upstream/glm-ocr/apps/frontend/Dockerfile" "${REPO_ROOT}/upstream/glm-ocr/apps/frontend"

echo "Built images:"
echo "  ${VLLM_IMAGE}"
echo "  ${PIPELINE_IMAGE}"
echo "  ${BACKEND_IMAGE}"
echo "  ${FRONTEND_IMAGE}"
