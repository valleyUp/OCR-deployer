#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"
ENV_EXAMPLE="${REPO_ROOT}/deploy/.env.example"
ENV_FILE="${REPO_ROOT}/deploy/.env"
ACTION="${1:-up}"

mkdir -p "${REPO_ROOT}/runtime/huggingface" "${REPO_ROOT}/runtime/backend-data"

if [[ ! -f "${ENV_FILE}" && -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from .env.example"
fi

if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

run_compose() {
    ${COMPOSE_CMD} --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

ensure_upstream() {
    local upstream_dir="${REPO_ROOT}/upstream/glm-ocr"
    if [[ -e "${upstream_dir}/.git" ]]; then
        return 0
    fi

    if git -C "${REPO_ROOT}" ls-files --stage -- upstream/glm-ocr | rg -q .; then
        git -C "${REPO_ROOT}" submodule update --init upstream/glm-ocr
        return 0
    fi

    echo "Missing upstream source at ${upstream_dir}" >&2
    echo "Please ensure upstream/glm-ocr exists (or run: git add .gitmodules upstream/glm-ocr first)." >&2
    return 1
}

case "${ACTION}" in
    up|start)
        ensure_upstream
        "${SCRIPT_DIR}/patch-queue-apply.sh"
        run_compose up -d
        ;;
    down|stop)
        run_compose down
        ;;
    restart)
        run_compose restart
        ;;
    logs)
        shift || true
        run_compose logs -f "$@"
        ;;
    ps|status)
        run_compose ps
        ;;
    build|build-images)
        "${SCRIPT_DIR}/build-images.sh"
        ;;
    save-images)
        shift || true
        "${SCRIPT_DIR}/save-images.sh" "$@"
        ;;
    pull-submodule)
        ensure_upstream
        if git -C "${REPO_ROOT}" ls-files --stage -- upstream/glm-ocr | rg -q .; then
            git -C "${REPO_ROOT}" submodule update --init --remote upstream/glm-ocr
        else
            git -C "${REPO_ROOT}/upstream/glm-ocr" pull --ff-only
        fi
        "${SCRIPT_DIR}/patch-queue-apply.sh"
        ;;
    *)
        echo "Usage: $0 {up|down|restart|logs|status|build-images|save-images|pull-submodule}" >&2
        exit 1
        ;;
esac
