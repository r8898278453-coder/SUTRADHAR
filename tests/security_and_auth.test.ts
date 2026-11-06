process.env.SUTRADHAR_TEST_RUN = 'true';
process.env.NODE_ENV = 'test';

import http from 'http';
import assert from 'assert';
import { 
  app, 
  SUTRADHAR_ADMIN_KEY, 
  SUTRADHAR_WORKER_KEY, 
  createAdminSession, 
  isTelegramAuthorized,
  generateEd25519Token,
  isDockerAvailable,
  clusterState
} from '../server.ts';
import { clusterDb } from '../server_db.ts';

async function runSecurityTestSuite() {
  console.log('================================================================');
  console.log('  SUTRADHAR SWARM — SECURITY & VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  // Start real ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const BASE_URL = `http://127.0.0.1:${port}`;

  async function apiRequest(method: string, path: string, headers: Record<string, string> = {}, body?: any) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TASK 2 — API AUTHENTICATION & RBAC
    // -------------------------------------------------------------
    console.log('--- TASK 2: API Authentication & Authorization Verification ---');

    await test('Unauthenticated admin request -> DENIED (401)', async () => {
      const res = await apiRequest('POST', '/api/cluster/kill-switch', {}, { action: 'PAUSE' });
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
      assert.ok(res.body.error?.includes('401_AUTHENTICATION_REQUIRED'));
    });

    await test('Forged x-sutradhar-role: ADMIN -> DENIED (401)', async () => {
      const res = await apiRequest(
        'POST', 
        '/api/cluster/kill-switch', 
        { 'x-sutradhar-role': 'ADMIN' }, 
        { action: 'PAUSE' }
      );
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
      assert.ok(res.body.error?.includes('401_AUTHENTICATION_REQUIRED'));
    });

    await test('Wrong credential -> DENIED (401)', async () => {
      const res = await apiRequest(
        'POST', 
        '/api/cluster/kill-switch', 
        { 'Authorization': 'Bearer wrong_invalid_secret_key' }, 
        { action: 'PAUSE' }
      );
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    });

    await test('Authorized admin request -> ALLOWED (200)', async () => {
      const res = await apiRequest(
        'POST', 
        '/api/cluster/kill-switch', 
        { 'Authorization': `Bearer ${SUTRADHAR_ADMIN_KEY}` }, 
        { action: 'RESUME' }
      );
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.strictEqual(res.body.success, true);
    });

    await test('Admin session login -> issues verified session token', async () => {
      const loginRes = await apiRequest('POST', '/api/auth/login', {}, { adminKey: SUTRADHAR_ADMIN_KEY });
      assert.strictEqual(loginRes.status, 200);
      assert.ok(loginRes.body.token?.startsWith('adm_sess_'));

      // Use session token
      const res = await apiRequest(
        'POST', 
        '/api/cluster/kill-switch', 
        { 'x-sutradhar-session': loginRes.body.token }, 
        { action: 'RESUME' }
      );
      assert.strictEqual(res.status, 200);
    });

    await test('Worker calling admin-only route -> DENIED (403_ADMIN_ONLY)', async () => {
      const res = await apiRequest(
        'POST', 
        '/api/cluster/kill-switch', 
        { 'Authorization': `Bearer ${SUTRADHAR_WORKER_KEY}` }, 
        { action: 'PAUSE' }
      );
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.ok(res.body.error?.includes('403_ADMIN_ONLY'));
    });

    await test('Read-only session modifying tickets -> DENIED (401)', async () => {
      const res = await apiRequest(
        'POST', 
        '/api/tickets/claim', 
        {}, 
        { workerId: 'NODE-A8F24C09', ticketId: 'TKT-104' }
      );
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    });

    await test('Worker calling allowed worker route -> ALLOWED (200 or business validation)', async () => {
      const res = await apiRequest(
        'POST', 
        '/api/tickets/claim', 
        { 'Authorization': `Bearer ${SUTRADHAR_WORKER_KEY}` }, 
        { workerId: 'NODE-A8F24C09', ticketId: 'TKT-104' }
      );
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });

    // -------------------------------------------------------------
    // TASK 3 — TELEGRAM AUTHORIZATION
    // -------------------------------------------------------------
    console.log('\n--- TASK 3: Telegram Security Verification ---');

    await test('Empty allowlists -> denies control commands', () => {
      const oldChatId = process.env.TELEGRAM_CHAT_ID;
      const oldAdminIds = process.env.TELEGRAM_ADMIN_USER_IDS;
      delete process.env.TELEGRAM_CHAT_ID;
      delete process.env.TELEGRAM_ADMIN_USER_IDS;

      const auth = isTelegramAuthorized('99999999', '123456');
      assert.strictEqual(auth.isApprovedChat, false, 'Expected isApprovedChat false when allowlist empty');
      assert.strictEqual(auth.isAdmin, false, 'Expected isAdmin false when allowlist empty');

      if (oldChatId) process.env.TELEGRAM_CHAT_ID = oldChatId;
      if (oldAdminIds) process.env.TELEGRAM_ADMIN_USER_IDS = oldAdminIds;
    });

    await test('Unauthorized sender in authorized group -> fails admin check', () => {
      process.env.TELEGRAM_CHAT_ID = '-100123456789';
      process.env.TELEGRAM_ADMIN_USER_IDS = '987654';

      // Authorized chat, but sender userId is 111111 (unauthorized)
      const auth = isTelegramAuthorized('-100123456789', '111111');
      assert.strictEqual(auth.isApprovedChat, true);
      assert.strictEqual(auth.isAdmin, false, 'Unauthorized sender must have isAdmin=false');

      // Authorized chat and authorized sender
      const adminAuth = isTelegramAuthorized('-100123456789', '987654');
      assert.strictEqual(adminAuth.isApprovedChat, true);
      assert.strictEqual(adminAuth.isAdmin, true);
    });

    // -------------------------------------------------------------
    // TASK 4 & 5 — DOCKER SANDBOX & REAL LLM
    // -------------------------------------------------------------
    console.log('\n--- TASK 4 & 5: Docker Sandbox & LLM Truth Verification ---');

    await test('Missing Docker in production mode -> returns SANDBOX_UNAVAILABLE', async () => {
      if (!isDockerAvailable()) {
        const oldEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const res = await apiRequest(
          'POST',
          '/api/cluster/ticket/test',
          { 'Authorization': `Bearer ${SUTRADHAR_ADMIN_KEY}` },
          { ticketId: 'TKT-104', isDemoMode: false }
        );
        process.env.NODE_ENV = oldEnv;
        assert.strictEqual(res.status, 503);
        assert.strictEqual(res.body.error, 'SANDBOX_UNAVAILABLE');
      } else {
        console.log('     (Docker is present on host, skipping unavailable assert)');
      }
    });

    await test('Passing test moves ticket to READY_FOR_REVIEW, never directly to COMMITTED_PUSHED', async () => {
      const res = await apiRequest(
        'POST',
        '/api/cluster/ticket/test',
        { 'Authorization': `Bearer ${SUTRADHAR_ADMIN_KEY}` },
        { ticketId: 'TKT-104', simulateFailure: false, isDemoMode: true }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ticket.status, 'READY_FOR_REVIEW', 'Expected status READY_FOR_REVIEW');
      assert.notStrictEqual(res.body.ticket.status, 'COMMITTED_PUSHED');
    });

    await test('Unconfigured LLM in production mode -> returns MODEL_UNAVAILABLE', async () => {
      const oldGemini = process.env.GEMINI_API_KEY;
      const oldOR = process.env.OPENROUTER_API_KEY;
      const oldEnv = process.env.NODE_ENV;
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      process.env.NODE_ENV = 'production';

      const dynTicketId = `TKT-LLM-${Date.now()}`;
      const newTkt: any = {
        id: dynTicketId,
        title: 'Test Ticket',
        description: 'Test',
        priority: 'P2_NORMAL',
        domain: 'Core',
        status: 'PENDING',
        parentTicketIds: [],
        allowedFiles: ['modules/core/Test.php'],
        readOnlyContracts: [],
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        logs: []
      };
      clusterDb.createTicket(newTkt);
      clusterState.tickets.push(newTkt);

      const res = await apiRequest(
        'POST',
        '/api/cluster/ticket/synthesize',
        { 'Authorization': `Bearer ${SUTRADHAR_ADMIN_KEY}` },
        { ticketId: dynTicketId, isDemoMode: false }
      );

      if (oldGemini) process.env.GEMINI_API_KEY = oldGemini;
      if (oldOR) process.env.OPENROUTER_API_KEY = oldOR;
      process.env.NODE_ENV = oldEnv;

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.error, 'MODEL_UNAVAILABLE');
    });

    // -------------------------------------------------------------
    // TASK 6, 8, 9, 12 — GATEKEEPER & ROLLBACK
    // -------------------------------------------------------------
    console.log('\n--- TASK 6, 8, 9, 12: Gatekeeper & Rollback Verification ---');

    await test('Revoked token push attempt -> DENIED (403_REVOKED_TOKEN)', async () => {
      const { tokenHeader, tokenId } = generateEd25519Token('TKT-104', 'NODE-A8F24C09', clusterState.epochId, ['modules/matrimony/ProfileController.php']);
      // Revoke token in SQLite
      clusterDb.revokeToken(tokenId, 'Security test revocation');

      const res = await apiRequest(
        'POST',
        '/api/cluster/ticket/verify-push',
        { 'Authorization': `Bearer ${SUTRADHAR_ADMIN_KEY}` },
        { ticketId: 'TKT-104', tokenHeader, branch: 'ai/TKT-104' }
      );
      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error?.includes('403_REVOKED_TOKEN'));
    });

    await test('Wrong worker heartbeat -> REJECTED (403_WRONG_WORKER)', async () => {
      const res = await apiRequest(
        'POST',
        '/api/cluster/watchdog/heartbeat',
        { 'Authorization': `Bearer ${SUTRADHAR_WORKER_KEY}` },
        { ticketId: 'TKT-104', workerId: 'NODE-IMPOSTER-999', progressPct: 50 }
      );
      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error?.includes('403_WRONG_WORKER'));
    });

    await test('Rollback transitions ticket to ROLLBACK_COMPLETED and spawns hotfix', async () => {
      const ticket106 = clusterState.tickets.find(t => t.id === 'TKT-106');
      if (ticket106) ticket106.rollbackCommit = 'd8471e9a';

      const res = await apiRequest(
        'POST',
        '/api/master/rollback',
        { 'Authorization': `Bearer ${SUTRADHAR_ADMIN_KEY}` },
        { ticketId: 'TKT-106', reason: 'Regression test failure', actor: 'Lead Admin' }
      );
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.hotfixTicket?.id?.startsWith('TKT-HOTFIX-'));
      assert.strictEqual(ticket106?.status, 'ROLLBACK_COMPLETED');
    });

  } finally {
    server.close();
  }

  console.log('\n================================================================');
  console.log(`[TEST SUMMARY] Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTestSuite().catch((err) => {
  console.error('Fatal in test suite:', err);
  process.exit(1);
});
