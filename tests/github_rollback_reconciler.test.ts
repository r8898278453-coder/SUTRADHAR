import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectRollbackDraftPr, type RollbackRecoveryFetcher } from '../github_rollback_reconciler.ts';

const MERGED = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const BRANCH = 'rollback/TKT-TEST';
type Scenario = {
  mainMoved?: boolean; headChanged?: boolean; treeChanged?: boolean;
  extraFile?: boolean; missingPr?: boolean; ambiguous?: boolean;
  closed?: boolean; changedPrHead?: boolean; movedPrBase?: boolean;
  networkDown?: boolean; wrongRepo?: boolean;
};

function fixture(s: Scenario = {}, hasBranch = true) {
  const calls: string[] = [];
  const fetcher: RollbackRecoveryFetcher = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    assert.equal(init?.method, 'GET', 'Recovery must never send a write operation');
    calls.push(path);
    if (s.networkDown) throw new Error('github down');
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (path.endsWith('/branches/main'))
      return ok({ commit: { sha: s.mainMoved ? 'd'.repeat(40) : MERGED } });
    if (path.endsWith('/branches/' + BRANCH))
      return ok({ commit: { sha: s.headChanged ? 'd'.repeat(40) : HEAD } });
    if (path.endsWith('/git/commits/' + HEAD))
      return ok({ sha: HEAD, tree: { sha: s.treeChanged ? 'd'.repeat(40) : TREE },
        parents: [{ sha: MERGED }] });
    if (path.endsWith('/compare/' + MERGED + '...' + HEAD)) {
      const files = [{ filename: 'value.txt', status: 'modified' }];
      if (s.extraFile) files.push({ filename: 'password.txt', status: 'modified' });
      return ok({ status: 'ahead', ahead_by: 1, behind_by: 0,
        total_commits: 1, files });
    }
    if (path.endsWith('/pulls')) {
      if (s.missingPr) return ok([]);
      const pr = {
        number: 81, state: s.closed ? 'closed' : 'open', draft: true,
        html_url: 'https://github.com/acme/widgets/pull/81',
        head: { ref: BRANCH, sha: s.changedPrHead ? 'd'.repeat(40) : HEAD,
          repo: { full_name: s.wrongRepo ? 'attacker/widgets' : 'acme/widgets' } },
        base: { ref: 'main', sha: s.movedPrBase ? 'd'.repeat(40) : MERGED,
          repo: { full_name: 'acme/widgets' } }
      };
      return ok(s.ambiguous ? [pr, { ...pr, number: 82 }] : [pr]);
    }
    throw new Error('unexpected GitHub read path ' + path);
  };
  const input = {
    repo: 'acme/widgets', token: 'readonly-fixture',
    branch: BRANCH, originalMergeSha: MERGED,
    branchHeadSha: hasBranch ? HEAD : null,
    restoredTreeSha: hasBranch ? TREE : null,
    changedFiles: ['value.txt'], allowedFiles: ['value.txt'], fetcher
  };
  return { input, calls };
}

test('read-only exact draft PR recovery records only the original PR identity', async () => {
  const { input, calls } = fixture();
  const result = await inspectRollbackDraftPr(input);
  assert.deepEqual(result, { verified: true, state: 'DRAFT_PR', prNumber: 81,
    url: 'https://github.com/acme/widgets/pull/81' });
  assert.ok(calls.some(x => x.endsWith('/pulls')));
});

test('remote rollback branch without a PR is reported; never creates a PR', async () => {
  const { input } = fixture({ missingPr: true });
  assert.deepEqual(await inspectRollbackDraftPr(input), { verified: true, state: 'ABSENT' });
});

test('absent rollback branch and absent PR never write GitHub refs', async () => {
  const { input, calls } = fixture({ missingPr: true }, false);
  assert.deepEqual(await inspectRollbackDraftPr(input), { verified: true, state: 'ABSENT' });
  assert.ok(!calls.some(x => /git\/commits|compare/.test(x)));
});

const problems: Array<[string, Scenario, string]> = [
  ['moved main', { mainMoved: true }, 'ROLLBACK_MAIN_MOVED_MANUAL_REVIEW'],
  ['unexpected branch head', { headChanged: true }, 'ROLLBACK_REMOTE_BRANCH_CHANGED'],
  ['wrong reverted tree', { treeChanged: true }, 'ROLLBACK_PR_REMOTE_COMMIT_MISMATCH'],
  ['extra changed file', { extraFile: true }, 'ROLLBACK_PR_REMOTE_COMMIT_MISMATCH'],
  ['duplicate candidate PR', { ambiguous: true }, 'ROLLBACK_PR_CONFLICT_REQUIRES_REVIEW'],
  ['closed PR', { closed: true }, 'ROLLBACK_PR_CONFLICT_REQUIRES_REVIEW'],
  ['fork source PR', { wrongRepo: true }, 'ROLLBACK_PR_CONFLICT_REQUIRES_REVIEW'],
  ['changed PR head', { changedPrHead: true }, 'ROLLBACK_PR_CONFLICT_REQUIRES_REVIEW'],
  ['changed base', { movedPrBase: true }, 'ROLLBACK_PR_CONFLICT_REQUIRES_REVIEW'],
  ['GitHub unavailable', { networkDown: true }, 'ROLLBACK_GITHUB_READ_UNAVAILABLE']
];
for (const [name, overrides, code] of problems) {
  test('fail closed recovery: ' + name, async () => {
    const { input } = fixture(overrides);
    assert.deepEqual(await inspectRollbackDraftPr(input), { verified: false, error: code });
  });
}

test('abandoned branch with a conflicting existing PR cannot clear reservation', async () => {
  const { input } = fixture({}, false);
  assert.deepEqual(await inspectRollbackDraftPr(input),
    { verified: false, error: 'ROLLBACK_PR_CONFLICT_REQUIRES_REVIEW' });
});

test('untrusted file scope is denied before any network read', async () => {
  const { input, calls } = fixture();
  const result = await inspectRollbackDraftPr({
    ...input, changedFiles: ['.env'], allowedFiles: ['value.txt']
  });
  assert.deepEqual(result, { verified: false, error: 'ROLLBACK_PR_INSPECTION_INVALID' });
  assert.equal(calls.length, 0);
});
