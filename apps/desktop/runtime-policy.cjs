/**
 * SUTRADHAR Desktop runtime support policy, pinned for the first v7 release.
 * Electron officially supports only the latest 3 stable major versions.
 * Update this policy during an independently reviewed, tested runtime upgrade.
 * Do NOT silently allow unsupported/EOL Electron binaries to be signed.
 */
'use strict';
const policy=Object.freeze({
  approvedElectronMajor:45,
  minimumElectronPatch:'45.3.1',
  approvedBuilderMajor:26,
  // Electron 45 scheduled EOL 27 April 2027: conservative block at UTC start.
  supportReviewDeadlineUtc:'2027-04-27T00:00:00Z'
});
function parts(v){
  if(typeof v!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))
    return null;
  return v.split('.').map(Number);
}
function verifyRuntime({electronVersion,builderVersion,now=Date.now()}={}){
  const e=parts(electronVersion),b=parts(builderVersion),min=parts(policy.minimumElectronPatch);
  if(!e||e[0]!==policy.approvedElectronMajor||
    e[1]<min[1]||(e[1]===min[1]&&e[2]<min[2]))
    return {accepted:false,error_code:'ELECTRON_RUNTIME_UNSUPPORTED_OR_UNPINNED'};
  if(!b||b[0]!==policy.approvedBuilderMajor)
    return {accepted:false,error_code:'ELECTRON_BUILDER_NOT_APPROVED'};
  if(typeof now!=='number'||!Number.isFinite(now)||
    now>=Date.parse(policy.supportReviewDeadlineUtc))
    return {accepted:false,error_code:'ELECTRON_SUPPORT_WINDOW_EXPIRED'};
  return {accepted:true,electronVersion,builderVersion,supportReviewDeadlineUtc:policy.supportReviewDeadlineUtc};
}
module.exports={verifyRuntime,policy};
