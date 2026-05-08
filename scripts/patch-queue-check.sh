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

if [[ ! -f "${SERIES_FILE}" ]]; then
    echo "No patch queue found at ${SERIES_FILE}, skipped."
    exit 0
fi

TMP_DIR="$(mktemp -d /tmp/glm-ocr-patch-check.XXXXXX)"
cleanup() {
    rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

rsync -a --exclude .git "${SUBMODULE_DIR}/" "${TMP_DIR}/"
git -C "${TMP_DIR}" init -q

while IFS= read -r patch_name || [[ -n "${patch_name}" ]]; do
    [[ -z "${patch_name}" ]] && continue
    [[ "${patch_name}" =~ ^# ]] && continue

    patch_path="${PATCH_DIR}/${patch_name}"
    if [[ ! -f "${patch_path}" ]]; then
        echo "Missing patch file: ${patch_path}" >&2
        exit 1
    fi

    git -C "${TMP_DIR}" apply --whitespace=nowarn "${patch_path}"
    echo "Checked: ${patch_name}"
done < "${SERIES_FILE}"

echo "Patch queue applies cleanly against $(git -C "${SUBMODULE_DIR}" rev-parse --short HEAD)"
