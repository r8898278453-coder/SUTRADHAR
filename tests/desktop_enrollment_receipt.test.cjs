'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {inspect,prepare,markSubmitted,requireSubmitted}=require('../apps/desktop/enrollment-receipt.cjs');
const {installSingleInstanceGuard}=require('../apps/desktop/single-instance.cjs');
const origin='https://stage.sutradhar.example.com';
function node(){
  const kp=crypto.generateKeyPairSync('ed25519');
  return {node_id:'node_'+crypto.randomUUID().replace(/-/g,''),
    public_key_pem:kp.publicKey.export({format:'pem',type:'spki'}).toString()};
}
function withDir(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-enrollment-receipt-'));
  try{run(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('First enrollment writes a private PREPARED receipt, then matching Central ACK may mark SUBMITTED',()=>{
  withDir(dir=>{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    assert.equal(inspect(args),null);
    assert.equal(requireSubmitted(args),false);
    assert.deepEqual(prepare(args),{state:'PREPARED'});
    const receiptPath=path.join(dir,'enrollment-receipt.json');
    const raw=fs.readFileSync(receiptPath,'utf8');
    assert.equal(raw.includes(identity.public_key_pem),false);
    assert.equal(raw.includes('PRIVATE KEY'),false);
    assert.equal(inspect(args).state,'PREPARED');
    assert.throws(()=>requireSubmitted(args),/SUBMISSION_UNCERTAIN/);
    assert.throws(()=>prepare(args),/ALREADY_PREPARED/);
    assert.deepEqual(markSubmitted(args),{state:'SUBMITTED'});
    assert.equal(requireSubmitted(args),true);
    assert.equal(inspect(args).central_origin,origin);
    assert.throws(()=>markSubmitted(args),/PREPARED_RECEIPT_REQUIRED/);
  });
});
test('Node key, node ID and Central origin are immutable bindings across restart',()=>{
  withDir(dir=>{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    prepare(args);markSubmitted(args);
    assert.equal(requireSubmitted({...args,node:{...identity}}),true);
    assert.throws(()=>requireSubmitted({...args,node:node()}),/MISMATCH/);
    assert.throws(()=>requireSubmitted({...args,node:{...identity,node_id:'node_'+('a'.repeat(32))}),/MISMATCH/);
    assert.throws(()=>requireSubmitted({...args,centralUrl:'https://new.example.com'}),/MISMATCH/);
    assert.throws(()=>requireSubmitted({...args,node:null}),/IDENTITY_UNAVAILABLE/);
    assert.throws(()=>requireSubmitted({...args,centralUrl:'http://example.com'}),/ORIGIN_INVALID/);
  });
});
test('Legacy plaintext timestamp, corruption and altered receipts never silently re-enroll',()=>{
  withDir(dir=>{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    fs.writeFileSync(path.join(dir,'enrollment_requested'),'2026-11-14T12:00:00Z');
    assert.throws(()=>requireSubmitted(args),/LEGACY_ENROLLMENT_RECEIPT/);
    fs.rmSync(path.join(dir,'enrollment_requested'));
    prepare(args);
    const file=path.join(dir,'enrollment-receipt.json');
    const r=JSON.parse(fs.readFileSync(file,'utf8'));
    fs.writeFileSync(file,JSON.stringify({...r,extra:'potential injection'}));
    assert.throws(()=>inspect(args),/MISMATCH/);
    fs.writeFileSync(file,'{ bad json');
    assert.throws(()=>inspect(args),/RECEIPT_INVALID/);
    fs.rmSync(file);
    assert.equal(inspect(args),null);
    fs.writeFileSync(file,JSON.stringify({...r,public_key_sha256:'b'.repeat(64)}));
    assert.throws(()=>requireSubmitted(args),/MISMATCH/);
  });
});
test('Only one Electron main owns an identity; second launch quits without starting its own agent',()=>{
  let callback=null,quits=0,shown=0,ready=false;
  const app={requestSingleInstanceLock:()=>true,quit:()=>{quits++;},
    on:(name,fn)=>{assert.equal(name,'second-instance');callback=fn;},
    isReady:()=>ready};
  assert.equal(installSingleInstanceGuard(app,()=>{shown++;}),true);
  assert.equal(quits,0);
  callback();
  assert.equal(shown,0);
  ready=true;callback();
  assert.equal(shown,1);
  let subscribed=false;
  const other={...app,requestSingleInstanceLock:()=>false,
    on:()=>{subscribed=true;}};
  assert.equal(installSingleInstanceGuard(other,()=>{throw Error('must not run');}),false);
  assert.equal(quits,1);
  assert.equal(subscribed,false);
});
