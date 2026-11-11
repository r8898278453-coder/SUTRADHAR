/**
 * Post-build safety and compatibility checks: app boundaries and source SHA.
 * Does not assert production readiness or perform deployment.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const central=path.join(root,'apps','central','dist');
const desktop=path.join(root,'apps','desktop','dist');
const get=rel=>path.join(root,rel);
const exists=rel=>fs.existsSync(get(rel));
const json=rel=>JSON.parse(fs.readFileSync(get(rel),'utf8'));
const sha=rel=>crypto.createHash('sha256').update(fs.readFileSync(get(rel))).digest('hex');
const contract=json('packages/shared/contract.json');
const cm=json('apps/central/dist/release-manifest.json');
const dm=json('apps/desktop/dist/release-manifest.json');
assert.equal(contract.api_protocol,7);
assert.equal(contract.heartbeat_interval_seconds,60);
assert.equal(contract.stale_after_seconds,180);
assert.equal(contract.initial_master_election_timezone,'Asia/Kolkata');
assert.equal(cm.application,'central');assert.equal(dm.application,'desktop');
assert.equal(cm.api_protocol,dm.api_protocol);
assert.equal(dm.api_protocol,contract.api_protocol);
assert.equal(cm.production_approved,false);
assert.equal(dm.production_approved,false);
assert.equal(dm.installer_signed,false);
assert.equal(dm.identity_os_vault_protected,false);
assert.equal(cm.status,'ALPHA_UNAPPROVED');
assert.equal(dm.status,'ALPHA_UNAPPROVED');
for(const rel of [
  'apps/central/dist/server.cjs',
  'apps/central/dist/index.html',
  'apps/central/dist/app.css',
  'apps/central/dist/dashboard.js',
  'apps/central/dist/v7/schema.sql',
  'apps/desktop/dist/edge-agent.cjs',
  'apps/desktop/dist/edge-worker.cjs',
  'apps/desktop/contract.json',
  'apps/desktop/main.cjs',
  'apps/desktop/preload.cjs',
  'apps/desktop/setup.html',
  'apps/desktop/setup.js',
  'apps/desktop/status.cjs'
]){
  assert(exists(rel),'Missing application build file: '+rel);
}
for(const rel of [
  'apps/central/dist/edge-agent.cjs','apps/central/dist/edge-worker.cjs',
  'apps/central/dist/identity.json',
  'apps/desktop/dist/server.cjs','apps/desktop/dist/schema.sql',
  'apps/desktop/dist/index.html',
])assert(!exists(rel),'Cross-app packaging boundary violation: '+rel);
assert.equal(cm.bundle_sha256,sha('apps/central/dist/server.cjs'));
assert.equal(cm.schema_sha256,sha('apps/central/dist/v7/schema.sql'));
assert.equal(dm.agent_bundle_sha256,sha('apps/desktop/dist/edge-agent.cjs'));
assert.equal(dm.worker_bundle_sha256,sha('apps/desktop/dist/edge-worker.cjs'));
assert.equal(fs.readFileSync(path.join(desktop,'release-manifest.json'),'utf8').includes('SUTRADHAR_ADMIN_KEY'),false);
for(const rel of ['apps/central/dist/server.cjs',
  'apps/desktop/dist/edge-agent.cjs',
  'apps/desktop/main.cjs',
  'apps/desktop/preload.cjs',
  'apps/desktop/setup.js',
  'apps/desktop/desktop-config.cjs',
  'apps/desktop/status.cjs',
  'apps/desktop/pack-qa.cjs']){
  cp.execFileSync(process.execPath,['--check',get(rel)],{stdio:'pipe',timeout:20000});
}
console.log('Separate Central/Desktop alpha bundles verified (not production accepted).');
