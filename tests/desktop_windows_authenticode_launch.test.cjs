'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {trustedWindowsPowerShell,verifyWindowsPublisher,
  verifyInstalledDesktopPublisher}=require('../apps/desktop/windows-authenticode.cjs');
test('Windows Authenticode uses pinned absolute OS binary and a minimal process environment',()=>{
  const result=trustedWindowsPowerShell({platform:'win32',
    systemRoot:'C:\\Windows',windir:'C:\\WINDOWS'});
  assert.equal(result.program,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(result.options.cwd,'C:\\Windows\\System32');
  assert.equal(result.options.shell,false);
  assert.equal(result.options.windowsHide,true);
  assert.equal(result.options.env.PATH,'C:\\Windows\\System32');
  assert.equal(result.options.env.SystemRoot,'C:\\Windows');
  assert.deepEqual(Object.keys(result.options.env).sort(),
    ['PATH','PSModulePath','SystemRoot','WINDIR'].sort());
  assert.equal(result.options.env.APPDATA,undefined);
});
test('refuse untrusted Windows root, conflicting system variables and network/relative paths',()=>{
  for(const args of [
    {platform:'linux'},
    {platform:'win32',systemRoot:'C:\\Users\\Public',windir:'C:\\Users\\Public'},
    {platform:'win32',systemRoot:'\\\\malicious\\Windows',windir:'\\\\malicious\\Windows'},
    {platform:'win32',systemRoot:'C:\\Windows\\..\\Temp'},
    {platform:'win32',systemRoot:'C:\\Windows;malicious'},
    {platform:'win32',systemRoot:'C:\\Windows',windir:'D:\\Windows'},
    {platform:'win32',systemRoot:'C:\\Windows\nbad'},
    {platform:'win32',systemRoot:'C:Windows'}
  ])assert.throws(()=>trustedWindowsPowerShell(args),
    /UPDATE_AUTHENTICODE_WINDOWS_/);
});
function withFile(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-authenticode-exec-'));
  try{
    const file=path.join(dir,"SUTRADHAR O'Brien.exe");
    const bytes=crypto.randomBytes(1700);
    fs.writeFileSync(file,bytes);
    return fn(file,crypto.createHash('sha256').update(bytes).digest('hex'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('staged installer trust executes ONLY absolute system shell; no PATH hijack or script injection',()=>withFile((file,digest)=>{
  let attempts=0;
  const r=verifyWindowsPublisher({installerPath:file,
    publisherSubject:"CN=Owner's SUTRADHAR",expectedSha256:digest,
    platform:'win32',systemRoot:'C:\\Windows',windir:'C:\\Windows',
    runner:(program,args,options)=>{
      attempts++;
      assert.equal(program,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(options.shell,false);
      assert.equal(options.cwd,'C:\\Windows\\System32');
      assert.equal(options.env.PATH,'C:\\Windows\\System32');
      assert.equal(args[0],'-NoLogo');
      assert.deepEqual(args.slice(1,3),['-NoProfile','-NonInteractive']);
      const code=Buffer.from(args.at(-1),'base64').toString('utf16le');
      assert.ok(code.includes("Owner''s SUTRADHAR"));
      assert.ok(code.includes("O''Brien.exe"));
      assert.ok(code.includes('Get-AuthenticodeSignature'));
      return {status:0};
    }});
  assert.equal(r.verified,true);
  assert.equal(r.installer_execution_allowed,false);
  assert.equal(attempts,1);
  assert.throws(()=>verifyWindowsPublisher({installerPath:file,
    publisherSubject:'CN=Trusted',expectedSha256:digest,platform:'win32',
    systemRoot:'C:\\Untrusted',windir:'C:\\Untrusted',
    runner:()=>{throw Error('attacker subprocess should not run');}}),
    /WINDOWS_ROOT_UNTRUSTED/);
}));
test('installed executable reinspection also forbids PATH-based shell, never proves installer success',()=>withFile((file)=>{
  const verified=verifyInstalledDesktopPublisher({executablePath:file,
    publisherSubject:'CN=Trusted',platform:'win32',
    systemRoot:'D:\\Windows',windir:'D:\\Windows',
    runner:(program,args,options)=>{
      assert.equal(program,'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(options.shell,false);
      assert.equal(options.env.PATH,'D:\\Windows\\System32');
      assert.ok(Buffer.from(args.at(-1),'base64').toString('utf16le')
        .includes('Get-AuthenticodeSignature'));
      return {status:0};
    }});
  assert.equal(verified.verified,true);
  assert.equal(verified.installation_success_proven,false);
}));
