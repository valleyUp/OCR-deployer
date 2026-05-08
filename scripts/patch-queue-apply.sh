#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUBMODULE_DIR="${REPO_ROOT}/upstream/glm-ocr"
PATCH_DIR="${REPO_ROOT}/patches/glm-ocr"
SERIES_FILE="${PATCH_DIR}/series"

if [[ ! -e "${SUBMODULE_DIR}/.git" ]]; then
    echo "Missing submodule worktree: ${SUBMODULE_DIR}" >&2
    exit 1
fi

STATE_DIR="${REPO_ROOT}/runtime/patch-queue-state"
STATE_FILE="${STATE_DIR}/glm-ocr.state"

if [[ ! -f "${SERIES_FILE}" ]]; then
    echo "No patch queue found at ${SERIES_FILE}, skipped."
    exit 0
fi

compute_queue_state() {
    local submodule_head queue_hash
    submodule_head="$(git -C "${SUBMODULE_DIR}" rev-parse HEAD)"
    queue_hash="$(
        {
            while IFS= read -r patch_name || [[ -n "${patch_name}" ]]; do
                [[ -z "${patch_name}" ]] && continue
                [[ "${patch_name}" =~ ^# ]] && continue
                printf 'patch:%s\n' "${patch_name}"
                cat "${PATCH_DIR}/${patch_name}"
            done < "${SERIES_FILE}"
        } | sha256sum | awk '{print $1}'
    )"
    printf '%s:%s\n' "${submodule_head}" "${queue_hash}"
}

DESIRED_STATE="$(compute_queue_state)"

if [[ -f "${STATE_FILE}" ]] && [[ "$(cat "${STATE_FILE}")" == "${DESIRED_STATE}" ]]; then
    if git -C "${SUBMODULE_DIR}" diff --quiet --; then
        echo "Patch queue state is stale for ${SUBMODULE_DIR}; rechecking."
    else
        echo "Patch queue already applied for ${SUBMODULE_DIR}"
        exit 0
    fi
fi

while IFS= read -r patch_name || [[ -n "${patch_name}" ]]; do
    [[ -z "${patch_name}" ]] && continue
    [[ "${patch_name}" =~ ^# ]] && continue

    patch_path="${PATCH_DIR}/${patch_name}"
    if [[ ! -f "${patch_path}" ]]; then
        echo "Missing patch file: ${patch_path}" >&2
        exit 1
    fi

    if git -C "${SUBMODULE_DIR}" apply --whitespace=nowarn --check --reverse "${patch_path}" >/dev/null 2>&1; then
        echo "Already applied: ${patch_name}"
        continue
    fi

    if git -C "${SUBMODULE_DIR}" apply --whitespace=nowarn --check "${patch_path}" >/dev/null 2>&1; then
        git -C "${SUBMODULE_DIR}" apply --whitespace=nowarn "${patch_path}"
    else
        git -C "${SUBMODULE_DIR}" apply --whitespace=nowarn --3way "${patch_path}"
    fi
    echo "Applied: ${patch_name}"
done < "${SERIES_FILE}"

mkdir -p "${STATE_DIR}"
printf '%s\n' "${DESIRED_STATE}" > "${STATE_FILE}"
