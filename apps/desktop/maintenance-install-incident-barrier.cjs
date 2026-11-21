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
function requireNoInstallerIncident({dir,manualOwnerRestart=false}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    throw Error('INSTALL_INCIDENT_START_DIRECTORY_INVALID');
  if(!fs.existsSync(dir))return {installer_incident:false};
  const s=fs.lstatSync(dir);
  if(!s.isDirectory()||s.isSymbolicLink())
    throw Error('INSTALL_INCIDENT_START_DIRECTORY_UNSAFE');
  const active=BLOCKING.filter(name=>fs.existsSync(path.join(dir,name)));
  if(active.length&&manualOwnerRestart!==true)
    throw Error('INSTALL_INCIDENT_AUTOMATIC_AGENT_START_BLOCKED');
  return Object.freeze({installer_incident:active.length>0,
    manual_restart_still_requires_owner:true});
}
module.exports={requireNoInstallerIncident};
