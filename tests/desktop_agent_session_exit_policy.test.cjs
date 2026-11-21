'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {classifyObservedAgentExit:decide}=
  require('../apps/desktop/agent-session-exit-policy.cjs');
const base={
  exitCode:1,signal:null,ownerHold:false,ownerStopRequested:false,
  appStopRequested:false,shuttingDown:false,
  vaultHealthy:true,holdInspectionHealthy:true
};
const call=changes=>decide({...base,...changes});
test('unrequested abnormal exit, signal or unknown zero signal never clears crash fence',()=>{
  for(const [exitCode,signal] of [[1,null],[null,'SIGTERM'],
    [0,'SIGTERM'],[null,null]]){
    const decision=call({exitCode,signal});
    assert.equal(decision.retire,false,JSON.stringify([exitCode,signal]));
    assert.equal(decision.reason,null);
  }
});
test('mere maintenance hold cannot retire even an observed clean exit',()=>{
  for(const exitCode of [0,1]){
    const decision=call({exitCode,ownerHold:true});
    assert.equal(decision.retire,false);
  }
});
test('explicit Owner isolation for exact child can retire only after observed exit',()=>{
  const observed=call({exitCode:null,signal:'SIGTERM',
    ownerHold:true,ownerStopRequested:true});
  assert.deepEqual(observed,
    {retire:true,reason:'OBSERVED_OWNER_MAINTENANCE_STOP'});
  assert.equal(call({exitCode:1,ownerStopRequested:true}).retire,false,
    'request without verified Owner hold does not grant retirement');
});
test('shutdown requires matching accepted stop request and running quit context',()=>{
  assert.equal(call({exitCode:1,shuttingDown:true}).retire,false);
  assert.equal(call({exitCode:1,appStopRequested:true}).retire,false);
  assert.deepEqual(call({exitCode:null,signal:'SIGTERM',
    shuttingDown:true,appStopRequested:true}),
    {retire:true,reason:'OBSERVED_APP_SHUTDOWN'});
  assert.equal(call({exitCode:1,ownerHold:true,shuttingDown:true,
    appStopRequested:true}).retire,false,
    'unrequested maintenance hold must not be bypassed by generic app quit');
});
test('observed natural clean zero exit still retains normal supervised restart',()=>{
  assert.deepEqual(call({exitCode:0}),
    {retire:true,reason:'CLEAN_EXIT'});
  for(const s of ['SIGTERM','SIGKILL']){
    assert.equal(call({exitCode:0,signal:s}).retire,false);
  }
});
test('vault corruption or inspection failure always dominates all stop reasons',()=>{
  for(const name of ['vaultHealthy','holdInspectionHealthy']){
    for(const change of [{exitCode:0},{ownerHold:true,ownerStopRequested:true},
      {shuttingDown:true,appStopRequested:true}]){
      assert.equal(call({...change,[name]:false}).retire,false);
    }
  }
});
test('malformed exit data fail closed rather than silently retiring the marker',()=>{
  for(const change of [{ownerStopRequested:1},{vaultHealthy:'yes'},
    {exitCode:'0'},{exitCode:-1},{signal:'not valid '.repeat(8)}])
    assert.throws(()=>call(change),/INVALID/);
});
test('packaged Main binds maintenance/shutdown retire paths to exact child event',()=>{
  const main=fs.readFileSync(path.resolve(__dirname,
    '../apps/desktop/main.cjs'),'utf8');
  const pkg=require('../apps/desktop/package.json');
  assert.ok(pkg.build.files.includes('agent-session-exit-policy.cjs'));
  assert.match(main,/expectedMaintenanceStopChild===spawnedAgent/);
  assert.match(main,/expectedQuitChild===spawnedAgent/);
  assert.match(main,/expectedMaintenanceStopChild=target;/);
  assert.match(main,/finally\s*\{\s*if\(expectedMaintenanceStopChild===target\)/);
  assert.match(main,/if\(target\.signalCode===null&&target\.kill\(\)===true\)\s*expectedQuitChild=target/);
  assert.match(main,/classifyObservedAgentExit\(\{/);
  assert.match(main,/if\(decision\.retire\)\s*\{\s*try\s*\{\s*finishObservedSession/);
  assert.match(main,/reason:decision\.reason/);
  assert.match(main,/if\(!decision\.retire\)\s*\{[\s\S]*?signer=null;/);
  assert.match(main,/if\(clean\|\|shuttingDown\|\|ownerHold\|\|holdInspectionFailed\)/);
  assert.match(main,/OS_VAULT_AGENT_SESSION_UNRECONCILED_OWNER_REVIEW/);
  assert.doesNotMatch(main,/ownerStop=ownerHold&&!holdInspectionFailed;/);
  assert.doesNotMatch(main,/clean\|\|ownerStop\|\|appStop/);
});
