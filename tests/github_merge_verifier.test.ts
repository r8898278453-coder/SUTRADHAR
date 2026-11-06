import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyGitHubMergeEvidence, type GitHubFetcher } from '../github_merge_verifier.ts';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const MERGED = 'd'.repeat(40);

type Fixture = {
  merged?: boolean;
  tree?: string;
  mergedTree?: string;
  parent?: string;
  filenames?: string[];
  checkSuccess?: boolean;
  approve?: boolean;
  onMain?: boolean;
  commits?: number;
};

function input(overrides: Fixture = {}) {
  const opts: Required<Fixture> = {
    merged: true, tree: TREE, mergedTree: TREE, parent: BASE,
    filenames: ['src/safe.ts'], checkSuccess: true,
    approve: true, onMain: true, commits: 1, ...overrides
  };
  const fetcher: GitHubFetcher = async (url: string) => {
    const pathname = new URL(url).pathname;
    const response = (json: unknown) => new Response(JSON.stringify(json), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
    const pr = {
      number: 12,
      commits: opts.commits,
      changed_files: opts.filenames.length,
      draft: false,
      merged_at: opts.merged ? '2026-11-06T17:00:00Z' : null,
      merge_commit_sha: opts.merged ? MERGED : null,
      user: { login: 'author' },
      head: { ref: 'ai/TKT-SEC-01', sha: HEAD, repo: { full_name: 'acme/widgets' } },
      base: { ref: 'main', repo: { full_name: 'acme/widgets' } }
    };
    if (pathname.endsWith('/pulls')) return response([pr]);
    if (pathname.endsWith('/git/commits/' + HEAD))
      return response({ sha: HEAD, parents: [{ sha: opts.parent }], tree: { sha: opts.tree } });
    if (pathname.endsWith('/git/commits/' + MERGED))
      return response({ sha: MERGED, parents: [{ sha: HEAD }], tree: { sha: opts.mergedTree } });
    if (pathname.endsWith('/pulls/12/files'))
      return response(opts.filenames.map(filename => ({ filename, status: 'modified' })));
    if (pathname.endsWith('/commits/' + HEAD + '/check-runs'))
      return response({ total_count: 1, check_runs: [{
        name: 'CI / tests', head_sha: HEAD, app: { slug: 'github-actions' },
        status: 'completed', conclusion: opts.checkSuccess ? 'success' : 'failure'
      }] });
    if (pathname.endsWith('/pulls/12/reviews'))
      return response([{ user: { login: 'reviewer' },
        state: opts.approve ? 'APPROVED' : 'COMMENTED',
        submitted_at: '2026-11-06T16:00:00Z' }]);
    if (pathname.endsWith('/compare/' + MERGED + '...main'))
      return response({ status: opts.onMain ? 'ahead' : 'diverged', base_commit: { sha: MERGED } });
    throw new Error('Unexpected GitHub REST route: ' + pathname);
  };
  return {
    repo: 'acme/widgets', token: 'fixture-readonly-token', branch: 'ai/TKT-SEC-01',
    allowedFiles: ['src/safe.ts'], baselineCommit: BASE, candidateTreeSha: TREE,
    requiredChecks: ['CI / tests'], requiredApprovals: 1,
    fetcher
  };
}

test('verified merged PR must match exact tested tree, CI, approval and main ancestry', async () => {
  const result = await verifyGitHubMergeEvidence(input());
  assert.equal(result.verified, true, JSON.stringify(result));
  if (!result.verified) return;
  assert.equal(result.prNumber, 12);
  assert.equal(result.mergeSha, MERGED);
  assert.equal(result.treeSha, TREE);
});

for (const [name, options, reason] of [
  ['unmerged PR', { merged: false }, 'GITHUB_MERGED_PR_NOT_UNAMBIGUOUS'],
  ['modified head tree', { tree: 'e'.repeat(40) }, 'GITHUB_TESTED_TREE_MISMATCH'],
  ['modified merge tree', { mergedTree: 'e'.repeat(40) }, 'GITHUB_TESTED_TREE_MISMATCH'],
  ['wrong parent commit', { parent: 'e'.repeat(40) }, 'GITHUB_TESTED_TREE_MISMATCH'],
  ['extra unapproved PR file', { filenames: ['src/safe.ts', 'src/other.ts'] }, 'GITHUB_PR_FILE_SCOPE_MISMATCH'],
  ['failed required check', { checkSuccess: false }, 'GITHUB_REQUIRED_CHECKS_MISSING'],
  ['no independent approval', { approve: false }, 'GITHUB_APPROVAL_NOT_VERIFIED'],
  ['merge absent on main', { onMain: false }, 'GITHUB_MERGE_NOT_ON_MAIN'],
  ['multiple head commits', { commits: 2 }, 'GITHUB_MERGED_PR_NOT_UNAMBIGUOUS']
] as const) {
  test(name + ' is denied', async () => {
    const result = await verifyGitHubMergeEvidence(input(options));
    assert.deepEqual(result, { verified: false, error: reason });
  });
}

test('required check configuration cannot be empty', async () => {
  const result = await verifyGitHubMergeEvidence({ ...input(), requiredChecks: [] });
  assert.deepEqual(result, { verified: false, error: 'GITHUB_VERIFICATION_NOT_CONFIGURED' });
});

test('GitHub outage must not create a verified result', async () => {
  const result = await verifyGitHubMergeEvidence({
    ...input(), fetcher: async () => { throw new Error('transport unavailable'); }
  });
  assert.deepEqual(result, { verified: false, error: 'GITHUB_API_UNAVAILABLE' });
});
