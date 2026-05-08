#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"
ENV_FILE="${REPO_ROOT}/deploy/.env"
ENV_EXAMPLE="${REPO_ROOT}/deploy/.env.example"
TEST_IMAGE="${1:-${REPO_ROOT}/unnamed.jpg}"

if [[ ! -f "${ENV_FILE}" && -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from .env.example"
fi

if [[ -f "${ENV_FILE}" ]]; then
    set -a
    source "${ENV_FILE}"
    set +a
fi

VLLM_HOST_PORT="${VLLM_HOST_PORT:-8080}"
PIPELINE_HOST_PORT="${PIPELINE_HOST_PORT:-5002}"
BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-8000}"
FRONTEND_HOST_PORT="${FRONTEND_HOST_PORT:-3000}"

VLLM_CONTAINER_NAME="${VLLM_CONTAINER_NAME:-glm-ocr-vllm}"
PIPELINE_CONTAINER_NAME="${PIPELINE_CONTAINER_NAME:-glm-ocr-pipeline}"
BACKEND_CONTAINER_NAME="${BACKEND_CONTAINER_NAME:-glm-ocr-backend}"

LAYOUT_OCR_URL_EXPECTED="${LAYOUT_OCR_URL:-http://pipeline:5002/glmocr/parse}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-glm-ocr}"
VLLM_DEVICE_EXPECTED="${VLLM_DEVICE:-cuda}"
VLLM_GPU_DEVICES_EXPECTED="${VLLM_GPU_DEVICES-0}"
VLLM_TENSOR_PARALLEL_SIZE_EXPECTED="${VLLM_TENSOR_PARALLEL_SIZE:-1}"
LAYOUT_DEVICE_EXPECTED="${LAYOUT_DEVICE:-cuda:0}"
LAYOUT_GPU_DEVICES_EXPECTED="${LAYOUT_GPU_DEVICES-0}"

if docker compose version &>/dev/null; then
    COMPOSE_CMD=(docker compose)
else
    COMPOSE_CMD=(docker-compose)
fi

run_compose() {
    "${COMPOSE_CMD[@]}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

pass_count=0
fail_count=0

pass() {
    echo "[PASS] $1"
    pass_count=$((pass_count + 1))
}

fail() {
    echo "[FAIL] $1"
    fail_count=$((fail_count + 1))
}

check_http_200() {
    local name="$1"
    local url="$2"
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)"
    if [[ "${code}" == "200" ]]; then
        pass "${name}: ${url} -> 200"
    else
        fail "${name}: ${url} -> ${code}"
    fi
}

echo "== Compose Status =="
run_compose ps --all
echo

echo "== Host Port Checks =="
check_http_200 "frontend" "http://127.0.0.1:${FRONTEND_HOST_PORT}"
check_http_200 "pipeline" "http://127.0.0.1:${PIPELINE_HOST_PORT}/health"
check_http_200 "backend" "http://127.0.0.1:${BACKEND_HOST_PORT}/health"
check_http_200 "vllm" "http://127.0.0.1:${VLLM_HOST_PORT}/health"
echo

echo "== vLLM Model Route Check =="
vllm_models="$(curl -sS "http://127.0.0.1:${VLLM_HOST_PORT}/v1/models" || true)"
if echo "${vllm_models}" | rg -q "\"id\"\\s*:\\s*\"${SERVED_MODEL_NAME}\""; then
    pass "vllm /v1/models contains model '${SERVED_MODEL_NAME}'"
else
    fail "vllm /v1/models missing model '${SERVED_MODEL_NAME}'"
fi
echo

echo "== Device Configuration Checks =="
vllm_cuda_visible_devices="$(docker exec "${VLLM_CONTAINER_NAME}" /bin/sh -lc 'echo ${CUDA_VISIBLE_DEVICES:-}' 2>/dev/null || true)"
if [[ "${vllm_cuda_visible_devices}" == "${VLLM_GPU_DEVICES_EXPECTED}" ]]; then
    pass "vllm CUDA_VISIBLE_DEVICES=${vllm_cuda_visible_devices}"
else
    fail "vllm CUDA_VISIBLE_DEVICES='${vllm_cuda_visible_devices}' (expected '${VLLM_GPU_DEVICES_EXPECTED}')"
fi

vllm_cmdline="$(docker exec "${VLLM_CONTAINER_NAME}" /bin/sh -lc "tr '\\0' ' ' < /proc/1/cmdline" 2>/dev/null || true)"
if [[ "${vllm_cmdline}" == *"--device ${VLLM_DEVICE_EXPECTED}"* ]]; then
    pass "vllm command contains --device ${VLLM_DEVICE_EXPECTED}"
else
    fail "vllm command missing --device ${VLLM_DEVICE_EXPECTED}"
fi
if [[ "${vllm_cmdline}" == *"--tensor-parallel-size ${VLLM_TENSOR_PARALLEL_SIZE_EXPECTED}"* ]]; then
    pass "vllm command contains --tensor-parallel-size ${VLLM_TENSOR_PARALLEL_SIZE_EXPECTED}"
else
    fail "vllm command missing --tensor-parallel-size ${VLLM_TENSOR_PARALLEL_SIZE_EXPECTED}"
fi

layout_device_in_pipeline="$(docker exec "${PIPELINE_CONTAINER_NAME}" /bin/sh -lc 'echo ${GLMOCR_LAYOUT_DEVICE:-}' 2>/dev/null || true)"
if [[ "${layout_device_in_pipeline}" == "${LAYOUT_DEVICE_EXPECTED}" ]]; then
    pass "pipeline GLMOCR_LAYOUT_DEVICE=${layout_device_in_pipeline}"
else
    fail "pipeline GLMOCR_LAYOUT_DEVICE='${layout_device_in_pipeline}' (expected '${LAYOUT_DEVICE_EXPECTED}')"
fi

layout_cuda_visible_devices_in_pipeline="$(docker exec "${PIPELINE_CONTAINER_NAME}" /bin/sh -lc 'echo ${CUDA_VISIBLE_DEVICES:-}' 2>/dev/null || true)"
if [[ "${layout_cuda_visible_devices_in_pipeline}" == "${LAYOUT_GPU_DEVICES_EXPECTED}" ]]; then
    pass "pipeline CUDA_VISIBLE_DEVICES=${layout_cuda_visible_devices_in_pipeline}"
else
    fail "pipeline CUDA_VISIBLE_DEVICES='${layout_cuda_visible_devices_in_pipeline}' (expected '${LAYOUT_GPU_DEVICES_EXPECTED}')"
fi
echo

echo "== Container-to-Container Checks =="
layout_in_backend="$(docker exec "${BACKEND_CONTAINER_NAME}" /bin/sh -lc 'echo ${LAYOUT_OCR_URL:-}' 2>/dev/null || true)"
if [[ "${layout_in_backend}" == "${LAYOUT_OCR_URL_EXPECTED}" ]]; then
    pass "backend LAYOUT_OCR_URL=${layout_in_backend}"
else
    fail "backend LAYOUT_OCR_URL='${layout_in_backend}' (expected '${LAYOUT_OCR_URL_EXPECTED}')"
fi

if docker exec "${BACKEND_CONTAINER_NAME}" python -c "import requests; r=requests.get('http://pipeline:5002/health',timeout=5); print(r.status_code); raise SystemExit(0 if r.status_code==200 else 1)" >/dev/null 2>&1; then
    pass "backend -> pipeline:5002 reachable"
else
    fail "backend -> pipeline:5002 unreachable"
fi

if docker exec "${PIPELINE_CONTAINER_NAME}" python -c "import urllib.request; urllib.request.urlopen('http://vllm:8000/health',timeout=5)" >/dev/null 2>&1; then
    pass "pipeline -> vllm:8000 reachable"
else
    fail "pipeline -> vllm:8000 unreachable"
fi
echo

if [[ -f "${TEST_IMAGE}" ]]; then
    echo "== OCR Smoke Test =="
    image_b64="$(base64 -w 0 "${TEST_IMAGE}")"
    ocr_resp="$(curl -sS --max-time 240 "http://127.0.0.1:${PIPELINE_HOST_PORT}/glmocr/parse" \
      -H 'Content-Type: application/json' \
      -d "{\"images\":[\"data:image/jpeg;base64,${image_b64}\"]}" || true)"
    if echo "${ocr_resp}" | rg -q '"error"'; then
        fail "pipeline /glmocr/parse returned error"
        echo "${ocr_resp}"
    elif echo "${ocr_resp}" | rg -q '"json_result"'; then
        pass "pipeline /glmocr/parse returns OCR result"
    else
        fail "pipeline /glmocr/parse returned unexpected payload"
        echo "${ocr_resp}"
    fi
    echo
else
    echo "== OCR Smoke Test =="
    echo "Skip: image not found at ${TEST_IMAGE}"
    echo
fi

echo "== Summary =="
echo "PASS=${pass_count} FAIL=${fail_count}"
if [[ "${fail_count}" -gt 0 ]]; then
    exit 1
fi
