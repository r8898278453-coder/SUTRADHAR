/**
 * API integration using controlled GitHub REST fixtures. The real server,
 * Ed25519 lease, SQLite attestation and PR-creation endpoint are exercised.
 * No external GitHub PR is created; this is not a live acceptance test.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { app, clusterState, generateEd25519Token, SUTRADHAR_ADMIN_KEY } from '../server.ts';
import { clusterDb } from '../server_db.ts';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const workerId = 'NODE-A8F24C09';
const patch = 'diff --git a/src/safe.ts b/src/safe.ts\n--- a/src/safe.ts\n+++ b/src/safe.ts\n@@ -1 +1 @@\n-old\n+new\n';

test('admin-only HTTP draft PR creation is scope/lease gated and never merges', async () => {
  const ticketId = 'TKT-PR-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const allowedFiles = ['src/safe.ts'];
  clusterDb.createTicket({
    id: ticketId, title: 'Mock GitHub Draft', description: 'Review before any merge',
    priority: 'P2_NORMAL', domain: 'Core', status: 'PENDING',
    parentTicketIds: [], allowedFiles, readOnlyContracts: [], retryCount: 0,
    maxRetries: 3, branch: 'ai/' + ticketId, diffPatch: patch,
    createdAt: now, updatedAt: now, logs: []
  });
  const epoch = clusterDb.getSystemState().epochId;
  const token = generateEd25519Token(ticketId, workerId, epoch, allowedFiles, 900);
  const claim = clusterDb.tryClaimTicket(workerId, ticketId, token.tokenId, 900);
  assert.equal(claim.success, true, JSON.stringify(claim));
  assert.ok(claim.branch);
  clusterDb.updateTicket(ticketId, {
    status: 'TESTING_SANDBOX', diffPatch: patch,
    ed25519Token: token.tokenHeader, tokenExpiresAt: token.expiresAt
  });
  const patchHash = crypto.createHash('sha256').update(patch).digest('hex');
  assert.equal(clusterDb.recordVerifiedSandboxPass({
    ticketId, patchSha256: patchHash, baselineCommit: BASE,
    candidateTreeSha: TREE, changedFiles: allowedFiles,
    workerId, epochId: epoch, stdout: 'fixture: real Docker tested in separate suite',
    stderr: ''
  }), true);
  // Controlled GitHub responses only: simulate a previously verified worker
  // push receipt in SQLite. The real Git push is covered by Python bare-remote tests.
  const pushReservation = clusterDb.reserveWorkerPushJob({
    ticketId, repo: 'acme/widgets', branch: claim.branch!,
    treeSha: TREE, baselineCommit: BASE, patchSha256: patchHash,
    workerId: workerId, epochId: epoch, tokenId: token.tokenId
  });
  assert.equal(pushReservation.success, true);
  if (!pushReservation.success) throw new Error(pushReservation.error);
  assert.equal(clusterDb.recordVerifiedWorkerPush({
    ticketId, repo: 'acme/widgets', branch: claim.branch!,
    headSha: HEAD, treeSha: TREE, baselineCommit: BASE,
    patchSha256: patchHash, workerId, epochId: epoch, tokenId: token.tokenId,
    reservationId: pushReservation.reservationId
  }), true);

  const envNames = ['SUTRADHAR_GITHUB_REPOSITORY', 'SUTRADHAR_GITHUB_PR_TOKEN',
    'SUTRADHAR_REQUIRED_CHECKS', 'SUTRADHAR_MIN_GITHUB_APPROVALS',
    'SUTRADHAR_ENABLE_PR_CREATION'] as const;
  const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  process.env.SUTRADHAR_GITHUB_REPOSITORY = 'acme/widgets';
  process.env.SUTRADHAR_GITHUB_PR_TOKEN = 'mock-pr-creation-token';
  process.env.SUTRADHAR_REQUIRED_CHECKS = 'CI / tests';
  process.env.SUTRADHAR_MIN_GITHUB_APPROVALS = '1';
  delete process.env.SUTRADHAR_ENABLE_PR_CREATION;

  const realFetch = globalThis.fetch;
  let wrongTree = true;
  let exists = false;
  let createCount = 0;
  globalThis.fetch = (async (url: any, init?: any): Promise<Response> => {
    if (!String(url).startsWith('https://api.github.com/repos/acme/widgets/')) {
      return realFetch(url, init);
    }
    const pathname = new URL(String(url)).pathname;
    const method = init?.method || 'GET';
    const reply = (body: any) => new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
    if (pathname.endsWith('/branches/main')) return reply({ commit: { sha: BASE } });
    if (pathname.endsWith('/branches/' + claim.branch)) return reply({ commit: { sha: HEAD } });
    if (pathname.endsWith('/git/commits/' + HEAD)) return reply({
      sha: HEAD, parents: [{ sha: BASE }],
      tree: { sha: wrongTree ? 'f'.repeat(40) : TREE }
    });
    if (pathname.endsWith('/compare/' + BASE + '...' + HEAD)) return reply({
      status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1,
      files: [{ filename: 'src/safe.ts', status: 'modified' }]
    });
    if (pathname.endsWith('/pulls') && method === 'GET') {
      return reply(exists ? [{
        number: 74, html_url: 'https://github.com/acme/widgets/pull/74',
        state: 'open', draft: true,
        head: { ref: claim.branch, sha: HEAD, repo: { full_name: 'acme/widgets' } },
        base: { ref: 'main', sha: BASE, repo: { full_name: 'acme/widgets' } }
      }] : []);
    }
    if (pathname.endsWith('/pulls') && method === 'POST') {
      createCount++;
      const body = JSON.parse(String(init?.body || '{}'));
      assert.equal(body.draft, true);
      assert.equal(body.base, 'main');
      assert.equal(body.head, claim.branch);
      exists = true;
      return reply({
        number: 74, html_url: 'https://github.com/acme/widgets/pull/74',
        state: 'open', draft: true,
        head: { ref: claim.branch, sha: HEAD, repo: { full_name: 'acme/widgets' } },
        base: { ref: 'main', sha: BASE, repo: { full_name: 'acme/widgets' } }
      });
    }
    throw new Error('Unexpected fixture GitHub path: ' + pathname);
  }) as typeof fetch;

  const server = http.createServer(app);
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const uri = `http://127.0.0.1:${address.port}/api/cluster/ticket/create-draft-pr`;
    async function call(admin = true) {
      const response = await realFetch(uri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(admin ? { Authorization: `Bearer ${SUTRADHAR_ADMIN_KEY}` } : {})
        },
        body: JSON.stringify({ ticketId })
      });
      return { status: response.status, body: await response.json() as any };
    }
    assert.equal((await call(false)).status, 401);
    assert.equal((await call()).status, 503, 'Feature flag must be explicit');
    process.env.SUTRADHAR_ENABLE_PR_CREATION = 'true';
    const denied = await call();
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error, 'DRAFT_PR_TESTED_COMMIT_MISMATCH');
    assert.equal(createCount, 0);
    wrongTree = false;
    const created = await call();
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.draft, true);
    assert.equal(created.body.status, 'READY_FOR_REVIEW');
    assert.equal(createCount, 1);
    assert.equal(clusterDb.getDraftPrSubmission(ticketId)?.prNumber, 74);
    assert.equal(clusterDb.getAllTickets().find(t => t.id === ticketId)?.status, 'READY_FOR_REVIEW');
    const replay = await call();
    assert.equal(replay.status, 200);
    assert.equal(replay.body.existing, true);
    assert.equal(createCount, 1);
    assert.equal(clusterDb.getAuditLogs(50).filter(x =>
      x.ticketId === ticketId && x.action === 'DRAFT_PR_VERIFIED_SUBMITTED').length, 1);
  } finally {
    globalThis.fetch = realFetch;
    for (const name of envNames) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
