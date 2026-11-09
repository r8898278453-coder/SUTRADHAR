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
  const dbPath = path.join(dir, 'state.db');
  const db = new ClusterDatabase(dbPath);
  (db as any).__testDbPath = dbPath;
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
  let currentGrantId = 'not-authorized';
  function authorize() {
    const result = db.authorizeGitMergeVerification(ticketId, 'acme/widgets', 'TEST-ADMIN');
    if (result.success) currentGrantId = result.grantId;
    return result;
  }
  function merge(data: Partial<Parameters<typeof db.recordVerifiedGitMerge>[0]> = {}) {
    return db.recordVerifiedGitMerge({
      ticketId, repo: 'acme/widgets', prNumber: 42, branch: 'ai/TKT-GITHUB-01',
      headSha: HEAD, mergeSha: MERGE, treeSha: TREE,
      patchSha256: hash, epochId: epoch, grantId: currentGrantId, ...data
    });
  }
  let reservationId: string | null = null;
  function reserve() {
    const result = db.reserveWorkerPushJob({
      ticketId, repo: 'acme/widgets', branch: 'ai/TKT-GITHUB-01',
      treeSha: TREE, baselineCommit: BASE, patchSha256: hash,
      workerId: 'NODE-TEST', epochId: epoch, tokenId: TOKEN_ID
    });
    if (result.success) reservationId = result.reservationId;
    return result;
  }
  function push(data: Partial<Parameters<typeof db.recordVerifiedWorkerPush>[0]> = {}) {
    if (!reservationId && !reserve().success) return false;
    return db.recordVerifiedWorkerPush({
      ticketId, repo: 'acme/widgets', branch: 'ai/TKT-GITHUB-01',
      headSha: HEAD, treeSha: TREE, baselineCommit: BASE,
      patchSha256: hash, workerId: 'NODE-TEST', epochId: epoch,
      tokenId: TOKEN_ID, reservationId: reservationId!, ...data
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
    db, ticketId, attest, merge, draft, push, reserve, authorize,
    getReservationId: () => reservationId,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

test('exact Docker tree and matching remote merge evidence persist atomically', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
    assert.equal(t.db.getSandboxAttestation(t.ticketId)?.candidateTreeSha, TREE);
    assert.equal(t.merge(), false, 'A merge without our worker push receipt is denied');
    assert.equal(t.push(), true, 'Worker branch is now attested');
    assert.equal(t.merge(), false, 'Human review grant and registered draft PR are mandatory');
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
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
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
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
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
    assert.equal(t.merge({ epochId: 500 }), false);
    t.db.setKillSwitch(true, 'release freeze', 'QA');
    assert.equal(t.merge(), false);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
  } finally { t.cleanup(); }
});

test('forged admin grant and explicitly revoked original worker token deny merge', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
    assert.equal(t.merge({ grantId: 'forged-grant' }), false);
    t.db.revokeToken(TOKEN_ID, 'Security test');
    assert.equal(t.merge(), false);
    assert.equal(t.authorize().success, false, 'Revoked worker provenance cannot be reauthorized');
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

test('durable worker push reservation denies duplicates and requires manual recovery after expiry', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    const first = t.reserve();
    assert.equal(first.success, true);
    if (!first.success) return;
    const other = t.reserve();
    assert.deepEqual(other, { success: false, error: 'WORKER_PUSH_RESERVED' });
    assert.equal(t.db.getWorkerPushJob(t.ticketId)?.state, 'RUNNING');
    (t.db as any).db.prepare('UPDATE worker_push_jobs SET expires_at=? WHERE ticket_id=?')
      .run(Date.now() - 10, t.ticketId);
    const stale = t.reserve();
    assert.deepEqual(stale, { success: false, error: 'WORKER_PUSH_RECOVERY_REQUIRED' });
    assert.equal(t.db.getWorkerPushJob(t.ticketId)?.state, 'NEEDS_RECONCILIATION');
    assert.equal(t.reserve().success, false);
    assert.equal(t.db.clearWorkerPushAfterVerifiedAbsence(t.ticketId, 'wrong'), false);
    assert.equal(t.db.clearWorkerPushAfterVerifiedAbsence(t.ticketId, first.reservationId), true);
    const retry = t.reserve();
    assert.equal(retry.success, true);
    if (retry.success) assert.notEqual(retry.reservationId, first.reservationId);
    assert.equal(t.push(), true);
    assert.equal(t.db.getWorkerPushJob(t.ticketId)?.state, 'CONFIRMED');
    assert.equal(t.db.clearWorkerPushAfterVerifiedAbsence(t.ticketId, retry.success ? retry.reservationId : ''), false);
  } finally { t.cleanup(); }
});

test('uncertain push receipt can be verified only under the original job reservation', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    const first = t.reserve();
    assert.equal(first.success, true);
    if (!first.success) return;
    assert.equal(t.db.markWorkerPushUncertain(t.ticketId, first.reservationId, 'REMOTE_RESULT_UNCERTAIN'), true);
    assert.equal(t.db.getWorkerPushJob(t.ticketId)?.state, 'NEEDS_RECONCILIATION');
    assert.equal(t.push({ reservationId: 'forged-reservation' }), false);
    assert.equal(t.push(), true, 'Read-only verified remote push may be reconciled by current valid lease');
    assert.equal(t.db.getVerifiedWorkerPush(t.ticketId)?.headSha, HEAD);
    assert.equal(t.db.getWorkerPushJob(t.ticketId)?.state, 'CONFIRMED');
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
  } finally { t.cleanup(); }
});

test('second SQLite process sees existing worker push reservation immediately', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    const first = t.reserve();
    assert.equal(first.success, true);
    const fileName = (t.db as any).db.filename;
    // More than one instance shares the same SQLite DB; no in-memory lock needed.
    const second = new ClusterDatabase((t.db as any).__testDbPath || fileName);
    const r = second.reserveWorkerPushJob({
      ticketId: t.ticketId, repo: 'acme/widgets', branch: 'ai/TKT-GITHUB-01',
      baselineCommit: BASE, treeSha: TREE, patchSha256: hash,
      workerId: 'NODE-TEST', tokenId: TOKEN_ID,
      epochId: t.db.getSystemState().epochId
    });
    assert.deepEqual(r, { success: false, error: 'WORKER_PUSH_RESERVED' });
  } finally { t.cleanup(); }
});

test('watchdog expiry preserves tested review state; administrator can verify after worker lease expires', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    (t.db as any).db.prepare(`UPDATE worker_leases
      SET expires_at=?, last_heartbeat_at=? WHERE ticket_id=?`)
      .run(Date.now() - 1000, Date.now() - 120000, t.ticketId);
    const sweep = t.db.sweepWatchdog();
    assert.ok(sweep.expiredTickets.includes(t.ticketId));
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'READY_FOR_REVIEW');
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.assignedTo, 'NODE-TEST');
    assert.equal(t.authorize().success, true, 'Explicit admin grant may follow worker lease expiry');
    assert.equal(t.merge(), true, 'Verified GitHub evidence may be saved after worker lease expiry');
    assert.equal(t.merge(), false, 'Admin grant is single-use');
  } finally { t.cleanup(); }
});

test('expired or mismatched admin grant fails closed until explicitly reauthorized', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
    (t.db as any).db.prepare('UPDATE merge_verification_grants SET expires_at=? WHERE ticket_id=?')
      .run(Date.now() - 1000, t.ticketId);
    assert.equal(t.merge(), false);
    assert.equal(t.authorize().success, true, 'Reissue requires an explicit fresh admin action');
    assert.equal(t.merge({ prNumber: 999 }), false, 'Registered PR identity cannot change');
    assert.equal(t.merge({ headSha: 'f'.repeat(40) }), false, 'Registered head cannot change');
    assert.equal(t.merge(), true);
    assert.equal(t.authorize().success, false, 'Consumed grant cannot be reissued');
  } finally { t.cleanup(); }
});

test('explicit manual revoke cancels review and rejects future proof authorization', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
    assert.equal(t.db.revokeLease(t.ticketId, 'Admin cancelled review'), true);
    assert.equal(t.db.isTokenRevoked(TOKEN_ID), true);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'PENDING');
    assert.equal(t.merge(), false);
    assert.equal(t.authorize().success, false);
  } finally { t.cleanup(); }
});

test('manual worker lease revoke cannot regress a verified GitHub merge to pending', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
    assert.equal(t.merge(), true);
    assert.equal(t.db.revokeLease(t.ticketId, 'Completed worker cleanup'), true);
    assert.equal(t.db.isTokenRevoked(TOKEN_ID), true);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'COMMITTED_PUSHED');
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.rollbackCommit, MERGE);
  } finally { t.cleanup(); }
});

test('rollback can complete only after a recorded revert branch, draft PR and verified remote merge', () => {
  const t = setup();
  try {
    assert.equal(t.attest(), true);
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
    assert.equal(t.merge(), true);
    assert.equal(t.db.rollbackMerge(t.ticketId, 'Detected regression', 'Admin').success, true);
    const reserved = t.db.reserveVerifiedRollback(t.ticketId, 'acme/widgets');
    assert.equal(reserved.success, true, JSON.stringify(reserved));
    if (!reserved.success) return;
    assert.equal(reserved.mergedCommit, MERGE);
    assert.equal(reserved.baselineCommit, BASE);
    assert.deepEqual(reserved.changedFiles, ['src/safe.ts']);
    assert.equal(t.db.reserveVerifiedRollback(t.ticketId, 'acme/widgets').success, false,
      'Duplicate rollback preparation must not run');
    const prepared = {
      ticketId: t.ticketId, reservationId: reserved.reservationId,
      repo: 'acme/widgets', branch: reserved.branch,
      originalMergeSha: MERGE, baselineCommit: BASE,
      testedMergeTree: TREE, headSha: 'e'.repeat(40),
      revertedTree: 'f'.repeat(40), epochId: reserved.epochId
    };
    assert.equal(t.db.recordVerifiedGitRollback({
      ticketId: t.ticketId, repo: 'acme/widgets', prNumber: 77,
      branch: reserved.branch, headSha: prepared.headSha,
      originalMergeSha: MERGE, revertedTree: prepared.revertedTree,
      rollbackMergeSha: '9'.repeat(40), epochId: reserved.epochId
    }), false, 'No verified PR => no rollback completion');
    assert.equal(t.db.recordRollbackPrepared({ ...prepared, revertedTree: '' }), false);
    assert.equal(t.db.recordRollbackPrepared(prepared), true);
    assert.equal(t.db.getRollbackProposal(t.ticketId)?.status, 'BRANCH_PUSHED');
    assert.equal(t.db.reserveRollbackDraftPr(t.ticketId, reserved.reservationId), true);
    assert.equal(t.db.reserveRollbackDraftPr(t.ticketId, reserved.reservationId), false,
      'Concurrent PR creation cannot race');
    assert.equal(t.db.recordRollbackDraftPr(t.ticketId, reserved.reservationId,
      'acme/widgets', 77, reserved.branch, 'a'.repeat(40), prepared.revertedTree), false);
    assert.equal(t.db.recordRollbackDraftPr(t.ticketId, reserved.reservationId,
      'acme/widgets', 77, reserved.branch, prepared.headSha, prepared.revertedTree), true);
    assert.equal(t.db.getRollbackProposal(t.ticketId)?.status, 'DRAFT_PR');
    assert.equal(t.db.recordVerifiedGitRollback({
      ticketId: t.ticketId, repo: 'acme/widgets', prNumber: 78,
      branch: reserved.branch, headSha: prepared.headSha,
      originalMergeSha: MERGE, revertedTree: prepared.revertedTree,
      rollbackMergeSha: '9'.repeat(40), epochId: reserved.epochId
    }), false, 'Wrong PR number cannot certify rollback');
    const accepted = {
      ticketId: t.ticketId, repo: 'acme/widgets', prNumber: 77,
      branch: reserved.branch, headSha: prepared.headSha,
      originalMergeSha: MERGE, revertedTree: prepared.revertedTree,
      rollbackMergeSha: '9'.repeat(40), epochId: reserved.epochId
    };
    assert.equal(t.db.recordVerifiedGitRollback(accepted), true);
    assert.equal(t.db.recordVerifiedGitRollback(accepted), false, 'No duplicate rollback completion');
    const rolled = t.db.getAllTickets().find(x => x.id === t.ticketId);
    assert.equal(rolled?.status, 'ROLLBACK_COMPLETED');
    assert.equal(rolled?.rollbackCommit, '9'.repeat(40));
    assert.equal(t.db.getAuditLogs(50).filter(x => x.action === 'REMOTE_ROLLBACK_VERIFIED').length, 1);
  } finally { t.cleanup(); }
});

test('rollback requires a previously verified merged ticket and remains blocked when paused', () => {
  const t = setup();
  try {
    assert.equal(t.db.reserveVerifiedRollback(t.ticketId, 'acme/widgets').success, false);
    assert.equal(t.attest(), true);
    assert.equal(t.push(), true);
    assert.equal(t.draft(), true);
    assert.equal(t.authorize().success, true);
    assert.equal(t.merge(), true);
    assert.equal(t.db.rollbackMerge(t.ticketId, 'Failing suite').success, true);
    t.db.setKillSwitch(true, 'Emergency pause', 'Admin');
    assert.equal(t.db.reserveVerifiedRollback(t.ticketId, 'acme/widgets').success, false);
    assert.equal(t.db.getAllTickets().find(x => x.id === t.ticketId)?.status, 'ROLLBACK_REQUESTED');
  } finally { t.cleanup(); }
});
