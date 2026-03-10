#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUBMODULE_DIR="${REPO_ROOT}/upstream/glm-ocr"
PATCH_DIR="${REPO_ROOT}/patches/glm-ocr"
SERIES_FILE="${PATCH_DIR}/series"
GENERATED_CLEAN_PATHS=(
    "apps/frontend/public/pdfjs"
)

if [[ ! -e "${SUBMODULE_DIR}/.git" ]]; then
    echo "Missing submodule worktree: ${SUBMODULE_DIR}" >&2
    exit 1
fi

GIT_DIR="$(git -C "${SUBMODULE_DIR}" rev-parse --git-dir)"
STATE_FILE="${GIT_DIR}/patch-queue-state"

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

if [[ ! -f "${STATE_FILE}" ]]; then
    echo "Patch queue state file not found for ${SUBMODULE_DIR}, skipped cleanup."
    exit 0
fi

if [[ "$(cat "${STATE_FILE}")" != "${DESIRED_STATE}" ]]; then
    echo "Patch queue state mismatch for ${SUBMODULE_DIR}, skipped cleanup." >&2
    exit 1
fi

mapfile -t patch_names < <(
    while IFS= read -r patch_name || [[ -n "${patch_name}" ]]; do
        [[ -z "${patch_name}" ]] && continue
        [[ "${patch_name}" =~ ^# ]] && continue
        printf '%s\n' "${patch_name}"
    done < "${SERIES_FILE}"
)

for (( idx=${#patch_names[@]}-1; idx>=0; idx-- )); do
    patch_name="${patch_names[idx]}"
    patch_path="${PATCH_DIR}/${patch_name}"

    if [[ ! -f "${patch_path}" ]]; then
        echo "Missing patch file: ${patch_path}" >&2
        exit 1
    fi

    if git -C "${SUBMODULE_DIR}" apply --check --reverse "${patch_path}" >/dev/null 2>&1; then
        git -C "${SUBMODULE_DIR}" apply --reverse "${patch_path}"
        echo "Cleaned: ${patch_name}"
        continue
    fi

    if git -C "${SUBMODULE_DIR}" apply --check "${patch_path}" >/dev/null 2>&1; then
        echo "Already clean: ${patch_name}"
        continue
    fi

    echo "Failed to clean patch: ${patch_name}" >&2
    exit 1
done

for clean_path in "${GENERATED_CLEAN_PATHS[@]}"; do
    git -C "${SUBMODULE_DIR}" clean -fd -- "${clean_path}"
done

rm -f "${STATE_FILE}"
echo "Patch queue cleaned for ${SUBMODULE_DIR}"
