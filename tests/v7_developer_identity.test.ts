import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {openDeveloperIdentity} from '../v7/developer_identity.ts';
import type {DeveloperIdentity} from '../v7/developer_identity.ts';

const names=['agent_alpha','agent_beta'];
const temp=(fn:(dir:string)=>void)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-dev-edge-'));
  try{fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
};
const advance=(x:DeveloperIdentity):DeveloperIdentity=>({
  ...x,node_sequence:x.node_sequence+1,
  agents:x.agents.map(a=>({...a,sequence:a.sequence+1}))
});

test('fresh alpha identity has a real Ed25519 pair, durable counters and new software boot on restart',()=>{
  temp(dir=>{
    const first=openDeveloperIdentity(dir,names);
    const id=first.state.node_id,boot=first.state.boot_id;
    assert.match(id,/^node_[a-f0-9]{32}$/);
    assert.ok(first.state.private_key_pem.includes('PRIVATE KEY'));
    const key=crypto.createPrivateKey(first.state.private_key_pem);
    assert.equal(crypto.createPublicKey(key).export({type:'spki',format:'pem'}),
      first.state.public_key_pem);
    const next=advance(first.state);
    first.persistHeartbeat(next);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'identity.json'),'utf8')).node_sequence,1);
    if(process.platform!=='win32'){
      assert.equal(fs.statSync(dir).mode&0o077,0);
      assert.equal(fs.statSync(path.join(dir,'identity.json')).mode&0o077,0);
    }
    first.release();
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),false);
    const second=openDeveloperIdentity(dir,names);
    assert.equal(second.state.node_id,id);
    assert.notEqual(second.state.boot_id,boot);
    assert.equal(second.state.node_sequence,1);
    assert.deepEqual(second.state.agents.map(x=>x.sequence),[1,1]);
    second.persistHeartbeat(advance(second.state));
    second.release();
  });
});

test('exclusive lock denies concurrent daemon and stale crash lock without PID guessing',()=>{
  temp(dir=>{
    const first=openDeveloperIdentity(dir,names);
    assert.throws(()=>openDeveloperIdentity(dir,names),
      /DEV_EDGE_ALREADY_RUNNING_OR_CRASH_UNRECONCILED/);
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),true);
    first.release();
    const second=openDeveloperIdentity(dir,names);
    const lock=fs.readFileSync(path.join(dir,'edge-owner.lock'),'utf8');
    assert.equal(JSON.parse(lock).pid,process.pid);
    second.release();
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),false);
    // A crash on real hardware leaves this lock. Never auto-reclaim it.
    fs.writeFileSync(path.join(dir,'edge-owner.lock'),'stale',{flag:'wx',mode:0o600});
    assert.throws(()=>openDeveloperIdentity(dir,names),
      /DEV_EDGE_ALREADY_RUNNING_OR_CRASH_UNRECONCILED/);
  });
});

test('replayed or altered node/agent heartbeat counters poison the session',()=>{
  for(const mutate of [
    (x:DeveloperIdentity)=>x,
    (x:DeveloperIdentity)=>({...x,node_sequence:x.node_sequence+2}),
    (x:DeveloperIdentity)=>({...advance(x),agents:[{...x.agents[0]},advance(x).agents[1]]}),
    (x:DeveloperIdentity)=>({...advance(x),boot_id:'boot_'+ 'f'.repeat(32)}),
    (x:DeveloperIdentity)=>({...advance(x),private_key_pem:'changed'}),
    (x:DeveloperIdentity)=>({...advance(x),agents:[advance(x).agents[1],advance(x).agents[0]]})
  ]){
    temp(dir=>{
      const current=openDeveloperIdentity(dir,names);
      assert.throws(()=>current.persistHeartbeat(mutate(current.state)),
        /DEV_EDGE_HEARTBEAT_REPLAY_OR_IDENTITY_MUTATION/);
      current.release();
      assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),true,
        'A poisoned process retains crash evidence rather than unlocking');
      assert.throws(()=>openDeveloperIdentity(dir,names),
        /DEV_EDGE_ALREADY_RUNNING_OR_CRASH_UNRECONCILED/);
    });
  }
});

test('interrupted file fsync cannot authorize heartbeat and retains old signed sequence',()=>{
  temp(dir=>{
    const current=openDeveloperIdentity(dir,names);
    const file=path.join(dir,'identity.json');
    const before=fs.readFileSync(file);
    // Node builtin ESM named exports are read-only. Patch the test-local
    // CommonJS builtin, then explicitly synchronize the ESM named export.
    const mutableFs=createRequire(import.meta.url)('node:fs') as typeof fs;
    const saved=mutableFs.fsyncSync;
    mutableFs.fsyncSync=()=>{throw Error('TEST_INTERRUPTED_FILE_FLUSH');};
    syncBuiltinESMExports();
    try{
      assert.throws(()=>current.persistHeartbeat(advance(current.state)),
        /TEST_INTERRUPTED_FILE_FLUSH/);
    }finally{mutableFs.fsyncSync=saved;syncBuiltinESMExports();}
    assert.deepEqual(fs.readFileSync(file),before);
    assert.deepEqual(fs.readdirSync(dir).sort(),['edge-owner.lock','identity.json']);
    current.release();
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),true);
  });
});

test('existing identity does not silently adopt altered configured agent roster',()=>{
  temp(dir=>{
    const session=openDeveloperIdentity(dir,names);
    session.release();
    const before=fs.readFileSync(path.join(dir,'identity.json'));
    assert.throws(()=>openDeveloperIdentity(dir,['agent_alpha','agent_new']),
      /DEV_EDGE_IDENTITY_INVALID_OR_AGENT_ROSTER_CHANGED/);
    assert.deepEqual(fs.readFileSync(path.join(dir,'identity.json')),before);
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),true);
  });
});

test('lost identity with enrollment marker or outbox never silently re-keys',()=>{
  for(const artifact of ['enrollment_requested','sealed_outbox.jsonl','identity.json.abandoned.tmp']){
    temp(dir=>{
      fs.writeFileSync(path.join(dir,artifact),'unreconciled',{mode:0o600});
      assert.throws(()=>openDeveloperIdentity(dir,names),
        /DEV_EDGE_MISSING_IDENTITY_OWNER_RECOVERY_REQUIRED/);
      assert.equal(fs.existsSync(path.join(dir,'identity.json')),false);
    });
  }
});

test('corrupt, mismatched key and insecure identities refuse restart',()=>{
  temp(dir=>{
    const session=openDeveloperIdentity(dir,names);
    session.release();
    const file=path.join(dir,'identity.json');
    const original=JSON.parse(fs.readFileSync(file,'utf8'));
    const other=crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(file,JSON.stringify({...original,
      private_key_pem:other.privateKey.export({type:'pkcs8',format:'pem'}).toString()}),{mode:0o600});
    assert.throws(()=>openDeveloperIdentity(dir,names),/DEV_EDGE_IDENTITY_KEY_MISMATCH/);
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),true);
  });
  temp(dir=>{
    const session=openDeveloperIdentity(dir,names);
    session.release();
    const file=path.join(dir,'identity.json');
    fs.writeFileSync(file,'{', {mode:0o600});
    assert.throws(()=>openDeveloperIdentity(dir,names),/DEV_EDGE_IDENTITY_FILE_UNSAFE|CORRUPT/);
  });
});

test('symlinked keyfile and public directory denied on POSIX',()=>{
  if(process.platform==='win32')return;
  temp(dir=>{
    const session=openDeveloperIdentity(dir,names);
    session.release();
    const file=path.join(dir,'identity.json');
    const newfile=path.join(dir,'old-key.json');
    fs.renameSync(file,newfile);
    fs.symlinkSync(newfile,file);
    assert.throws(()=>openDeveloperIdentity(dir,names),/DEV_EDGE_IDENTITY_FILE_UNSAFE/);
  });
  temp(dir=>{
    fs.chmodSync(dir,0o755);
    assert.throws(()=>openDeveloperIdentity(dir,names),
      /DEV_EDGE_PRIVATE_DIRECTORY_REQUIRED/);
    assert.equal(fs.existsSync(path.join(dir,'identity.json')),false);
  });
});

test('restoring old counters while process alive is detected before writing any new sequence',()=>{
  temp(dir=>{
    const s=openDeveloperIdentity(dir,names);
    const old=fs.readFileSync(path.join(dir,'identity.json'));
    s.persistHeartbeat(advance(s.state));
    fs.writeFileSync(path.join(dir,'identity.json'),old,{mode:0o600});
    assert.throws(()=>s.persistHeartbeat(advance(advance(s.state))),
      /DEV_EDGE_IDENTITY_EXTERNAL_CHANGE_OR_ROLLBACK/);
    s.release();
    assert.equal(fs.existsSync(path.join(dir,'edge-owner.lock')),true);
  });
});
