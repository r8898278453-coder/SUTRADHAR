import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {inspectLastRetainedPilotHeartbeat as inspect} from '../v7/pilot_signed_packet_recheck.ts';

const keys=crypto.generateKeyPairSync('ed25519');
const nodeId='node_'+'a'.repeat(32),agent='agent_dev_01';
const pub=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const ctx=(payload:unknown)=>({
  retainedPayload:payload,nodeId,publicKeyPem:pub,
  acceptedNodeSequenceDecimal:'7',acceptedBootId:'boot_dev_01',
  agents:[{agent_id:agent,accepted_sequence_decimal:'9'}]
});
function packet(seq=7,agentSeq=9){
  const timestamp=1770000000000;
  const body=JSON.stringify({boot_id:'boot_dev_01',sequence:seq,
    expected_master_epoch:2,
    agents:[{agent_id:agent,sequence:agentSeq,status:'ONLINE'}]});
  const nonce='nonce_'+'b'.repeat(32);
  const signed=[String(timestamp),nonce,'POST','/v7/nodes/heartbeat',
    crypto.createHash('sha256').update(body).digest('hex')].join('\n');
  return {schema:1,node_id:nodeId,timestamp_ms:timestamp,
    nonce,signature_base64:crypto.sign(null,Buffer.from(signed),
      keys.privateKey).toString('base64'),
    body_base64:Buffer.from(body).toString('base64'),accepted_at_ms:timestamp+1000};
}
test('retained node-signed packet validates exact bytes without release authority',()=>{
  const p=packet(),before=JSON.stringify(p),out=inspect(ctx(p));
  assert.equal(out.record_present,true);
  assert.equal(out.last_retained_packet_signature_verified,true);
  assert.equal(out.retained_sequence_equals_current_accepted_node_counter,true);
  assert.equal(out.retained_agent_sequences_not_ahead_of_central,true);
  assert.equal(out.retained_boot_id_matches_current,true);
  assert.equal(out.last_retained_node_sequence_decimal,'7');
  assert.equal(out.complete_signed_heartbeat_history,false);
  assert.equal(out.agent_restart_allowed,false);
  assert.equal(out.production_release_authorized,false);
  assert.equal(JSON.stringify(p),before);
  assert.equal(JSON.stringify(out).includes('signature_base64'),false);
  assert.equal(JSON.stringify(out).includes('body_base64'),false);
});
test('no pilot packet is normal but NEVER proof of complete history',()=>{
  const out=inspect(ctx(null));
  assert.equal(out.record_present,false);
  assert.equal(out.last_retained_packet_signature_verified,false);
  assert.equal(out.error_code,'NO_PILOT_PACKET_RETAINED');
  assert.equal(out.complete_signed_heartbeat_history,false);
});
test('older valid signed packet is a partial historical observation',()=>{
  const out=inspect(ctx(packet(5,8)));
  assert.equal(out.last_retained_packet_signature_verified,true);
  assert.equal(out.retained_sequence_equals_current_accepted_node_counter,false);
  assert.equal(out.retained_agent_sequences_not_ahead_of_central,true);
  assert.equal(out.agent_restart_allowed,false);
});
test('cryptographic tampering or wrong node key fails closed',()=>{
  const bad=[
    p=>{p.signature_base64='A'+p.signature_base64.slice(1);},
    p=>{p.node_id='node_'+'f'.repeat(32);},
    p=>{p.accepted_at_ms=p.timestamp_ms+400001;},
    p=>{p.body_base64=Buffer.from('{"sequence":7}').toString('base64');},
    p=>{p.nonce='bad space';},
    p=>{p.private_key_pem='SHOULD_NOT_BE_HERE';},
    p=>{p.body_base64='%%%';}
  ];
  for(const mutate of bad){
    const p:any=packet();mutate(p);
    const out=inspect(ctx(p));
    assert.equal(out.record_present,true);
    assert.equal(out.last_retained_packet_signature_verified,false,mutate.toString());
    assert.equal(out.agent_restart_allowed,false);
  }
});
test('a stored packet ahead of Central node OR agent counter rejects as corruption',()=>{
  for(const p of [packet(8,9),packet(7,10)]){
    const out=inspect(ctx(p));
    assert.equal(out.last_retained_packet_signature_verified,false);
    assert.equal(out.error_code,'PILOT_PACKET_AHEAD_OF_CENTRAL_ACCEPTED_COUNTERS');
  }
});
test('valid signature from wrong Ed25519 public key is rejected',()=>{
  const other=crypto.generateKeyPairSync('ed25519');
  const a=ctx(packet());
  a.publicKeyPem=other.publicKey.export({type:'spki',format:'pem'}).toString();
  assert.equal(inspect(a).last_retained_packet_signature_verified,false);
});
