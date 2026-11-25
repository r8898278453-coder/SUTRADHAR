/**
 * Owner-controlled OFFLINE release offer signing.
 * Requires a locally Authenticode-verified installer and matching release
 * evidence, plus the protected Ed25519 Owner release key. No upload/install.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyWindowsPublisher}=require('../../apps/desktop/windows-authenticode.cjs');
const {sha256File}=require('../../apps/desktop/update-policy.cjs');
function requireEnv(n){const x=process.env[n];if(!x||!x.trim())throw Error('OWNER_OFFER_BLOCKED: missing '+n);return x.trim();}
function refuse(s){throw Error('OWNER_OFFER_BLOCKED: '+s);}
function main(){
  if(process.platform!=='win32')refuse('must verify Authenticode on Windows');
  if(process.env.SUTRADHAR_OWNER_ROLLOUT_APPROVED!=='yes')refuse('explicit Owner release approval required');
  const kind=requireEnv('SUTRADHAR_UPDATE_KIND');
  if(!['update','rollback'].includes(kind))refuse('invalid update type');
  if(kind==='rollback'&&process.env.SUTRADHAR_OWNER_EMERGENCY_ROLLBACK_APPROVED!=='yes')
    refuse('emergency rollback requires separate Owner approval');
  const version=requireEnv('SUTRADHAR_RELEASE_VERSION');
  if(!/^\d+\.\d+\.\d+$/.test(version))refuse('stable version required');
  const sha=requireEnv('SUTRADHAR_EXPECTED_COMMIT_SHA');
  if(!/^[0-9a-f]{40}$/.test(sha))refuse('source SHA invalid');
  // An Owner approval is for a concrete wave on known enrolled PCs, not
  // a globally reusable release offer shared across all SUTRADHAR devices.
  const waveId=requireEnv('SUTRADHAR_ROLLOUT_WAVE_ID');
  if(!/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(waveId))
    refuse('approved wave ID must begin with wave_');
  const targets=requireEnv('SUTRADHAR_ROLLOUT_NODE_IDS').split(',');
  if(targets.length<1||targets.length>10||
    targets.some(id=>!/^node_[0-9a-f]{32}$/.test(id))||
    new Set(targets).size!==targets.length)
    refuse('explicit unique Owner-approved node IDs required, maximum ten');
  const signer=requireEnv('SUTRADHAR_WINDOWS_PUBLISHER_NAME');
  if(!/^CN=.{1,220}$/.test(signer))refuse('publisher subject invalid');
  const file=requireEnv('SUTRADHAR_INSTALLER_PATH');
  if(!path.isAbsolute(file)||!/^SUTRADHAR[-_ A-Za-z0-9.()]+\.exe$/.test(path.basename(file)))
    refuse('trusted absolute installer path required');
  const evidenceFile=path.join(path.dirname(file),'signed-release-evidence.json');
  const evidenceStat=fs.lstatSync(evidenceFile);
  if(!evidenceStat.isFile()||evidenceStat.isSymbolicLink()||
     evidenceStat.size<20||evidenceStat.size>65536)
    refuse('local signing evidence file untrusted');
  const evidence=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
  const stats=fs.lstatSync(file);
  if(!stats.isFile()||stats.isSymbolicLink()||
    stats.size<1000||stats.size>1024*1024*1024)
    refuse('signed installer must be a regular bounded Windows executable');
  const hash=sha256File(file);
  if(evidence.local_signing_verified!==true||evidence.source_sha!==sha||
    evidence.version!==version||!Array.isArray(evidence.installers)||
    !evidence.installers.some(x=>x.filename===path.basename(file)&&
      x.sha256===hash&&x.signer===signer&&x.verified===true))
    refuse('signed installer local evidence mismatch');
  // Use the same pinned absolute Windows system binary, escaped PowerShell
  // literal and before/after bytes checks as the Desktop installer verifier.
  // JSON.stringify() double-quoted paths were unsafe for PowerShell $().
  try{
    const verified=verifyWindowsPublisher({
      installerPath:file,publisherSubject:signer,expectedSha256:hash
    });
    if(verified.verified!==true||verified.file_sha256!==hash||
       verified.installer_execution_allowed!==false)
      refuse('Windows signature/publisher verification incomplete');
  }catch{refuse('Windows signature/publisher verification failed');}
  if(sha256File(file)!==hash)
    refuse('installer bytes changed during Authenticode verification');
  const keyPath=requireEnv('SUTRADHAR_RELEASE_SIGNING_KEY_FILE');
  if(!path.isAbsolute(keyPath))refuse('Owner signer key must use an absolute path');
  const repoRoot=path.resolve(__dirname,'../..');
  const keyStat=fs.lstatSync(keyPath);
  if(!keyStat.isFile()||keyStat.isSymbolicLink()||
     keyStat.size<100||keyStat.size>16384)
    refuse('Owner signing key file untrusted');
  const realKey=fs.realpathSync(keyPath);
  const insideRepo=realKey===repoRoot||realKey.startsWith(repoRoot+path.sep);
  if(insideRepo)refuse('Owner signing private key MUST be outside Git repository');
  const privateKey=crypto.createPrivateKey(fs.readFileSync(keyPath));
  if(privateKey.asymmetricKeyType!=='ed25519')refuse('Owner release signing key must be Ed25519');
  const now=Date.now();
  const body={schema:2,application:'desktop',channel:'stable',type:kind,
    version,source_sha:sha,protocol:7,filename:path.basename(file),
    installer_sha256:hash,installer_bytes:stats.size,
    publisher_subject:signer,issued_ms:now,expires_ms:now+7*86400000,
    rollout:{wave_id:waveId,node_ids:targets,owner_approved_at_ms:now}};
  if(kind==='rollback')body.owner_emergency_rollback_approved=true;
  const signature_base64=crypto.sign(null,Buffer.from(JSON.stringify(body)),
    privateKey).toString('base64');
  const envelope={signed:body,signature_base64};
  const destination=path.join(path.dirname(file),'SUTRADHAR Desktop.offer.json');
  if(fs.existsSync(destination))refuse('existing signed offer cannot be overwritten');
  // An interrupted write is UNKNOWN: leave any partial file in place for
  // explicit Owner review. Never regenerate a new signed offer over it.
  const fd=fs.openSync(destination,'wx',0o600);
  try{
    fs.writeFileSync(fd,JSON.stringify(envelope,null,2)+'\n');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  console.log(JSON.stringify({offer:destination,sha256:hash,type:kind,version,
    wave_id:waveId,target_node_count:targets.length,published:false,automatic_update:false}));
}
main();
