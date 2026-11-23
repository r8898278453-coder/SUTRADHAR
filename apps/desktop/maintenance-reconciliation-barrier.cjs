/** Persistent post-release barrier. Remains active after a signed hold archival. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
function requiresReconciliation(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    throw Error('RECOVERY_BARRIER_NODE_PATH_INVALID');
  let stat;
  try{stat=fs.lstatSync(dir);}
  catch(error){
    if(error?.code==='ENOENT')return false;
    throw Error('RECOVERY_BARRIER_NODE_DIRECTORY_INSPECTION_FAILED');
  }
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error('RECOVERY_BARRIER_NODE_DIRECTORY_INVALID');
  return fs.readdirSync(dir).some(x=>/^maintenance-release-[a-f0-9]{64}\.json$/.test(x));
}
module.exports={requiresReconciliation};
