# Developer AST hints — V7 alpha

## Purpose

Supplement the Master task planner's bounded lexical hints with a read-only syntax-tree inspection of explicitly selected source files at a local immutable Git commit. It is a developer diagnostic; it does not replace the existing Desktop preview or grant admission or worker authority.

## Run locally

From a trusted SUTRADHAR source checkout with the committed dependencies installed using `npm ci`, use:

```sh
npm run ops:master-ast-hints -- /absolute/path/to/target-repository 0123456789012345678901234567890123456789 src/a.ts src/b.ts
````

Replace the example commit with a real exact 40-character local commit SHA and paths with 1–12 exact repository-relative JS/TS-family paths. On Windows use the absolute target repository path in quotes if it contains spaces. No fetch or checkout occurs. The target checkout, Git executable and locally installed parser must be trusted. Do not pass provider credentials or sensitive paths. Run in a developer source checkout, not a packaged Desktop installer.

## Interpretation

The output identifies the commit and tree, source-path status and counts, and at most 40 resolved relative-reference edges. Source text and unresolved module-specifier strings are not emitted; paths themselves can be sensitive, so review output before sharing. File statuses include PARSED, MISSING, SIZE_LIMIT, ENCODING_ERROR, PARSE_ERROR and REFERENCE_LIMIT. A failed Git read, invalid request or unsafe inventory refuses the whole command. A missing, ambiguous or unsupported reference is not independence evidence. An edge limit is explicit; multiple distinct specifiers may refer to the same target. No full dependency inventory is claimed.

Parser handles import/export declarations, import types, import-equals, literal dynamic import and syntactic require calls; comments and string decoys are not treated as imports. The latter require calls can be shadowed, and syntactic evidence does not establish runtime behavior. Relative extension/index and selected JS-to-TS suffix substitution are conservative candidates, not TypeScript's actual project-aware resolver. No tsconfig paths, package exports, build plugins, generated code, runtime resolution, type checker, contract extraction or cross-language analysis. The bounded inventory excludes unsafe/nonregular entries; it does not establish a complete filesystem security audit. The explicit commit need not be the current remote baseline. No source execution, external request, provider token measurement, Git write, task creation or scheduling is performed.

Limits: 12 selected files, 16 KiB per blob, 1 MiB tree listing, 128 reference occurrences per parsed file, 40 output edges. Parse failures do not return partial references. Separate review must determine task scope, remote freshness, integration ordering, contract dependencies and secret exposure.

## Verification

```sh
node --test tests/master_ast_hints.test.cjs
npm run test:v7
````

161 independently named regression scenarios are registered (not feature count). Source commits: `4e08d02`, `261e10b`, `27426f2`, `537f10c`. Status: CODED / EXACT-HEAD CI PENDING. No live deployment or release-gate acceptance. G0–G7 HOLD.
