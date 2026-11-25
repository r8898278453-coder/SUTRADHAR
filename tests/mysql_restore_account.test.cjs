'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateRestoreAccount}=require('../scripts/ops/restore-account-guard.cjs');
const valid={user:'sutradhar_staging_restore',expectedUser:'sutradhar_staging_restore',
  host:'mysql.example.com',sourceDb:'source_main',targetDb:'sutradhar_staging'};
test('Owner-reviewed exact staging username is mandatory and not a grants proof',()=>{
  const proof=validateRestoreAccount(valid);
  assert.equal(proof.accepted,true);
  assert.equal(proof.db_user_bound,true);
  assert.equal(proof.db_grants_verified,false);
  assert.equal(proof.production_restore_authorized,false);
  for(const expectedUser of [undefined,'','other_staging','root','sutradhar_staging_restore ']){
    assert.throws(()=>validateRestoreAccount({...valid,expectedUser}),
      /STAGING_RESTORE_EXACT_DB_USER_APPROVAL_REQUIRED/);
  }
});
test('administrative restore account names are denied even if self-approved',()=>{
  for(const user of ['root','ROOT','admin','administrator','superuser','dba']){
    assert.throws(()=>validateRestoreAccount({...valid,user,expectedUser:user}),
      /STAGING_RESTORE_PRIVILEGED_DB_USER_REFUSED/,user);
  }
});
test('disposable CI root exception requires all six exact environmental fences',()=>{
  const ci={user:'root',expectedUser:'root',host:'127.0.0.1',
    sourceDb:'sutradhar_backup_ci_source',targetDb:'sutradhar_backup_staging_ci',
    nodeEnv:'test',disposableSentinel:'disposable-only'};
  const proof=validateRestoreAccount(ci);
  assert.equal(proof.accepted,true);
  assert.equal(proof.disposable_ci_privileged_exception,true);
  for(const change of [
    {nodeEnv:'production'},{disposableSentinel:''},{host:'localhost'},
    {sourceDb:'sutradhar_production'},{targetDb:'sutradhar_backup_staging'},
    {expectedUser:'different_user'}
  ]){
    assert.throws(()=>validateRestoreAccount({...ci,...change}));
  }
});
