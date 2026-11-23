'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {inspect,prepare,markSubmitted,requireSubmitted,reconcilePrepared}=require('../apps/desktop/enrollment-receipt.cjs');
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
    assert.throws(()=>requireSubmitted({...args,node:{...identity,node_id:'node_'+('a'.repeat(32))}}),/MISMATCH/);
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
    // Re-create this *private* fixture after unlink. The reader correctly
    // refuses a world-readable file before reaching identity comparisons.
    fs.writeFileSync(file,JSON.stringify({...r,public_key_sha256:'b'.repeat(64)}),
      {mode:0o600});
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

test('Prepared enrollment reconciles ONLY with approved signed existing node, without re-enrollment',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-reconcile-'));
  try{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    prepare(args);
    let calls=0;
    const signer={sign:request=>{
      assert.deepEqual(request,{kind:'node_api',method:'GET',uri:'/v7/nodes/me',body:''});
      return {'x-sutradhar-node':identity.node_id,
        'x-sutradhar-nonce':'nonce-test','x-sutradhar-signature':'signed-test-only'};
    }};
    const fetcher=async(url,options)=>{
      calls++;
      assert.equal(url,origin+'/v7/nodes/me');
      assert.equal(options.method,'GET');
      assert.equal(options.redirect,'error');
      assert.equal(options.body,undefined);
      assert.equal(options.headers.Accept,'application/json');
      return new Response(JSON.stringify({node_id:identity.node_id}),
        {headers:{'content-type':'application/json'}});
    };
    await assert.rejects(reconcilePrepared({...args,signer,fetcher:async()=>({ok:false,status:403})}),
      /NOT_YET_OWNER_APPROVED/);
    assert.equal(inspect(args).state,'PREPARED');
    await assert.rejects(reconcilePrepared({...args,signer,
      fetcher:async()=>new Response(JSON.stringify({node_id:'node_'+('a'.repeat(32))}),
        {headers:{'content-type':'application/json'}})}),
      /NODE_MISMATCH/);
    assert.equal(inspect(args).state,'PREPARED');
    const result=await reconcilePrepared({...args,signer,fetcher});
    assert.deepEqual(result,{accepted:true,ownerApprovalVerified:true});
    assert.equal(calls,1);
    assert.equal(requireSubmitted(args),true);
    await assert.rejects(reconcilePrepared({...args,signer,fetcher}),
      /REQUIRES_PREPARED_RECEIPT/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('oversized signed reconciliation cannot change PREPARED to SUBMITTED',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-reconcile-large-'));
  try{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    prepare(args);
    const signer={sign:()=>({'x-sutradhar-node':identity.node_id,
      'x-sutradhar-nonce':'nonce','x-sutradhar-signature':'signed'})};
    const fetcher=async()=>new Response(JSON.stringify({padding:'x'.repeat(70000)}),
      {headers:{'content-type':'application/json'}});
    await assert.rejects(reconcilePrepared({...args,signer,fetcher}),
      /ENROLLMENT_RECONCILIATION_RESPONSE_TOO_LARGE/);
    assert.equal(inspect(args).state,'PREPARED');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('world-readable enrollment receipts are refused before identity comparison',()=>{
  if(process.platform==='win32')return;
  withDir(dir=>{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    prepare(args);
    const file=path.join(dir,'enrollment-receipt.json');
    fs.chmodSync(file,0o644);
    assert.throws(()=>requireSubmitted(args),/ENROLLMENT_RECEIPT_INVALID/);
    assert.throws(()=>markSubmitted(args),/ENROLLMENT_RECEIPT_INVALID/);
    assert.equal(fs.existsSync(file),true,'never delete Owner evidence');
  });
});
test('symlinked enrollment receipt requires Owner review, never follows target',()=>{
  if(process.platform==='win32')return;
  withDir(dir=>{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    prepare(args);
    const file=path.join(dir,'enrollment-receipt.json');
    const original=path.join(dir,'receipt-original.json');
    fs.renameSync(file,original);fs.symlinkSync(original,file);
    assert.throws(()=>inspect(args),/ENROLLMENT_RECEIPT_INVALID/);
  });
});

test('an IP/private Central origin cannot produce a PREPARED receipt',()=>{
  withDir(dir=>{
    const identity=node();
    for(const centralUrl of ['https://192.168.1.10','https://stage.example.com:9443',
      'https://server.local','https://[::1]']){
      assert.throws(()=>prepare({dir,node:identity,centralUrl}),/ORIGIN_INVALID/);
      assert.equal(fs.existsSync(path.join(dir,'enrollment-receipt.json')),false);
    }
  });
});

test('dangling enrollment and legacy markers trigger Owner hold, never absent identity',()=>{
  if(process.platform==='win32')return;
  withDir(dir=>{
    const identity=node(),args={dir,node:identity,centralUrl:origin};
    const receipt=path.join(dir,'enrollment-receipt.json');
    const legacy=path.join(dir,'enrollment_requested');
    fs.symlinkSync(path.join(dir,'missing-receipt'),receipt);
    assert.throws(()=>inspect(args),/ENROLLMENT_RECEIPT_INVALID/);
    assert.throws(()=>requireSubmitted(args),/ENROLLMENT_RECEIPT_INVALID/);
    assert.throws(()=>prepare(args),/ENROLLMENT_RECEIPT_INVALID/);
    assert.equal(fs.lstatSync(receipt).isSymbolicLink(),true);
    fs.unlinkSync(receipt);
    fs.symlinkSync(path.join(dir,'missing-legacy-file'),legacy);
    assert.throws(()=>inspect(args),/LEGACY_ENROLLMENT_RECEIPT_OWNER_REVIEW_REQUIRED/);
    assert.throws(()=>prepare(args),/LEGACY_ENROLLMENT_RECEIPT_OWNER_REVIEW_REQUIRED/);
    assert.equal(fs.existsSync(receipt),false);
    assert.equal(fs.lstatSync(legacy).isSymbolicLink(),true);
  });
});
