'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),
  os=require('node:os'),path=require('node:path');
const {evaluateEvidence,hashFile}=require('../scripts/release/verify-owner-evidence-files.cjs');
const {GATES}=require('../scripts/release/verify-owner-acceptance.cjs');
const now=Date.parse('2026-11-20T12:00:00Z'),sha='a'.repeat(40);
const env={G0:'ci',G1:'hostinger-staging',G2:'hostinger-staging',
  G3:'windows-signer',G4:'physical-windows',G5:'physical-windows',
  G6:'physical-windows',G7:'owner-review'};
function setup(){
  // Resolve the Windows runner's temporary folder junction BEFORE creating
  // fixture artifacts. Evidence verification intentionally refuses redirecting
  // parent paths even when their final bytes are currently the same.
  const canonicalTemp=fs.realpathSync.native(os.tmpdir());
  const dir=fs.realpathSync.native(
    fs.mkdtempSync(path.join(canonicalTemp,'sut-owner-evidence-')));
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const pub=publicKey.export({format:'pem',type:'spki'});
  const artifacts=[],gates=[];
  for(const gate of GATES){
    const file=path.join(dir,gate+'.json');
    const content=JSON.stringify({test_only:true,gate,proof:'fixture-only'});
    fs.writeFileSync(file,content,{mode:0o600});
    artifacts.push({gate_id:gate,path:file});
    gates.push({gate_id:gate,status:'PASS',reviewer:'Independent Reviewer',
      reviewed_at_utc:new Date(now-1000).toISOString(),exact_git_sha:sha,
      environment:env[gate],evidence_location:'private://owner/'+gate,
      evidence_sha256:crypto.createHash('sha256').update(content).digest('hex'),
      test_case_ids:['TEST_'+gate],limitations:'This is a test-only fixture',
      owner_approval_reference:'private://approval/'+gate});
  }
  const payload={schema:1,source_sha:sha,issued_at_ms:now-60000,
    expires_at_ms:now+3600000,gates};
  const sign=()=>({payload,signature_base64:crypto.sign(null,
    Buffer.from('SUTRADHAR_OWNER_ACCEPTANCE_V1\n'+JSON.stringify(payload)),
    privateKey).toString('base64')});
  return {dir,pub,artifacts,payload,sign,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('exact eight local evidence file hashes match signed Owner index but never approve production',()=>{
  const c=setup();
  try{
    // Direct hash reader check isolates Windows filesystem API/alias failures.
    const fileProof=hashFile(c.artifacts[0].path);
    assert.equal(fileProof.sha256,c.payload.gates[0].evidence_sha256);
    const result=evaluateEvidence({envelope:c.sign(),
      ownerPublicKeyPem:c.pub,expectedSha:sha,
      artifacts:c.artifacts,now});
    assert.equal(result.accepted,true,JSON.stringify(result));
    assert.equal(result.verified_file_count,8);
    assert.equal(result.evidence_files_verified,true);
    assert.equal(result.evidence_facts_independently_verified,false);
    assert.equal(result.production_release_authorized,false);
    assert.equal(result.physical_windows_verified,false);
    assert.equal(result.hostinger_staging_verified,false);
    assert.ok(result.files.every(z=>z.sha256.length===64&&z.bytes>0));
  }finally{c.close();}
});
test('changed local file contents reject even when signed metadata remains valid',()=>{
  const c=setup();
  try{
    fs.writeFileSync(c.artifacts[3].path,'tampered content');
    const res=evaluateEvidence({envelope:c.sign(),ownerPublicKeyPem:c.pub,
      expectedSha:sha,artifacts:c.artifacts,now});
    assert.equal(res.accepted,false);
    assert.equal(res.production_release_authorized,false);
    assert.equal(res.evidence_files_verified,false);
  }finally{c.close();}
});
test('wrong Owner signature or exact candidate SHA rejected before touching files',()=>{
  const c=setup();
  try{
    const other=crypto.generateKeyPairSync('ed25519').publicKey.export({
      format:'pem',type:'spki'});
    for(const options of [{ownerPublicKeyPem:other},{expectedSha:'b'.repeat(40)}]){
      const res=evaluateEvidence({envelope:c.sign(),ownerPublicKeyPem:c.pub,
        expectedSha:sha,artifacts:c.artifacts,now,...options});
      assert.equal(res.accepted,false);
    }
  }finally{c.close();}
});
test('missing file, duplicate mapping or mismatched gate ID rejected',()=>{
  const c=setup();
  try{
    for(const modified of [
      c.artifacts.slice(0,7),
      c.artifacts.map((x,i)=>i===1?{...x,gate_id:'G0'}:x),
      c.artifacts.map((x,i)=>i===4?{...x,path:c.artifacts[0].path}:x),
      c.artifacts.map((x,i)=>i===6?{...x,path:path.join(c.dir,'missing')}:x)
    ]){
      const res=evaluateEvidence({envelope:c.sign(),ownerPublicKeyPem:c.pub,
        expectedSha:sha,artifacts:modified,now});
      assert.equal(res.accepted,false);
      assert.equal(res.production_release_authorized,false);
    }
  }finally{c.close();}
});
test('symlinks are rejected instead of following an untrusted evidence path',()=>{
  const c=setup();
  try{
    const alternate=path.join(c.dir,'shortcut');
    fs.symlinkSync(c.artifacts[0].path,alternate);
    assert.throws(()=>hashFile(alternate));
    const changed=c.artifacts.map((x,i)=>i===0?{...x,path:alternate}:x);
    const result=evaluateEvidence({envelope:c.sign(),ownerPublicKeyPem:c.pub,
      expectedSha:sha,artifacts:changed,now});
    assert.equal(result.accepted,false);
  }finally{c.close();}
});

test('offline Owner CLI reads immutable signed inputs and never issues production approval',()=>{
  const c=setup();
  try{
    const cp=require('node:child_process');
    const signed=path.join(c.dir,'owner-signed.json');
    const pubFile=path.join(c.dir,'owner-public.pem');
    const mapFile=path.join(c.dir,'evidence-map.json');
    fs.writeFileSync(signed,JSON.stringify(c.sign()),{mode:0o600});
    fs.writeFileSync(pubFile,c.pub,{mode:0o600});
    fs.writeFileSync(mapFile,JSON.stringify({schema:1,artifacts:c.artifacts}),
      {mode:0o600});
    const env={...process.env,
      SUTRADHAR_OWNER_ACCEPTANCE_FILE:signed,
      SUTRADHAR_OWNER_ACCEPTANCE_PUBLIC_KEY_FILE:pubFile,
      SUTRADHAR_OWNER_EVIDENCE_MAP_FILE:mapFile,
      SUTRADHAR_EXPECTED_COMMIT_SHA:sha};
    // Existing test proof was deliberately issued in November 2026; make the
    // CLI signing window current without changing test keys or real evidence.
    c.payload.issued_at_ms=Date.now()-60000;
    c.payload.expires_at_ms=Date.now()+3600000;
    for(const gate of c.payload.gates){
      gate.reviewed_at_utc=new Date(Date.now()-1000).toISOString();
    }
    fs.writeFileSync(signed,JSON.stringify(c.sign()),{mode:0o600});
    const acceptScript=path.resolve(__dirname,
      '../scripts/release/verify-owner-acceptance.cjs');
    const evidenceScript=path.resolve(__dirname,
      '../scripts/release/verify-owner-evidence-files.cjs');
    for(const script of [acceptScript,evidenceScript]){
      const processResult=cp.spawnSync(process.execPath,[script],{
        encoding:'utf8',timeout:12000,env});
      assert.equal(processResult.status,0,
        script+': '+processResult.stderr);
      const output=JSON.parse(processResult.stdout);
      assert.equal(output.accepted,true);
      assert.equal(output.production_release_authorized,false);
    }
    if(process.platform!=='win32'){
      const redirect=path.join(c.dir,'signed-symlink.json');
      fs.symlinkSync(signed,redirect);
      for(const script of [acceptScript,evidenceScript]){
        const refused=cp.spawnSync(process.execPath,[script],{
          encoding:'utf8',timeout:12000,
          env:{...env,SUTRADHAR_OWNER_ACCEPTANCE_FILE:redirect}});
        assert.notEqual(refused.status,0,script);
        assert.equal(refused.stdout.includes('production_release_authorized":true'),false);
      }
    }
  }finally{c.close();}
});
