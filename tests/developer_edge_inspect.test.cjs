'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
  crypto=require('node:crypto'),cp=require('node:child_process');
const {inspectDeveloperEdgeDir}=require('../scripts/ops/developer-edge-inspect.cjs');
const fixture=()=>({
  node_id:'node_'+'a'.repeat(32),boot_id:'boot_'+'b'.repeat(32),
  private_key_pem:'SECRET_PEM_MUST_NOT_APPEAR_IN_INSPECTION',
  public_key_pem:'PRIVATE_METADATA_NOT_TO_EXPORT',
  node_sequence:34,agents:[{id:'agent_alpha',sequence:34},{id:'agent_beta',sequence:34}]
});
function inTemp(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-dev-inspector-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function write(dir,basename,bytes){
  fs.writeFileSync(path.join(dir,basename),bytes,{mode:0o600});
}
test('read-only inspector does not create an absent directory or grant restart',()=>{
  inTemp(dir=>{
    const absent=path.join(dir,'not-created');
    const r=inspectDeveloperEdgeDir(absent);
    assert.equal(r.state,'NOT_CONFIGURED');
    assert.equal(r.restart_authorized,false);
    assert.equal(fs.existsSync(absent),false);
    assert.equal(inspectDeveloperEdgeDir(dir).state,'NOT_ENROLLED');
  });
});
test('Owner sees only explicitly allowed public metadata; no PEM or lock token',()=>{
  inTemp(dir=>{
    const ident=fixture(),token=crypto.randomUUID();
    write(dir,'identity.json',JSON.stringify(ident));
    write(dir,'edge-owner.lock',JSON.stringify({
      schema:1,pid:12345,started_at:'2026-11-21T00:00:00.000Z',token}));
    write(dir,'status.json','{}');
    const before=new Map(fs.readdirSync(dir).map(n=>[n,fs.readFileSync(path.join(dir,n))]));
    const report=inspectDeveloperEdgeDir(dir);
    assert.equal(report.state,'LOCK_PRESENT_OWNER_REVIEW_REQUIRED');
    assert.equal(report.lock_present,true);
    assert.equal(report.lock.pid,12345);
    assert.equal(report.identity.node_sequence,34);
    assert.deepEqual(report.identity.agents.map(a=>a.agent_id),['agent_alpha','agent_beta']);
    for(const flag of ['restart_authorized','process_alive_verified',
      'central_verified','mutation_performed','private_key_exported',
      'production_release_authorized'])
      assert.equal(report[flag],false,flag);
    const output=JSON.stringify(report);
    for(const forbidden of [ident.private_key_pem,ident.public_key_pem,token,
      'private_key_pem','public_key_pem'])
      assert.equal(output.includes(forbidden),false);
    assert.deepEqual(fs.readdirSync(dir),[...before.keys()]);
    for(const [name,bytes] of before)
      assert.deepEqual(fs.readFileSync(path.join(dir,name)),bytes);
  });
});
test('unlocked identity is never treated as restart approval or Central proof',()=>{
  inTemp(dir=>{
    write(dir,'identity.json',JSON.stringify(fixture()));
    const report=inspectDeveloperEdgeDir(dir);
    assert.equal(report.state,'UNLOCKED_NOT_RESTART_AUTHORIZED');
    assert.equal(report.owner_review_required,true);
    assert.equal(report.restart_authorized,false);
  });
});
test('missing identity with old enrollment or outbox requires Owner review',()=>{
  for(const name of ['enrollment_requested','sealed_outbox.jsonl','status.json']){
    inTemp(dir=>{
      write(dir,name,'historical state');
      const report=inspectDeveloperEdgeDir(dir);
      assert.equal(report.state,'MISSING_IDENTITY_OWNER_REVIEW_REQUIRED');
      assert.deepEqual(report.residual_artifacts,[name]);
    });
  }
});
test('malformed metadata and insecure files fail closed without printing secrets',()=>{
  inTemp(dir=>{
    write(dir,'identity.json','this is not json');
    assert.throws(()=>inspectDeveloperEdgeDir(dir),/DEV_EDGE_INSPECT_IDENTITY_CORRUPT/);
  });
  inTemp(dir=>{
    write(dir,'identity.json',JSON.stringify({...fixture(),node_sequence:-1}));
    assert.throws(()=>inspectDeveloperEdgeDir(dir),/DEV_EDGE_INSPECT_IDENTITY_INVALID/);
  });
  inTemp(dir=>{
    write(dir,'identity.json',JSON.stringify(fixture()));
    write(dir,'edge-owner.lock','not-json');
    assert.throws(()=>inspectDeveloperEdgeDir(dir),/DEV_EDGE_INSPECT_LOCK_CORRUPT/);
  });
  inTemp(dir=>{
    write(dir,'identity.json',JSON.stringify(fixture()));
    write(dir,'edge-owner.lock',JSON.stringify({
      schema:1,pid:0,started_at:'2026-11-21T00:00:00.000Z',token:crypto.randomUUID()}));
    assert.throws(()=>inspectDeveloperEdgeDir(dir),/DEV_EDGE_INSPECT_LOCK_INVALID/);
  });
  if(process.platform!=='win32'){
    inTemp(dir=>{
      write(dir,'identity.json',JSON.stringify(fixture()));
      fs.chmodSync(path.join(dir,'identity.json'),0o644);
      assert.throws(()=>inspectDeveloperEdgeDir(dir),/DEV_EDGE_INSPECT_FILE_UNSAFE/);
    });
    inTemp(dir=>{
      fs.chmodSync(dir,0o755);
      assert.throws(()=>inspectDeveloperEdgeDir(dir),/DEV_EDGE_INSPECT_DIRECTORY_UNSAFE/);
    });
    inTemp(dir=>{
      const outside=path.join(dir,'original.json');
      write(dir,'original.json',JSON.stringify(fixture()));
      fs.symlinkSync(outside,path.join(dir,'identity.json'));
      assert.throws(()=>inspectDeveloperEdgeDir(dir),/DEV_EDGE_INSPECT_FILE_UNSAFE/);
    });
  }
});
test('CLI read-only success and error paths never echo key or token',()=>{
  inTemp(dir=>{
    const ident=fixture(),token=crypto.randomUUID();
    write(dir,'identity.json',JSON.stringify(ident));
    write(dir,'edge-owner.lock',JSON.stringify({
      schema:1,pid:99999,started_at:new Date().toISOString(),token}));
    const script=path.resolve(__dirname,'../scripts/ops/developer-edge-inspect.cjs');
    const args={env:{...process.env,SUTRADHAR_NODE_DIR:dir},
      encoding:'utf8',timeout:8000};
    const ok=cp.spawnSync(process.execPath,[script],args);
    assert.equal(ok.status,0,ok.stderr);
    assert.equal(JSON.parse(ok.stdout).state,'LOCK_PRESENT_OWNER_REVIEW_REQUIRED');
    for(const str of [ident.private_key_pem,ident.public_key_pem,token])
      assert.equal((ok.stdout+ok.stderr).includes(str),false);
    write(dir,'edge-owner.lock','corrupt');
    const bad=cp.spawnSync(process.execPath,[script],args);
    assert.equal(bad.status,2);
    assert.equal(JSON.parse(bad.stderr).error_code,'DEV_EDGE_INSPECT_LOCK_CORRUPT');
    assert.equal(bad.stderr.includes(token),false);
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),true);
  });
});
