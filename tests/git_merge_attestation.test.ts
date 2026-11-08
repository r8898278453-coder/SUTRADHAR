import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClusterDatabase } from '../server_db.ts';

const BASE = 'a'.repeat(40);
const TREE = 'c'.repeat(40);
const HEAD = 'b'.repeat(40);
const MERGE = 'd'.repeat(40);
const TOKEN_ID = 'tok_test_lease_001';
const patch = 'diff --git a/src/safe.ts b/src/safe.ts\n--- a/src/safe.ts\n+++ b/src/safe.ts\n@@ -1 +1 @@\n-old\n+new\n';
const hash = crypto.createHash('sha256').update(patch).digest('hex');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutradhar-git-cas-'));
  const db = new ClusterDatabase(path.join(dir, 'state.db'));
  const ticketId = 'TKT-GITHUB-01';
  const timestamp = new Date().toISOString();
  db.createTicket({
    id: ticketId, title: 'Verified merge CAS', description: 'Test',
    priority: 'P2_NORMAL', domain: 'Core', status: 'TESTING_SANDBOX',
    assignedTo: 'NODE-TEST', branch: 'ai/TKT-GITHUB-01',
    allowedFiles: ['src/safe.ts'], readOnlyContracts: [], parentTicketIds: [],
    retryCount: 0, maxRetries: 3, diffPatch: patch,
    createdAt: timestamp, updatedAt: timestamp, logs: []
  });
  const epoch = db.getSystemState().epochId;
  const now = Date.now();
  // The merge CAS checks the durable owner, epoch, token ID and expiry again
  // after external GitHub requests complete.
  (db as any).db.prepare(`INSERT INTO worker_leases
    (ticket_id, worker_id, epoch_id, token_id, leased_at, expires_at, last_heartbeat_at, is_revoked)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(
      ticketId, 'NODE-TEST', epoch, TOKEN_ID, now, now + 900_000, now
    );
  function attest() {
    return db.recordVerifiedSandboxPass({
      ticketId, patchSha256: hash, baselineCommit: BASE, candidateTreeSha: TREE,
      changedFiles: ['src/safe.ts'], workerId: 'NODE-TEST', epochId: epoch,
      stdout: 'container exit 0', stderr: ''
    });
  }
  function merge(data: Partial<Parameters<typeof db.recordVerifiedGitMerge>[0]> = {}) {
    return db.recordVerifiedGitMerge({
      ticketId, repo: 'acme/widgets', prNumber: 12, branch: 'ai/TKT-GITHUB-01',
      headSha: HEAD, mergeSha: MERGE, treeSha: TREE,
      patchSha256: hash, epochId: epoch, workerId: 'NODE-TEST', tokenId: TOKEN_ID, ...data
    });
  }
  function push(data: Partial<Parameters<typeof db.recordVerifiedWorkerPush>[0]> = {}) {
    return db.recordVerifiedWorkerPush({
      ticketId, repo: 'acme/widgets', branch: 'ai/TKT-GITHUB-01',
      headSha: HEAD, treeSha: TREE, baselineCommit: BASE,
      patchSha256: hash, workerId: 'NODE-TEST', epochId: epoch,
      tokenId: TOKEN_ID, ...data
    });
  }
  function draft(data: Partial<Parameters<typeof db.recordVerifiedDraftPr>[0]> = {}) {
    return db.recordVerifiedDraftPr({
      ticketId, repo: 'acme/widgets', prNumber: 42,
      branch: 'ai/TKT-GITHUB-01', headSha: HEAD,
      treeSha: TREE, patchSha256: hash, epochId: epoch,
      workerId: 'NODE-TEST', tokenId: TOKEN_ID, ...data
    });
  }
  return {
    db, ticketId, attest, merge, draft, push,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

test('exact Docker tree and matching remote merge evidence persist atomically', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
    assert.equal(t.db.getSandboxAttestation(t.ticketId)?.candidateTreeSha, TREE);
    assert.equal(t.merge(), true);
    const merged = t.db.getAllTickets().find(x => x.id === t.ticketId);
    assert.equal(merged?.status, 'COMMITTED_PUSHED');
    assert.equal(merged?.rollbackCommit, MERGE);
    assert.equal(t.merge(), false, 'Duplicate merge attestation is forbidden');
    assert.equal(t.db.getAuditLogs(20).filter(x => x.action === 'REMOTE_MERGE_VERIFIED').length, 1);
  } finally { t.cleanup(); }
});

test('untested ticket cannot be merged', () => {
  const t = setup();
  try {
    assert.equal(t.merge(), false);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'TESTING_SANDBOX');
  } finally { t.cleanup(); }
});

test('wrong tree and changed patch are denied', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.merge({ treeSha: 'f'.repeat(40) }), false);
    t.db.updateTicket(t.ticketId, { diffPatch: patch + '# edited' });
    assert.equal(t.merge(), false);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
  } finally { t.cleanup(); }
});

test('stale epoch or paused cluster denies merge', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.merge({ epochId: 500 }), false);
    t.db.setKillSwitch(true, 'release freeze', 'QA');
    assert.equal(t.merge(), false);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
  } finally { t.cleanup(); }
});

test('wrong token, revoked token and expired lease cannot commit a merge', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.merge({ tokenId: 'tok_forged' }), false);
    t.db.revokeToken(TOKEN_ID, 'Security test');
    assert.equal(t.merge(), false);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
  } finally { t.cleanup(); }
});

test('draft PR submission requires a matching tested tree and live signed lease', () => {
  const t = setup();
  try {
    assert.equal(t.draft(), false, 'Untested ticket must be rejected');
    assert.equal(t.attest(), true);
    assert.equal(t.draft(), false, 'No verified push receipt => no PR');
    assert.equal(t.push({ treeSha: 'f'.repeat(40) }), false);
    assert.equal(t.push(), true, 'Exact tested branch receipt recorded');
    assert.equal(t.db.getVerifiedWorkerPush(t.ticketId)?.headSha, HEAD);
    assert.equal(t.push(), true, 'Same push can be recorded idempotently');
    assert.equal(t.push({ headSha: 'f'.repeat(40) }), false, 'Different push cannot overwrite receipt');
    assert.equal(t.draft({ treeSha: 'f'.repeat(40) }), false);
    assert.equal(t.draft({ tokenId: 'wrong' }), false);
    assert.equal(t.draft(), true);
    assert.equal(t.db.getDraftPrSubmission(t.ticketId)?.prNumber, 42);
    assert.equal(t.draft(), true, 'Same PR can be recorded idempotently');
    assert.equal(t.draft({ prNumber: 101 }), false, 'Different PR cannot overwrite evidence');
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status,
      'READY_FOR_REVIEW', 'Creating a PR never marks a merge complete');
    assert.equal(t.db.getAuditLogs(50).filter(x => x.action === 'DRAFT_PR_VERIFIED_SUBMITTED').length, 1);
  } finally { t.cleanup(); }
});

test('paused cluster or revoked lease blocks draft PR persistence', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    t.db.revokeToken(TOKEN_ID, 'Revoke test');
    assert.equal(t.draft(), false);
    t.db.setKillSwitch(true, 'Freeze', 'Test');
    assert.equal(t.draft(), false);
  } finally { t.cleanup(); }
});

test('verified worker push cannot proceed without Docker attestation or live lease', () => {
  const t = setup();
  try {
    assert.equal(t.push(), false);
    assert.equal(t.attest(), true);
    assert.equal(t.push({ tokenId: 'forged-token' }), false);
    assert.equal(t.push({ patchSha256: 'a'.repeat(64) }), false);
    t.db.revokeToken(TOKEN_ID, 'Security revoked');
    assert.equal(t.push(), false);
    assert.equal(t.db.getVerifiedWorkerPush(t.ticketId), null);
  } finally { t.cleanup(); }
});
