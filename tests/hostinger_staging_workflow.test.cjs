'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const yaml=fs.readFileSync(path.resolve(__dirname,
  '../.github/workflows/owner-staging-verify.yml'),'utf8');
test('manual staging workflow has no mutable external effect and only runs from reviewed main',()=>{
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/refs\/heads\/main/);
  assert.match(yaml,/persist-credentials:\s*false/);
  assert.match(yaml,/permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(yaml,/permissions:\s*\n\s*contents:\s*write/);
  assert.doesNotMatch(yaml,/\b(?:npm\s+run\s+ops:restore-staging|docker\s+push|git\s+push|aws\s+s3\s+cp)\b/);
});
test('Owner-controlled exact staging host is bound through repository variables, not user input',()=>{
  assert.match(yaml,/SUTRADHAR_STAGING_ALLOWED_HOSTNAME:\s*\$\{\{\s*vars\.SUTRADHAR_STAGING_ALLOWED_HOSTNAME\s*\}\}/);
  assert.doesNotMatch(yaml,/SUTRADHAR_STAGING_ALLOWED_HOSTNAME:\s*\$\{\{\s*inputs\./);
  assert.match(yaml,/SUTRADHAR_STAGING_URL:\s*\$\{\{\s*inputs\.staging_url\s*\}\}/);
  assert.match(yaml,/SUTRADHAR_EXPECTED_COMMIT_SHA:\s*\$\{\{\s*inputs\.expected_sha\s*\}\}/);
  assert.match(yaml,/node scripts\/ops\/hostinger-staging-preflight\.cjs/);
});
