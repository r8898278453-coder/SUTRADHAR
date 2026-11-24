import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseLeader,chooseBackups,firstElectionOpen,scopesOverlap,safeScope,LEASE_SECONDS,HEARTBEAT_SECONDS,validTaskBranch,isProtectedScope,parseContractKeys,contractReservationConflicts} from '../v7/rules.ts';
import {parseProviderMappings,declaredProviderMappings,providerRegistrySnapshot,verifyProviderRegistrySnapshot} from '../v7/provider_mappings.ts';
const day=Date.parse('2026-11-11T00:00:00Z');
const ts=(hour:number,minute=0)=>day+hour*3600000+minute*60000;
const candidate=(id:string,node:string,arrival:number,seen:number)=>({
  agent_id:id,node_id:node,arrival_id:arrival,last_seen_ms:seen,eligible:true
});
const empty={master_agent_id:null,lease_until_ms:null,bootstrapped:false,epoch:0,backup1:null,backup2:null};
test('v7 initial election opens at exactly 08:00 Asia/Kolkata',()=>{
  assert.equal(firstElectionOpen(ts(2,29)),false);
  assert.equal(firstElectionOpen(ts(2,30)),true);
  assert.equal(firstElectionOpen(ts(22,30)),false); // 04:00 following calendar day
});
test('v7 initial candidate before 08:00 is never elected',()=>{
  assert.equal(chooseLeader(empty,[candidate('first','n1',1,ts(2,29))],ts(2,29)),null);
});
test('v7 first eligible accepted arrival wins, uptime not used',()=>{
  const now=ts(2,31),arr=[candidate('late','n2',2,now),candidate('first','n1',1,now)];
  assert.equal(chooseLeader(empty,arr,now),'first');
});
test('v7 single healthy Master stays across all subsequent 8 AM times',()=>{
  const tomorrow=ts(2,30)+86400000;
  const ld={...empty,master_agent_id:'incumbent',lease_until_ms:tomorrow+50000,
    bootstrapped:true,epoch:35,backup1:'backup',backup2:null};
  assert.equal(chooseLeader(ld,[candidate('incumbent','n1',1,tomorrow),
    candidate('backup','n2',2,tomorrow)],tomorrow),'incumbent');
});
test('v7 expired Master promotes backup 1 before backup 2',()=>{
  const now=ts(4),ld={...empty,bootstrapped:true,epoch:7,
    master_agent_id:'master',lease_until_ms:now-1000,backup1:'b1',backup2:'b2'};
  const arr=[candidate('b2','n3',3,now),candidate('b1','n2',2,now),candidate('master','n1',1,now)];
  assert.equal(chooseLeader(ld,arr,now),'b1');
});
test('v7 backup 2 takes over when backup 1 is missing',()=>{
  const now=ts(4),ld={...empty,bootstrapped:true,epoch:4,
    // Central persists old node even after the Master is absent from
    // the candidate JOIN; this is mandatory for safe node independence.
    master_agent_id:'master',master_node_id:'n1',
    lease_until_ms:now-1000,backup1:'b1',backup2:'b2'};
  const arr=[candidate('b1','n2',2,now-181000),candidate('b2','n3',3,now)];
  assert.equal(chooseLeader(ld,arr,now),'b2');
});
test('v7 rejects stale and revoked candidates',()=>{
  const now=ts(4);
  const old=candidate('old','n1',1,now-190000);
  const revoked={...candidate('bad','n2',2,now),eligible:false};
  assert.equal(chooseLeader({...empty,bootstrapped:true},[old,revoked],now),null);
});
test('v7 return of former Master does not preempt live successor',()=>{
  const now=ts(4),ld={...empty,bootstrapped:true,epoch:18,
    master_agent_id:'successor',lease_until_ms:now+100000,backup1:'former'};
  assert.equal(chooseLeader(ld,[candidate('former','n1',1,now),
    candidate('successor','n2',2,now)],now),'successor');
});
test('v7 backups prefer physically distinct machines',()=>{
  const now=ts(4),arr=[candidate('master','n1',1,now),candidate('a','n1',2,now),
    candidate('b','n2',3,now),candidate('c','n3',4,now)];
  assert.deepEqual(chooseBackups('master',arr,now),['b','c']);
});
test('v7 never promotes an independent backup from the Master PC',()=>{
  const now=ts(4),arr=[candidate('master','n1',1,now),
    candidate('a','n1',2,now),candidate('b','n1',3,now)];
  assert.deepEqual(chooseBackups('master',arr,now),[null,null],
    'One physical PC with three agents is not three failover PCs');
  const expired={...empty,bootstrapped:true,epoch:5,
    master_agent_id:'master',master_node_id:'n1',lease_until_ms:now-1000,
    backup1:'a',backup2:'b'};
  assert.equal(chooseLeader(expired,arr,now),null,
    'Fake same-node backup must never be promoted after Master expiry');
});
test('v7 keeps backup slots vacant rather than duplicating a physical node',()=>{
  const now=ts(4),arr=[candidate('master','n1',1,now),
    candidate('a','n1',2,now),candidate('one','n2',3,now),
    candidate('two','n2',4,now)];
  assert.deepEqual(chooseBackups('master',arr,now),['one',null]);
  const withThird=[...arr,candidate('three','n3',5,now)];
  assert.deepEqual(chooseBackups('master',withThird,now),['one','three']);
});
test('v7 refuses same-PC backup when old Master is revoked or missing from candidates',()=>{
  const now=ts(4);
  const lost={...empty,bootstrapped:true,master_agent_id:'master',
    master_node_id:'n1',lease_until_ms:now-1000,backup1:'same_pc',
    backup2:'different_pc'};
  assert.equal(chooseLeader(lost,[candidate('same_pc','n1',2,now),
    candidate('different_pc','n2',3,now)],now),'different_pc');
  assert.equal(chooseLeader({...lost,backup2:null},
    [candidate('same_pc','n1',2,now)],now),null);
  assert.equal(chooseLeader({...lost,master_node_id:null},
    [candidate('same_pc','n1',2,now),candidate('different_pc','n2',3,now)],now),
    null,'Unverifiable previous Master machine must fail closed');
});

test('v7 NO_MASTER recovery cannot rebootstrap the former PC',()=>{
  const now=ts(4),oldNode='n1';
  const waiting={...empty,bootstrapped:true,epoch:32,
    recovery_requires_independent_node:true,
    recovery_excluded_node_id:oldNode};
  const candidates=[candidate('old_master','n1',1,now),
    candidate('sibling','n1',2,now)];
  assert.equal(chooseLeader(waiting,candidates,now),null,
    'Repeated heartbeats from old PC cannot clear NO_MASTER');
  assert.equal(chooseLeader({...waiting,recovery_excluded_node_id:null},[
    ...candidates,candidate('independent','n2',3,now)],now),null,
    'Missing durable previous-node proof must block all promotion');
  assert.equal(chooseLeader(waiting,[
    ...candidates,candidate('independent','n2',3,now)],now),'independent');
});
test('v7 blocked pre-bootstrap election after midnight until 08:00 IST',()=>{
  const now=ts(20);
  assert.equal(chooseLeader(empty,[candidate('first','n1',1,now)],now),null); // 01:30 IST next day
});
test('v7 scope overlap blocks path prefix conflicts, not similar names',()=>{
  assert.equal(scopesOverlap('src/a.ts','src/a.ts'),true);
  assert.equal(scopesOverlap('src','src/a.ts'),true);
  assert.equal(scopesOverlap('src/a','src/ab'),false);
});
test('v7 scope validation excludes traversal, secrets, root and backslash',()=>{
  for(const s of ['/etc/passwd','../secret','.env','src/../secret','src//a','src\\x','node_modules/x','.git/config'])
    assert.equal(safeScope(s),false,s);
  for(const s of ['src/a.ts','contracts/auth/one.ts','components/Button.tsx'])
    assert.equal(safeScope(s),true,s);
});
test('v7 liveness cadence remains 60s / suspicion threshold 180s',()=>{
  assert.equal(HEARTBEAT_SECONDS,60);assert.equal(LEASE_SECONDS,180);
});

test('v7 planned Git branches are publishable by the same read-only Git verifier',()=>{
  for(const valid of ['ai/ticket_alpha','ai/A-1_foo','ai/a.b-c_7'])
    assert.equal(validTaskBranch(valid),true,valid);
  for(const invalid of ['ai/a/b','ai/..','ai/.secret','ai/a..b','ai/a.lock',
    'ai/a.','ai/','main','release/x','worker-x/ticket-y',
    'ai/'+'x'.repeat(102),null,undefined])
    assert.equal(validTaskBranch(invalid),false,String(invalid));
});
test('task creator cannot downgrade protected Central, Desktop, signing or repo control paths',()=>{
  for(const scope of ['v7','v7/central.ts','core','migrations','apps',
    'apps/central/src','apps/desktop/main.cjs','sandbox/run_sandbox.sh',
    'scripts/release','scripts/ops/mysql-ops.cjs','packages/shared/contract.json',
    '.github/workflows/ci.yml','package.json','package-lock.json','server.ts',
    'github_merge_verifier.ts','.env.example','tsconfig.json'])
    assert.equal(isProtectedScope(scope),true,scope);
  for(const ordinary of ['src/feature.ts','tests/test_feature.ts',
    'docs/feature.md','app/desktopish.ts','packages-other/api.ts'])
    assert.equal(isProtectedScope(ordinary),false,ordinary);
  assert.equal(isProtectedScope('../escape'),true);
});


test('nested repo control files and package execution descriptors are never normal worker scopes',()=>{
  for(const s of [
    'src/.git','src/.git/config','src/.gitattributes','src/.gitmodules',
    'src/.lfsconfig','src/.env.production','src/.env',
    'src/node_modules/payload','src/package.json','src/package-lock.json',
    'components/.npmrc','tests/yarn.lock','features/pnpm-lock.yaml'
  ]){
    assert.equal(safeScope(s),false,s);
    assert.equal(isProtectedScope(s),true,s);
  }
  assert.equal(safeScope('src/.well-known/feature.ts'),true);
  assert.equal(safeScope('src/package-shaped.ts'),true);
});
test('backup selection excludes future-dated heartbeats just like Master election',()=>{
  const now=ts(4);
  assert.deepEqual(chooseBackups('master',[
    candidate('master','n1',1,now),
    candidate('future','n2',2,now+3600000),
    candidate('healthy','n3',3,now)
  ],now),['healthy',null]);
});

test('nested ignored-file and dependency runtime controls remain protected',()=>{
  for(const f of ['src/.gitignore','src/.yarnrc.yml','src/.pnp.cjs',
    'src/bun.lock','src/pyproject.toml','src/setup.py']){
    assert.equal(safeScope(f),false,f);
    assert.equal(isProtectedScope(f),true,f);
  }
  assert.equal(safeScope('src/normal-feature.ts'),true);
});

test('Windows aliases and case-insensitive scope reservations fail closed',()=>{
  for(const p of ['src/package.json.','src/.git.','src/name.','src/CON','src/nul.txt','src/COM1.ts','src/lpt9/file.ts','src/AUX.json'])assert.equal(safeScope(p),false,p);
  assert.equal(safeScope('src/concept.ts'),true);
  assert.equal(scopesOverlap('src/Feature.ts','SRC/feature.ts'),true);
  assert.equal(scopesOverlap('Src/Features','src/features/a.ts'),true);
  assert.equal(scopesOverlap('src/a','SRC/ab'),false);
});

test('provider registry is scoped to exact project and agent and never attests provider authorization',()=>{
  const binding={project_id:'project_alpha',agent_id:'agent_alpha',provider:'CHATGPT_WEB',
    account_ref:'account_operator',workspace_ref:'workspace_alpha'};
  const raw=JSON.stringify([binding,{...binding,agent_id:'agent_beta'}]);
  assert.equal(parseProviderMappings(raw).length,2);
  const result=declaredProviderMappings(raw,binding.project_id,binding.agent_id);
  assert.equal(result.length,1);
  assert.equal(result[0].state,'OWNER_DECLARED_UNVERIFIED');
  assert.equal(result[0].provider_mapping_verified,false);
  assert.equal(result[0].automatic_execution_allowed,false);
  assert.match(result[0].binding_sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(declaredProviderMappings(raw,binding.project_id,'agent_OTHER'),[]);
  assert.deepEqual(declaredProviderMappings(undefined,binding.project_id,binding.agent_id),[]);
  assert.deepEqual(declaredProviderMappings(raw,'PROJECT_ALPHA',binding.agent_id),[]);
  for(const invalid of [
    [binding,binding],
    [binding,{...binding,project_id:'project_beta'}],
    [binding,{...binding,agent_id:'agent_beta',workspace_ref:'workspace_beta'}],
    [{...binding,token:'sentinel'}],
    [{...binding,account_ref:'user@example.org'}],
    [{...binding,workspace_ref:'https://example.invalid/project'}],
    [{...binding,provider:'UNKNOWN'}]
  ])assert.throws(()=>parseProviderMappings(JSON.stringify(invalid)),/PROVIDER_MAPPING_(CONFIG_INVALID|CONFLICT)/);
  assert.throws(()=>parseProviderMappings(' '.repeat(16385)),/CONFIG_INVALID/);
});

test('declared shared contract keys are canonical, bounded and hierarchically exclusive',()=>{
  assert.deepEqual(parseContractKeys(['event:orders.created','api:orders']),['api:orders','event:orders.created']);
  assert.deepEqual(parseContractKeys([]),[]);
  assert.equal(parseContractKeys(undefined),null);
  for(const value of [null,'api:orders',['api:Orders'],['api:orders..create'],
    ['api:orders','api:orders.create'],['db:orders','db:orders'],['git:orders'],
    ['api:orders/create'],['api:orders '],Array.from({length:13},(_,i)=>'db:table'+i)])
    assert.throws(()=>parseContractKeys(value),/INVALID_TASK_CONTRACT_KEYS/);
  assert.equal(contractReservationConflicts(['api:orders'],['api:orders.create']),true);
  assert.equal(contractReservationConflicts(['api:orders.create'],['api:orders']),true);
  assert.equal(contractReservationConflicts(['api:orders'],['api:orders2']),false);
  assert.equal(contractReservationConflicts(['api:orders'],['db:orders']),false);
  assert.equal(contractReservationConflicts(null,['api:orders']),true);
  assert.equal(contractReservationConflicts(['api:orders'],null),true);
  assert.equal(contractReservationConflicts([],['api:orders']),false);
  assert.equal(contractReservationConflicts(null,null),false);
});

test('versioned provider registry snapshots are canonical and empty snapshot is explicit',()=>{
  const first={project_id:'project_alpha',agent_id:'agent_alpha',provider:'CHATGPT_WEB',account_ref:'account_alpha',workspace_ref:'workspace_alpha'};
  const second={...first,agent_id:'agent_beta'};
  const snapshot=providerRegistrySnapshot(1,[second,first]);
  assert.deepEqual(snapshot,providerRegistrySnapshot(1,[first,second]));
  assert.deepEqual(verifyProviderRegistrySnapshot(snapshot),snapshot);
  assert.notEqual(snapshot.registry_sha256,providerRegistrySnapshot(2,[first,second]).registry_sha256);
  const empty=providerRegistrySnapshot(2,[]);
  assert.deepEqual(verifyProviderRegistrySnapshot(empty).bindings,[]);
  for(const bad of [{...snapshot,version:2},{...snapshot,registry_sha256:'0'.repeat(64)},
    {...snapshot,extra:true},{...snapshot,bindings:[first]}])
    assert.throws(()=>verifyProviderRegistrySnapshot(bad),/PROVIDER_REGISTRY_INVALID/);
  for(const v of [0,-1,1.5,'1',Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>providerRegistrySnapshot(v,[]),/PROVIDER_REGISTRY_INVALID/);
  assert.throws(()=>providerRegistrySnapshot(1,[{...first,workspace_ref:'workspace_alpha\n'}]));
});
