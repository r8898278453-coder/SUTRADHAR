/** No configured credentials or disabled worker push may touch the Git remote. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { app, SUTRADHAR_ADMIN_KEY } from '../server.ts';

test('verified worker push endpoint denies anonymous, disabled and unconfigured calls', async () => {
  const keys = ['SUTRADHAR_ENABLE_WORKER_PUSH', 'SUTRADHAR_GITHUB_REPOSITORY',
    'SUTRADHAR_TARGET_REPO_ROOT', 'SUTRADHAR_GITHUB_PUSH_TOKEN'] as const;
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  delete process.env.SUTRADHAR_ENABLE_WORKER_PUSH;
  const server = http.createServer(app);
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/cluster/ticket/push-tested-branch`;
    const call = async (admin = true) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          ...(admin ? { Authorization: `Bearer ${SUTRADHAR_ADMIN_KEY}` } : {}) },
        body: JSON.stringify({ ticketId: 'TKT-SECURITY-NO-PUSH' })
      });
      return { status: response.status, body: await response.json() as any };
    };
    assert.equal((await call(false)).status, 401, 'Anonymous caller must never push');
    const disabled = await call();
    assert.equal(disabled.status, 503);
    assert.equal(disabled.body.error, 'WORKER_PUSH_DISABLED');
    process.env.SUTRADHAR_ENABLE_WORKER_PUSH = 'true';
    delete process.env.SUTRADHAR_GITHUB_REPOSITORY;
    delete process.env.SUTRADHAR_TARGET_REPO_ROOT;
    delete process.env.SUTRADHAR_GITHUB_PUSH_TOKEN;
    const missing = await call();
    assert.equal(missing.status, 503);
    assert.equal(missing.body.error, 'WORKER_PUSH_NOT_CONFIGURED');
    const reconcile = await fetch(url.replace('/push-tested-branch', '/reconcile-tested-branch'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUTRADHAR_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: 'TKT-SECURITY-NO-PUSH' })
    });
    assert.equal(reconcile.status, 503);
    assert.equal((await reconcile.json() as any).error, 'WORKER_PUSH_NOT_CONFIGURED');
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
