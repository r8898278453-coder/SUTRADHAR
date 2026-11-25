# Developer AST hints — V7 alpha

## Purpose

Supplement the Master task planner's bounded lexical hints with a read-only syntax-tree inspection of explicitly selected source files at a local immutable Git commit. The developer diagnostic remains available. Desktop now uses the same syntax parser for its bounded source-hint preview (alpha source; CI and physical acceptance pending). Neither path grants admission or worker authority.

## Run locally

From a trusted SUTRADHAR source checkout with the committed dependencies installed using `npm ci`, use:

```sh
npm run ops:master-ast-hints -- /absolute/path/to/target-repository 0123456789012345678901234567890123456789 src/a.ts src/b.ts
```

Replace the example commit with a real exact 40-character local commit SHA and paths with 1–12 exact repository-relative JS/TS-family paths. On Windows use the absolute target repository path in quotes if it contains spaces. No fetch or checkout occurs. The target checkout, Git executable and locally installed parser must be trusted. Do not pass provider credentials or sensitive paths. Run in a developer source checkout, not a packaged Desktop installer.

## Interpretation

The output identifies the commit and tree, source-path status and counts, and at most 40 resolved relative-reference edges. Source text and unresolved module-specifier strings are not emitted; paths themselves can be sensitive, so review output before sharing. File statuses include PARSED, MISSING, SIZE_LIMIT, ENCODING_ERROR, PARSE_ERROR and REFERENCE_LIMIT. A failed Git read, invalid request or unsafe inventory refuses the whole command. A missing, ambiguous or unsupported reference is not independence evidence. An edge limit is explicit; multiple distinct specifiers may refer to the same target. No full dependency inventory is claimed.

Parser handles import/export declarations, import types, import-equals, literal dynamic import and syntactic require calls; comments and string decoys are not treated as imports. The latter require calls can be shadowed, and syntactic evidence does not establish runtime behavior. Relative extension/index and selected JS-to-TS suffix substitution are conservative candidates, not TypeScript's actual project-aware resolver. No tsconfig paths, package exports, build plugins, generated code, runtime resolution, type checker, contract extraction or cross-language analysis. The bounded inventory excludes unsafe/nonregular entries; it does not establish a complete filesystem security audit. The explicit commit need not be the current remote baseline. No source execution, external request, provider token measurement, Git write, task creation or scheduling is performed.

Limits: 12 selected files, 16 KiB per blob, 1 MiB tree listing, 128 reference occurrences per parsed file, 40 output edges. Parse failures do not return partial references. Separate review must determine task scope, remote freshness, integration ordering, contract dependencies and secret exposure.

## Verification

```sh
node --test tests/master_ast_hints.test.cjs
npm run test:v7
```

161 independently named regression scenarios are registered (not feature count). Source commits: `4e08d02`, `261e10b`, `27426f2`, `537f10c`. The original CLI suite passed on the earlier exact HEAD 574f2f4171c2d75aee8b55983ab2a43a2330995e. The new shared-parser and Desktop integration require fresh exact-head CI. No live deployment or release-gate acceptance. G0–G7 HOLD.


## Desktop integration — 25 November 2026

On an approved, enrolled packaged Windows PC with an acknowledged heartbeat, no maintenance hold or unresolved admission journal, select the current Master and exact project. Inspect the trusted local Git checkout, prepare a valid 2–10-task draft (including a group imported through the bulk review workflow), and choose **Inspect local AST import hints (no AI or network Git)**. The main process validates the declared task graph before parsing, rechecks the signed project and current Master epoch, reads only the observed immutable tree and rechecks the local tracking ref after inspection. Remote freshness is not verified. No source file is executed, no working-tree file is consulted, no provider request or Git fetch/push is made. Only selected paths and counts, syntactic import hints and review questions are returned; paths and ticket identifiers can still be sensitive.

Desktop sampling is round-robin across the scoped tasks, at most 12 files, 16 KiB per blob, 1 MiB tree listing, 128 syntactic reference occurrences per file and 40 cross-task/shared hints. The output identifies AST_SYNTAX mode, per-file status, resolved/ambiguous/missing/unsupported counts, skipped coverage, unknown reference count and incomplete parse indicator. Size, encoding, parse errors, parser refusal and reference-limit results never return partial references for that file. A missing parser in the packaged app blocks AST review rather than falling back silently. The legacy lexical helper remains available to source callers and existing regression tests, explicitly marked LEXICAL_LEGACY; it is not the new Desktop UI path.

The comparison with the declared DAG marks cross-task references DECLARED_ORDER_PRESENT (including transitive order), REVERSE_DECLARED_ORDER_REVIEW or NO_DECLARED_ORDER_REVIEW. Shared targets are SHARED_DEPENDENCY_REVIEW. These are review questions, not required execution edges; an import from an already-existing baseline file does not prove future code dependence. No edges are created, no task is admitted, no automatic dispatch or semantic/type verification. A zero-question report never establishes independence. Full project-aware module/type resolution, actual decomposition, live upstream Git proof, worker capacity, integration QA and release acceptance remain open.

Build and packaging: use the existing root-lockfile TypeScript version (currently 5.9.3); no new npm dependency. Desktop build stages the parser runtime as master-typescript.cjs plus the upstream LICENSE.txt and ThirdPartyNoticeText.txt under fixed resource names. Build manifest records exact version and all three SHA-256 hashes. Closed build inventories, ASAR allowlist, actual packaged-resource byte comparisons, post-build checks and protected signing preflight include these resources. Package-time byte checks do not establish runtime tamper resistance, a signed installer or physical acceptance. The full TypeScript library increases package size and its use requires independent Windows verification. The application loads only the fixed installed resource, never a parser supplied by a target checkout or renderer. The installed resource and OS must be trusted.

Tests: 49 named cases in tests/desktop_master_ast_review.test.cjs and three additional packaged-resource tests in tests/desktop_packaged_runtime.test.cjs; existing 161 developer AST cases remain. Includes real disposable Git fixtures, dirty worktree, syntax decoys, missing/ambiguous references, DAG order review, scope rejection, parser bounds, and absent/altered packaged resources. New source CODED / EXACT-HEAD CI PENDING. No local Windows install, live deployment or release gate promotion. G0–G7 HOLD. Tests are not completed feature-task counts.
