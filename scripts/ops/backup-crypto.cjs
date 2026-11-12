/**
 * Authenticated, encrypted MySQL logical backup format.
 * Decrypt entire bounded payload and verify GCM tag BEFORE any DB restore.
 * Password/key never appears in this output. No unencrypted temp dump files.
 */
'use strict';
const crypto=require('node:crypto');
const MAX_DUMP_BYTES=80*1024*1024;
const FORMAT='SUTRADHAR_MYSQL_AES256_GCM_V1';
function key(raw){
  if(typeof raw!=='string'||!/^[-a-zA-Z0-9+/=]{42,48}$/.test(raw))
    throw Error('BACKUP_ENCRYPTION_KEY_INVALID');
  const k=Buffer.from(raw,'base64');
  if(k.length!==32)throw Error('BACKUP_ENCRYPTION_KEY_INVALID');
  return k;
}
function encryptDump(plain,{keyBase64,sourceDb,at=Date.now()}){
  const k=key(keyBase64);
  if(!Buffer.isBuffer(plain)||plain.length<100||plain.length>MAX_DUMP_BYTES)
    throw Error('BACKUP_DUMP_TOO_SMALL_OR_LARGE');
  if(!/^[a-zA-Z0-9_]{1,64}$/.test(sourceDb)||!Number.isSafeInteger(at))
    throw Error('BACKUP_SOURCE_INVALID');
  const nonce=crypto.randomBytes(12);
  const meta={format:FORMAT,source_db:sourceDb,created_ms:at,
    plaintext_sha256:crypto.createHash('sha256').update(plain).digest('hex'),
    plaintext_bytes:plain.length,nonce:nonce.toString('base64')};
  const cipher=crypto.createCipheriv('aes-256-gcm',k,nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(meta)));
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  return Buffer.from(JSON.stringify({...meta,ciphertext:encrypted.toString('base64'),
    tag:cipher.getAuthTag().toString('base64')})+'\n');
}
function decryptDump(recordBytes,{keyBase64,expectedSourceDb}){
  const k=key(keyBase64);
  const record=JSON.parse(Buffer.isBuffer(recordBytes)?recordBytes.toString():recordBytes);
  if(record.format!==FORMAT||record.source_db!==expectedSourceDb||
    !/^[a-zA-Z0-9_]{1,64}$/.test(record.source_db)||
    !Number.isSafeInteger(record.plaintext_bytes)||record.plaintext_bytes<100||
    record.plaintext_bytes>MAX_DUMP_BYTES||
    !/^[0-9a-f]{64}$/.test(record.plaintext_sha256))
    throw Error('BACKUP_METADATA_INVALID');
  const {ciphertext,tag,...meta}=record;
  const iv=Buffer.from(meta.nonce,'base64'),body=Buffer.from(ciphertext,'base64');
  if(iv.length!==12||Buffer.from(tag,'base64').length!==16||
    body.length!==record.plaintext_bytes)throw Error('BACKUP_AUTHENTICATION_INVALID');
  const decipher=crypto.createDecipheriv('aes-256-gcm',k,iv);
  decipher.setAAD(Buffer.from(JSON.stringify(meta)));
  decipher.setAuthTag(Buffer.from(tag,'base64'));
  const plain=Buffer.concat([decipher.update(body),decipher.final()]);
  if(crypto.createHash('sha256').update(plain).digest('hex')!==record.plaintext_sha256)
    throw Error('BACKUP_PLAINTEXT_DIGEST_MISMATCH');
  return {plain,sourceDb:record.source_db,createdAt:new Date(record.created_ms).toISOString(),
    sha256:record.plaintext_sha256};
}
module.exports={encryptDump,decryptDump,MAX_DUMP_BYTES};
