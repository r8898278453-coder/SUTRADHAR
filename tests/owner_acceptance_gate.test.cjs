'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {evaluate,GATES}=require('../scripts/release/verify-owner-acceptance.cjs');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const pub=publicKey.export({format:'pem',type:'spki'});
const sha='a'.repeat(40),now=Date.parse('2026-11-17T12:00:00Z');
const env={G0:'ci',G1:'hostinger-staging',G2:'hostinger-staging',G3:'windows-signer',G4:'physical-windows',G5:'physical-windows',G6:'physical-windows',G7:'owner-review'};
function payload(){return {schema:1,source_sha:sha,issued_at_ms:now-60000,expires_at_ms:now+3600000,gates:GATES.map(g=>({
  gate_id:g,status:'PASS',reviewer:'Independent Reviewer',reviewed_at_utc:new Date(now-1000).toISOString(),
  exact_git_sha:sha,environment:env[g],evidence_location:'private://receipt/'+g,
  evidence_sha256:'b'.repeat(64),test_case_ids:['TEST_'+g],limitations:'Reviewer must validate source evidence',
  owner_approval_reference:'private://owner-approval/'+g}))};}
function signed(p){return {payload:p,signature_base64:crypto.sign(null,
  Buffer.from('SUTRADHAR_OWNER_ACCEPTANCE_V1\n'+JSON.stringify(p)),privateKey).toString('base64')};}
function check(p,opts={}){return evaluate({envelope:signed(p),ownerPublicKeyPem:pub,expectedSha:sha,now,...opts});}
test('complete signed evidence is format-valid but NEVER production permission',()=>{
  const r=check(payload());assert.equal(r.accepted,true);
  assert.equal(r.production_release_authorized,false);
  assert.equal(r.status,'SIGNED_EVIDENCE_FORMAT_VALID_ONLY');
});
test('reject missing, duplicate, blocked, mismatched and wrong-environment gates',()=>{
  const cases=[p=>p.gates.pop(),p=>p.gates[3].gate_id='G0',
    p=>p.gates[1].status='BLOCKED',p=>p.gates[2].exact_git_sha='c'.repeat(40),
    p=>p.gates[3].environment='ci',p=>p.gates[7].owner_approval_reference=''];
  for(const mutate of cases){const p=payload();mutate(p);assert.equal(check(p).accepted,false);}
});
test('reject tampered signature and accidental other-key trust',()=>{
  const envelope=signed(payload());envelope.payload.gates[0].status='FAIL';
  assert.equal(evaluate({envelope,ownerPublicKeyPem:pub,expectedSha:sha,now}).accepted,false);
  const other=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'});
  assert.equal(evaluate({envelope:signed(payload()),ownerPublicKeyPem:other,expectedSha:sha,now}).accepted,false);
});
test('reject expired, wrong commit, future issuance and malformed evidence',()=>{
  const fns=[p=>p.expires_at_ms=now,p=>p.issued_at_ms=now+121000,
    p=>p.gates[1].evidence_sha256='not-a-hash',p=>p.gates[2].test_case_ids=[],
    p=>p.gates[5].reviewed_at_utc='invalid'];
  for(const mutate of fns){const p=payload();mutate(p);assert.equal(check(p).accepted,false);}
  assert.equal(check(payload(),{expectedSha:'c'.repeat(40)}).accepted,false);
});
