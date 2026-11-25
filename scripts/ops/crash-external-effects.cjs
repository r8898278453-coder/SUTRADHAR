/**
 * SUTRADHAR: OFFLINE and READ-ONLY Owner crash external-effects worksheet.
 *
 * Verifies a signed crash REVIEW (not a grant), then fingerprints local
 * external Git / QA / witness evidence files if the Owner supplies them.
 * Hashes prove only submitted file bytes. Neither a human claim nor a copied
 * remote screenshot is authentication of GitHub/MySQL/physical machines.
 *
 * No Central calls, PR writes, checkout, agent start, marker removal or release.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createReviewManifest,verifySignedReview,canonical}=
  require('./crash-owner-review.cjs');
const HEX=/^[0-9a-f]{64}$/;
const EVIDENCE_KIND=Object.freeze([
  'GITHUB_REMOTE_STATE',
  'INDEPENDENT_QA_RECEIPT_REVIEW',
  'GLOBAL_QA_PENDING_QUEUE_REVIEW',
  'WORKER_CHECKPOINT_REVIEW',
  'LEASE_AND_TASK_RECONCILIATION',
  'ORIGINAL_PC_PHYSICAL_WITNESS'
]);
const MAX_BYTES=1024*1024;
const fail=c=>{throw Error('CRASH_EXTERNAL_EFFECTS_'+c);};
function object(o){return o!==null&&typeof o==='object'&&!Array.isArray(o);}
function exact(o,keys){return object(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');}
function nonneg(n){return Number.isSafeInteger(n)&&n>=0;}
function normalize(file){
  let s=path.normalize(file);
  if(process.platform==='win32'){
    const prefix=String.fromCharCode(92,92,63,92);
    if(s.startsWith(prefix))s=s.slice(prefix.length);
    s=s.toLowerCase();
  }
  return s;
}
function hashLocalEvidence(file){
  // Reject repo paths, symlinks and junctions (including in parents);
  // offline verification never uploads or prints source file contents.
  if(typeof file!=='string'||file.length>1024||!path.isAbsolute(file))
    fail('EVIDENCE_ABSOLUTE_PATH_REQUIRED');
  const normalized=path.resolve(file);
  const repo=path.resolve(__dirname,'../..');
  const n=normalize(normalized),root=normalize(repo);
  if(n===root||n.startsWith(root+path.sep))
    fail('EVIDENCE_MUST_BE_OUTSIDE_REPOSITORY');
  const stat=fs.lstatSync(normalized);
  if(!stat.isFile()||stat.isSymbolicLink()||
     stat.size<32||stat.size>MAX_BYTES)
    fail('EVIDENCE_FILE_UNSAFE');
  const real=fs.realpathSync.native(normalized);
  if(normalize(real)!==n)fail('EVIDENCE_FILE_REDIRECTED');
  const fd=fs.openSync(normalized,fs.constants.O_RDONLY|
    (fs.constants.O_NOFOLLOW||0));
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size!==stat.size||
       before.dev!==stat.dev||before.ino!==stat.ino)
      fail('EVIDENCE_FILE_CHANGED_DURING_OPEN');
    const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(65536);
    let done=0;
    while(done<before.size){
      const nRead=fs.readSync(fd,buffer,0,
        Math.min(buffer.length,before.size-done),done);
      if(nRead<1)fail('EVIDENCE_FILE_TRUNCATED');
      digest.update(buffer.subarray(0,nRead));done+=nRead;
    }
    const after=fs.fstatSync(fd),last=fs.lstatSync(normalized);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||
       after.ctimeMs!==before.ctimeMs||
       after.dev!==before.dev||after.ino!==before.ino||
       last.dev!==before.dev||last.ino!==before.ino||
       last.size!==before.size)
      fail('EVIDENCE_FILE_CHANGED_DURING_HASH');
    return {sha256:digest.digest('hex'),bytes:done};
  }finally{fs.closeSync(fd);}
}
function worksheet(input){
  const manifest=createReviewManifest(input);
  const x=input.second, h=x.historical_effects;
  const counts={
    active_worker_lease_count:x.active_worker_lease_count,
    outstanding_worker_ticket_count:x.outstanding_worker_ticket_count,
    unresolved_git_job_count:x.unresolved_git_job_count,
    centrally_confirmed_git_job_count:
      h.centrally_confirmed_git_jobs_involving_this_pc_count,
    qa_receipts_created_by_pc_count:h.qa_receipts_created_by_this_pc_count,
    qa_receipts_on_pc_tickets_count:
      h.qa_receipts_on_worker_tickets_for_this_pc_count,
    pending_qa_owner_reviews_on_pc_tickets_count:
      h.pending_qa_owner_reviews_for_worker_tickets_count,
    pending_global_qa_owner_reviews_count:
      h.pending_qa_owner_reviews_global_count,
    local_checkpoint_count:h.local_agent_checkpoint_record_count
  };
  if(Object.values(counts).some(n=>!nonneg(n)))
    fail('CENTRAL_EFFECT_COUNT_INVALID');
  const required=['ORIGINAL_PC_PHYSICAL_WITNESS'];
  if(counts.unresolved_git_job_count>0||
     counts.centrally_confirmed_git_job_count>0)
    required.push('GITHUB_REMOTE_STATE');
  if(counts.qa_receipts_created_by_pc_count>0||
     counts.qa_receipts_on_pc_tickets_count>0)
    required.push('INDEPENDENT_QA_RECEIPT_REVIEW');
  if(counts.pending_qa_owner_reviews_on_pc_tickets_count>0||
     counts.pending_global_qa_owner_reviews_count>0)
    required.push('GLOBAL_QA_PENDING_QUEUE_REVIEW');
  if(counts.local_checkpoint_count>0)
    required.push('WORKER_CHECKPOINT_REVIEW');
  if(counts.active_worker_lease_count>0||
     counts.outstanding_worker_ticket_count>0)
    required.push('LEASE_AND_TASK_RECONCILIATION');
  return {manifest,counts,required:required.sort()};
}
function evaluateCrashEffects({input,envelope,pinnedOwnerReviewPublicKeyPem,
  index=null,now=Date.now(),hasher=hashLocalEvidence}={}){
  // Existing Ed25519 Owner review must be valid and bound to both original
  // Central snapshots BEFORE any external evidence is classified.
  const signed=verifySignedReview({input,envelope,
    pinnedOwnerReviewPublicKeyPem,now});
  const {manifest,counts,required}=worksheet(input);
  if(signed.manifest_sha256!==manifest.manifest_sha256||
     signed.owner_reconciliation_complete!==false||
     signed.agent_restart_allowed!==false)
    fail('OWNER_REVIEW_CROSSCHECK_INVALID');
  const records=[],seenKinds=new Set(),seenPaths=new Set();
  if(index!==null){
    if(!exact(index,['schema','kind','node_id','manifest_sha256',
      'owner_review_id','central_epoch_decimal',
      'central_audit_watermark_decimal','evidence',
      'agent_restart_allowed','marker_removal_allowed',
      'production_release_authorized'])||
       index.schema!==1||
       index.kind!=='SUTRADHAR_CRASH_EXTERNAL_EFFECTS_INDEX_V1'||
       index.node_id!==manifest.node_id||
       index.manifest_sha256!==manifest.manifest_sha256||
       index.owner_review_id!==signed.review_id||
       index.central_epoch_decimal!==manifest.central_epoch_decimal||
       index.central_audit_watermark_decimal!==
         manifest.central_global_audit_event_high_watermark_decimal||
       index.agent_restart_allowed!==false||
       index.marker_removal_allowed!==false||
       index.production_release_authorized!==false||
       !Array.isArray(index.evidence)||index.evidence.length>6||
       typeof hasher!=='function')
      fail('INDEX_SCOPE_INVALID');
    for(const item of index.evidence){
      if(!exact(item,['category','path','sha256',
        'captured_at_ms','reviewer_role','source_description'])||
         !EVIDENCE_KIND.includes(item.category)||
         seenKinds.has(item.category)||
         !HEX.test(item.sha256||'')||
         !Number.isSafeInteger(item.captured_at_ms)||
         item.captured_at_ms<1||item.captured_at_ms>now+60000||
         !['OWNER','INDEPENDENT_QA','INDEPENDENT_GIT',
           'PHYSICAL_WITNESS'].includes(item.reviewer_role)||
         typeof item.source_description!=='string'||
         item.source_description.trim().length<20||
         item.source_description.length>300||
         typeof item.path!=='string'||!path.isAbsolute(item.path)||
         seenPaths.has(normalize(path.resolve(item.path))))
        fail('INDEX_ENTRY_INVALID');
      seenKinds.add(item.category);
      seenPaths.add(normalize(path.resolve(item.path)));
      // The role and description are UNVERIFIED claims, not independent proof.
      const observed=hasher(item.path);
      if(!observed||observed.sha256!==item.sha256||
         !nonneg(observed.bytes)||observed.bytes<32||
         observed.bytes>MAX_BYTES)
        fail('ATTACHMENT_SHA256_MISMATCH');
      records.push({category:item.category,bytes:observed.bytes,
        sha256:item.sha256,claimed_reviewer_role:item.reviewer_role,
        evidence_file_hash_verified:true,external_provenance_verified:false});
    }
  }
  const missing=required.filter(kind=>!seenKinds.has(kind));
  return Object.freeze({
    schema:1,kind:'SUTRADHAR_CRASH_EXTERNAL_EFFECTS_WORKSHEET_V1',
    state:'OWNER_REVIEW_REQUIRED',node_id:manifest.node_id,
    manifest_sha256:manifest.manifest_sha256,
    signed_owner_review_id:signed.review_id,
    central_epoch_decimal:manifest.central_epoch_decimal,
    central_audit_watermark_decimal:
      manifest.central_global_audit_event_high_watermark_decimal,
    central_effect_counts:counts,required_evidence_categories:required,
    missing_evidence_categories:missing,
    hash_checked_attachments:records,
    attachment_hashes_verified:records.length>0,
    submitted_artifact_source_authenticated:false,
    independent_qa_reviewer_authenticated:false,
    external_git_state_independently_verified:false,
    original_pc_physical_shutdown_verified:false,
    full_accepted_heartbeat_history_verified:false,
    qa_pending_queue_coverage_complete:false,
    external_git_qa_effects_cleared:false,
    owner_reconciliation_complete:false,
    agent_restart_allowed:false,marker_removal_allowed:false,
    installer_execution_allowed:false,production_release_authorized:false,
    read_only:true,
    warning:'File SHA-256 equality and signed Owner review prove only supplied bytes and Owner acknowledgement. Reviewer labels, GitHub remote state, QA authority, audit completeness, original Windows processes and OS-vault custody are NOT independently verified.'
  });
}
function main(){
  const {boundedJson,evidenceInputFromEnv}=
    require('./crash-owner-review.cjs');
  const input=evidenceInputFromEnv();
  const envelope=boundedJson(process.env.SUTRADHAR_CRASH_OWNER_REVIEW_FILE,16384);
  const publicPath=process.env.SUTRADHAR_CRASH_OWNER_PUBLIC_KEY_FILE;
  if(typeof publicPath!=='string'||!path.isAbsolute(publicPath))
    fail('OWNER_REVIEW_PUBLIC_KEY_PATH_REQUIRED');
  const pStat=fs.lstatSync(publicPath);
  if(!pStat.isFile()||pStat.isSymbolicLink()||
     pStat.size<100||pStat.size>4000)
    fail('OWNER_REVIEW_PUBLIC_KEY_UNSAFE');
  const idx=process.env.SUTRADHAR_CRASH_EXTERNAL_EFFECT_INDEX_FILE;
  const index=idx?boundedJson(idx,65536):null;
  const report=evaluateCrashEffects({input,envelope,index,
    pinnedOwnerReviewPublicKeyPem:fs.readFileSync(publicPath,'utf8')});
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)try{main();}catch(e){
  console.error(String(e.message||e));process.exitCode=1;
}
module.exports={evaluateCrashEffects,hashLocalEvidence,worksheet,EVIDENCE_KIND,main};
