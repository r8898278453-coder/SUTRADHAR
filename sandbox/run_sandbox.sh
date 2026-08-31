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

IMAGE_TAG="sutradhar-runner:5.3"

if ! docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
    echo "[INFO][SANDBOX] Building hardened runner image ${IMAGE_TAG}..." >&2
    docker build -t "${IMAGE_TAG}" -f "sandbox/Dockerfile.runner" sandbox/
fi

CONTAINER_NAME="sutradhar_sb_$(date +%s%N | cut -b1-12)"

# Test Isolation Guardrail: Check for canonical tests directory and ensure read-only protection
TEST_MOUNT_ARGS=""
if [[ -d "${ABS_WORKSPACE}/tests" ]]; then
    TEST_MOUNT_ARGS="-v ${ABS_WORKSPACE}/tests:/workspace/tests:ro"
fi

exec timeout --signal=SIGKILL 45s docker run \
    --name "${CONTAINER_NAME}" \
    --rm \
    --network="none" \
    --memory="512m" \
    --memory-swap="512m" \
    --cpus="1.0" \
    --pids-limit=100 \
    --stop-timeout=3 \
    --user 10001:10001 \
    --security-opt="no-new-privileges:true" \
    --cap-drop=ALL \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -v "${ABS_WORKSPACE}:/workspace:rw" \
    ${TEST_MOUNT_ARGS} \
    -w /workspace \
    "${IMAGE_TAG}" \
    "timeout 40s ${TEST_CMD}"
