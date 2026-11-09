/**
 * Real Express + SQLite rollback state transitions with deterministic GitHub
 * REST fixtures. The actual inverse Git/Docker operation is independently
 * covered by tests/test_rollback_pipeline.py. NO live GitHub PR is created.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { app, clusterState, generateEd25519Token, SUTRADHAR_ADMIN_KEY } from '../server.ts';
import { clusterDb } from '../server_db.ts';

const BASE = 'a'.repeat(40);
const ORIGINAL_HEAD = 'b'.repeat(40);
const TESTED_TREE = 'c'.repeat(40);
const MERGED = 'd'.repeat(40);
const REVERT_TREE = 'e'.repeat(40);
const REVERT_HEAD = 'f'.repeat(40);
const REVERT_MERGED = '9'.repeat(40);
const WORKER = 'NODE-A8F24C09';
const PATCH = 'diff --git a/src/safe.ts b/src/safe.ts\n--- a/src/safe.ts\n+++ b/src/safe.ts\n@@ -1 +1 @@\n-old\n+new\n';

test('real admin HTTP rollback PR requires external review/CI evidence before completion', async () => {
  const ticketId = 'TKT-ROLL-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const files = ['src/safe.ts'];
  const epoch = clusterDb.getSystemState().epochId;
  clusterDb.createTicket({
    id: ticketId, title: 'Rollback API fixture', description: 'No real target GitHub delivery',
    priority: 'P2_NORMAL', domain: 'Core', status: 'PENDING', branch: 'ai/' + ticketId,
    allowedFiles: files, readOnlyContracts: [], parentTicketIds: [],
    retryCount: 0, maxRetries: 3, diffPatch: PATCH,
    createdAt: now, updatedAt: now, logs: []
  });
  const signed = generateEd25519Token(ticketId, WORKER, epoch, files, 900);
  const claim = clusterDb.tryClaimTicket(WORKER, ticketId, signed.tokenId, 900);
  assert.equal(claim.success, true);
  assert.ok(claim.branch);
  clusterDb.updateTicket(ticketId, {
    status: 'TESTING_SANDBOX', diffPatch: PATCH,
    ed25519Token: signed.tokenHeader, tokenExpiresAt: signed.expiresAt
  });
  const patchSha = crypto.createHash('sha256').update(PATCH).digest('hex');
  assert.equal(clusterDb.recordVerifiedSandboxPass({
    ticketId, patchSha256: patchSha, baselineCommit: BASE,
    candidateTreeSha: TESTED_TREE, changedFiles: files,
    workerId: WORKER, epochId: epoch,
    stdout: 'fixture only: Docker tested in Python real integration', stderr: ''
  }), true);
  const pushed = clusterDb.reserveWorkerPushJob({
    ticketId, repo: 'acme/widgets', branch: claim.branch!, treeSha: TESTED_TREE,
    baselineCommit: BASE, patchSha256: patchSha,
    workerId: WORKER, tokenId: signed.tokenId, epochId: epoch
  });
  assert.equal(pushed.success, true);
  if (!pushed.success) return;
  assert.equal(clusterDb.recordVerifiedWorkerPush({
    ticketId, repo: 'acme/widgets', branch: claim.branch!,
    headSha: ORIGINAL_HEAD, treeSha: TESTED_TREE, baselineCommit: BASE,
    patchSha256: patchSha, workerId: WORKER, epochId: epoch,
    tokenId: signed.tokenId, reservationId: pushed.reservationId
  }), true);
  assert.equal(clusterDb.recordVerifiedDraftPr({
    ticketId, repo: 'acme/widgets', prNumber: 42,
    branch: claim.branch!, headSha: ORIGINAL_HEAD, treeSha: TESTED_TREE,
    patchSha256: patchSha, workerId: WORKER, epochId: epoch,
    tokenId: signed.tokenId
  }), true);
  const grant = clusterDb.authorizeGitMergeVerification(ticketId, 'acme/widgets');
  assert.equal(grant.success, true);
  if (!grant.success) return;
  assert.equal(clusterDb.recordVerifiedGitMerge({
    ticketId, repo: 'acme/widgets', prNumber: 42, branch: claim.branch!,
    headSha: ORIGINAL_HEAD, mergeSha: MERGED, treeSha: TESTED_TREE,
    patchSha256: patchSha, epochId: epoch, grantId: grant.grantId
  }), true);
  assert.equal(clusterDb.rollbackMerge(ticketId, 'Regression found after merge', 'Admin').success, true);
  const reserved = clusterDb.reserveVerifiedRollback(ticketId, 'acme/widgets');
  assert.equal(reserved.success, true);
  if (!reserved.success) return;
  // This is synthetic rollback branch evidence for the HTTP route test ONLY.
  // The actual inverse commit and Docker behavior have separate real Git tests.
  assert.equal(clusterDb.recordRollbackPrepared({
    ticketId, reservationId: reserved.reservationId, repo: 'acme/widgets',
    branch: reserved.branch, originalMergeSha: MERGED, baselineCommit: BASE,
    testedMergeTree: TESTED_TREE, headSha: REVERT_HEAD,
    revertedTree: REVERT_TREE, epochId: epoch
  }), true);
  const branch = reserved.branch;
  const envKeys = ['SUTRADHAR_GITHUB_REPOSITORY','SUTRADHAR_GITHUB_PR_TOKEN',
    'SUTRADHAR_GITHUB_TOKEN','SUTRADHAR_REQUIRED_CHECKS',
    'SUTRADHAR_MIN_GITHUB_APPROVALS','SUTRADHAR_ENABLE_ROLLBACK'] as const;
  const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
  process.env.SUTRADHAR_GITHUB_REPOSITORY = 'acme/widgets';
  process.env.SUTRADHAR_GITHUB_PR_TOKEN = 'mock-fixture-pr-token';
  process.env.SUTRADHAR_GITHUB_TOKEN = 'mock-fixture-read-token';
  process.env.SUTRADHAR_REQUIRED_CHECKS = 'CI / tests';
  process.env.SUTRADHAR_MIN_GITHUB_APPROVALS = '1';
  process.env.SUTRADHAR_ENABLE_ROLLBACK = 'true';

  let merged = false;
  let approved = false;
  let treeCorrect = false;
  let created = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    if (!String(url).startsWith('https://api.github.com/repos/acme/widgets/')) {
      return originalFetch(url, init);
    }
    const pathname = new URL(String(url)).pathname;
    const method = init?.method || 'GET';
    const answer = (data: unknown) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
    if (pathname.endsWith('/branches/main')) return answer({ commit: { sha: MERGED } });
    if (pathname.endsWith('/branches/' + branch))
      return answer({ commit: { sha: REVERT_HEAD } });
    if (pathname.endsWith('/git/commits/' + REVERT_HEAD))
      return answer({ sha: REVERT_HEAD, parents: [{ sha: MERGED }],
        tree: { sha: REVERT_TREE } });
    if (pathname.endsWith('/git/commits/' + REVERT_MERGED))
      return answer({ sha: REVERT_MERGED,
        tree: { sha: treeCorrect ? REVERT_TREE : TESTED_TREE } });
    if (pathname.endsWith('/compare/' + MERGED + '...' + REVERT_HEAD))
      return answer({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1,
        files: [{ filename: files[0], status: 'modified' }] });
    if (pathname.endsWith('/compare/' + REVERT_MERGED + '...main'))
      return answer({ status: 'ahead', base_commit: { sha: REVERT_MERGED } });
    if (pathname.endsWith('/pulls') && method === 'GET') {
      return answer(merged ? [{
        number: 77, commits: 1, changed_files: 1, draft: false,
        merged_at: '2026-11-10T00:00:00Z', merge_commit_sha: REVERT_MERGED,
        user: { login: 'author' },
        head: { ref: branch, sha: REVERT_HEAD, repo: { full_name: 'acme/widgets' } },
        base: { ref: 'main', repo: { full_name: 'acme/widgets' } }
      }] : []);
    }
    if (pathname.endsWith('/pulls') && method === 'POST') {
      created++;
      const body = JSON.parse(String(init?.body || '{}'));
      assert.equal(body.draft, true);
      assert.equal(body.base, 'main');
      assert.equal(body.head, branch);
      return answer({
        number: 77, html_url: 'https://github.com/acme/widgets/pull/77',
        state: 'open', draft: true,
        head: { ref: branch, sha: REVERT_HEAD, repo: { full_name: 'acme/widgets' } },
        base: { ref: 'main', sha: MERGED, repo: { full_name: 'acme/widgets' } }
      });
    }
    if (pathname.endsWith('/pulls/77/files'))
      return answer([{ filename: files[0], status: 'modified' }]);
    if (pathname.endsWith('/commits/' + REVERT_HEAD + '/check-runs'))
      return answer({ total_count: 1, check_runs: [{
        name: 'CI / tests', head_sha: REVERT_HEAD, app: { slug: 'github-actions' },
        status: 'completed', conclusion: 'success'
      }] });
    if (pathname.endsWith('/pulls/77/reviews'))
      return answer([{ state: approved ? 'APPROVED' : 'COMMENTED',
        user: { login: 'independent-reviewer' },
        submitted_at: '2026-11-09T23:00:00Z' }]);
    throw new Error('Unexpected mocked GitHub path ' + pathname);
  }) as typeof fetch;

  const server = http.createServer(app);
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const post = async (route: string) => {
      const response = await originalFetch(origin + route, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUTRADHAR_ADMIN_KEY}`,
          'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      return { status: response.status, body: await response.json() as any };
    };
    // Even with a prepared fixture, anonymous and feature-disabled API
    // requests must never execute any rollback Git operation.
    const anon = await originalFetch(origin + '/api/master/rollback/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId })
    });
    assert.equal(anon.status, 401);
    process.env.SUTRADHAR_ENABLE_ROLLBACK = 'false';
    const disabled = await post('/api/master/rollback/prepare');
    assert.equal(disabled.status, 503);
    assert.equal(disabled.body.error, 'ROLLBACK_FEATURE_DISABLED');
    assert.equal((await post('/api/master/rollback/create-draft-pr')).status, 503);
    process.env.SUTRADHAR_ENABLE_ROLLBACK = 'true';
    const early = await post('/api/master/rollback/verify');
    assert.equal(early.status, 409);
    assert.equal(clusterDb.getAllTickets().find(t => t.id === ticketId)?.status, 'ROLLBACK_REQUESTED');
    const draft = await post('/api/master/rollback/create-draft-pr');
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal(draft.body.status, 'ROLLBACK_DRAFT_PR_NOT_MERGED');
    assert.equal(created, 1);
    assert.equal((await post('/api/master/rollback/create-draft-pr')).status, 409);
    assert.equal(clusterDb.getAllTickets().find(t => t.id === ticketId)?.status, 'ROLLBACK_REQUESTED');
    const unmerged = await post('/api/master/rollback/verify');
    assert.equal(unmerged.status, 409);
    merged = true;
    const noApproval = await post('/api/master/rollback/verify');
    assert.equal(noApproval.status, 409);
    assert.equal(noApproval.body.error, 'GITHUB_TESTED_TREE_MISMATCH');
    treeCorrect = true;
    const stillUnapproved = await post('/api/master/rollback/verify');
    assert.equal(stillUnapproved.status, 409);
    assert.equal(stillUnapproved.body.error, 'GITHUB_APPROVAL_NOT_VERIFIED');
    approved = true;
    const success = await post('/api/master/rollback/verify');
    assert.equal(success.status, 200, JSON.stringify(success.body));
    assert.equal(success.body.status, 'ROLLBACK_COMPLETED');
    assert.equal(success.body.rollbackMergedSha, REVERT_MERGED);
    assert.equal(clusterDb.getAllTickets().find(t => t.id === ticketId)?.status, 'ROLLBACK_COMPLETED');
    assert.equal((await post('/api/master/rollback/verify')).status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
