#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UPSTREAM_DIR="${REPO_ROOT}/upstream/glm-ocr"

cd "${REPO_ROOT}"
echo "== Root repo status =="
git status --short --branch

echo
echo "== Submodule pointer =="
if git ls-files --stage -- upstream/glm-ocr | rg -q .; then
    git submodule status -- upstream/glm-ocr
else
    echo "upstream/glm-ocr not added to index yet (run: git add .gitmodules upstream/glm-ocr)"
fi

echo
echo "== Upstream submodule worktree status =="
if [[ -e "${UPSTREAM_DIR}/.git" ]]; then
    cd "${UPSTREAM_DIR}"
    git status --short --branch
else
    echo "Missing: ${UPSTREAM_DIR}"
fi
