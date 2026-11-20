'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const packaged=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/secure-agent.ts'),'utf8');
const developer=fs.readFileSync(path.resolve(__dirname,'../v7/agent.ts'),'utf8');
const central=fs.readFileSync(path.resolve(__dirname,'../v7/central.ts'),'utf8');

test('packaged OS-vault Master delegates recovery to identical fail-closed shared validator',()=>{
  assert.match(packaged,/import\s*\{verifyRecoverySnapshot\}\s*from\s*['"]\.\.\/\.\.\/v7\/recovery_validation\.ts['"]/);
  assert.match(developer,/import\s*\{verifyRecoverySnapshot\}/);
  assert.match(packaged,/const\s+manifest_sha256\s*=\s*verifyRecoverySnapshot\(data,epoch\)/);
  assert.doesNotMatch(packaged,/data\.events\.length\s*>=\s*300/);
  assert.doesNotMatch(packaged,/data\.tickets\.some\(/);
  assert.match(packaged,/manifest_sha256\s*\}\s*\)/);
});

test('packaged heartbeat is connectivity only and Central derives work from authoritative ledgers',()=>{
  assert.match(packaged,/status:'ONLINE'/);
  for(const match of ['AS active_ticket','AS has_work_lease','AS has_git_job',
    "entry.status==='BUSY'?'BUSY':'IDLE'"]){
    assert.ok(central.includes(match),match);
  }
  assert.match(central,/INVALID_AGENT_ACTIVITY/);
});

test('both developer and packaged agents independently verify same-node ownership after ID collision',()=>{
  for(const source of [packaged,developer]){
    assert.match(source,/import\s*\{verifyExistingAgentOnOwnNode\}/);
    assert.match(source,/verifyExistingAgentOnOwnNode\(own,state\.node_id,/);
    assert.doesNotMatch(source,/AGENT_ID_ALREADY_EXISTS['"]\)registered\.add/);
  }
  assert.match(packaged,/send\('GET','\/v7\/nodes\/me'\)/);
  assert.match(developer,/signedGet\('\/v7\/nodes\/me'\)/);
});

test('developer-only plaintext identity is fail-closed and never replaces the OS-vault packaged edge',()=>{
  assert.match(developer,/import\s*\{openDeveloperIdentity\}\s*from\s*['"]\.\/developer_identity\.ts['"]/);
  assert.match(developer,/openDeveloperIdentity\(home,agentNames\)/);
  assert.match(developer,/identitySession\.persistHeartbeat\(state\)/);
  assert.match(developer,/identitySession\.release\(\)/);
  assert.doesNotMatch(developer,/JSON\.parse\(fs\.readFileSync\(filename/);
  assert.doesNotMatch(packaged,/openDeveloperIdentity|developer_identity\.ts/);
  assert.match(packaged,/await bridge\('saveCounters',state\)/);
});
