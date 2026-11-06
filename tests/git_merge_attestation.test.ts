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
      patchSha256: hash, epochId: epoch, ...data
    });
  }
  return {
    db, ticketId, attest, merge,
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
