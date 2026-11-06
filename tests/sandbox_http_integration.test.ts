/**
 * Actual HTTP -> Git snapshot -> scoped patch -> Docker -> SQLite integration.
 * Run only where Docker is installed: npm run test:sandbox-http
 * This test never mocks a container or fabricates a Git SHA.
 */
process.env.NODE_ENV = 'test';
process.env.SUTRADHAR_TEST_RUN = 'true';

import * as assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { app, SUTRADHAR_ADMIN_KEY, clusterState } from '../server.ts';
import { clusterDb } from '../server_db.ts';
import type { Ticket } from '../src/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sutradhar-http-e2e-'));
const testRepo = path.join(tempRoot, 'target');
fs.mkdirSync(testRepo);
function git(...args: string[]) {
  return childProcess.execFileSync('git', args, { cwd: testRepo, encoding: 'utf8' });
}
git('init', '-q');
git('config', 'user.name', 'Sutradhar E2E');
git('config', 'user.email', 'sandbox@local.invalid');
fs.mkdirSync(path.join(testRepo, 'tests'));
fs.writeFileSync(path.join(testRepo, 'value.txt'), 'OLD\n');
fs.writeFileSync(path.join(testRepo, 'tests', 'test_value.py'),
  "from pathlib import Path\n\ndef test_value():\n    assert Path('/workspace/value.txt').read_text() == 'NEW\\n'\n");
fs.writeFileSync(path.join(testRepo, '.env.example'), 'DUMMY_VALUE=placeholder\n');
git('add', '-A');
git('commit', '-q', '-m', 'fixture baseline');

function patchFor(replacement: string): string {
  const target = path.join(testRepo, 'value.txt');
  fs.writeFileSync(target, replacement + '\n');
  const diff = git('diff', '--', 'value.txt');
  git('checkout', '--', 'value.txt');
  return diff;
}

function makeTicket(diffPatch: string, allowedFiles: string[] = ['value.txt']): Ticket {
  const id = 'TKT-DOCKER-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id,
    title: 'HTTP Docker integration',
    description: 'Verify actual candidate patch in isolated runner',
    priority: 'P2_NORMAL',
    domain: 'Core',
    status: 'TESTING_SANDBOX',
    allowedFiles,
    readOnlyContracts: [],
    parentTicketIds: [],
    branch: `ai/${id}`,
    retryCount: 0,
    maxRetries: 3,
    currentTier: 1,
    diffPatch,
    createdAt: now,
    updatedAt: now,
    logs: []
  };
  clusterDb.createTicket(ticket);
  assert.ok(clusterDb.getAllTickets().some(x => x.id === ticket.id), 'Fixture ticket must be persisted');
  clusterState.tickets.unshift(ticket);
  return ticket;
}

process.env.SUTRADHAR_TARGET_REPO_ROOT = testRepo;
process.env.SUTRADHAR_SANDBOX_TEST_COMMAND = 'python3 -m pytest -q';

async function main() {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
  const base = `http://127.0.0.1:${address.port}`;

  async function testTicket(ticket: Ticket, extraBody: Record<string, unknown> = {}) {
    const response = await fetch(base + '/api/cluster/ticket/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUTRADHAR_ADMIN_KEY}`
      },
      body: JSON.stringify({ ticketId: ticket.id, ...extraBody })
    });
    return { status: response.status, data: await response.json() as any };
  }

  try {
    // The API may only mark a real passing Docker test ready for review, never merged.
    const success = makeTicket(patchFor('NEW'));
    const first = await testTicket(success, { simulateFailure: true, isDemoMode: true });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.status, 'TEST_PASSED');
    assert.equal(first.data.exitCode, 0);
    assert.equal(success.status, 'READY_FOR_REVIEW');
    assert.notEqual(success.status, 'COMMITTED_PUSHED');
    assert.deepEqual(first.data.evidence.changedFiles, ['value.txt']);
    assert.match(first.data.evidence.candidateTreeSha, /^[0-9a-f]{40}$/);
    assert.equal(clusterDb.getSandboxAttestation(success.id)?.candidateTreeSha, first.data.evidence.candidateTreeSha);
    assert.equal(first.data.evidence.patchSha256, crypto.createHash('sha256').update(success.diffPatch!).digest('hex'));
    assert.ok((success.testStdout || '').includes('__SUTRADHAR_CONTAINER_TEST_STARTED__'));
    assert.equal(clusterDb.getAllTickets().find(x => x.id === success.id)?.status, 'READY_FOR_REVIEW');

    // Real pytest failure should preserve actual stderr and transition to healing.
    const failing = makeTicket(patchFor('BAD'));
    const second = await testTicket(failing);
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.status, 'TEST_FAILED');
    assert.notEqual(second.data.exitCode, 0);
    assert.equal(failing.status, 'HEALING_RETRY');
    assert.equal(failing.retryCount, 1);
    assert.equal(clusterDb.getAllTickets().find(x => x.id === failing.id)?.status, 'HEALING_RETRY');

    // Same valid diff but unauthorized file whitelist must never invoke success.
    const forbidden = makeTicket(patchFor('NEW'), ['other-file.txt']);
    const third = await testTicket(forbidden);
    assert.equal(third.status, 422, JSON.stringify(third.data));
    assert.equal(third.data.error, 'PATCH_REJECTED');
    assert.equal(forbidden.status, 'TESTING_SANDBOX');

    console.log('[HTTP DOCKER INTEGRATION] Real pass, real failure, and scope denial verified.');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
