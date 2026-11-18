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
