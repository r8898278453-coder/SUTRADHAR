'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
  crypto=require('node:crypto');
const {writeOwnerEnvelope}=require('../scripts/release/sign-physical-pilot-evidence.cjs');
const envelope={payload:{schema:1,session_id:'f'.repeat(32)},
  signature_base64:Buffer.alloc(64).toString('base64')};
function privateDir(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-owner-pilot-output-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('Owner pilot output is a new exact byte-for-byte, fsynced, private file',()=>privateDir(dir=>{
  const output=path.join(dir,'signed-envelope.json'),real=fs.fsyncSync;
  let synced=0;
  try{
    fs.fsyncSync=function(fd){synced++;return real(fd);};
    const report=writeOwnerEnvelope({output,envelope});
    assert.equal(report.evidence_file_written,true);
    assert.equal(report.production_release_authorized,false);
    assert.equal(report.physical_test_verified,false);
    assert.equal(report.directory_durability,process.platform==='win32'?
      'WINDOWS_POWER_LOSS_DURABILITY_UNVERIFIED':'POSIX_FILE_AND_DIRECTORY_FSYNC');
    const bytes=fs.readFileSync(output);
    assert.equal(report.evidence_index_sha256,crypto.createHash('sha256')
      .update(bytes).digest('hex'));
    assert.deepEqual(JSON.parse(bytes),envelope);
    assert.ok(synced>= (process.platform==='win32'?1:2),
      'POSIX must sync both file and parent directory before return');
    if(process.platform!=='win32'){
      assert.equal(fs.statSync(output).mode&0o077,0);
      assert.equal(fs.statSync(dir).mode&0o077,0);
    }
    assert.throws(()=>writeOwnerEnvelope({output,envelope}),
      /PILOT_OWNER_SIGNED_OUTPUT_ALREADY_EXISTS/);
    assert.deepEqual(fs.readFileSync(output),bytes,
      'A later retry cannot change an existing signed file');
  }finally{fs.fsyncSync=real;}
}));
test('failed file fsync leaves uncertain file and blocks same-path retry',()=>privateDir(dir=>{
  const output=path.join(dir,'uncertain-file.json'),real=fs.fsyncSync;
  try{
    fs.fsyncSync=()=>{throw Error('synthetic file storage outage');};
    assert.throws(()=>writeOwnerEnvelope({output,envelope}),
      /PILOT_OWNER_SIGNED_OUTPUT_WRITE_UNCERTAIN/);
  }finally{fs.fsyncSync=real;}
  assert.equal(fs.existsSync(output),true,
    'Do not delete ambiguous evidence after write or fsync failure');
  assert.throws(()=>writeOwnerEnvelope({output,envelope}),
    /PILOT_OWNER_SIGNED_OUTPUT_ALREADY_EXISTS/);
}));
test('failed POSIX parent directory sync leaves signed bytes, never claims durable success',()=>{
  if(process.platform==='win32')return;
  privateDir(dir=>{
    const output=path.join(dir,'uncertain-directory.json'),real=fs.fsyncSync;
    let count=0;
    try{
      fs.fsyncSync=function(fd){
        if(++count===2)throw Error('synthetic directory sync outage');
        return real(fd);
      };
      assert.throws(()=>writeOwnerEnvelope({output,envelope}),
        /PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_SYNC_UNCERTAIN/);
    }finally{fs.fsyncSync=real;}
    assert.equal(count,2);
    assert.deepEqual(JSON.parse(fs.readFileSync(output)),envelope);
    assert.throws(()=>writeOwnerEnvelope({output,envelope}),
      /PILOT_OWNER_SIGNED_OUTPUT_ALREADY_EXISTS/,
      'No overwrite or unguarded retry even after a failed parent sync');
  });
});
test('Owner file writer refuses absent, public and symlinked target directories',()=>{
  privateDir(dir=>{
    assert.throws(()=>writeOwnerEnvelope({output:'relative.json',envelope}),
      /PILOT_OWNER_SIGNED_OUTPUT_UNSAFE/);
    assert.throws(()=>writeOwnerEnvelope({
      output:path.join(dir,'missing','signed.json'),envelope}),
      /PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_UNAVAILABLE/);
    if(process.platform!=='win32'){
      const linked=path.join(dir,'linked');
      fs.symlinkSync(dir,linked,'dir');
      assert.throws(()=>writeOwnerEnvelope({
        output:path.join(linked,'signed.json'),envelope}),
        /PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_UNSAFE/);
      fs.chmodSync(dir,0o755);
      assert.throws(()=>writeOwnerEnvelope({
        output:path.join(dir,'signed.json'),envelope}),
        /PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_UNSAFE/);
      assert.equal(fs.existsSync(path.join(dir,'signed.json')),false);
    }
  });
});
test('helper only reports file durability, not whether caller verified Owner signature',()=>privateDir(dir=>{
  const report=writeOwnerEnvelope({
    output:path.join(dir,'synthetic-unverified.json'),envelope});
  assert.equal(Object.hasOwn(report,'signed'),false);
  assert.equal(report.production_release_authorized,false);
  assert.equal(report.physical_test_verified,false);
}));
