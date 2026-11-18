/**
 * Windows Authenticode publisher verification. Never launches an installer.
 * Use single-quoted PowerShell literals (escaping embedded apostrophes), not
 * interpolated double-quoted code derived from an Owner-selected path.
 */
'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {sha256File}=require('./update-policy.cjs');
function psLiteral(s){
  if(typeof s!=='string'||s.length<1||s.length>2048||
     /[\x00-\x1f]/.test(s))throw Error('UPDATE_AUTHENTICODE_LITERAL_INVALID');
  return "'"+s.replace(/'/g,"''")+"'";
}
function verifyWindowsPublisher({installerPath,publisherSubject,expectedSha256,
  platform=process.platform,runner=spawnSync}={}){
  if(platform!=='win32'||typeof installerPath!=='string'||
     !/^CN=.{1,220}$/.test(publisherSubject||'')||
     !/^[0-9a-f]{64}$/.test(expectedSha256||''))
    throw Error('UPDATE_AUTHENTICODE_WINDOWS_TRUST_REQUIRED');
  if(sha256File(installerPath)!==expectedSha256)
    throw Error('UPDATE_AUTHENTICODE_PRECHECK_SHA_MISMATCH');
  const command="$ErrorActionPreference='Stop';"+
    '$s=Get-AuthenticodeSignature -LiteralPath '+psLiteral(installerPath)+';'+
    'if($s.Status -ne \'Valid\' -or $null -eq $s.SignerCertificate){exit 42};'+
    'if($s.SignerCertificate.Subject -cne '+psLiteral(publisherSubject)+'){exit 43};'+
    'exit 0';
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  let result;
  try{result=runner('powershell.exe',['-NoProfile','-NonInteractive',
    '-EncodedCommand',encoded],{timeout:30000,windowsHide:true,
    encoding:'utf8'});}
  catch{throw Error('UPDATE_AUTHENTICODE_WINDOWS_VERIFICATION_FAILED');}
  if(!result||result.error||result.signal||result.status!==0)
    throw Error('UPDATE_AUTHENTICODE_WINDOWS_VERIFICATION_FAILED');
  if(sha256File(installerPath)!==expectedSha256)
    throw Error('UPDATE_AUTHENTICODE_POSTCHECK_SHA_MISMATCH');
  return Object.freeze({verified:true,publisher_subject:publisherSubject,
    file_sha256:expectedSha256,installer_execution_allowed:false});
}
/**
 * Verify the NEWLY RUNNING installed Desktop executable, not only the staged
 * installer. This does not attest NSIS completion, nor Windows installer exit.
 */
function verifyInstalledDesktopPublisher({executablePath,publisherSubject,
  platform=process.platform,runner=spawnSync}={}){
  if(platform!=='win32'||typeof executablePath!=='string'||
     !path.isAbsolute(executablePath)||
     !/^CN=.{1,220}$/.test(publisherSubject||''))
    throw Error('POSTINSTALL_INSTALLED_EXE_TRUST_REQUIRED');
  const digestBefore=sha256File(executablePath);
  const command="$ErrorActionPreference='Stop';"+
    '$s=Get-AuthenticodeSignature -LiteralPath '+psLiteral(executablePath)+';'+
    'if($s.Status -ne \'Valid\' -or $null -eq $s.SignerCertificate){exit 42};'+
    'if($s.SignerCertificate.Subject -cne '+psLiteral(publisherSubject)+'){exit 43};'+
    'exit 0';
  let result;
  try{
    result=runner('powershell.exe',['-NoProfile','-NonInteractive',
      '-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],
      {timeout:30000,windowsHide:true,encoding:'utf8'});
  }catch{throw Error('POSTINSTALL_WINDOWS_PUBLISHER_VERIFICATION_FAILED');}
  if(!result||result.error||result.signal||result.status!==0)
    throw Error('POSTINSTALL_WINDOWS_PUBLISHER_VERIFICATION_FAILED');
  if(sha256File(executablePath)!==digestBefore)
    throw Error('POSTINSTALL_INSTALLED_EXE_CHANGED');
  return Object.freeze({verified:true,exe_sha256:digestBefore,
    publisher_subject:publisherSubject,installation_success_proven:false});
}

module.exports={psLiteral,verifyWindowsPublisher,verifyInstalledDesktopPublisher};
