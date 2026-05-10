#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TMP_ROOT="${REPO_ROOT}/tmp/ui-preview-branches"
WORKTREE_ROOT="${TMP_ROOT}/worktrees"
RUN_ROOT="${TMP_ROOT}/runs"
LOG_ROOT="${TMP_ROOT}/logs"
PID_DIR="${TMP_ROOT}/pids"
MANIFEST="${TMP_ROOT}/manifest.tsv"

HOST="${HOST:-127.0.0.1}"
START_PORT="${START_PORT:-3003}"
BRANCH_PATTERN="${BRANCH_PATTERN:-feat*}"
UI_PREVIEW_MODE="${UI_PREVIEW_MODE:-dev}"

ACTION="${1:-start}"
if [[ $# -gt 0 ]]; then
    shift
fi

usage() {
    cat <<'EOF'
Usage:
  scripts/preview-ui-branches.sh start [branch ...]
  scripts/preview-ui-branches.sh stop
  scripts/preview-ui-branches.sh status
  scripts/preview-ui-branches.sh clean
  scripts/preview-ui-branches.sh list

Defaults:
  - Branches: local branches matching feat*
  - Ports:    start at 3003 and skip occupied ports
  - Temp dir: ./tmp/ui-preview-branches
  - Mode:     Vite dev server

Environment:
  START_PORT=3003              first port to try
  HOST=127.0.0.1               bind host
  BRANCH_PATTERN='feat*'       branch glob used when no branches are passed
  UI_PREVIEW_MODE=dev|preview  preview builds static dist before serving
  PNPM_INSTALL_FLAGS='...'     override install flags

Examples:
  scripts/preview-ui-branches.sh start
  START_PORT=3010 scripts/preview-ui-branches.sh start feat/ui-a feat/ui-b
  UI_PREVIEW_MODE=preview scripts/preview-ui-branches.sh start
  PNPM_INSTALL_FLAGS='--frozen-lockfile --force' scripts/preview-ui-branches.sh start
  scripts/preview-ui-branches.sh stop
EOF
}

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

safe_name() {
    printf '%s' "$1" | sed -E 's#[^A-Za-z0-9._-]+#-#g; s#^-+|-+$##g'
}

is_under_tmp_root() {
    local path="$1"
    case "${path}" in
        "${TMP_ROOT}"|"${TMP_ROOT}"/*) return 0 ;;
        *) return 1 ;;
    esac
}

port_is_free() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ! ss -ltn | awk '{print $4}' | grep -Eq "[:.]${port}$"
        return
    fi
    ! (true >/dev/tcp/"${HOST}"/"${port}") >/dev/null 2>&1
}

listener_pid_for_port() {
    local port="$1"
    if ! command -v ss >/dev/null 2>&1; then
        return 1
    fi
    ss -ltnp 2>/dev/null |
        awk -v port=":${port}" '$4 ~ port "$" {print $0}' |
        sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' |
        head -n 1
}

stop_pid() {
    local pid="$1"
    [[ -n "${pid}" ]] || return 1
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
        return 1
    fi
    kill -- "-${pid}" >/dev/null 2>&1 || kill "${pid}" >/dev/null 2>&1 || true
    return 0
}

next_free_port() {
    local port="$1"
    while ! port_is_free "${port}"; do
        port=$((port + 1))
    done
    printf '%s\n' "${port}"
}

current_branch() {
    git -C "${REPO_ROOT}" branch --show-current
}

selected_branches() {
    if [[ $# -gt 0 ]]; then
        printf '%s\n' "$@"
        return
    fi

    git -C "${REPO_ROOT}" for-each-ref --format='%(refname:short)' refs/heads |
        while IFS= read -r branch; do
            if [[ "${branch}" == ${BRANCH_PATTERN} ]]; then
                printf '%s\n' "${branch}"
            fi
        done
}

stop_all() {
    if [[ ! -d "${PID_DIR}" ]]; then
        echo "No preview server PID directory found."
        return
    fi

    local stopped=0
    local pid_file pid
    for pid_file in "${PID_DIR}"/*.pid; do
        [[ -e "${pid_file}" ]] || continue
        pid="$(cat "${pid_file}")"
        if stop_pid "${pid}"; then
            stopped=$((stopped + 1))
        fi
        rm -f "${pid_file}"
    done

    if [[ -f "${MANIFEST}" ]]; then
        local branch port manifest_pid url log_file run_dir listener_pid
        while IFS=$'\t' read -r branch port manifest_pid url log_file run_dir; do
            listener_pid="$(listener_pid_for_port "${port}" || true)"
            if stop_pid "${listener_pid}"; then
                stopped=$((stopped + 1))
            fi
        done < <(tail -n +2 "${MANIFEST}")
    fi

    echo "Stopped ${stopped} preview server(s)."
}

remove_temp_worktrees() {
    if [[ ! -d "${WORKTREE_ROOT}" ]]; then
        return
    fi

    local worktree_dir
    for worktree_dir in "${WORKTREE_ROOT}"/*; do
        [[ -e "${worktree_dir}" ]] || continue
        if ! is_under_tmp_root "${worktree_dir}"; then
            echo "Refusing to remove non-temp worktree path: ${worktree_dir}" >&2
            exit 1
        fi
        git -C "${REPO_ROOT}" worktree remove --force "${worktree_dir}" >/dev/null 2>&1 || rm -rf "${worktree_dir}"
    done
    git -C "${REPO_ROOT}" worktree prune >/dev/null 2>&1 || true
}

status() {
    if [[ ! -f "${MANIFEST}" ]]; then
        echo "No active preview manifest at ${MANIFEST}"
        return
    fi

    {
        printf 'branch\tport\tpid\tstate\turl\tlog\trun_dir\n'
        tail -n +2 "${MANIFEST}" |
            while IFS=$'\t' read -r branch port pid url log_file run_dir; do
                local state="stopped"
                local listener_pid
                listener_pid="$(listener_pid_for_port "${port}" || true)"
                if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
                    state="running"
                elif [[ -n "${listener_pid}" ]] && kill -0 "${listener_pid}" >/dev/null 2>&1; then
                    pid="${listener_pid}"
                    state="running"
                fi
                printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
                    "${branch}" "${port}" "${pid}" "${state}" "${url}" "${log_file}" "${run_dir}"
            done
    } | column -t -s $'\t' 2>/dev/null || cat "${MANIFEST}"
}

list_branches() {
    selected_branches "$@" | nl -w1 -s'. '
}

prepare_worktree() {
    local branch="$1"
    local current="$2"
    local safe="$3"
    local worktree_dir="${WORKTREE_ROOT}/${safe}"

    if [[ "${branch}" == "${current}" ]]; then
        printf '%s\n' "${REPO_ROOT}"
        return
    fi

    if [[ -e "${worktree_dir}" ]]; then
        if ! is_under_tmp_root "${worktree_dir}"; then
            echo "Refusing to remove non-temp worktree path: ${worktree_dir}" >&2
            exit 1
        fi
        git -C "${REPO_ROOT}" worktree remove --force "${worktree_dir}" >/dev/null 2>&1 || rm -rf "${worktree_dir}"
    fi

    git -C "${REPO_ROOT}" worktree add --detach "${worktree_dir}" "${branch}" >/dev/null
    printf '%s\n' "${worktree_dir}"
}

sync_frontend_tree() {
    local branch_source="$1"
    local run_dir="$2"
    local upstream_frontend="${REPO_ROOT}/upstream/glm-ocr/apps/frontend"
    local overlay_frontend="${branch_source}/deploy/overlays/frontend"

    if [[ ! -f "${upstream_frontend}/package.json" ]]; then
        echo "Missing upstream frontend source: ${upstream_frontend}" >&2
        exit 1
    fi
    if [[ ! -d "${overlay_frontend}/src" ]]; then
        echo "Missing overlay frontend source for branch: ${overlay_frontend}" >&2
        exit 1
    fi

    if [[ -e "${run_dir}" ]]; then
        if ! is_under_tmp_root "${run_dir}"; then
            echo "Refusing to remove non-temp run path: ${run_dir}" >&2
            exit 1
        fi
        rm -rf "${run_dir}"
    fi
    mkdir -p "${run_dir}"

    cp -a "${upstream_frontend}/." "${run_dir}/"
    cp -a "${overlay_frontend}/." "${run_dir}/"
}

write_pnpm_build_policy() {
    local run_dir="$1"
    local workspace_file="${run_dir}/pnpm-workspace.yaml"

    if [[ -f "${workspace_file}" ]]; then
        if ! grep -Eq '^[[:space:]]*-[[:space:]]*"?esbuild"?.*$' "${workspace_file}"; then
            echo "Warning: ${workspace_file} exists but does not list esbuild in onlyBuiltDependencies." >&2
            echo "pnpm 10 may require running pnpm approve-builds in ${run_dir}." >&2
        fi
        return
    fi

    cat >"${workspace_file}" <<'EOF'
packages:
  - .

# pnpm 10+ blocks dependency build scripts unless they are explicitly approved.
# Vite needs esbuild's install script/native binary setup during local previews.
onlyBuiltDependencies:
  - esbuild
EOF
}

install_deps() {
    local run_dir="$1"

    if [[ -n "${PNPM_INSTALL_FLAGS:-}" ]]; then
        # Intentional word splitting lets callers pass several pnpm flags.
        # shellcheck disable=SC2086
        pnpm --dir "${run_dir}" install ${PNPM_INSTALL_FLAGS}
        return
    fi

    if ! pnpm --dir "${run_dir}" install --frozen-lockfile --offline; then
        echo "Offline pnpm install failed for ${run_dir}; retrying with network-enabled frozen install." >&2
        pnpm --dir "${run_dir}" install --frozen-lockfile
    fi
}

start_server() {
    local branch="$1"
    local run_dir="$2"
    local port="$3"
    local safe="$4"
    local log_file="${LOG_ROOT}/${safe}.log"
    local pid_file="${PID_DIR}/${safe}.pid"
    local cmd=()

    if [[ "${UI_PREVIEW_MODE}" == "preview" ]]; then
        pnpm --dir "${run_dir}" build
        cmd=(pnpm exec vite preview --host "${HOST}" --port "${port}" --strictPort)
    else
        cmd=(pnpm exec vite --host "${HOST}" --port "${port}" --strictPort)
    fi

    rm -f "${pid_file}"
    if command -v setsid >/dev/null 2>&1; then
        (
            exec setsid bash -c '
                pid_file="$1"
                run_dir="$2"
                shift 2
                echo "$$" >"${pid_file}"
                cd "${run_dir}"
                exec nohup "$@"
            ' preview-ui "${pid_file}" "${run_dir}" "${cmd[@]}"
        ) >"${log_file}" 2>&1 &
    else
        (
            echo "${BASHPID}" >"${pid_file}"
            cd "${run_dir}"
            exec nohup "${cmd[@]}"
        ) >"${log_file}" 2>&1 &
    fi

    local launcher_pid=$!
    for _ in $(seq 1 50); do
        [[ -s "${pid_file}" ]] && break
        sleep 0.1
    done

    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -z "${pid}" ]]; then
        pid="${launcher_pid}"
        echo "${pid}" >"${pid_file}"
    fi

    local ready=0
    for _ in $(seq 1 30); do
        if ! kill -0 "${pid}" >/dev/null 2>&1; then
            break
        fi
        if ! port_is_free "${port}"; then
            ready=1
            break
        fi
        sleep 1
    done

    if [[ "${ready}" -ne 1 ]]; then
        echo "Failed to start ${branch} on ${HOST}:${port}; see ${log_file}" >&2
        tail -n 80 "${log_file}" >&2 || true
        return 1
    fi

    printf '%s\t%s\t%s\thttp://%s:%s/\t%s\t%s\n' \
        "${branch}" "${port}" "${pid}" "${HOST}" "${port}" "${log_file}" "${run_dir}" >>"${MANIFEST}"
}

start_all() {
    need_cmd git
    need_cmd pnpm
    need_cmd cp
    need_cmd sed

    mkdir -p "${WORKTREE_ROOT}" "${RUN_ROOT}" "${LOG_ROOT}" "${PID_DIR}"

    local branches=()
    mapfile -t branches < <(selected_branches "$@")
    if [[ "${#branches[@]}" -eq 0 ]]; then
        echo "No local branches matched ${BRANCH_PATTERN}" >&2
        exit 1
    fi

    stop_all >/dev/null 2>&1 || true
    printf 'branch\tport\tpid\turl\tlog\trun_dir\n' >"${MANIFEST}"

    local current
    current="$(current_branch)"

    local next_port="${START_PORT}"
    local branch safe source_dir run_dir port
    for branch in "${branches[@]}"; do
        safe="$(safe_name "${branch}")"
        source_dir="$(prepare_worktree "${branch}" "${current}" "${safe}")"
        run_dir="${RUN_ROOT}/${safe}"
        port="$(next_free_port "${next_port}")"
        next_port=$((port + 1))

        echo "Preparing ${branch} -> ${run_dir}"
        sync_frontend_tree "${source_dir}" "${run_dir}"
        write_pnpm_build_policy "${run_dir}"
        install_deps "${run_dir}"
        start_server "${branch}" "${run_dir}" "${port}" "${safe}"
    done

    echo
    echo "UI previews:"
    status
    echo
    echo "Stop with: scripts/preview-ui-branches.sh stop"
}

clean_all() {
    stop_all || true
    remove_temp_worktrees
    if [[ -e "${TMP_ROOT}" ]]; then
        if ! is_under_tmp_root "${TMP_ROOT}"; then
            echo "Refusing to remove non-temp path: ${TMP_ROOT}" >&2
            exit 1
        fi
        rm -rf "${TMP_ROOT}"
    fi
    echo "Removed ${TMP_ROOT}"
}

case "${ACTION}" in
    start|up)
        start_all "$@"
        ;;
    stop|down)
        stop_all
        ;;
    status|ps)
        status
        ;;
    clean)
        clean_all
        ;;
    list)
        list_branches "$@"
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        usage >&2
        exit 1
        ;;
esac
