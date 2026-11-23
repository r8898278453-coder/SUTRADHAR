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

test('packaged child uses capped response parser, never unbounded Response.json()',()=>{
  assert.match(packaged,/require\('\.\/agent-central-http\.cjs'\)/);
  assert.match(packaged,/await agentCentralRequest\(/);
  assert.doesNotMatch(packaged,/await res\.json\(\)/);
  assert.match(packaged,/body:method==='POST'\?body:undefined/);
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

test('Owner and physical-pilot cluster GET is observation-only; never triggers Master election',()=>{
  const route=central.match(/app\.get\('\/v7\/cluster',jsonRoute\(async req=>\{([\s\S]*?)\n\}\)\);/);
  assert.ok(route,'Owner status route must remain explicit and testable');
  assert.match(route[1],/admin\(req\)/);
  assert.match(route[1],/leader\(c,false\)/);
  assert.doesNotMatch(route[1],/\bevaluate\s*\(/,
    'GET status must never change epoch, Master or lease state');
  assert.doesNotMatch(route[1],/\b(?:UPDATE|INSERT|DELETE)\b/i,
    'GET status must not write MySQL');
});

test('signed cluster-state GET and Owner STATUS cannot elect or fence Master',()=>{
  const signed=central.match(/app\.get\('\/v7\/cluster\/state',jsonRoute\(async req=>\{([\s\S]*?)\n\}\)\);/);
  assert.ok(signed,'Signed cluster state route must exist');
  assert.match(signed[1],/nodeAuth\(req\)/);
  assert.match(signed[1],/leader\(c,false\)/);
  assert.doesNotMatch(signed[1],/\bevaluate\s*\(/);
  const owner=central.match(/async function ownerCommand[\s\S]*?if\(command==='STATUS'\)\s*result=\{cluster:ld\}/);
  assert.ok(owner,'Owner STATUS must only return the current leader snapshot');
  assert.doesNotMatch(owner[0],/evaluate\(c,'owner-read'\)/);
});

test('failed packaged OS-vault counter commits are terminal and parent never auto-restarts',()=>{
  const main=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/main.cjs'),'utf8');
  const vault=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/os-vault.cjs'),'utf8');
  assert.match(packaged,/try\{await bridge\('saveCounters',state\);\}/);
  assert.match(packaged,/catch\{throw Error\('OS_VAULT_COUNTER_COMMIT_UNCERTAIN_OWNER_REVIEW'\);\}/);
  assert.match(packaged,/if\(e\?\.message==='OS_VAULT_COUNTER_COMMIT_UNCERTAIN_OWNER_REVIEW'\)/);
  assert.match(packaged,/throw e;\s*\}\s*privateStatus\(state,/);
  assert.match(main,/if\(msg\.op==='saveCounters'\)\s*\{[\s\S]*?vaultError='OS_VAULT_COUNTER_COMMIT_UNCERTAIN_OWNER_REVIEW'/);
  assert.match(main,/if\(shuttingDown\|\|vaultError\)return/);
  assert.match(main,/const clean=exitCode===0&&!signal/);
  assert.match(main,/if\(!clean\)\{[\s\S]*?vaultError='OS_VAULT_AGENT_CRASH_OWNER_REVIEW_REQUIRED'/);
  assert.match(main,/vaultError='OS_VAULT_AGENT_CRASH_OWNER_REVIEW_REQUIRED'/);
  assert.match(main,/vaultError='OS_VAULT_COUNTER_COMMIT_UNCERTAIN_OWNER_REVIEW';\s*signer=null/);
  assert.match(main,/vaultError='OS_VAULT_AGENT_CRASH_OWNER_REVIEW_REQUIRED';\s*signer=null/);
  assert.match(main,/if\(vaultError\)throw Error\(vaultError\)/);
  assert.match(vault,/identity\.osvault\.write-intent/);
  assert.match(vault,/fs\.openSync\(intent,[\s\S]*?fs\.fsyncSync\(intentFd\)/);
  assert.match(vault,/fs\.unlinkSync\(intent\)/);
  assert.match(vault,/if\(poisoned\)throw Error\('OS_VAULT_WRITE_COMMIT_UNCERTAIN_OWNER_REVIEW'\)/);
});

test('every packaged agent node POST signing route has a narrow child payload contract',()=>{
  const bridge=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/vault-bridge.cjs'),'utf8');
  assert.match(packaged,/agent_id:agent\.id,capabilities:\{\s*engine:'BROWSER_ASSISTED',platform:process\.platform,secure_identity:true/);
  assert.match(packaged,/request_id:'recovery_'\+epoch\+'_'\+masterId,agent_id:masterId/);
  assert.match(packaged,/expected_master_epoch:epoch,manifest_sha256/);
  assert.match(bridge,/if\(uri==='\/v7\/agents\/register'\)/);
  assert.match(bridge,/packet\.capabilities\.secure_identity!==true/);
  assert.match(bridge,/!v\.agents\.some\(a=>a\.id===packet\.agent_id\)/);
  assert.match(bridge,/uri==='\/v7\/leadership\/reconcile'/);
  assert.match(bridge,/packet\.request_id!==[\s\S]*?'recovery_'\+packet\.expected_master_epoch\+'_'\+packet\.agent_id/);
  assert.match(bridge,/VAULT_NODE_POST_CONTRACT_DENIED/);
  assert.match(bridge,/packet\.boot_id!==v\.boot_id/);
});

test('packaged Main durably fences sessions before spawn and blocks orphaned signing after relaunch',()=>{
  const main=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/main.cjs'),'utf8');
  const pkg=require('../apps/desktop/package.json');
  assert.ok(pkg.build.files.includes('agent-session-fence.cjs'));
  assert.match(main,/requireNoAgentSession\(\{dir:nodeDir\(\)\}\)/);
  assert.match(main,/session=beginAgentSession\(\{dir:nodeDir\(\)\}\);[\s\S]*?agent=spawn\(/);
  assert.match(main,/OS_VAULT_AGENT_LAUNCH_UNCERTAIN_OWNER_REVIEW/);
  assert.match(main,/catch\{[\s\S]*?signer=null;[\s\S]*?throw Error\(vaultError\)/);
  assert.match(main,/finishObservedSession\(\{dir:nodeDir\(\),session_id:session\.session_id,/);
  assert.match(main,/if\(!clean\)\{[\s\S]*?vaultError='OS_VAULT_AGENT_CRASH_OWNER_REVIEW_REQUIRED'/);
  assert.match(main,/if\(shuttingDown\|\|vaultError\)return/);
  assert.match(main,/event\.preventDefault\(\)/);
  assert.match(main,/target\.once\('exit',finish\)/);
});

test('crash diagnostics remain a read-only local Owner inspection without signer or filesystem repair',()=>{
  const main=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/main.cjs'),'utf8');
  const preload=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/preload.cjs'),'utf8');
  const setup=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/setup.js'),'utf8');
  const html=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/setup.html'),'utf8');
  const pkg=require('../apps/desktop/package.json');
  const diag=fs.readFileSync(path.resolve(__dirname,'../apps/desktop/agent-crash-evidence.cjs'),'utf8');
  assert.ok(pkg.build.files.includes('agent-crash-evidence.cjs'));
  assert.match(main,/ipcMain\.handle\('sutradhar:inspectAgentCrashEvidence'/);
  assert.match(main,/if\(agent\)[\s\S]*?AGENT_CRASH_DIAGNOSTIC_CHILD_EXIT_UNCONFIRMED/);
  assert.match(preload,/inspectAgentCrashEvidence:\(\)=>ipcRenderer\.invoke/);
  assert.match(setup,/get\('inspectCrashEvidence'\)\.addEventListener/);
  assert.match(html,/id="inspectCrashEvidence"/);
  assert.match(diag,/agent_restart_allowed:false/);
  assert.match(diag,/marker_removal_allowed:false/);
  assert.doesNotMatch(diag,/unlinkSync|renameSync|writeFileSync|\.sign\(|fetch\(/);
});
