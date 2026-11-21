let key='',timer=null;
const $=id=>document.getElementById(id);
function message(text,error=false){$('message').textContent=text;$('message').className=error?'message error':'message';}
async function request(path,options={}){
  if(!key)throw new Error('Owner API key required');
  const res=await fetch(path,{...options,headers:{authorization:'Bearer '+key,
    ...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})},
    cache:'no-store',credentials:'omit'});
  const out=await res.json();
  if(!res.ok)throw new Error(out.error_code||'HTTP '+res.status);
  return out;
}
function value(id,text){$(id).textContent=text===undefined||text===null?'—':String(text);}
function cell(row,text){const e=document.createElement('td');e.textContent=text===null||text===undefined?'—':String(text);row.append(e);}
function rows(id,values){const body=$(id);body.replaceChildren();for(const row of values){const tr=document.createElement('tr');for(const v of row)cell(tr,v);body.append(tr);}}
function date(raw){if(!raw)return '—';const d=new Date(raw.endsWith('Z')?raw:raw+'Z');return isNaN(d.getTime())?'—':d.toLocaleString();}

const nodeRecoveryResults=$('node-recovery-results');
$('node-recovery-inspect').addEventListener('click',async()=>{
  const btn=$('node-recovery-inspect');
  const nodeId=$('node-recovery-input').value.trim();
  if(!/^node_[0-9a-f]{32}$/.test(nodeId)){
    nodeRecoveryResults.textContent='INVALID NODE ID. Expected node_ followed by 32 lowercase hexadecimal characters. No request sent.';
    return;
  }
  btn.disabled=true;
  nodeRecoveryResults.textContent='Inspecting Central MySQL read-only snapshot…';
  try{
    const result=await request('/v7/owner/node-recovery/'+encodeURIComponent(nodeId));
    if(result?.schema!==1||result.mode!=='OWNER_CENTRAL_NODE_CRASH_RECOVERY_OBSERVATION'||
       result.node_id!==nodeId||result.read_only!==true||
       result.central_state_modified!==false||
       result.agent_restart_allowed!==false||
       result.marker_removal_allowed!==false||
       result.installer_execution_allowed!==false||
       result.production_release_authorized!==false||
       result.owner_reconciliation_complete!==false)
      throw new Error('UNTRUSTED_OWNER_RECOVERY_RESPONSE');
    nodeRecoveryResults.textContent=[
      'OWNER REVIEW REQUIRED — do not remove the original PC crash marker.',
      'Node: '+result.node_id+' ('+result.node_state+')',
      'Ed25519 public-key fingerprint SHA-256: '+result.node_public_key_fingerprint_sha256,
      'Accepted node boot: '+(result.accepted_boot_id||'none'),
      'Accepted node sequence: '+result.accepted_node_sequence_decimal,
      'Cluster epoch: '+result.cluster?.epoch_decimal+', phase: '+result.cluster?.phase,
      'This PC currently in Master/backup roles: '+String(result.cluster?.original_pc_in_cluster_roles),
      'Maintenance fence: '+String(result.maintenance?.active_fence),
      'Unresolved maintenance intent(s): '+result.maintenance?.unresolved_intent_count,
      'Active worker leases: '+result.active_worker_lease_count,
      'Outstanding worker tickets: '+result.outstanding_worker_ticket_count,
      'Unresolved Git jobs involving this PC: '+result.unresolved_git_job_count,
      'Historical effect indicators (not proof of external resolution): '+
        JSON.stringify(result.historical_effects),
      'Latest retained signed packet: '+
        JSON.stringify(result.historical_effects?.last_retained_pilot_heartbeat),
      'Agents: '+JSON.stringify(result.agents),
      'Central observation time (ms): '+result.observed_at_central_ms,
      'Local PC key/DPAPI, physical shutdown, QA/Git side effects: NOT VERIFIED.',
      'Restart, marker removal, installation, production release: NOT AUTHORIZED.'
    ].join('\n');
  }catch(e){
    nodeRecoveryResults.textContent='OWNER RECOVERY OBSERVATION UNAVAILABLE: '+
      String(e?.message||e)+'. No authorization implied; preserve original device evidence.';
  }finally{btn.disabled=false;}
});


const crosscheckOutput=$('node-recovery-crosscheck-results');
$('node-recovery-crosscheck').addEventListener('click',async()=>{
  const btn=$('node-recovery-crosscheck');
  const nodeId=$('node-recovery-input').value.trim();
  const pin=$('node-recovery-pin').value.trim();
  const raw=$('node-recovery-local-json').value;
  crosscheckOutput.textContent='OWNER HOLD: preliminary crosscheck not verified.';
  if(!/^node_[a-f0-9]{32}$/.test(nodeId)||
     !/^[a-f0-9]{64}$/.test(pin)||raw.length<10||raw.length>16000){
    crosscheckOutput.textContent='HOLD — exact node ID, independently pinned original Ed25519 fingerprint and bounded local diagnostic JSON are required. No recovery authorized.';
    return;
  }
  btn.disabled=true;
  try{
    const local=JSON.parse(raw);
    // Two independent GETs catch moving Central counters, epoch, roles,
    // maintenance and Git/worker state. Neither ever uploads local JSON/pin.
    const centralBefore=await request('/v7/owner/node-recovery/'+encodeURIComponent(nodeId));
    const centralAfter=await request('/v7/owner/node-recovery/'+encodeURIComponent(nodeId));
    const report=window.SutradharCrashCrosscheck.inspectPair({
      local,first:centralBefore,second:centralAfter,nodeId,
      pinnedPublicKeySha256:pin,observedAtClientMs:Date.now()
    });
    if(report.state!=='OWNER_REVIEW_REQUIRED'||
       report.agent_restart_allowed!==false||
       report.marker_removal_allowed!==false||
       report.owner_reconciliation_complete!==false)
      throw Error('CROSSCHECK_UNSAFE_RESULT');
    crosscheckOutput.textContent=[
      'OWNER REVIEW REQUIRED — NOT AN AUTHORIZATION.',
      'Node ID entered by Owner: '+report.compared_node_id,
      'Central public-key fingerprint matches independent enrollment pin: '+
        String(report.central_fingerprint_matches_independent_enrollment_pin),
      'Local crash marker has expected shape: '+String(report.local_session_marker_shape_valid),
      'Two Central observations unchanged: '+String(report.central_observation_unchanged),
      'Central read window bounded (30 seconds): '+String(report.central_observation_window_bounded),
      'Browser clock within 2 minutes of Central: '+String(report.central_browser_clock_near_central),
      'Historical QA, checkpoint, Git and retained heartbeat coverage: review all finding codes below.',
      'Potential inconsistencies: '+report.preliminary_inconsistency_count,
      'Finding codes: '+report.finding_codes.join(', '),
      'Local-to-Central identity/counter continuity and physical Windows shutdown NOT PROVEN.',
      'No marker deletion, agent restart, installer launch, Git replay or production release.'
    ].join('\n');
  }catch{
    crosscheckOutput.textContent='HOLD — local/remote data is invalid, tampered or unavailable. No recovery authorized; preserve original PC and evidence.';
  }finally{btn.disabled=false;}
});

let gitRecoverySnapshot=null,gitRecoverySelection=null,gitRecoveryPending=null;

let prSelected=null,prCreationAttempt=null;
let prReviewSnapshot=null,mergeVerifyPending=null;
let prRecoveryQueue=null,prRecoverySelected=null,prRecoveryPending=null;
function prStatus(text){value('pr-status',text);}
function updatePrAction(){
  const p=prSelected;
  $('draft-pr').disabled=!key||!p||!p.ready_for_owner_intent||
    $('git-ticket-id').value.trim()!==p.ticket_id||
    $('pr-expected-head').value!==p.candidate_head_sha||
    $('pr-confirm-head').value!==p.candidate_head_sha||
    !gitHead.test(p.candidate_head_sha)||
    $('pr-owner-note').value.trim().length<20||
    $('pr-owner-note').value.trim().length>500||
    !$('pr-consent').checked||Boolean(prCreationAttempt);
  const ready=Boolean(prReviewSnapshot&&
    prReviewSnapshot.ticket_id===$('git-ticket-id').value.trim()&&
    Number.isSafeInteger(prReviewSnapshot.pr_number)&&
    prReviewSnapshot.pr_number>0&&
    gitHead.test(prReviewSnapshot.expected_head_sha)&&
    $('pr-confirm-head').value===prReviewSnapshot.expected_head_sha&&
    $('pr-owner-note').value.trim().length>=20&&
    $('pr-owner-note').value.trim().length<=500&&
    $('merge-verify-consent').checked&&
    (!mergeVerifyPending||(
      mergeVerifyPending.ticket_id===prReviewSnapshot.ticket_id&&
      mergeVerifyPending.owner_review_note===$('pr-owner-note').value.trim())));
  $('verify-merge').disabled=!ready||!key;
  $('verify-merge').textContent=mergeVerifyPending?
    'Retry SAME exact merge-verification receipt':'Verify external merge (read-only proof)';
}
function clearPrCreation(){
  prSelected=null;prCreationAttempt=null;prReviewSnapshot=null;
  mergeVerifyPending=null;
  $('pr-expected-head').value='';$('pr-confirm-head').value='';
  $('pr-owner-note').value='';$('pr-consent').checked=false;
  $('merge-verify-consent').checked=false;
  value('pr-review-summary','Not inspected. No merge has been executed.');
  updatePrAction();
}
function updatePrRecovery(){
  const j=prRecoverySelected;
  const r=$('pr-recovery-reason').value.trim();
  $('pr-recovery-verify').disabled=!key||!j||
    $('pr-recovery-ticket').value!==j.ticket_id||
    $('pr-recovery-expected-head').value!==j.remote_head_sha||
    $('pr-recovery-confirm-head').value!==j.remote_head_sha||
    !gitHead.test(j.remote_head_sha)||r.length<20||r.length>500||
    !$('pr-recovery-consent').checked||
    Boolean(prRecoveryPending&&prRecoveryPending.reason!==r);
}
function clearPrRecovery(){
  prRecoverySelected=null;prRecoveryPending=null;
  $('pr-recovery-ticket').value='';$('pr-recovery-expected-head').value='';
  $('pr-recovery-confirm-head').value='';$('pr-recovery-reason').value='';
  $('pr-recovery-consent').checked=false;updatePrRecovery();
}
function renderPrRecovery(data){
  const valid=data&&Array.isArray(data.attempts)&&
    data.attempts.length<=100&&data.automatic_recreate_allowed===false;
  prRecoveryQueue=valid?data:null;
  value('pr-recovery-count',valid?data.attempts.length+' one-shot attempt(s)':
    'Unavailable — no automated recovery');
  $('pr-recovery-jobs').replaceChildren();
  for(const j of valid?data.attempts:[]){
    const tr=document.createElement('tr');
    cell(tr,j.ticket_id);cell(tr,j.repository);cell(tr,j.branch);
    cell(tr,j.remote_head_sha);
    const td=document.createElement('td'),b=document.createElement('button');
    b.type='button';b.textContent='Review exact remote';
    b.disabled=Boolean(prRecoveryPending);
    b.addEventListener('click',()=>{
      if(prRecoveryPending)return;
      prRecoverySelected=j;
      $('pr-recovery-ticket').value=j.ticket_id;
      $('pr-recovery-expected-head').value=j.remote_head_sha;
      $('pr-recovery-confirm-head').value='';
      $('pr-recovery-reason').value='';
      $('pr-recovery-consent').checked=false;
      value('pr-recovery-status','Review the original GitHub Draft PR externally, then enter the exact SHA.');
      updatePrRecovery();
    });
    td.append(b);tr.append(td);$('pr-recovery-jobs').append(tr);
  }
  if(prRecoverySelected&&!prRecoveryPending&&!(!valid||
    data.attempts.some(j=>j.ticket_id===prRecoverySelected.ticket_id&&
      j.remote_head_sha===prRecoverySelected.remote_head_sha)))clearPrRecovery();
}

const gitHead=/^[a-f0-9]{40}$/;
function recoveryStatus(text){value('git-recovery-status',text);}
function clearGitRecoveryReview(){
  gitRecoverySelection=null;gitRecoveryPending=null;
  $('git-recovery-ticket').value='';$('git-recovery-expected-head').value='';
  $('git-recovery-epoch').value='';$('git-recovery-confirm-sha').value='';
  $('git-recovery-reason').value='';$('git-recovery-consent').checked=false;
  updateGitRecoveryAction();
}
function updateGitRecoveryAction(){
  const intent=gitRecoveryPending||(
    gitRecoverySelection&&gitRecoverySnapshot&&gitRecoverySnapshot.master_live&&
    gitRecoverySnapshot.phase==='RECOVERING'&&gitRecoverySelection.preflight_eligible
      ?{ticket_id:gitRecoverySelection.ticket_id,
        expected_master_epoch:gitRecoverySnapshot.epoch,
        candidate_head_sha:gitRecoverySelection.candidate_head_sha,
        reason:$('git-recovery-reason').value.trim()}:null);
  const matching=Boolean(intent&&
    $('git-recovery-ticket').value===intent.ticket_id&&
    Number($('git-recovery-epoch').value)===intent.expected_master_epoch&&
    $('git-recovery-expected-head').value===intent.candidate_head_sha&&
    gitHead.test(intent.candidate_head_sha)&&
    $('git-recovery-confirm-sha').value===intent.candidate_head_sha&&
    $('git-recovery-consent').checked&&
    $('git-recovery-reason').value.trim().length>=12&&
    $('git-recovery-reason').value.trim().length<=500&&
    (!gitRecoveryPending||$('git-recovery-reason').value.trim()===gitRecoveryPending.reason));
  $('git-recovery-verify').disabled=!matching||!key;
  $('git-recovery-verify').textContent=gitRecoveryPending
    ?'Retry same recovery request':'Verify exact remote evidence';
}
function chooseGitRecovery(job){
  if(gitRecoveryPending){
    recoveryStatus('A recovery request may have been accepted. Retry the same request or clear it explicitly.');
    return;
  }
  if(!gitRecoverySnapshot||!gitRecoverySnapshot.master_live||
    gitRecoverySnapshot.phase!=='RECOVERING'||!job.preflight_eligible){
    recoveryStatus('Selection blocked: Central has no live RECOVERING Master or matching proof preflight.');
    return;
  }
  gitRecoverySelection=job;
  $('git-recovery-ticket').value=job.ticket_id;
  $('git-recovery-expected-head').value=job.candidate_head_sha;
  $('git-recovery-epoch').value=String(gitRecoverySnapshot.epoch);
  $('git-recovery-confirm-sha').value='';
  $('git-recovery-reason').value='';
  $('git-recovery-consent').checked=false;
  recoveryStatus('Review '+job.ticket_id+' ('+job.repository+' / '+job.branch_name+
    '). Type the exact approved commit SHA and your incident reason.');
  updateGitRecoveryAction();
}
function renderGitRecoveryQueue(data){
  const valid=Boolean(data&&Number.isSafeInteger(data.epoch)&&
    typeof data.phase==='string'&&typeof data.master_live==='boolean'&&
    Array.isArray(data.unresolved_jobs)&&data.unresolved_jobs.length<=300);
  gitRecoverySnapshot=valid?data:null;
  const jobs=valid?data.unresolved_jobs:[];
  value('git-recovery-count',valid
    ?jobs.length+' uncertain job(s) · '+data.phase+' · epoch '+data.epoch
    :'Unavailable — check Central API');
  const body=$('git-recovery-jobs');body.replaceChildren();
  for(const job of jobs){
    const tr=document.createElement('tr');
    cell(tr,job.ticket_id);cell(tr,job.git_state);cell(tr,job.task_status);
    cell(tr,job.publication_epoch);cell(tr,job.candidate_head_sha);
    const reasons=Array.isArray(job.blocking_reasons)?job.blocking_reasons:[];
    const reasonLabel={
      MASTER_NOT_LIVE_OR_APPROVED:'Master lease expired, offline or revoked',
      MASTER_NOT_RECOVERING:'Master is not recovering',
      CLUSTER_PAUSED:'Cluster paused',
      PUBLICATION_NOT_PRIOR_EPOCH:'Not an earlier Master epoch',
      TICKET_NOT_IN_RECOVERY_STATE:'Ticket status not eligible',
      QA_NOT_INDEPENDENT:'Developer cannot approve own work',
      MATCHING_QA_RECEIPT_MISSING:'Original independent QA proof missing',
      LIVE_WORKER_LEASE:'Active worker lease must be fenced',
      INVALID_REMOTE_PROOF_METADATA:'Candidate repository, branch or SHA invalid'
    };
    cell(tr,job.preflight_eligible?'Ready for read-only review':
      'BLOCKED: '+(reasons.length
        ?reasons.map(x=>reasonLabel[x]||'Unknown safety check').join('; ')
        :'Central did not authorize review'));
    const td=document.createElement('td'),b=document.createElement('button');
    b.type='button';b.textContent='Review';
    b.disabled=!job.preflight_eligible||!data.master_live||data.phase!=='RECOVERING'||
      Boolean(gitRecoveryPending);
    b.addEventListener('click',()=>chooseGitRecovery(job));td.append(b);tr.append(td);
    body.append(tr);
  }
  if(!jobs.length){
    const tr=document.createElement('tr');const td=document.createElement('td');
    td.colSpan=7;td.textContent=valid?'No unresolved Git publication jobs.':'Recovery queue unavailable.';
    tr.append(td);body.append(tr);
  }
  if(!gitRecoveryPending){
    const still=gitRecoverySelection&&jobs.find(j=>
      j.ticket_id===gitRecoverySelection.ticket_id&&
      j.candidate_head_sha===gitRecoverySelection.candidate_head_sha&&
      j.preflight_eligible&&data.epoch===Number($('git-recovery-epoch').value));
    if(!still&&gitRecoverySelection){
      clearGitRecoveryReview();
      recoveryStatus('Recovery selection invalidated by new Central state; review again.');
    }else if(still)gitRecoverySelection=still;
  }else{
    recoveryStatus('A prior Owner request may have succeeded even if the queue changed. Use Retry with the same exact fields and request ID, or clear the attempt.');
  }
  updateGitRecoveryAction();
}

function renderLeadershipSafety(data){
  // Never infer safe-to-restart or safe-to-elect from an API/transport error.
  const valid=Boolean(data&&data.mode==='OWNER_READ_ONLY_LEADERSHIP_SAFETY'&&
    data.read_only===true&&data.central_state_modified===false&&
    data.automatic_promotion_allowed===false&&
    data.production_release_authorized===false&&
    Number.isSafeInteger(data.epoch)&&Array.isArray(data.reason_codes)&&
    data.reason_codes.length<=20&&
    data.reason_codes.every(x=>typeof x==='string'&&/^[A-Z0-9_]{3,100}$/.test(x)));
  if(!valid){
    value('leadership-safety-status','UNKNOWN — Owner verification required');
    value('leadership-safety-details','Diagnostic unavailable or unverified. Do not infer Master health, promote a PC, remove a local lock, install or retry uncertain work.');
    return;
  }
  value('leadership-safety-status',data.reason_codes.length?
    'Review required · epoch '+data.epoch:'No diagnostic warnings · epoch '+data.epoch);
  const labels={
    CLUSTER_PAUSED_OWNER_REVIEW:'Cluster is paused',
    MASTER_RECOVERY_RECONCILIATION_REQUIRED:'New Master needs recovery/Owner review',
    INITIAL_ELECTION_WAIT_UNTIL_08_IST:'First election waits until 08:00 IST',
    PREVIOUS_MASTER_IDENTITY_EVIDENCE_MISSING:'Previous Master node evidence is missing — HOLD',
    WAITING_FOR_DISTINCT_APPROVED_NODE_HEARTBEAT:'No healthy independent enrolled backup node — HOLD',
    AWAITING_SIGNED_HEARTBEAT_FOR_ELECTION:'Waiting for an authorized signed election heartbeat',
    AWAITING_FIRST_SIGNED_ELECTION_HEARTBEAT:'Waiting for first signed election heartbeat',
    INCONSISTENT_MASTER_PHASE_OWNER_REVIEW:'Master/phase inconsistency — HOLD',
    MASTER_NODE_BINDING_MISSING:'Master node binding missing — HOLD',
    MASTER_LEASE_EXPIRED_AWAITING_SIGNED_HEARTBEAT:'Master lease expired — status view cannot elect',
    MASTER_APPROVAL_OR_FRESH_HEARTBEAT_MISSING:'Master approval/fresh heartbeat unverified',
    BACKUP_NODE_ID_COLLISION_OR_BINDING_MISSING:'Backup node identities conflict or are missing',
    FEWER_THAN_TWO_DISTINCT_BACKUP_NODES:'Fewer than two independently enrolled backup nodes'
  };
  value('leadership-safety-details',
    (data.reason_codes.length?data.reason_codes.map(x=>labels[x]||
      'Unrecognized safety hold ('+x+')').join(' · '):
      'Recorded roles look consistent at this instant (not physical-machine proof).')+
    ' · Distinct approved/fresh node IDs: '+data.approved_fresh_eligible_node_count+
    '. Independent candidate node IDs: '+data.approved_fresh_independent_node_count+
    '. Read only; never a restart, promotion, Git retry or release authorization.');
}

async function refresh(){
  const [cluster,projects,tasks,audit]=await Promise.all([
    request('/v7/cluster'),request('/v7/projects'),request('/v7/tasks'),request('/v7/audit')]);
  const c=cluster.cluster;
  // New Owner diagnostic is optional for older staging builds; unavailable
  // never displays a green/safe-to-continue state.
  let leadershipSafety=null;
  try{leadershipSafety=await request('/v7/owner/leadership-safety');}catch{}
  renderLeadershipSafety(leadershipSafety);
  // Optional migration-sensitive Owner maintenance surface. Keep the core
  // dashboard readable if the new staging schema is not yet provisioned,
  // but disable planning until the server returns valid authoritative rows.
  let maintenance=null;
  try{maintenance=await request('/v7/owner/maintenance');}catch{}
  const maintenanceReady=Array.isArray(maintenance);
  $('plan-maintenance').disabled=!maintenanceReady;
  $('start-pc-drain').disabled=!maintenanceReady;
  $('finalize-pc-drain').disabled=!maintenanceReady;
  $('cancel-maintenance').disabled=!maintenanceReady;
  value('maintenanceCount',maintenanceReady?
    maintenance.length+' records':'Unavailable — schema/health review required');
  rows('maintenance-plans',maintenanceReady?maintenance.map(p=>[
    p.plan_id,p.node_id,p.wave_id,
    p.state+(Number(p.fence_active)===1?' / OWNER RELEASE REQUIRED':''),
    p.expected_epoch,
    Number(p.fence_active)===1?'DURABLE FENCE — no automatic expiry':date(p.expires_at)]):[]);
  // Optional read-only Owner queue. Fail closed if API/schema is unavailable.
  let gitRecovery=null;
  try{gitRecovery=await request('/v7/owner/git-recovery');}catch{}
  renderGitRecoveryQueue(gitRecovery);
  let prQueue=null;
  try{prQueue=await request('/v7/owner/pr-recovery');}catch{}
  renderPrRecovery(prQueue);
  $('maintenance-epoch').value=String(c.epoch);
  value('master',c.master_agent_id||'No Master');value('epoch',c.epoch);
  value('phase',c.phase);value('backup1',c.backup1||'None');value('backup2','Backup 2: '+(c.backup2||'None'));
  value('paused',Number(c.paused)?'PAUSED':'RUNNING');
  value('lease','Lease to: '+date(c.lease_until));
  if(c.elected_at){const seconds=Math.max(0,Math.floor((Date.now()-new Date(c.elected_at+'Z').getTime())/1000));
    value('tenure','Elected '+date(c.elected_at)+' · '+Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m');}
  else value('tenure','Fresh cluster / awaiting candidate');
  value('agentCount',cluster.agents.length+' agents');
  rows('agents',cluster.agents.map(a=>[a.agent_id,a.node_id,a.state+' / '+a.node_state,
    a.last_seen?'Seen '+date(a.last_seen):'Not yet heard']));
  value('projectCount',projects.length+' projects');rows('projects',projects.map(p=>[p.display_name,p.repository,p.status]));
  value('taskCount',tasks.length+' tasks');rows('tasks',tasks.map(t=>[t.ticket_id,t.worker_agent_id,t.status,t.version]));
  value('auditCount',audit.length+' recent');rows('audit',audit.map(a=>[date(a.created_at),a.event_type,a.actor]));
  value('connection','Authenticated · live');$('dashboard').hidden=false;
}
$('connect').onclick=async()=>{clearPrCreation();clearPrRecovery();clearGitRecoveryReview();key=$('key').value;$('key').value='';try{await refresh();message('Authenticated. Data refreshed.');}
  catch(e){key='';$('dashboard').hidden=true;value('connection','Disconnected');message(e.message,true);}
  if(timer)clearInterval(timer);
  if(key)timer=setInterval(()=>refresh().catch(e=>message(e.message,true)),20000);
};
$('disconnect').onclick=()=>{key='';clearPrCreation();clearPrRecovery();clearGitRecoveryReview();gitRecoverySnapshot=null;
  $('node-recovery-local-json').value='';$('node-recovery-pin').value='';
  crosscheckOutput.textContent='Disconnected — pasted local evidence cleared; no authorization.';
  $('dashboard').hidden=true;value('connection','Disconnected');
  if(timer)clearInterval(timer);message('Disconnected. Credentials cleared from memory.');};
$('refresh').onclick=()=>refresh().catch(e=>message(e.message,true));
document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',async()=>{
  const command=button.dataset.command;
  const payload={};
  if(command.endsWith('_NODE'))payload.node_id=$('node-id').value.trim();
  if(command.endsWith('_AGENT')){payload.agent_id=$('agent-id').value.trim();
    payload.master_eligible=$('eligible').checked;payload.qa_eligible=$('qa').checked;}
  if(command==='GRANT_PROJECT_AGENT'||command==='REVOKE_PROJECT_AGENT'){
    payload.project_id=$('access-project-id').value.trim();
    payload.agent_id=$('access-agent-id').value.trim();
    payload.can_develop=$('can-develop').checked;payload.can_qa=$('can-qa').checked;
  }
  if(command==='CREATE_PROJECT'){payload.project_id=$('project-id').value.trim();
    payload.display_name=$('project-name').value.trim();payload.repository=$('repository').value.trim();}
  if(command.endsWith('_PROPOSAL'))payload.proposal_id=$('proposal-id').value.trim();
  if(!confirm('Confirm owner command: '+command+'?'))return;
  try{
    const body={command,request_id:'web_'+crypto.randomUUID().replaceAll('-',''),payload};
    const result=await request('/v7/owner/command',{method:'POST',body:JSON.stringify(body)});
    message('Accepted receipt '+result.receipt_id);await refresh();
  }catch(e){message(e.message,true);}
}));

const maintId=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
$('plan-maintenance').onclick=async()=>{
  const node_id=$('maintenance-node-id').value.trim();
  const wave_id=$('maintenance-wave').value.trim();
  const target_version=$('maintenance-version').value.trim();
  const offer_sha256=$('maintenance-offer-sha').value.trim();
  const expected_epoch=Number($('maintenance-epoch').value);
  if(!/^node_[0-9a-f]{32}$/.test(node_id)||
    !/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(wave_id)||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(target_version)||
    !/^[0-9a-f]{64}$/.test(offer_sha256)||
    !Number.isSafeInteger(expected_epoch)||expected_epoch<1){
    message('Provide exact node ID, wave, stable version, Owner-signed offer SHA and current epoch.',true);
    return;
  }
  if(!confirm('Record a 5-minute OWNER MAINTENANCE INTENT for '+node_id+
    '? This does NOT authorize or run an installer.'))return;
  const plan_id='plan_'+crypto.randomUUID().replaceAll('-','');
  try{
    const result=await request('/v7/owner/command',{method:'POST',
      body:JSON.stringify({request_id:'maint_'+crypto.randomUUID().replaceAll('-',''),
        command:'PLAN_PC_UPDATE',
        payload:{plan_id,node_id,wave_id,target_version,offer_sha256,expected_epoch}})});
    message('INTENT ONLY recorded: '+result.state.plan_id+
      '. Installer execution NOT approved. Expires in 5 minutes.');
    $('maintenance-cancel-id').value=result.state.plan_id;
    await refresh();
  }catch(e){message('Maintenance plan BLOCKED: '+e.message,true);}
};
async function submitDrain(command,label){
  const plan_id=$('maintenance-drain-id').value.trim();
  if(!maintId.test(plan_id)){message('Valid exact plan ID required to manage drain.',true);return;}
  const description=command==='START_PC_DRAIN'?
    'start a durable fence blocking NEW tasks (existing work continues)':
    'mark this PC DRAINED only after Central verifies no unfinished work';
  if(!confirm('Owner confirmation: '+description+' for '+plan_id+
    '? This does NOT authorize an installer.'))return;
  try{
    const response=await request('/v7/owner/command',{method:'POST',
      body:JSON.stringify({request_id:'drain_'+crypto.randomUUID().replaceAll('-',''),
        command,payload:{plan_id}})});
    message(label+': '+response.state.state+'. Installer execution still NOT approved.');
    $('maintenance-cancel-id').value=plan_id;
    await refresh();
  }catch(e){message(label+' BLOCKED: '+e.message,true);}
}
$('start-pc-drain').onclick=()=>submitDrain('START_PC_DRAIN','Durable fence');
$('finalize-pc-drain').onclick=()=>submitDrain('FINALIZE_PC_DRAIN','Drain validation');

$('cancel-maintenance').onclick=async()=>{
  const plan_id=$('maintenance-cancel-id').value.trim();
  if(!maintId.test(plan_id)){message('Valid exact plan ID required to cancel.',true);return;}
  if(!confirm('RELEASE Owner maintenance fence for '+plan_id+
    '? New task claims and leader candidacy may resume immediately. Do not release'+
    ' if any real PC maintenance is underway. This does NOT install software.'))return;
  try{
    await request('/v7/owner/command',{method:'POST',
      body:JSON.stringify({request_id:'maint_'+crypto.randomUUID().replaceAll('-',''),
        command:'CANCEL_PC_UPDATE',payload:{plan_id}})});
    message('Maintenance plan cancelled and any durable task fence RELEASED.'+
      ' New work may resume. No installer or agent was operated.');
    await refresh();
  }catch(e){message('Cancellation failed: '+e.message,true);}
};

async function gitOperation(pathname){
  const ticket_id=$('git-ticket-id').value.trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(ticket_id)){message('Valid ticket ID required',true);return;}
  if(!confirm('Perform Owner-authorized Git verification for '+ticket_id+'? This will never merge main.'))return;
  try{
    const body={request_id:'git_'+crypto.randomUUID().replaceAll('-',''),ticket_id};
    const response=await request(pathname,{method:'POST',body:JSON.stringify(body)});
    message('Git operation accepted: '+JSON.stringify(response).slice(0,600));
    await refresh();
  }catch(e){message(e.message,true);}
}
$('merge-verify-consent').addEventListener('change',updatePrAction);
$('pr-review-inspect').onclick=async()=>{
  prReviewSnapshot=null;mergeVerifyPending=null;updatePrAction();
  const ticket=$('git-ticket-id').value.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(ticket)){
    value('pr-review-summary','Enter a valid exact ticket ID first.');return;
  }
  try{
    const snapshot=await request('/v7/owner/pr-review/'+encodeURIComponent(ticket));
    if(snapshot.ticket_id!==ticket||!gitHead.test(snapshot.expected_head_sha)||
       !Number.isSafeInteger(snapshot.pr_number)||snapshot.pr_number<1||
       snapshot.read_only!==true||snapshot.merge_performed!==false)
      throw Error('PR_REVIEW_SNAPSHOT_UNTRUSTED');
    prReviewSnapshot=snapshot;
    const x=snapshot.review||{};
    value('pr-review-summary',
      'GitHub PR #'+snapshot.pr_number+
      ' at '+snapshot.expected_head_sha+
      ' · '+(x.draft===true?'DRAFT':'Review/merge status')+
      ' · checks: '+(x.checks_passed===true?'PASS':'NOT VERIFIED')+
      ' · independent approvals: '+(x.independent_approvals??0)+
      '/'+(x.required_approvals??'?')+
      ' · ready for manual merge: '+(x.ready_for_manual_merge===true?'YES':'NO')+
      ' · blockers: '+(Array.isArray(x.blocks)?x.blocks.join(', '):'unavailable')+
      '. Read-only snapshot; never bypass GitHub branch protections.');
    updatePrAction();
  }catch(e){
    value('pr-review-summary','Review/CI inspection blocked: '+e.message);
    updatePrAction();
  }
};
$('verify-merge').onclick=async()=>{
  updatePrAction();if($('verify-merge').disabled)return;
  const snap=prReviewSnapshot;
  const intent=mergeVerifyPending||{
    request_id:'mergeverify_'+crypto.randomUUID().replaceAll('-',''),
    ticket_id:snap.ticket_id,
    expected_remote_head_sha:snap.expected_head_sha,
    expected_pr_number:snap.pr_number,
    owner_review_note:$('pr-owner-note').value.trim(),
    owner_confirmed_readonly_verification:true
  };
  if(!confirm('VERIFY EXTERNAL MERGE ONLY: exact GitHub PR #'+intent.expected_pr_number+
    ' at '+intent.expected_remote_head_sha+
    ' for ticket '+intent.ticket_id+
    '. Central will READ GitHub and mark DONE ONLY if remote merge, human review, exact HEAD/tree and CI all verify. This will NEVER merge or push main.'))return;
  mergeVerifyPending=intent;updatePrAction();
  try{
    const result=await request('/v7/tasks/verify-merge',{
      method:'POST',body:JSON.stringify(intent)});
    if(result.accepted!==true||result.ticket_id!==intent.ticket_id||
       result.status!=='DONE'||result.read_only!==true||
       result.merge_performed!==false||
       result.github?.headSha!==intent.expected_remote_head_sha||
       result.github?.prNumber!==intent.expected_pr_number)
      throw Error('MERGE_VERIFICATION_RECEIPT_UNTRUSTED');
    message('Exact externally merged PR verified at '+result.github.mergeSha+
      '. Ticket DONE. Central did NOT merge/push/deploy.');
    prReviewSnapshot=null;mergeVerifyPending=null;updatePrAction();
    await refresh();
  }catch(e){
    value('pr-review-summary','External merge NOT verified: '+e.message+
      '. Review real GitHub status. An ambiguous response may be retried ONLY with the same request ID and exact inputs.');
    message('Merge verification blocked/uncertain: '+e.message,true);
    updatePrAction();
  }
};
$('git-ticket-id').addEventListener('input',clearPrCreation);
for(const id of ['pr-confirm-head','pr-owner-note']){
  $(id).addEventListener('input',updatePrAction);
}
$('pr-consent').addEventListener('change',updatePrAction);
$('pr-preflight').onclick=async()=>{
  clearPrCreation();
  const ticket=$('git-ticket-id').value.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(ticket)){
    prStatus('Valid exact ticket ID required.');return;
  }
  try{
    const p=await request('/v7/owner/pr-preflight/'+encodeURIComponent(ticket));
    if(!p.git_published_verified||!gitHead.test(p.candidate_head_sha)||
       p.ticket_id!==ticket)throw Error('PR_PREFLIGHT_UNTRUSTED');
    prSelected=p;$('pr-expected-head').value=p.candidate_head_sha;
    prStatus(p.ready_for_owner_intent?
      'Ready only for ONE Owner-confirmed draft: '+p.repository+'/'+p.branch+
      ' from '+p.base_branch+' at '+p.candidate_head_sha:
      'Not ready: creation disabled, Master unavailable, PR already registered or pending Owner recovery.');
    updatePrAction();
  }catch(e){prStatus('PR preflight denied: '+e.message);}
};
$('draft-pr').onclick=async()=>{
  updatePrAction();if($('draft-pr').disabled)return;
  const p=prSelected;
  const intent={request_id:'prdraft_'+crypto.randomUUID().replaceAll('-',''),
    ticket_id:p.ticket_id,expected_remote_head_sha:p.candidate_head_sha,
    expected_candidate_tree_sha:p.candidate_tree_sha,
    owner_confirmed_draft_only:true,owner_review_note:$('pr-owner-note').value.trim()};
  if(!confirm('CREATE one real Draft PR for '+p.repository+'/'+p.branch+
    ' at exact head '+p.candidate_head_sha+' into '+p.base_branch+
    '? This is a GitHub WRITE (Draft PR only). A lost response requires Owner read-only recovery; NEVER create a second PR.'))return;
  prCreationAttempt=intent;updatePrAction();
  prStatus('One-shot PR creation intent submitted. Do not create again if outcome is uncertain.');
  try{
    const v=await request('/v7/git/pr-draft',{method:'POST',body:JSON.stringify(intent)});
    if(v.accepted!==true||v.head_sha!==p.candidate_head_sha||
       v.merge_performed!==false||v.draft!==true)
      throw Error('PR_RESPONSE_REVIEW_REQUIRED');
    prStatus('Draft PR '+v.url+' verified; external human review and required CI remain mandatory. NO merge.');
    await refresh();
  }catch(e){
    prStatus('PR outcome uncertain: '+e.message+
      '. DO NOT retry Create. Inspect GitHub then use the Owner read-only PR recovery queue.');
    message('Draft PR requires Owner reconciliation: '+e.message,true);
    refresh().catch(()=>{});
  }
};
for(const id of ['pr-recovery-confirm-head','pr-recovery-reason']){
  $(id).addEventListener('input',updatePrRecovery);
}
$('pr-recovery-consent').addEventListener('change',updatePrRecovery);
$('pr-recovery-clear').onclick=()=>{
  clearPrRecovery();
  value('pr-recovery-status','Cleared local selection; the durable Central attempt remains. NO second PR POST.');
};
$('pr-recovery-verify').onclick=async()=>{
  updatePrRecovery();if($('pr-recovery-verify').disabled)return;
  const j=prRecoverySelected;
  const intent=prRecoveryPending||{
    request_id:'prrecover_'+crypto.randomUUID().replaceAll('-',''),
    ticket_id:j.ticket_id,expected_remote_head_sha:j.remote_head_sha,
    reason:$('pr-recovery-reason').value.trim(),
    owner_confirmed_readonly_proof:true
  };
  if(!confirm('READ-ONLY GitHub inspection of an EXISTING Draft PR for '+
    j.ticket_id+' at '+j.remote_head_sha+'? No PR will be created, pushed or merged.'))return;
  prRecoveryPending=intent;updatePrRecovery();
  value('pr-recovery-status','Verifying existing remote PR read-only. Never resubmit Create.');
  try{
    const v=await request('/v7/git/pr-recover-readonly',{
      method:'POST',body:JSON.stringify(intent)});
    if(v.accepted!==true||v.head_sha!==j.remote_head_sha||
      v.recovered_readonly!==true||v.second_pr_create_attempt!==false)
      throw Error('PR_RECOVERY_RECEIPT_MISMATCH');
    clearPrRecovery();
    value('pr-recovery-status','Existing remote Draft PR '+v.url+
      ' verified. No new PR created. Human review and CI still required.');
    await refresh();
  }catch(e){
    value('pr-recovery-status','Read-only recovery uncertain: '+e.message+
      '. Retry this SAME recovery request only; NEVER re-create PR.');
    message('PR recovery not complete: '+e.message,true);
    updatePrRecovery();
  }
};


for(const id of ['git-recovery-confirm-sha','git-recovery-reason']){
  $(id).addEventListener('input',updateGitRecoveryAction);
}
$('git-recovery-consent').addEventListener('change',updateGitRecoveryAction);
$('git-recovery-clear').onclick=()=>{
  clearGitRecoveryReview();
  recoveryStatus('Review cleared locally. This does NOT revoke a Central receipt or retry a Git push.');
  refresh().catch(e=>message(e.message,true));
};
$('git-recovery-verify').onclick=async()=>{
  updateGitRecoveryAction();
  if($('git-recovery-verify').disabled)return;
  const intent=gitRecoveryPending||{
    request_id:'gitrecover_'+crypto.randomUUID().replaceAll('-',''),
    ticket_id:gitRecoverySelection.ticket_id,
    expected_master_epoch:gitRecoverySnapshot.epoch,
    candidate_head_sha:gitRecoverySelection.candidate_head_sha,
    reason:$('git-recovery-reason').value.trim(),
    owner_confirmed_readonly_proof:true
  };
  if(!confirm('Owner review only: verify exact GitHub HEAD '+intent.candidate_head_sha+
    ' for ticket '+intent.ticket_id+' against Central QA evidence? This performs READ-ONLY GitHub requests and no push or merge.'))return;
  // Keep this exact request ID in tab memory after any unknown network outcome.
  // It is intentionally not persisted in localStorage/cookies or a URL.
  gitRecoveryPending=intent;
  updateGitRecoveryAction();
  recoveryStatus('Checking read-only remote evidence. Do not run a Git push or task retry.');
  try{
    const result=await request('/v7/git/recover-remote-proof',{
      method:'POST',body:JSON.stringify({
        request_id:intent.request_id,ticket_id:intent.ticket_id,
        expected_master_epoch:intent.expected_master_epoch,
        reason:intent.reason,owner_confirmed_readonly_proof:true
      })});
    if(!result.accepted||result.ticket_id!==intent.ticket_id||
      result.remote_head_sha!==intent.candidate_head_sha||
      result.merge_performed!==false||result.automatic_retry_allowed!==false)
      throw new Error('UNEXPECTED_RECOVERY_RECEIPT_REVIEW_REQUIRED');
    clearGitRecoveryReview();
    recoveryStatus('Exact remote commit verified for '+intent.ticket_id+
      '; Git job confirmed, NO push or merge. Independent merge verification remains required.');
    await refresh();
  }catch(e){
    recoveryStatus('Recovery not confirmed: '+e.message+
      '. Retry with the same fields and request ID if the response was lost. Never repush based on this failure.');
    message('Git recovery not confirmed: '+e.message,true);
    updateGitRecoveryAction();
  }
};
