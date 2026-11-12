/**
 * Owner-controlled OFFLINE release offer signing.
 * Requires a locally Authenticode-verified installer and matching release
 * evidence, plus the protected Ed25519 Owner release key. No upload/install.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cp=require('node:child_process');
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
  const signer=requireEnv('SUTRADHAR_WINDOWS_PUBLISHER_NAME');
  if(!/^CN=.{1,220}$/.test(signer))refuse('publisher subject invalid');
  const file=requireEnv('SUTRADHAR_INSTALLER_PATH');
  if(!path.isAbsolute(file)||!/^SUTRADHAR[-_ A-Za-z0-9.()]+\.exe$/.test(path.basename(file)))
    refuse('trusted absolute installer path required');
  const evidenceFile=path.join(path.dirname(file),'signed-release-evidence.json');
  const evidence=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
  const bytes=fs.readFileSync(file);
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(evidence.local_signing_verified!==true||evidence.source_sha!==sha||
    evidence.version!==version||!Array.isArray(evidence.installers)||
    !evidence.installers.some(x=>x.filename===path.basename(file)&&
      x.sha256===hash&&x.signer===signer&&x.verified===true))
    refuse('signed installer local evidence mismatch');
  const powershell='$s=Get-AuthenticodeSignature -LiteralPath '+JSON.stringify(file)+
    ';if($s.Status -ne "Valid" -or $null -eq $s.SignerCertificate){exit 41};'+
    'if($s.SignerCertificate.Subject -cne '+JSON.stringify(signer)+'){exit 42}';
  const check=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',powershell],
    {timeout:30000,encoding:'utf8',windowsHide:true});
  if(check.error||check.status!==0)refuse('Windows signature/publisher verification failed');
  const keyPath=requireEnv('SUTRADHAR_RELEASE_SIGNING_KEY_FILE');
  if(!path.isAbsolute(keyPath))refuse('signer key must be outside a relative repository path');
  const privateKey=crypto.createPrivateKey(fs.readFileSync(keyPath));
  if(privateKey.asymmetricKeyType!=='ed25519')refuse('Owner release signing key must be Ed25519');
  const now=Date.now();
  const body={schema:1,application:'desktop',channel:'stable',type:kind,
    version,source_sha:sha,protocol:7,filename:path.basename(file),
    installer_sha256:hash,installer_bytes:bytes.length,
    publisher_subject:signer,issued_ms:now,expires_ms:now+7*86400000};
  if(kind==='rollback')body.owner_emergency_rollback_approved=true;
  const signature_base64=crypto.sign(null,Buffer.from(JSON.stringify(body)),
    privateKey).toString('base64');
  const envelope={signed:body,signature_base64};
  const destination=path.join(path.dirname(file),'SUTRADHAR Desktop.offer.json');
  if(fs.existsSync(destination))refuse('existing signed offer cannot be overwritten');
  fs.writeFileSync(destination,JSON.stringify(envelope,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({offer:destination,sha256:hash,type:kind,version,
    published:false,automatic_update:false}));
}
main();
