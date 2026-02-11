#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/deploy/.env"
ENV_EXAMPLE="${REPO_ROOT}/deploy/.env.example"
OUTPUT_PATH="${1:-${REPO_ROOT}/runtime/glm-ocr-4images.tar}"

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

mkdir -p "$(dirname "${OUTPUT_PATH}")"
docker save -o "${OUTPUT_PATH}" \
    "${VLLM_IMAGE}" \
    "${PIPELINE_IMAGE}" \
    "${BACKEND_IMAGE}" \
    "${FRONTEND_IMAGE}"

echo "Saved image bundle to: ${OUTPUT_PATH}"
