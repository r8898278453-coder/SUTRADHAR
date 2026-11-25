'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verify}=require('../scripts/release/verify-post-update-health.cjs');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const pem=publicKey.export({format:'pem',type:'spki'}),fp=crypto.createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
const now=1763380800000,node='node_'+'a'.repeat(32),wave='wave_pilot01',offer='b'.repeat(64),version='7.2.0';
function sign(phase,changes={}){const p={schema:1,phase,node_id:node,node_key_sha256:fp,wave_id:wave,offer_sha256:offer,target_version:version,agent_count:2,central_approved:true,checked_at_ms:now-(phase==='BEFORE'?120000:1000),heartbeat_age_seconds:30,...changes};return {payload:p,signature_base64:crypto.sign(null,Buffer.from('SUTRADHAR_UPDATE_HEALTH_V1\n'+JSON.stringify(p)),privateKey).toString('base64')}}
function run(before=sign('BEFORE'),after=sign('AFTER')){return verify({before,after,expectedNodeId:node,expectedWaveId:wave,expectedOfferSha256:offer,expectedVersion:version,expectedPublicKeyPem:pem,now});}
test('valid signatures do not prove actual install or authorize rollback',()=>{const v=run();assert.equal(v.accepted,true);assert.equal(v.installation_verified,false);});
test('fail closed on forged or mismatched post-update identity, versions and work',()=>{for(const changes of [{node_id:'node_'+'c'.repeat(32)},{target_version:'7.3.0'},{agent_count:1},{central_approved:false},{heartbeat_age_seconds:181},{wave_id:'wave_other01'},{checked_at_ms:now-400000}])assert.equal(run(sign('BEFORE'),sign('AFTER',changes)).accepted,false);});
test('detect tamper, stale record, wrong key and reordering',()=>{const z=sign('AFTER');z.payload.agent_count=1;assert.equal(run(sign('BEFORE'),z).accepted,false);assert.equal(run(sign('AFTER'),sign('BEFORE')).accepted,false);const s=verify({before:sign('BEFORE'),after:sign('AFTER'),expectedNodeId:node,expectedWaveId:wave,expectedOfferSha256:offer,expectedVersion:version,expectedPublicKeyPem:crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}),now});assert.equal(s.accepted,false);});
