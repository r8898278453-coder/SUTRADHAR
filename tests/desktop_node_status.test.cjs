'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readNodeStatus,writeNodeStatus,MAX_STATUS_BYTES}=
  require('../apps/desktop/node-status.cjs');
const {summarizeCentralReceipt}=require('../apps/desktop/status.cjs');
const nodeId='node_'+'a'.repeat(32);
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-local-status-'));
  try{return fn(path.join(dir,'status.json'),dir);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('status preserves a prior ACK timestamp without granting a new ACK on outage',()=>{
  fixture(file=>{
    const accepted='2026-11-23T06:00:00.000Z';
    assert.equal(readNodeStatus({file,nodeId}),null);
    const saved=writeNodeStatus({file,nodeId,
      now:'2026-11-23T06:00:02.000Z',
      extra:{connection:'ACKNOWLEDGED',last_accepted_at:accepted,
        phase:'READY',epoch:7,master_agent_id:'agent_master'}});
    assert.equal(saved.authority,false);
    writeNodeStatus({file,nodeId,now:'2026-11-23T06:00:08.000Z',
      extra:{connection:'NOT_ACKNOWLEDGED',
        error_code:'NETWORK_UNAVAILABLE'}});
    const read=readNodeStatus({file,nodeId});
    assert.equal(read.last_accepted_at,accepted);
    assert.equal(summarizeCentralReceipt(read,nodeId,true,
      Date.parse('2026-11-23T06:00:12.000Z')).acknowledgedNow,false);
    assert.deepEqual(fs.readdirSync(path.dirname(file)),['status.json']);
  });
});
test('oversized or symlinked local status cannot be read or overwritten',()=>{
  fixture((file,dir)=>{
    fs.writeFileSync(file,Buffer.alloc(MAX_STATUS_BYTES+1,0x61));
    const bytes=fs.readFileSync(file);
    assert.throws(()=>readNodeStatus({file,nodeId}),/FILE_UNSAFE/);
    assert.throws(()=>writeNodeStatus({file,nodeId,
      extra:{connection:'ACKNOWLEDGED'}}),/FILE_UNSAFE/);
    assert.deepEqual(fs.readFileSync(file),bytes);
    if(process.platform!=='win32'){
      fs.renameSync(file,path.join(dir,'outside'));
      fs.symlinkSync(path.join(dir,'outside'),file);
      assert.throws(()=>readNodeStatus({file,nodeId}),/FILE_UNSAFE/);
      assert.throws(()=>writeNodeStatus({file,nodeId,
        extra:{connection:'ACKNOWLEDGED'}}),/FILE_UNSAFE/);
      assert.deepEqual(fs.readFileSync(path.join(dir,'outside')),bytes);
    }
  });
});
test('malformed receipt, different node and forged Owner permission are rejected',()=>{
  fixture(file=>{
    assert.throws(()=>writeNodeStatus({file,nodeId,
      extra:{connection:'ACKNOWLEDGED',owner_approved:true}}),
      /FIELDS_INVALID/);
    assert.equal(fs.existsSync(file),false);
    assert.throws(()=>writeNodeStatus({file,nodeId,
      extra:{connection:'ACKNOWLEDGED',phase:'x'.repeat(MAX_STATUS_BYTES+1)}}),
      /TOO_LARGE/);
    assert.equal(fs.existsSync(file),false);
    writeNodeStatus({file,nodeId,extra:{connection:'ACKNOWLEDGED'}});
    assert.throws(()=>readNodeStatus({file,nodeId:'node_'+'b'.repeat(32)}),
      /CONTENT_INVALID/);
    fs.writeFileSync(file,'{invalid');
    assert.throws(()=>readNodeStatus({file,nodeId}),
      /FILE_UNSAFE|JSON_INVALID/);
  });
});

test('packaged heartbeat preserves validated backup and local agent IDs for manual restart ACK',()=>fixture(file=>{
  const saved=writeNodeStatus({file,nodeId,extra:{
    connection:'ACKNOWLEDGED',phase:'READY',epoch:17,
    master_agent_id:'agent_master_1',
    backups:['agent_backup_1','agent_backup_2'],
    agent_ids:['agent_pc2_a','agent_pc2_b'],
    last_accepted_at:new Date().toISOString()
  }});
  assert.equal(saved.stored,true);
  const value=readNodeStatus({file,nodeId});
  assert.deepEqual(value.backups,['agent_backup_1','agent_backup_2']);
  assert.deepEqual(value.agent_ids,['agent_pc2_a','agent_pc2_b']);
  for(const patch of [
    {backups:['only_one']},{backups:['valid',42]},
    {agent_ids:['duplicate','duplicate']},{agent_ids:[]},
    {agent_ids:['one','two','three','four','five']},
    {agent_ids:['bad id']}
  ])assert.throws(()=>writeNodeStatus({file,nodeId,
    extra:{connection:'ACKNOWLEDGED',...patch}}),/FIELDS_INVALID/);
  assert.deepEqual(readNodeStatus({file,nodeId}).agent_ids,
    ['agent_pc2_a','agent_pc2_b'],'invalid status cannot replace a valid ACK');
}));
