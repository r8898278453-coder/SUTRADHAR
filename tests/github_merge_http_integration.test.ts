/**
 * API integration with controlled GitHub REST fixtures.
 * This exercises real Express auth, signed lease, SQLite attestation/CAS and
 * GitHub verification code. It does NOT claim a real remote PR was merged.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { app, generateEd25519Token } from '../server.ts';
import { clusterDb } from '../server_db.ts';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const MERGE = 'd'.repeat(40);
const worker = 'NODE-A8F24C09';
const patch = 'diff --git a/src/safe.ts b/src/safe.ts\n--- a/src/safe.ts\n+++ b/src/safe.ts\n@@ -1 +1 @@\n-old\n+new\n';

test('HTTP GitHub merge approval uses signed durable lease and actual tested tree CAS', async () => {
  const ticketId = 'TKT-VERIFY-' + crypto.randomUUID().slice(0, 9);
  const now = new Date().toISOString();
  const files = ['src/safe.ts'];
  const ticket: any = {
    id: ticketId, title: 'GitHub API acceptance fixture', description: 'Mock remote JSON only',
    priority: 'P2_NORMAL', domain: 'Core', status: 'PENDING', assignedTo: undefined,
    parentTicketIds: [], allowedFiles: files, readOnlyContracts: [],
    retryCount: 0, maxRetries: 3, branch: 'ai/' + ticketId,
    diffPatch: patch, createdAt: now, updatedAt: now, logs: []
  };
  clusterDb.createTicket(ticket);
  const epoch = clusterDb.getSystemState().epochId;
  const signed = generateEd25519Token(ticketId, worker, epoch, files, 900);
  const claim = clusterDb.tryClaimTicket(worker, ticketId, signed.tokenId, 900);
  assert.equal(claim.success, true, JSON.stringify(claim));
  assert.ok(claim.branch);
  clusterDb.updateTicket(ticketId, {
    status: 'TESTING_SANDBOX', diffPatch: patch,
    ed25519Token: signed.tokenHeader, tokenExpiresAt: signed.expiresAt
  });
  const hash = crypto.createHash('sha256').update(patch).digest('hex');
  assert.equal(clusterDb.recordVerifiedSandboxPass({
    ticketId, patchSha256: hash, baselineCommit: BASE, candidateTreeSha: TREE,
    changedFiles: files, workerId: worker, epochId: epoch,
    stdout: 'this is an API fixture; Docker tested separately', stderr: ''
  }), true);

  const previous = {
    repo: process.env.SUTRADHAR_GITHUB_REPOSITORY,
    token: process.env.SUTRADHAR_GITHUB_TOKEN,
    checks: process.env.SUTRADHAR_REQUIRED_CHECKS,
    approvals: process.env.SUTRADHAR_MIN_GITHUB_APPROVALS
  };
  process.env.SUTRADHAR_GITHUB_REPOSITORY = 'acme/widgets';
  process.env.SUTRADHAR_GITHUB_TOKEN = 'local-fixture-token';
  process.env.SUTRADHAR_REQUIRED_CHECKS = 'CI / tests';
  process.env.SUTRADHAR_MIN_GITHUB_APPROVALS = '1';

  const originalFetch = globalThis.fetch;
  let simulateWrongTree = true;
  globalThis.fetch = (async (url: any, init?: any): Promise<Response> => {
    if (!String(url).startsWith('https://api.github.com/repos/acme/widgets/')) {
      return originalFetch(url, init);
    }
    const pathname = new URL(String(url)).pathname;
    const body = (data: unknown) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
    if (pathname.endsWith('/pulls')) return body([{
      number: 24, commits: 1, changed_files: 1, draft: false,
      merged_at: '2026-11-06T18:30:00Z', merge_commit_sha: MERGE,
      user: { login: 'author' },
      head: { ref: claim.branch, sha: HEAD, repo: { full_name: 'acme/widgets' } },
      base: { ref: 'main', repo: { full_name: 'acme/widgets' } }
    }]);
    if (pathname.endsWith('/git/commits/' + HEAD))
      return body({ sha: HEAD, parents: [{ sha: BASE }],
        tree: { sha: simulateWrongTree ? 'f'.repeat(40) : TREE } });
    if (pathname.endsWith('/git/commits/' + MERGE))
      return body({ sha: MERGE, tree: { sha: TREE } });
    if (pathname.endsWith('/pulls/24/files'))
      return body([{ filename: 'src/safe.ts', status: 'modified' }]);
    if (pathname.endsWith('/commits/' + HEAD + '/check-runs'))
      return body({ total_count: 1, check_runs: [{
        name: 'CI / tests', head_sha: HEAD,
        status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }
      }] });
    if (pathname.endsWith('/pulls/24/reviews'))
      return body([{ state: 'APPROVED', user: { login: 'reviewer' },
        submitted_at: '2026-11-06T18:00:00Z' }]);
    if (pathname.endsWith('/compare/' + MERGE + '...main'))
      return body({ status: 'ahead', base_commit: { sha: MERGE } });
    throw new Error('unexpected GitHub mocked path: ' + pathname);
  }) as typeof fetch;

  const server = http.createServer(app);
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/cluster/ticket/verify-push`;
    const call = async () => {
      const response = await originalFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${(await import('../server.ts')).SUTRADHAR_ADMIN_KEY}`,
          'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, tokenHeader: signed.tokenHeader, branch: claim.branch })
      });
      return { status: response.status, data: await response.json() as any };
    };
    const denied = await call();
    assert.equal(denied.status, 409);
    assert.equal(denied.data.error, 'GITHUB_TESTED_TREE_MISMATCH');
    assert.equal(clusterDb.getAllTickets().find(x => x.id === ticketId)?.status, 'READY_FOR_REVIEW');

    simulateWrongTree = false;
    const accepted = await call();
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.verified, true);
    assert.equal(accepted.data.status, 'COMMITTED_PUSHED');
    assert.equal(accepted.data.mergedCommit, MERGE);
    const persisted = clusterDb.getAllTickets().find(x => x.id === ticketId);
    assert.equal(persisted?.status, 'COMMITTED_PUSHED');
    assert.equal(persisted?.rollbackCommit, MERGE);
    const replay = await call();
    assert.equal(replay.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.repo === undefined) delete process.env.SUTRADHAR_GITHUB_REPOSITORY;
    else process.env.SUTRADHAR_GITHUB_REPOSITORY = previous.repo;
    if (previous.token === undefined) delete process.env.SUTRADHAR_GITHUB_TOKEN;
    else process.env.SUTRADHAR_GITHUB_TOKEN = previous.token;
    if (previous.checks === undefined) delete process.env.SUTRADHAR_REQUIRED_CHECKS;
    else process.env.SUTRADHAR_REQUIRED_CHECKS = previous.checks;
    if (previous.approvals === undefined) delete process.env.SUTRADHAR_MIN_GITHUB_APPROVALS;
    else process.env.SUTRADHAR_MIN_GITHUB_APPROVALS = previous.approvals;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
