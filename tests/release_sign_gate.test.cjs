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
