'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {encryptDump,decryptDump,MAX_DUMP_BYTES}=require('../scripts/ops/backup-crypto.cjs');
const key=crypto.randomBytes(32).toString('base64');
test('encrypted database backup verifies GCM tag and plaintext SHA before restore',()=>{
  const data=Buffer.from('CREATE TABLE test (id INT);\n'+
    'INSERT INTO test VALUES (1);\n'.repeat(40));
  const encrypted=encryptDump(data,{keyBase64:key,sourceDb:'sutradhar_v7'});
  assert.equal(encrypted.includes('CREATE TABLE'),false);
  assert.equal(encrypted.includes('INSERT INTO'),false);
  const decoded=decryptDump(encrypted,{keyBase64:key,expectedSourceDb:'sutradhar_v7'});
  assert.deepEqual(decoded.plain,data);
  assert.equal(decoded.sha256,crypto.createHash('sha256').update(data).digest('hex'));
  assert.throws(()=>decryptDump(encrypted,{keyBase64:crypto.randomBytes(32).toString('base64'),
    expectedSourceDb:'sutradhar_v7'}));
  assert.throws(()=>decryptDump(encrypted,{keyBase64:key,expectedSourceDb:'production_database'}));
});
test('backup encryption fails closed for modified ciphertext, metadata and tag',()=>{
  const data=Buffer.alloc(1024,0x61);
  const raw=encryptDump(data,{keyBase64:key,sourceDb:'sutradhar_v7'});
  const orig=JSON.parse(raw.toString());
  for(const altered of [
    {...orig,tag:crypto.randomBytes(16).toString('base64')},
    {...orig,ciphertext:crypto.randomBytes(1024).toString('base64')},
    {...orig,plaintext_sha256:'0'.repeat(64)},
    {...orig,created_ms:orig.created_ms+1},
    {...orig,source_db:'sutradhar_other'}
  ]){
    assert.throws(()=>decryptDump(Buffer.from(JSON.stringify(altered)),{
      keyBase64:key,expectedSourceDb:'sutradhar_v7'}));
  }
});
test('backup refuses missing/short key and large unbounded plaintext',()=>{
  const data=Buffer.alloc(1024,0x61);
  assert.throws(()=>encryptDump(data,{keyBase64:'bad',sourceDb:'sutradhar_v7'}));
  assert.throws(()=>encryptDump(Buffer.alloc(10),{keyBase64:key,sourceDb:'sutradhar_v7'}));
  assert.throws(()=>encryptDump(Buffer.alloc(MAX_DUMP_BYTES+1),{keyBase64:key,sourceDb:'sutradhar_v7'}));
});
