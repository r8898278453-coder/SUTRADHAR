import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifiedDraftPr, type DraftPrFetcher } from '../github_pr_creator.ts';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const BRANCH = 'worker-a1/ticket-104';
type Options = {
  mainMoved?: boolean;
  branchAbsent?: boolean;
  wrongTree?: boolean;
  extraFile?: boolean;
  extraCommit?: boolean;
  existing?: boolean;
  closedPr?: boolean;
  changedOnPost?: boolean;
  baseChangedOnPost?: boolean;
  networkFailure?: boolean;
};

function fixture(options: Options = {}) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const fetcher: DraftPrFetcher = async (url, init) => {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: pathname, body });
    if (options.networkFailure) throw new Error('mock transport down');
    const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (pathname.endsWith('/branches/main')) {
      return ok({ commit: { sha: options.mainMoved ? 'f'.repeat(40) : BASE } });
    }
    if (pathname.endsWith('/branches/worker-a1/ticket-104')) {
      return options.branchAbsent
        ? new Response('{}', { status: 404 })
        : ok({ commit: { sha: HEAD } });
    }
    if (pathname.endsWith('/git/commits/' + HEAD)) {
      return ok({ sha: HEAD, tree: { sha: options.wrongTree ? 'e'.repeat(40) : TREE },
        parents: [{ sha: BASE }] });
    }
    if (pathname.endsWith('/compare/' + BASE + '...' + HEAD)) {
      const files = [{ filename: 'src/safe.ts', status: 'modified' }];
      if (options.extraFile) files.push({ filename: 'src/other.ts', status: 'modified' });
      return ok({ status: 'ahead', ahead_by: options.extraCommit ? 2 : 1,
        behind_by: 0, total_commits: options.extraCommit ? 2 : 1, files });
    }
    if (pathname.endsWith('/pulls') && method === 'GET') {
      return ok(options.existing ? [{
        number: 42, html_url: 'https://github.com/acme/widgets/pull/42',
        state: options.closedPr ? 'closed' : 'open', draft: true,
        head: { ref: BRANCH, sha: HEAD, repo: { full_name: 'acme/widgets' } },
        base: { ref: 'main', sha: BASE, repo: { full_name: 'acme/widgets' } }
      }] : []);
    }
    if (pathname.endsWith('/pulls') && method === 'POST') {
      return ok({
        number: 43, html_url: 'https://github.com/acme/widgets/pull/43',
        state: 'open', draft: body?.draft,
        head: { ref: BRANCH, sha: options.changedOnPost ? 'e'.repeat(40) : HEAD,
          repo: { full_name: 'acme/widgets' } },
        base: { ref: 'main', sha: options.baseChangedOnPost ? 'f'.repeat(40) : BASE,
          repo: { full_name: 'acme/widgets' } }
      });
    }
    throw new Error('Unexpected mock route: ' + pathname);
  };
  const input = {
    repo: 'acme/widgets', token: 'mock-only-pr-token', branch: BRANCH,
    ticketId: 'TKT-104', baselineCommit: BASE, candidateTreeSha: TREE,
    changedFiles: ['src/safe.ts'], allowedFiles: ['src/safe.ts'],
    title: 'TKT-104: reviewed patch', description: 'Human review is mandatory',
    fetcher
  };
  return { calls, input };
}

test('creates a draft PR only for the exact tested existing branch', async () => {
  const { calls, input } = fixture();
  const result = await createVerifiedDraftPr(input);
  assert.equal(result.created, true, JSON.stringify(result));
  if (!result.created) return;
  assert.equal(result.prNumber, 43);
  assert.equal(result.existing, false);
  assert.equal(result.headSha, HEAD);
  const writes = calls.filter(x => x.method === 'POST');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].path.endsWith('/pulls'));
  assert.equal(writes[0].body?.draft, true);
  assert.equal(writes[0].body?.base, 'main');
  assert.equal(writes[0].body?.head, BRANCH);
  assert.ok(!calls.some(x => /merge|\/git\/refs/.test(x.path)));
});

test('identical existing draft PR is returned without another write', async () => {
  const { calls, input } = fixture({ existing: true });
  const result = await createVerifiedDraftPr(input);
  assert.equal(result.created, true);
  if (result.created) assert.equal(result.existing, true);
  assert.equal(calls.filter(x => x.method === 'POST').length, 0);
});

for (const [name, opts, expected] of [
  ['main moved', { mainMoved: true }, 'DRAFT_PR_MAIN_MOVED_RETEST_REQUIRED'],
  ['branch not pushed', { branchAbsent: true }, 'DRAFT_PR_GITHUB_API_UNAVAILABLE'],
  ['wrong tree', { wrongTree: true }, 'DRAFT_PR_TESTED_COMMIT_MISMATCH'],
  ['unauthorized file', { extraFile: true }, 'DRAFT_PR_TESTED_COMMIT_MISMATCH'],
  ['extra commit', { extraCommit: true }, 'DRAFT_PR_TESTED_COMMIT_MISMATCH'],
  ['closed PR already uses branch', { existing: true, closedPr: true }, 'DRAFT_PR_BRANCH_ALREADY_USED'],
  ['branch changed before PR creation', { changedOnPost: true }, 'DRAFT_PR_RESPONSE_HEAD_CHANGED_MANUAL_REVIEW'],
  ['base moved during PR creation', { baseChangedOnPost: true }, 'DRAFT_PR_RESPONSE_HEAD_CHANGED_MANUAL_REVIEW'],
  ['GitHub unavailable', { networkFailure: true }, 'DRAFT_PR_GITHUB_API_UNAVAILABLE']
] as const) {
  test('fail closed: ' + name, async () => {
    const { input, calls } = fixture(opts);
    const result = await createVerifiedDraftPr(input);
    assert.deepEqual(result, { created: false, error: expected });
    if (expected !== 'DRAFT_PR_RESPONSE_HEAD_CHANGED_MANUAL_REVIEW') {
      assert.equal(calls.filter(x => x.method === 'POST').length, 0);
    }
  });
}

test('out-of-scope input never contacts GitHub', async () => {
  const { input, calls } = fixture();
  const result = await createVerifiedDraftPr({ ...input, changedFiles: ['src/secret.ts'] });
  assert.deepEqual(result, { created: false, error: 'DRAFT_PR_CONFIGURATION_INVALID' });
  assert.equal(calls.length, 0);
});
