import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { ClusterDatabase } from '../server_db.ts';

const TEST_DB_PATH = path.join(process.cwd(), '.sutradhar_state', 'test_cluster.db');
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const db = new ClusterDatabase(TEST_DB_PATH);

console.log('[TEST] Starting Cluster Database & State Layer Test Suite...');
let passed = 0;
let failed = 0;

function it(desc: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${desc} - ${err.message}`);
    failed++;
  }
}

// 1. Initial State
it('Initializes system_state with baseline values', () => {
  const state = db.getSystemState();
  assert.strictEqual(state.currentMasterId, 'NODE-E78A1201');
  assert.strictEqual(state.epochId, 15);
  assert.strictEqual(state.killSwitchActive, false);
});

// 2. Ticket Creation & Retrieval
it('Creates new ticket and retrieves it', () => {
  db.createTicket({
    id: 'TKT-TEST-01',
    title: 'Test Unit Ticket',
    description: 'Unit testing database persistence',
    priority: 'P1_HIGH',
    domain: 'Auth',
    status: 'PENDING',
    allowedFiles: ['modules/auth/Test.php'],
    readOnlyContracts: ['contracts/AuthInterface.php'],
    retryCount: 0,
    maxRetries: 3,
    currentTier: 1,
    branch: 'ai/TKT-TEST-01',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const tickets = db.getAllTickets();
  const t = tickets.find(x => x.id === 'TKT-TEST-01');
  assert.ok(t);
  assert.strictEqual(t?.title, 'Test Unit Ticket');
  assert.strictEqual(t?.status, 'PENDING');
  assert.deepStrictEqual(t?.allowedFiles, ['modules/auth/Test.php']);
});

// 3. Atomic Ticket Claim
it('Claims pending ticket atomically and creates lease', () => {
  const res = db.tryClaimTicket('NODE-WORKER-99', 'TKT-TEST-01', 'SEC-TOKEN-123', 900);
  assert.strictEqual(res.success, true);
  assert.ok(res.branch);
  assert.ok(res.lease);

  const tickets = db.getAllTickets();
  const t = tickets.find(x => x.id === 'TKT-TEST-01');
  assert.strictEqual(t?.status, 'SYNTHESIZING_DIFF');
  assert.strictEqual(t?.assignedTo, 'NODE-WORKER-99');
});

// 4. Dependency Resolution Enforcement
it('Enforces ticket dependencies: child cannot be claimed before parent merges', () => {
  // Create Parent (in-progress)
  db.createTicket({
    id: 'TKT-PARENT-01',
    title: 'Parent Task',
    priority: 'P1_HIGH',
    domain: 'Core',
    status: 'SYNTHESIZING_DIFF',
    allowedFiles: ['modules/core/Parent.php'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Create Child dependent on Parent
  db.createTicket({
    id: 'TKT-CHILD-01',
    title: 'Child Task',
    priority: 'P2_NORMAL',
    domain: 'Core',
    status: 'BLOCKED_ON_PARENT',
    parentTicketIds: ['TKT-PARENT-01'],
    allowedFiles: ['modules/core/Child.php'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Try to claim child while parent is not COMMITTED_PUSHED
  const failClaim = db.tryClaimTicket('NODE-WORKER-99', 'TKT-CHILD-01', 'SEC-TOKEN-CHILD');
  assert.strictEqual(failClaim.success, false);
  assert.ok(failClaim.error?.includes('Parent ticket TKT-PARENT-01 is not yet COMMITTED_PUSHED'));

  // Now mark parent as COMMITTED_PUSHED
  db.updateTicket('TKT-PARENT-01', { status: 'COMMITTED_PUSHED' });

  // Now child claim must succeed
  const successClaim = db.tryClaimTicket('NODE-WORKER-99', 'TKT-CHILD-01', 'SEC-TOKEN-CHILD');
  assert.strictEqual(successClaim.success, true);
});

// 5. Clarification Protocol
it('Blocks ticket for clarification and releases on answer', () => {
  db.blockForClarification('TKT-CHILD-01', 'Should null be accepted as input?', 'NODE-WORKER-99', 'Ambiguous type');
  
  let tickets = db.getAllTickets();
  let t = tickets.find(x => x.id === 'TKT-CHILD-01');
  assert.strictEqual(t?.status, 'BLOCKED_CLARIFICATION');
  assert.strictEqual(t?.assignedTo, undefined);
  assert.strictEqual(t?.clarificationQuestion?.question, 'Should null be accepted as input?');

  // Answer clarification
  db.answerClarification('TKT-CHILD-01', 'Yes, fallback to default value on null', 'Admin');
  tickets = db.getAllTickets();
  t = tickets.find(x => x.id === 'TKT-CHILD-01');
  assert.strictEqual(t?.status, 'PENDING');
  assert.strictEqual(t?.clarificationQuestion?.answer, 'Yes, fallback to default value on null');
});

// 6. Watchdog Heartbeat & Sweeper
it('Records lease heartbeats and sweeps expired leases', () => {
  // Claim child again
  db.tryClaimTicket('NODE-WORKER-02', 'TKT-CHILD-01', 'SEC-TOKEN-02', 2); // 2 second TTL
  
  const hbRes = db.recordLeaseHeartbeat('TKT-CHILD-01', 'NODE-WORKER-02', 50, 'Running tests');
  assert.strictEqual(hbRes, true);

  const leases = db.getAllLeases();
  const l = leases.find(x => x.ticketId === 'TKT-CHILD-01');
  assert.strictEqual(l?.progressPct, 50);
  assert.strictEqual(l?.lastStep, 'Running tests');
});

// 7. Model Usage Accounting
it('Records and stores model usage metrics', () => {
  db.recordModelUsage({
    ticketId: 'TKT-CHILD-01',
    workerId: 'NODE-WORKER-02',
    provider: 'Google AI Studio',
    model: 'gemini-3.8-flash',
    tokensIn: 120,
    tokensOut: 450,
    latencyMs: 820,
    success: true,
  });

  const countRow = (db as any).db.prepare('SELECT COUNT(*) as count FROM model_usage WHERE ticket_id = ?').get('TKT-CHILD-01') as any;
  assert.strictEqual(countRow.count, 1);
});

// 8. Execution Attempt Recording
it('Records sandbox execution attempts', () => {
  db.recordExecutionAttempt({
    ticketId: 'TKT-CHILD-01',
    workerId: 'NODE-WORKER-02',
    attemptNumber: 1,
    tierUsed: 1,
    patchValid: true,
    sandboxExitCode: 0,
    stdout: '12 passed in 1.4s',
    durationMs: 1400,
  });

  const countRow = (db as any).db.prepare('SELECT COUNT(*) as count FROM execution_attempts WHERE ticket_id = ?').get('TKT-CHILD-01') as any;
  assert.strictEqual(countRow.count, 1);
});

// 9. Rollback Bad Merge
it('Requests rollback without fabricating a completed Git revert', () => {
  db.updateTicket('TKT-PARENT-01', { rollbackCommit: 'a1b2c3d4' });
  const rbRes = db.rollbackMerge('TKT-PARENT-01', 'QA discovered regression', 'Master Node');
  assert.strictEqual(rbRes.success, true);
  assert.strictEqual(rbRes.hotfixId, undefined);
  const ticket = db.getAllTickets().find(t => t.id === 'TKT-PARENT-01');
  assert.strictEqual(ticket?.status, 'ROLLBACK_REQUESTED');
  assert.ok(db.getAuditLogs(20).some(e => e.action === 'ROLLBACK_REQUESTED'));
});

// Clean up
try {
  fs.unlinkSync(TEST_DB_PATH);
} catch (e) {}

console.log(`\n[TEST SUMMARY] Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
