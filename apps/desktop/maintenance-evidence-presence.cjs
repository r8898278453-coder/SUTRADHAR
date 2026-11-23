/**
 * A maintenance evidence directory entry counts as present even when a
 * symlink is dangling. Only a genuine ENOENT means absent.
 * This is a refusal guard, NOT permission to execute an installer.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
function evidenceEntryPresent(file,{io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     !io||typeof io.lstatSync!=='function')
    throw Error('MAINTENANCE_EVIDENCE_PATH_INVALID');
  try{io.lstatSync(file);return true;}
  catch(error){
    if(error?.code==='ENOENT')return false;
    throw Error('MAINTENANCE_EVIDENCE_PATH_UNCERTAIN_OWNER_REVIEW');
  }
}
module.exports={evidenceEntryPresent};
