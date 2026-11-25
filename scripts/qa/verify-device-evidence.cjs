#!/usr/bin/env node
/**
 * Owner-only, offline verification of QA device-signed evidence. The trusted
 * public key MUST be obtained independently from approved Central enrollment
 * records, not from the transferred evidence/attestation files.
 *
 * Usage:
 * node scripts/qa/verify-device-evidence.cjs <qa_result.json>
 *      <qa_attested.json> <approved_public_key.pem>
 *      <expected_node_id> <expected_qa_agent_id>
 *      <expected_ticket_id> <expected_head_sha> <expected_tree_sha>
 *
 * Never contacts Central, runs untrusted code, or changes ticket status.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {verifyQaEvidence}=require('../../apps/desktop/qa-evidence.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[a-f0-9]{40}$/;
function safeRead(p,max){
  if(!path.isAbsolute(p))throw Error('QA_OWNER_VERIFY_ABSOLUTE_PATH_REQUIRED');
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.size===0||s.size>max)
    throw Error('QA_OWNER_VERIFY_UNTRUSTED_FILE');
  return fs.readFileSync(p);
}
function main(args){
  if(args.length!==8||!/^node_[a-f0-9]{32}$/.test(args[3]||'')||
    !ID.test(args[4]||'')||!ID.test(args[5]||'')||
    !SHA.test(args[6]||'')||!SHA.test(args[7]||''))
    throw Error('QA_OWNER_VERIFY_EXACT_INPUTS_REQUIRED');
  const raw=safeRead(args[0],16*1024);
  const attestation=JSON.parse(safeRead(args[1],8192).toString('utf8'));
  const expectedPublicKeyPem=safeRead(args[2],8192).toString('utf8');
  const result=verifyQaEvidence({attestation,evidenceRaw:raw,
    expectedPublicKeyPem,expectedNodeId:args[3],
    expectedAgentId:args[4],expectedTicketId:args[5],
    expectedHead:args[6],expectedTree:args[7]});
  return {...result,owner_central_approval_required:true,
    production_approved:false};
}
if(require.main===module){
  try{
    const report=main(process.argv.slice(2));
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }catch(e){
    process.stderr.write('QA verification blocked: '+String(e?.message||e)+'\n');
    process.exitCode=1;
  }
}
module.exports={main};
