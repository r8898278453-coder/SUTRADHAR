/**
 * Bind a staging-only MySQL restore to the exact Owner-reviewed DB username.
 * Names are NOT sufficient privilege proof; the DBA must separately inspect
 * grants and ensure NO production, server-wide or external schema rights.
 * Only an explicitly disposable CI loopback fixture may use root.
 */
'use strict';
const USER=/^[A-Za-z0-9_]{1,64}$/;
const PRIVILEGED=/^(?:root|admin|administrator|superuser|dba)$/i;
function validateRestoreAccount({user,expectedUser,host,sourceDb,targetDb,
  nodeEnv,disposableSentinel}={}){
  if(!USER.test(user||'')||!USER.test(expectedUser||'')||
     expectedUser!==user)
    throw Error('STAGING_RESTORE_EXACT_DB_USER_APPROVAL_REQUIRED');
  const disposableCi=nodeEnv==='test'&&disposableSentinel==='disposable-only'&&
    host==='127.0.0.1'&&user==='root'&&
    sourceDb==='sutradhar_backup_ci_source'&&
    targetDb==='sutradhar_backup_staging_ci';
  if(PRIVILEGED.test(user)&&!disposableCi)
    throw Error('STAGING_RESTORE_PRIVILEGED_DB_USER_REFUSED');
  return Object.freeze({accepted:true,db_user_bound:true,
    db_grants_verified:false,production_restore_authorized:false,
    disposable_ci_privileged_exception:disposableCi});
}
module.exports={validateRestoreAccount};
