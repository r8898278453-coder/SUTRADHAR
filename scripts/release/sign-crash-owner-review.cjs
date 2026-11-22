/**
 * Owner-initiated OFFLINE sign of exact crash evidence review (NOT a grant).
 * Requires an independent Owner Ed25519 key and explicit acknowledgement.
 * No Central token, network, child process, marker or installer is involved.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createReviewManifest,evidenceInputFromEnv,canonical,SIGN_DOMAIN}=
  require('../ops/crash-owner-review.cjs');
function fail(code){throw Error('CRASH_REVIEW_SIGN_'+code);}
function normalizedPath(value){
  let s=path.normalize(value);
  if(process.platform==='win32'){
    const extended=String.fromCharCode(92,92,63,92);
    if(s.startsWith(extended))s=s.slice(extended.length);
    s=s.toLowerCase();
  }
  return s;
}
function externalPath(file){
  // Node accepts absolute paths that still contain '..'; compare resolved
  // paths and the *physical* parent, not the original spelling.
  const repo=path.resolve(__dirname,'../..');
  if(typeof file!=='string'||file.length>2048||!path.isAbsolute(file))
    fail('EXTERNAL_PATH_REQUIRED');
  const output=path.resolve(file),repoReal=fs.realpathSync.native(repo);
  const underRepo=value=>{
    const x=normalizedPath(value),root=normalizedPath(repoReal);
    return x===root||x.startsWith(root+path.sep);
  };
  const parent=path.dirname(output);
  const parentReal=fs.realpathSync.native(parent);
  if(underRepo(output)||underRepo(parentReal))
    fail('EXTERNAL_PATH_REQUIRED');
  // Reject symlink/junction parent redirection. This protects the Owner key
  // and output from being silently redirected through an alias.
  if(normalizedPath(parentReal)!==normalizedPath(parent))
    fail('EXTERNAL_PARENT_REDIRECTED');
  const st=fs.lstatSync(parent);
  if(!st.isDirectory()||st.isSymbolicLink())
    fail('EXTERNAL_PARENT_UNSAFE');
  return output;
}
function main(){
  if(process.env.SUTRADHAR_OWNER_CRASH_EVIDENCE_REVIEW_APPROVED!=='yes')
    fail('EXPLICIT_OWNER_REVIEW_REQUIRED');
  const input=evidenceInputFromEnv();
  const manifest=createReviewManifest(input);
  const now=Date.now();
  if(now-manifest.second_central_observed_at_ms>5*60000||
     manifest.second_central_observed_at_ms>now+60000)
    fail('STALE_CENTRAL_OBSERVATION');
  const keyPath=externalPath(process.env.SUTRADHAR_CRASH_OWNER_SIGNING_KEY_FILE);
  const outputPath=externalPath(process.env.SUTRADHAR_CRASH_OWNER_REVIEW_OUTPUT);
  if(keyPath===outputPath)fail('KEY_AND_OUTPUT_COLLIDE');
  const st=fs.lstatSync(keyPath);
  if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>16384)
    fail('SIGNING_KEY_FILE_UNSAFE');
  const key=crypto.createPrivateKey(fs.readFileSync(keyPath));
  if(key.asymmetricKeyType!=='ed25519')fail('ED25519_OWNER_KEY_REQUIRED');
  const note=process.env.SUTRADHAR_CRASH_OWNER_REVIEW_NOTE||'';
  if(note.trim().length<40||note.length>800)fail('OWNER_NOTE_REQUIRED');
  const signed={schema:1,action:'ACKNOWLEDGE_CRASH_EVIDENCE_REVIEW_ONLY',
    node_id:manifest.node_id,
    independent_enrollment_fingerprint_sha256:
      manifest.independent_enrollment_fingerprint_sha256,
    manifest_sha256:manifest.manifest_sha256,
    review_id:crypto.randomBytes(32).toString('hex'),
    review_note:note,issued_at_ms:now,expires_at_ms:now+5*60000,
    agent_restart_allowed:false,marker_removal_allowed:false,
    installer_execution_allowed:false,production_release_authorized:false};
  const signature_base64=crypto.sign(null,
    Buffer.from(SIGN_DOMAIN+canonical(signed),'utf8'),key).toString('base64');
  const fd=fs.openSync(outputPath,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({signed,signature_base64},null,2)+'\n');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  console.log(JSON.stringify({file:outputPath,
    review_id:signed.review_id,manifest_sha256:manifest.manifest_sha256,
    owner_review_only:true,one_time_replay_enforcement:false,
    agent_restart_allowed:false,marker_removal_allowed:false,
    installer_execution_allowed:false,production_release_authorized:false}));
}
if(require.main===module)try{main();}catch(e){
  console.error(String(e.message||e));process.exitCode=1;
}
module.exports={main,externalPath};
