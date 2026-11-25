'use strict';
// Local bulk manifest review for packaged Desktop MAIN only. No network,
// write, execution, or admission. Only a native chooser supplies the path.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {TextDecoder}=require('node:util');
const {analyzeBulkPlanningDraft,extractBulkReviewGroup,analyzeMasterPlanningDraft}=require('./worker-claim.cjs');
const MAX=524288;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=x=>{throw Error(x);};
function readBulkManifest(file,{io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.length>2048||/[\0\r\n]/.test(file))fail('BULK_FILE_PATH_INVALID');
  const valid=s=>s.isFile()&&!s.isSymbolicLink()&&s.size>=1&&s.size<=MAX;
  const same=(a,b)=>valid(a)&&valid(b)&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
  let fd;
  try{
    const before=io.lstatSync(file);
    if(!valid(before))fail('BULK_FILE_UNSAFE');
    fd=io.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const opened=io.fstatSync(fd);
    if(!same(before,opened))fail('BULK_FILE_CHANGED');
    const raw=Buffer.alloc(opened.size);
    let n=0;while(n<raw.length){
      const count=io.readSync(fd,raw,n,raw.length-n,n);
      if(!Number.isSafeInteger(count)||count<=0||count>raw.length-n)fail('BULK_FILE_SHORT_READ');
      n+=count;
    }
    if(!same(opened,io.fstatSync(fd))||!same(opened,io.lstatSync(file)))fail('BULK_FILE_CHANGED');
    return raw;
  }catch(e){
    if(typeof e?.message==='string'&&/^BULK_FILE_[A-Z_]+$/.test(e.message))throw e;
    fail('BULK_FILE_READ_REFUSED');
  }finally{if(fd!==undefined)io.closeSync(fd);}
}
function parseManifest(raw){
  if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>MAX)fail('BULK_INPUT_SIZE');
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('BULK_INPUT_INVALID_JSON_OR_ENCODING');}
  if(!data||Array.isArray(data)||Object.keys(data).sort().join('|')!=='schema|tasks'||
     data.schema!=='SUTRADHAR_BULK_DECLARATIONS_V1')fail('BULK_INPUT_SCHEMA');
  return {tasks:data.tasks,report:analyzeBulkPlanningDraft(data.tasks),file_sha256:sha(raw)};
}
function requireBulkLocalBaseline(report,observed,current){
  if(!report||!observed||!current||JSON.stringify(observed)!==JSON.stringify(current)||
     observed.local_tracking_ref_verified!==true||observed.remote_freshness_verified!==false||
     observed.baseline_verified!==false||observed.automatic_execution_allowed!==false||
     typeof observed.baseline_sha!=='string'||observed.baseline_sha.length!==40||
     !/^[a-f0-9]{40}$/.test(observed.baseline_sha)||report.baseline_sha!==observed.baseline_sha)
    fail('BULK_LOCAL_BASELINE_CHANGED_OR_MISMATCH');
}
function groupImportReasons(group){
  const reasons=[];
  if(!group.within_existing_batch_limits)reasons.push('OUTSIDE_EXISTING_BATCH_LIMITS');
  if(group.isolated_review)reasons.push('ISOLATED_REVIEW_REQUIRED');
  if(group.unresolved_conflict_count!==0)reasons.push('UNRESOLVED_DECLARED_CONFLICT');
  if(group.external_dependencies_unverified.length)reasons.push('EXTERNAL_DEPENDENCY_UNVERIFIED');
  if(group.requires_upstream_baseline_review||group.depends_on_review_groups.length)reasons.push('UPSTREAM_BASELINE_REVIEW_REQUIRED');
  return reasons;
}
function reviewBulkManifest(raw,observed,current){
  const parsed=parseManifest(raw);
  requireBulkLocalBaseline(parsed.report,observed,current);
  const report=parsed.report;
  return {...report,file_sha256:parsed.file_sha256,
    review_groups:report.review_groups.map(g=>{
      const reasons=groupImportReasons(g);
      return {...g,local_draft_import_allowed:reasons.length===0,local_draft_import_blockers:reasons};
    }),local_tracking_ref_verified:true,local_draft_only:true};
}
function selectBulkDraft(raw,observed,current,expectedFileDigest,expectedManifestDigest,groupId){
  const hash=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x);
  if(!hash(expectedFileDigest)||!hash(expectedManifestDigest))fail('BULK_REVIEW_SELECTION_INVALID');
  const parsed=parseManifest(raw);
  requireBulkLocalBaseline(parsed.report,observed,current);
  if(parsed.file_sha256!==expectedFileDigest||parsed.report.manifest_sha256!==expectedManifestDigest)
    fail('BULK_REVIEW_FILE_OR_MANIFEST_CHANGED');
  const selected=extractBulkReviewGroup(parsed.tasks,expectedManifestDigest,groupId);
  if(groupImportReasons(selected.group).length)fail('BULK_GROUP_REQUIRES_SEPARATE_REVIEW');
  analyzeMasterPlanningDraft(selected.tasks);
  return {...selected,file_sha256:parsed.file_sha256,local_draft_only:true,
    requires_fresh_central_preview:true,central_admission_performed:false};
}
module.exports={readBulkManifest,parseManifest,requireBulkLocalBaseline,reviewBulkManifest,selectBulkDraft};
