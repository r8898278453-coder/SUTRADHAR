/**
 * Offline acceptance-evidence verifier. This is a reviewer aid, NOT a release
 * authorization, deployment gate, signing operation, installer lease, or proof
 * that a real-world test took place. All receipts require independent review.
 * No network access and no writes. Never accepts a private key.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const GATES=['G0','G1','G2','G3','G4','G5','G6','G7'];
const ENV={G0:'ci',G1:'hostinger-staging',G2:'hostinger-staging',G3:'windows-signer',G4:'physical-windows',G5:'physical-windows',G6:'physical-windows',G7:'owner-review'};
const REQUIRED=['gate_id','status','reviewer','reviewed_at_utc','exact_git_sha','environment','evidence_location','evidence_sha256','test_case_ids','limitations','owner_approval_reference'];
function deny(code){return {accepted:false,error_code:code,production_release_authorized:false};}
function evaluate({envelope,ownerPublicKeyPem,expectedSha,now=Date.now()}){
  try{
    if(typeof expectedSha!=='string'||!SHA.test(expectedSha)||!Number.isSafeInteger(now)||now<0)
      return deny('ACCEPTANCE_CHECK_INPUT_INVALID');
    if(typeof ownerPublicKeyPem!=='string'||ownerPublicKeyPem.length>10000)
      return deny('ACCEPTANCE_OWNER_PUBLIC_KEY_REQUIRED');
    const key=crypto.createPublicKey(ownerPublicKeyPem);
    if(key.asymmetricKeyType!=='ed25519')return deny('ACCEPTANCE_WRONG_KEY_TYPE');
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||
      Object.keys(envelope).sort().join('|')!=='payload|signature_base64')
      return deny('ACCEPTANCE_ENVELOPE_INVALID');
    const p=envelope.payload;
    if(!p||typeof p!=='object'||Array.isArray(p)||
      Object.keys(p).sort().join('|')!=='expires_at_ms|gates|issued_at_ms|schema|source_sha'||
      p.schema!==1||p.source_sha!==expectedSha||
      !Number.isSafeInteger(p.issued_at_ms)||!Number.isSafeInteger(p.expires_at_ms)||
      p.issued_at_ms>now+120000||p.expires_at_ms<=now||
      p.expires_at_ms<=p.issued_at_ms||p.expires_at_ms-p.issued_at_ms>7*86400000)
      return deny('ACCEPTANCE_PAYLOAD_INVALID');
    if(typeof envelope.signature_base64!=='string'||
      !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature_base64))
      return deny('ACCEPTANCE_SIGNATURE_INVALID');
    if(!crypto.verify(null,Buffer.from('SUTRADHAR_OWNER_ACCEPTANCE_V1\n'+JSON.stringify(p)),
      key,Buffer.from(envelope.signature_base64,'base64')))
      return deny('ACCEPTANCE_SIGNATURE_INVALID');
    if(!Array.isArray(p.gates)||p.gates.length!==8)return deny('ACCEPTANCE_GATES_INCOMPLETE');
    const seen=new Set();
    for(const g of p.gates){
      if(!g||typeof g!=='object'||Array.isArray(g)||
        Object.keys(g).sort().join('|')!==REQUIRED.slice().sort().join('|')||
        !GATES.includes(g.gate_id)||seen.has(g.gate_id)||g.status!=='PASS'||
        g.environment!==ENV[g.gate_id]||g.exact_git_sha!==expectedSha)
        return deny('ACCEPTANCE_GATE_INVALID');
      seen.add(g.gate_id);
      if(typeof g.reviewer!=='string'||g.reviewer.trim().length<3||g.reviewer.length>120||
        typeof g.reviewed_at_utc!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(g.reviewed_at_utc)||
        !Number.isFinite(Date.parse(g.reviewed_at_utc))||
        Date.parse(g.reviewed_at_utc)>now+120000||
        Date.parse(g.reviewed_at_utc)<p.issued_at_ms-7*86400000||
        typeof g.evidence_location!=='string'||g.evidence_location.length<8||
        g.evidence_location.length>500||!HEX.test(g.evidence_sha256)||
        !Array.isArray(g.test_case_ids)||!g.test_case_ids.length||
        g.test_case_ids.length>100||g.test_case_ids.some(x=>typeof x!=='string'||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(x))||
        typeof g.limitations!=='string'||g.limitations.length>1000||
        typeof g.owner_approval_reference!=='string'||
        g.owner_approval_reference.trim().length<8||g.owner_approval_reference.length>500)
        return deny('ACCEPTANCE_EVIDENCE_INVALID');
    }
    if(seen.size!==GATES.length)return deny('ACCEPTANCE_GATES_INCOMPLETE');
    return {accepted:true,production_release_authorized:false,
      status:'SIGNED_EVIDENCE_FORMAT_VALID_ONLY',source_sha:expectedSha,
      verified_gates:GATES.slice(),expires_at_ms:p.expires_at_ms,
      warning:'Human review of underlying evidence, protected branch controls and separate Owner production approval remain mandatory.'};
  }catch{return deny('ACCEPTANCE_VERIFICATION_FAILED');}
}
function main(){
  const file=process.env.SUTRADHAR_OWNER_ACCEPTANCE_FILE;
  const pub=process.env.SUTRADHAR_OWNER_ACCEPTANCE_PUBLIC_KEY_FILE;
  if(!file||!pub||!path.isAbsolute(file)||!path.isAbsolute(pub)){
    console.error('ACCEPTANCE_ABSOLUTE_PATHS_REQUIRED');process.exitCode=1;return;
  }
  try{
    for(const p of [file,pub]){
      const st=fs.lstatSync(p);
      if(!st.isFile()||st.isSymbolicLink()||st.size>131072||st.size<1)
        throw Error('ACCEPTANCE_INPUT_FILE_INVALID');
    }
    const result=evaluate({envelope:JSON.parse(fs.readFileSync(file,'utf8')),
      ownerPublicKeyPem:fs.readFileSync(pub,'utf8'),
      expectedSha:process.env.SUTRADHAR_EXPECTED_COMMIT_SHA});
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }catch{console.error('ACCEPTANCE_INPUT_UNAVAILABLE_OR_INVALID');process.exitCode=1;}
}
if(require.main===module)main();
module.exports={evaluate,GATES};
