/**
 * Guard automatic Desktop Edge-agent launches after ANY installer attempt.
 * A normal app login or child crash must NOT undo a recorded installer fence.
 * This does not independently authorize manual Owner restart.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const BLOCKING=[
  'installer-execution-attempt.json',
  'installer-failure-review-observed.json',
  'installer-failure-exception-reviewed.json'
];
function present(file){
  try{return fs.lstatSync(file);}
  catch(error){
    if(error?.code==='ENOENT')return null;
    throw Error('INSTALL_INCIDENT_PATH_INSPECTION_FAILED');
  }
}
function requireNoInstallerIncident({dir,manualOwnerRestart=false}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    throw Error('INSTALL_INCIDENT_START_DIRECTORY_INVALID');
  const s=present(dir);
  if(!s)return {installer_incident:false};
  if(!s.isDirectory()||s.isSymbolicLink())
    throw Error('INSTALL_INCIDENT_START_DIRECTORY_UNSAFE');
  // A dangling symlink IS an installed-exe attempt/review artifact. Presence
  // alone blocks auto-start; content is never trusted or read here.
  const active=BLOCKING.filter(name=>present(path.join(dir,name)));
  if(active.length&&manualOwnerRestart!==true)
    throw Error('INSTALL_INCIDENT_AUTOMATIC_AGENT_START_BLOCKED');
  return Object.freeze({installer_incident:active.length>0,
    manual_restart_still_requires_owner:true});
}
module.exports={requireNoInstallerIncident};
