#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUBMODULE_DIR="${REPO_ROOT}/upstream/glm-ocr"
PATCH_DIR="${REPO_ROOT}/patches/glm-ocr"
PATCH_NAME="${1:-0001-add-dockerfile-pipeline.patch}"
PATCH_PATH="${PATCH_DIR}/${PATCH_NAME}"

shift || true

mkdir -p "${PATCH_DIR}"

declare -a target_paths=()
declare -a untracked_paths=()

if [[ "$#" -gt 0 ]]; then
    target_paths=("$@")
    while IFS= read -r line; do
        [[ -n "${line}" ]] && untracked_paths+=("${line}")
    done < <(git -C "${SUBMODULE_DIR}" ls-files --others --exclude-standard -- "${target_paths[@]}")
else
    while IFS= read -r line; do
        [[ -n "${line}" ]] && untracked_paths+=("${line}")
    done < <(git -C "${SUBMODULE_DIR}" ls-files --others --exclude-standard)
fi

if [[ "${#untracked_paths[@]}" -gt 0 ]]; then
    git -C "${SUBMODULE_DIR}" add -N -- "${untracked_paths[@]}"
fi

if [[ "${#target_paths[@]}" -gt 0 ]]; then
    git -C "${SUBMODULE_DIR}" diff --binary -- "${target_paths[@]}" > "${PATCH_PATH}"
else
    git -C "${SUBMODULE_DIR}" diff --binary > "${PATCH_PATH}"
fi

if [[ "${#untracked_paths[@]}" -gt 0 ]]; then
    git -C "${SUBMODULE_DIR}" reset -q -- "${untracked_paths[@]}"
fi

if [[ ! -s "${PATCH_PATH}" ]]; then
    rm -f "${PATCH_PATH}"
    echo "No diff found in submodule, patch not updated." >&2
    exit 1
fi

SERIES_FILE="${PATCH_DIR}/series"
if [[ ! -f "${SERIES_FILE}" ]]; then
    printf "%s\n" "${PATCH_NAME}" > "${SERIES_FILE}"
elif ! rg -Fxq "${PATCH_NAME}" "${SERIES_FILE}"; then
    printf "%s\n" "${PATCH_NAME}" >> "${SERIES_FILE}"
fi

echo "Patch refreshed: ${PATCH_PATH}"
