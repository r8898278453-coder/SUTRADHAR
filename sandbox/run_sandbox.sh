#!/usr/bin/env bash
# ==============================================================================
# SUTRADHAR CLUSTER - SANDBOX HARDENING & TIMEOUT WRAPPER (v5.3)
# Strictly limits CPU, memory, PIDs, time, and drops all network access.
# ==============================================================================
set -euo pipefail

WORKSPACE_PATH="${1:-}"
TEST_CMD="${2:-pytest tests/}"

if [[ -z "${WORKSPACE_PATH}" ]] || [[ ! -d "${WORKSPACE_PATH}" ]]; then
    echo "[ERROR][SANDBOX] Invalid workspace path provided: '${WORKSPACE_PATH}'" >&2
    exit 1
fi

ABS_WORKSPACE="$(cd "${WORKSPACE_PATH}" && pwd)"

if [[ -d "${ABS_WORKSPACE}/secrets" ]]; then
    echo "[FATAL][SANDBOX] Secrets directory found inside target workspace. Refusing mount." >&2
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "[FATAL][SANDBOX] SANDBOX_UNAVAILABLE: Docker daemon is not installed or running. Untrusted host execution is strictly prohibited." >&2
    exit 126
fi

if ! docker info >/dev/null 2>&1; then
    echo "[FATAL][SANDBOX] SANDBOX_UNAVAILABLE: Docker daemon is not accessible. Untrusted host execution is strictly prohibited." >&2
    exit 126
fi

IMAGE_TAG="sutradhar-runner:5.3"

if ! docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
    echo "[INFO][SANDBOX] Building hardened runner image ${IMAGE_TAG}..." >&2
    docker build -t "${IMAGE_TAG}" -f "sandbox/Dockerfile.runner" sandbox/
fi

CONTAINER_NAME="sutradhar_sb_$(date +%s%N | cut -b1-12)"

# Copy candidate files to a disposable workspace. Never expose the authoritative
# repository read-write to a process executing model-generated code.
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sutradhar-sandbox.XXXXXXXX")"
cleanup() { rm -rf -- "${STAGING_DIR}"; }
trap cleanup EXIT

# tar preserves symlinks rather than following them; exclude Git metadata and
# common credential/state paths from the disposable runner workspace.
tar -C "${ABS_WORKSPACE}" \
    --exclude='./.git' \
    --exclude='./.sutradhar_state' \
    --exclude='*/.sutradhar_state/*' \
    --exclude='./secrets' \
    --exclude='*/secrets/*' \
    --exclude='*.pem' --exclude='*.key' --exclude='*.pub' \
    --exclude='.env' --exclude='.env.*' --exclude='*/.env' --exclude='*/.env.*' \
    --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' \
    -cf - . | tar -C "${STAGING_DIR}" -xf -

# Preserve private staging-directory permissions. Match host UID if non-root;
# if the launcher runs as root, delegate only the disposable copy to UID 10001.
if [[ "$(id -u)" -eq 0 ]]; then
    chown -R 10001:10001 "${STAGING_DIR}"
    CONTAINER_USER="10001:10001"
else
    chmod -R u+rwX "${STAGING_DIR}"
    CONTAINER_USER="$(id -u):$(id -g)"
fi

set +e
timeout --signal=SIGKILL 45s docker run \
    --name "${CONTAINER_NAME}" \
    --rm \
    --network="none" \
    --memory="512m" \
    --memory-swap="512m" \
    --cpus="1.0" \
    --pids-limit=100 \
    --stop-timeout=3 \
    --user "${CONTAINER_USER}" \
    --security-opt="no-new-privileges:true" \
    --cap-drop=ALL \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -v "${STAGING_DIR}:/workspace:rw" \
    -w /workspace \
    "${IMAGE_TAG}" \
    "printf '__SUTRADHAR_CONTAINER_TEST_STARTED__\\n'; timeout 40s ${TEST_CMD}"
status=$?
set -e
exit "${status}"
