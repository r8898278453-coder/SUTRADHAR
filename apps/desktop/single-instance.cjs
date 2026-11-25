/**
 * Prevent two independent Electron main processes from controlling the same
 * encrypted identity, node sequence and child agent concurrently.
 */
'use strict';
function installSingleInstanceGuard(electronApp,onSecondInstance){
  if(!electronApp||typeof electronApp.requestSingleInstanceLock!=='function'||
    typeof electronApp.quit!=='function'||typeof electronApp.on!=='function'||
    typeof onSecondInstance!=='function')
    throw Error('DESKTOP_SINGLE_INSTANCE_GUARD_UNAVAILABLE');
  if(!electronApp.requestSingleInstanceLock()){
    electronApp.quit();
    return false;
  }
  electronApp.on('second-instance',()=>{
    if(electronApp.isReady?.())onSecondInstance();
  });
  return true;
}
module.exports={installSingleInstanceGuard};
