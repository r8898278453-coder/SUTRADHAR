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

test('protected signing workflow supplies every required independent trust root',()=>{
  const fs=require('node:fs');
  const workflow=fs.readFileSync(path.resolve(__dirname,
    '../.github/workflows/owner-desktop-sign.yml'),'utf8');
  const packer=fs.readFileSync(script,'utf8');
  const expected=[
    'SUTRADHAR_RELEASE_UPDATE_PUBLIC_KEY_PEM_B64',
    'SUTRADHAR_INSTALL_EXECUTION_PUBLIC_KEY_PEM_B64',
    'SUTRADHAR_MAINTENANCE_RELEASE_PUBLIC_KEY_PEM_B64',
    'SUTRADHAR_FAILURE_REVIEW_PUBLIC_KEY_PEM_B64'];
  for(const name of expected){
    assert.match(packer,new RegExp("required\\('"+name+"'\\)"));
    assert.ok(workflow.includes(name+': $'+'{{ vars.'+name+' }}'),
      'Owner-controlled protected variable must reach pack:release: '+name);
    assert.ok(!workflow.includes(name+': $'+'{{ secrets.'+name+' }}'),
      'Public trust roots are protected reviewed variables, never private signing secrets');
  }
  assert.match(packer,/validateOwnerPublicRoots/);
  assert.ok(workflow.includes('environment:'));
  assert.ok(workflow.includes('name: sutradhar-desktop-signing'));
  assert.ok(workflow.includes("Only the reviewed main workflow may sign"));
  assert.ok(workflow.includes("READY_BY_OWNER"));
  assert.ok(workflow.includes("APPROVE SIGNING WITHOUT PUBLISHING"));
  assert.doesNotMatch(workflow,/actions\/upload-artifact|--publish[ =]always/i);
});

test('four independent Ed25519 public keys are required and private or malformed keys are rejected',()=>{
  const crypto=require('node:crypto');
  const {NAMES,validateOwnerPublicRoots}=
    require('../apps/desktop/release-key-policy.cjs');
  const encode=pub=>Buffer.from(pub).toString('base64');
  const pub=()=>crypto.generateKeyPairSync('ed25519').publicKey
    .export({format:'pem',type:'spki'}).toString('utf8');
  const correct=Object.fromEntries(NAMES.map(k=>[k,encode(pub())]));
  const result=validateOwnerPublicRoots(correct);
  assert.equal(Object.keys(result).length,4);
  assert.equal(new Set(Object.values(result).map(x=>x.fingerprint_sha256)).size,4);
  assert.ok(Object.values(result).every(x=>/BEGIN PUBLIC KEY/.test(x.pem)));
  for(const change of [
    {[NAMES[1]]:correct[NAMES[0]]},
    {[NAMES[2]]:Buffer.from('-----BEGIN PRIVATE KEY-----\n...').toString('base64')},
    {[NAMES[3]]:'@@invalid@@'},
    {[NAMES[0]]:correct[NAMES[0]]+'='},
    {[NAMES[2]]:encode(crypto.generateKeyPairSync('ec',
      {namedCurve:'prime256v1'}).publicKey.export({format:'pem',type:'spki'}))},
    {[NAMES[3]]:undefined}
  ])assert.throws(()=>validateOwnerPublicRoots({...correct,...change}),
    /RELEASE_TRUST_BLOCKED/);
  const extra={...correct,UNAPPROVED_EXTRA:correct[NAMES[0]]};
  assert.throws(()=>validateOwnerPublicRoots(extra),/EXACT_FOUR_PUBLIC_KEYS_REQUIRED/);
});

test('offline update offer signer shares hardened Authenticode trust and fsynced one-shot output',()=>{
  const fs=require('node:fs');
  const p=path.resolve(__dirname,'../scripts/release/sign-offline-offer.cjs');
  const body=fs.readFileSync(p,'utf8');
  assert.match(body,/verifyWindowsPublisher/);
  assert.match(body,/installerPath:file,publisherSubject:signer,expectedSha256:hash/);
  assert.match(body,/verified\.installer_execution_allowed!==false/);
  assert.match(body,/fs\.openSync\(destination,'wx',0o600\)/);
  assert.match(body,/fs\.fsyncSync\(fd\)/);
  assert.match(body,/fs\.realpathSync\(keyPath\)/);
  assert.doesNotMatch(body,/spawnSync\('powershell\.exe'|-Command.*powershell|JSON\.stringify\(file\)/);
  const forbidden=cp.spawnSync(process.execPath,[p],{
    encoding:'utf8',timeout:10000,
    env:{PATH:process.env.PATH,HOME:process.env.HOME,
      SUTRADHAR_OWNER_ROLLOUT_APPROVED:'yes',SUTRADHAR_UPDATE_KIND:'update'}
  });
  assert.notEqual(forbidden.status,0);
  assert.match(forbidden.stderr,/OWNER_OFFER_BLOCKED/);
});
