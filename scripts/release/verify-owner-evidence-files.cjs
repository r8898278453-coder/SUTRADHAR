/**
 * Independent local cryptographic verification of the eight evidence files
 * referenced by one already signed Owner acceptance index.
 *
 * This proves available local FILE BYTES match the signed hashes only. It
 * cannot authenticate the real-world facts, human reviewer, Windows machine
 * or deployment behind an evidence file. Never authorizes production.
 * Pure offline, read-only, no network or secret export.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluate,GATES}=require('./verify-owner-acceptance.cjs');
const LIMIT=64*1024*1024;
const HEX=/^[0-9a-f]{64}$/;
const fail=code=>{throw Error(code);};
function hashFile(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.length>1024)
    fail('OWNER_EVIDENCE_ABSOLUTE_FILE_REQUIRED');
  const resolved=path.resolve(file);
  if(fs.realpathSync.native(resolved)!==resolved)
    fail('OWNER_EVIDENCE_SYMLINK_OR_REDIRECT');
  const info=fs.lstatSync(resolved);
  if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>LIMIT)
    fail('OWNER_EVIDENCE_FILE_INVALID_OR_OVERSIZED');
  const fd=fs.openSync(resolved,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size!==info.size||before.size>LIMIT||
       before.ino!==info.ino||before.dev!==info.dev)
      fail('OWNER_EVIDENCE_FILE_CHANGED_DURING_OPEN');
    const digest=crypto.createHash('sha256');
    const buffer=Buffer.allocUnsafe(64*1024);
    let read=0;
    while(read<before.size){
      const n=fs.readSync(fd,buffer,0,
        Math.min(buffer.length,before.size-read),read);
      if(n===0)fail('OWNER_EVIDENCE_FILE_TRUNCATED');
      digest.update(buffer.subarray(0,n));read+=n;
    }
    const after=fs.fstatSync(fd),latest=fs.lstatSync(resolved);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||
       after.ctimeMs!==before.ctimeMs||after.ino!==before.ino||
       after.dev!==before.dev||latest.ino!==before.ino||
       latest.dev!==before.dev||latest.size!==before.size)
      fail('OWNER_EVIDENCE_FILE_CHANGED_DURING_HASH');
    return {sha256:digest.digest('hex'),bytes:read};
  }finally{fs.closeSync(fd);}
}
function evaluateEvidence({envelope,ownerPublicKeyPem,expectedSha,
  artifacts,now=Date.now(),hasher=hashFile}){
  const signed=evaluate({envelope,ownerPublicKeyPem,expectedSha,now});
  if(!signed.accepted)return {accepted:false,error_code:signed.error_code,
    evidence_files_verified:false,production_release_authorized:false};
  try{
    if(!Array.isArray(artifacts)||artifacts.length!==GATES.length||
       typeof hasher!=='function')
      fail('OWNER_EVIDENCE_MAP_INVALID');
    const seen=new Set(),paths=new Set();
    const mapping=new Map();
    for(const a of artifacts){
      if(!a||typeof a!=='object'||Array.isArray(a)||
         Object.keys(a).sort().join('|')!=='gate_id|path'||
         !GATES.includes(a.gate_id)||seen.has(a.gate_id)||
         typeof a.path!=='string'||!path.isAbsolute(a.path)||
         paths.has(path.resolve(a.path)))
        fail('OWNER_EVIDENCE_MAP_INVALID');
      seen.add(a.gate_id);paths.add(path.resolve(a.path));
      mapping.set(a.gate_id,a.path);
    }
    const receipt=[];
    for(const g of GATES){
      const entry=envelope.payload.gates.find(item=>item.gate_id===g);
      if(!entry||!HEX.test(entry.evidence_sha256))
        fail('OWNER_EVIDENCE_GATE_HASH_INVALID');
      const observed=hasher(mapping.get(g));
      if(!observed||observed.sha256!==entry.evidence_sha256||
         !Number.isSafeInteger(observed.bytes)||observed.bytes<1||
         observed.bytes>LIMIT)
        fail('OWNER_EVIDENCE_FILE_SHA_MISMATCH');
      receipt.push({gate_id:g,bytes:observed.bytes,sha256:observed.sha256});
    }
    return {accepted:true,status:'SIGNED_OWNER_EVIDENCE_FILES_HASH_VERIFIED_ONLY',
      source_sha:expectedSha,verified_file_count:receipt.length,
      files:receipt,evidence_files_verified:true,
      evidence_facts_independently_verified:false,
      physical_windows_verified:false,hostinger_staging_verified:false,
      owner_production_approval_recorded:false,
      production_release_authorized:false,
      warning:'Hashes prove local bytes only. Human validation of G0-G7 facts, actual staging, physical PCs and independent approval remain mandatory.'};
  }catch{
    return {accepted:false,error_code:'OWNER_EVIDENCE_FILE_VERIFICATION_FAILED',
      evidence_files_verified:false,production_release_authorized:false};
  }
}
function main(){
  const envelopeFile=process.env.SUTRADHAR_OWNER_ACCEPTANCE_FILE||'';
  const pubFile=process.env.SUTRADHAR_OWNER_ACCEPTANCE_PUBLIC_KEY_FILE||'';
  const manifestFile=process.env.SUTRADHAR_OWNER_EVIDENCE_MAP_FILE||'';
  try{
    for(const [file,max] of [[envelopeFile,131072],[pubFile,10000],
      [manifestFile,65536]]){
      if(!path.isAbsolute(file)||fs.lstatSync(file).size>max||
         !fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())
        fail('OWNER_EVIDENCE_INPUT_UNTRUSTED');
    }
    const envelope=JSON.parse(fs.readFileSync(envelopeFile,'utf8'));
    const mapping=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||
       Object.keys(mapping).sort().join('|')!=='artifacts|schema'||
       mapping.schema!==1)fail('OWNER_EVIDENCE_MAP_INVALID');
    const result=evaluateEvidence({envelope,
      ownerPublicKeyPem:fs.readFileSync(pubFile,'utf8'),
      expectedSha:process.env.SUTRADHAR_EXPECTED_COMMIT_SHA||'',
      artifacts:mapping.artifacts});
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }catch{
    console.error('OWNER_EVIDENCE_OFFLINE_VERIFICATION_FAILED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={evaluateEvidence,hashFile,LIMIT};
