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
PYPI_INDEX_URL="${PYPI_INDEX_URL:-https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple}"

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

if [[ -n "$(git -C "${UPSTREAM_DIR}" status --short)" ]]; then
    echo "Upstream worktree is dirty; overlay builds require a clean upstream source." >&2
    git -C "${UPSTREAM_DIR}" status --short >&2
    exit 1
fi

docker build \
    --build-arg PYPI_INDEX_URL="${PYPI_INDEX_URL}" \
    -t "${VLLM_IMAGE}" \
    -f "${REPO_ROOT}/deploy/vllm/Dockerfile" \
    "${REPO_ROOT}/deploy/vllm"
docker build \
    --build-arg PYPI_INDEX_URL="${PYPI_INDEX_URL}" \
    -t "${PIPELINE_IMAGE}" \
    -f "${REPO_ROOT}/deploy/images/pipeline/Dockerfile" \
    "${REPO_ROOT}"
docker build \
    --build-arg PYPI_INDEX_URL="${PYPI_INDEX_URL}" \
    --build-arg NPM_REGISTRY_URL="${NPM_REGISTRY_URL:-https://registry.npmmirror.com}" \
    -t "${BACKEND_IMAGE}" \
    -f "${REPO_ROOT}/deploy/images/backend/Dockerfile" \
    "${REPO_ROOT}"
docker build \
    --build-arg NPM_REGISTRY_URL="${NPM_REGISTRY_URL:-https://registry.npmmirror.com}" \
    -t "${FRONTEND_IMAGE}" \
    -f "${REPO_ROOT}/deploy/images/frontend/Dockerfile" \
    "${REPO_ROOT}"

echo "Built images:"
echo "  ${VLLM_IMAGE}"
echo "  ${PIPELINE_IMAGE}"
echo "  ${BACKEND_IMAGE}"
echo "  ${FRONTEND_IMAGE}"
