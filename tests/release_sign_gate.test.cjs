'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const cp=require('node:child_process');
const script=path.resolve(__dirname,'../apps/desktop/pack-release.cjs');
test('Production installer signing refuses unsigned/unapproved/alpha releases',()=>{
  const result=cp.spawnSync(process.execPath,[script],{
    cwd:path.dirname(script),
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,
      SUTRADHAR_OWNER_RELEASE_APPROVED:'false',
      SUTRADHAR_EXPECTED_COMMIT_SHA:'a'.repeat(40),
      SUTRADHAR_RELEASE_TAG:'desktop-v7.0.0-alpha.1'},
    encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/RELEASE_BLOCKED/);
  assert.doesNotMatch(result.stderr,/PRIVATE KEY|password=|CSC_KEY_PASSWORD=.*[a-z]/i);
});


test('release signing verifies Authenticode with trusted absolute OS binary and escaped literal paths',()=>{
  const fs=require('node:fs');
  const text=fs.readFileSync(script,'utf8');
  assert.match(text,/trustedWindowsPowerShell/);
  assert.match(text,/cp\.spawnSync\(trustedShell\.program/);
  assert.match(text,/psLiteral\(file\)/);
  assert.match(text,/psLiteral\(signed\)/);
  assert.match(text,/-EncodedCommand/);
  assert.doesNotMatch(text,/cp\.spawnSync\('powershell\.exe'/);
});
