'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {recordInspection,receiptPath}=require('../apps/desktop/update-inspection-journal.cjs');

function fixture(){
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  const node={node_id:'node_'+'a'.repeat(32),
    private_key_pem:privateKey.export({format:'pem',type:'pkcs8'}).toString(),
    public_key_pem:publicKey.export({format:'pem',type:'spki'}).toString()};
  const now=Date.parse('2026-11-15T12:00:00Z');
  const signed={schema:2,version:'7.1.0',type:'update',
    source_sha:'b'.repeat(40),installer_sha256:'c'.repeat(64),
    expires_ms:now+600000,rollout:{wave_id:'wave_pilot01',node_ids:[node.node_id]}};
  const envelope={signed,signature_base64:'owner-signature-was-verified-upstream'};
  const verified={accepted:true,version:signed.version,source_sha:signed.source_sha,
    file_sha256:signed.installer_sha256,wave_id:signed.rollout.wave_id,
    device_node_id:node.node_id,requires_windows_authenticode:true,automatic_install:false};
  return {node,now,envelope,verified,centralOrigin:'https://stage.example.com',
    currentVersion:'7.0.0',authenticodeVerified:true};
}
function withDir(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-release-receipt-'));
  try{return run(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('locally inspected offer generates one node-signed NOT INSTALLED receipt',()=>{
  withDir(dir=>{
    const args={dir,...fixture()};
    const first=recordInspection(args);
    assert.equal(first.recorded,true);
    assert.equal(first.previously_inspected,false);
    assert.equal(first.installed,false);
    assert.equal(first.owner_install_approval,false);
    const target=receiptPath(dir,first.receipt_id);
    const raw=fs.readFileSync(target,'utf8');
    assert.equal(raw.includes('PRIVATE KEY'),false);
    assert.equal(raw.includes('owner-signature-was-verified-upstream'),false);
    const value=JSON.parse(raw);
    assert.equal(value.payload.status,'OFFLINE_INSPECTED_ONLY');
    assert.equal(value.payload.installed,false);
    assert.equal(value.payload.wave_id,'wave_pilot01');
    assert.equal(value.payload.node_id,args.node.node_id);
    const pub=crypto.createPublicKey(args.node.public_key_pem);
    assert.equal(crypto.verify(null,Buffer.from('SUTRADHAR_UPDATE_INSPECTION_V1\n'+
      JSON.stringify(value.payload)),pub,Buffer.from(value.signature_base64,'base64')),true);
    const repeated=recordInspection(args);
    assert.deepEqual(repeated,{recorded:true,previously_inspected:true,
      installed:false,receipt_id:first.receipt_id,owner_install_approval:false});
    assert.equal(fs.readFileSync(target,'utf8'),raw);
  });
});
test('corrupted and partial interrupted receipts require Owner review, not silent overwrite',()=>{
  withDir(dir=>{
    const args={dir,...fixture()};
    const first=recordInspection(args),file=receiptPath(dir,first.receipt_id);
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    value.payload.installed=true;
    fs.writeFileSync(file,JSON.stringify(value));
    assert.throws(()=>recordInspection(args),/IDENTITY_OR_DATA_MISMATCH/);
    fs.writeFileSync(file,'{partial');
    assert.throws(()=>recordInspection(args),/RECEIPT_CORRUPT/);
  });
});
test('wrong OS-vault node key, wrong Central and missing authenticode fail closed',()=>{
  withDir(dir=>{
    const args={dir,...fixture()};
    const id=recordInspection(args).receipt_id;
    assert.ok(fs.existsSync(receiptPath(dir,id)));
    assert.throws(()=>recordInspection({...args,authenticodeVerified:false}),
      /TRUSTED_PREFLIGHT_REQUIRED/);
    assert.throws(()=>recordInspection({...args,centralOrigin:'https://other.example.com'}),
      /IDENTITY_OR_DATA_MISMATCH/);
    const newKey=crypto.generateKeyPairSync('ed25519');
    const wrongKey={...args.node,
      private_key_pem:newKey.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
      public_key_pem:newKey.publicKey.export({format:'pem',type:'spki'}).toString()};
    assert.throws(()=>recordInspection({...args,node:wrongKey}),
      /IDENTITY_OR_DATA_MISMATCH/);
    assert.throws(()=>recordInspection({...args,node:{...args.node,private_key_pem:'wrong'}}),
      /KEY_INVALID/);
    assert.throws(()=>recordInspection({...args,currentVersion:'7.0.0-alpha.1'}),
      /TRUSTED_PREFLIGHT_REQUIRED/);
    assert.throws(()=>recordInspection({...args,verified:{...args.verified,
      accepted:false}}),/TRUSTED_PREFLIGHT_REQUIRED/);
    assert.throws(()=>recordInspection({...args,verified:{...args.verified,
      device_node_id:'node_'+'b'.repeat(32)}}),/TRUSTED_PREFLIGHT_REQUIRED/);
  });
});
test('expired and mismatched signed offer data cannot produce a receipt',()=>{
  withDir(dir=>{
    const args={dir,...fixture()};
    const expired={...args.envelope,signed:{...args.envelope.signed,
      expires_ms:args.now-1}};
    assert.throws(()=>recordInspection({...args,envelope:expired}),
      /SIGNED_OFFER_MISMATCH/);
    assert.throws(()=>recordInspection({...args,verified:{...args.verified,
      file_sha256:'d'.repeat(64)}}),/SIGNED_OFFER_MISMATCH/);
    assert.throws(()=>recordInspection({...args,envelope:{...args.envelope,
      signed:{...args.envelope.signed,rollout:{wave_id:'wave_pilot01',
        node_ids:['node_'+'b'.repeat(32)]}}}}),/SIGNED_OFFER_MISMATCH/);
  });
});
