# Real sandbox execution (implementation slice, 2026-11-06)

This describes actual execution, not simulated fixtures. The HTTP endpoint
`POST /api/cluster/ticket/test` now invokes `sandbox/execute_ticket.py`,
which applies a ticket's persisted diff to a clean Git HEAD snapshot and runs
a **server-configured** test command inside `sandbox/run_sandbox.sh` (Docker).

## Requirements and configuration

- A separate, trusted local Git checkout of the target project, with at least one commit.
- Python 3.11+ and Git installed on the SUTRADHAR host.
- Docker daemon, and permission to build/run `sutradhar-runner:5.3`.
- A test command appropriate for the target repository. The shipped Docker image is
  Python 3.11 + pytest, so PHP/Node builds need a separately reviewed image.
- A securely authenticated SUTRADHAR administrator or correctly authenticated worker
  holding an active ticket lease.
- Environment configuration (in server process; **not** in browser or ticket):

```bash
export SUTRADHAR_TARGET_REPO_ROOT="/absolute/path/to/trusted/target-repo"
export SUTRADHAR_SANDBOX_TEST_COMMAND="python3 -m pytest -q"
# Optional Python interpreter:
export SUTRADHAR_PYTHON=python3
```

No HTTP request may override the target Git root, test command, Docker image,
status, or failure result. `isDemoMode`, `simulateFailure` and
`x-sutradhar-demo-mode` are intentionally ignored in the production API.

## Exact workflow

1. Check auth and worker lease; refuse requests while kill-switch is active.
2. Require the ticket to have a nonempty diff and to be in `TESTING_SANDBOX` /
   `HEALING_RETRY`. Refuse a duplicate concurrent run in the same server process.
3. Obtain the target repository's actual `HEAD` SHA.
4. Run `git archive HEAD` to create an ephemeral snapshot (no live dirty worktree).
5. Reject unsafe paths, archive symlinks/hardlinks, and oversize archives.
   Omit committed `.env*`, `secrets`, `.sutradhar_state`, private-key files
   and other common runtime credential directories from the candidate snapshot.
6. Initialize a disposable Git index; apply the generated patch with
   `git apply --check`, then `git apply`. Compare the **actual staged diff**
   against the ticket's exact allowed-file whitelist. Reject unauthorized
   creates/deletes, type changes and renames.
7. Execute Docker via `run_sandbox.sh`, which creates a second disposable
   workspace, isolates network, restricts resources, drops capabilities, uses
   a non-root user and read-only root filesystem, and enforces timeouts.
8. Accept a passing exit code only if a trusted start marker was emitted from
   **inside the container**.
9. Persist actual exit code, stdout/stderr, duration, and pass/fail in
   `execution_attempts`; append baseline SHA, patch SHA-256, changed files
   and outcome in the audit log.
10. Recheck epoch, worker lease, kill-switch and patch identity before accepting
    the result. A passing test becomes `READY_FOR_REVIEW`, **not** `COMMITTED_PUSHED`.

## Outcomes

| Runner result | HTTP result | Ticket effect |
|---|---|---|
| `TEST_PASSED` with real Docker exit 0 | 200 | `READY_FOR_REVIEW` |
| `TEST_FAILED` with real nonzero exit | 200 | `HEALING_RETRY` or `DEAD_LETTER_QUEUE` |
| `PATCH_REJECTED` | 422 | No passing test evidence |
| Docker absent / not accessible | 503 | No passing test evidence |
| Target root/test command absent | 503 | No test attempted |
| Runner preparation/internal failure | 502 | No passing test evidence |
| Patch, lease, epoch or pause changed while running | 409 | Discard result as stale |
| Wrong or missing ticket | 400/404 | No execution |
| Duplicate test or invalid ticket state | 409 | No execution |

`success:true` means a real test process was run and returned a result; the
separate `status` and `exitCode` distinguish pass and fail.

## Reproduce integration checks

```bash
npm install
npm test                         # security and SQLite fixtures
python3 -m unittest discover -s tests -p 'test_sandbox_execution.py' -v
SUTRADHAR_REAL_DOCKER_E2E=1 python3 -m unittest discover -s tests -p 'test_sandbox_execution.py' -v
npm run test:sandbox-http         # actual Express -> Git -> Docker -> SQLite tests
npm run lint
npm run build
```

CI has separate actual Docker regression steps. Passing a fixture-only test
does not prove that a Git PR was merged or that the target project was deployed.

## Remaining security/release work

- No remote Git push/PR merge evidence, no real rollback Git revert yet.
- The worker Git pipeline and sandbox executor are not yet one complete
  automatic scheduler; the HTTP endpoint invokes tests for stored diffs.
- Execution attempts are in SQLite; durable cryptographic provenance binding
  `patchSha256` to an immutable remote commit and exact lease remains pending.
- Multi-process duplicate-test locking needs a DB-level claim, not only a JS Set.
- Git snapshot export excludes uncommitted edits by design; tests see committed
  `HEAD`, not a mutable live worktree.
- Image is Python-only; other languages need reviewed, pinned, nonprivileged
  images with no network or host fallback.
- Run the Docker daemon on an isolated worker host; restrict Docker socket
  access, test dependencies and artifact collection. A malicious container
  image or Docker daemon is outside this runner's trust boundary.
- Historical leaked master signer must be rotated and older tokens invalidated.

See [Implementation Tracker](./IMPLEMENTATION_TRACKER.md) and
[Implementation Log](./IMPLEMENTATION_LOG_2026-11-06.md).
