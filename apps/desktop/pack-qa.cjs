/**
 * QA-only unsigned Windows package. Cannot publish and cannot be called by
 * a routine desktop build. Production signing and updater are NOT implemented.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
if(process.env.SUTRADHAR_ALLOW_UNSIGNED_QA_PACKAGE!=='true')
  throw Error('Unsigned QA packaging disabled. Must explicitly set SUTRADHAR_ALLOW_UNSIGNED_QA_PACKAGE=true for an isolated QA environment.');
const script=path.join(__dirname,'dist','edge-agent.cjs');
if(!fs.existsSync(script)||!fs.existsSync(path.join(__dirname,'contract.json')))
  throw Error('Run npm run build:desktop in repository root before packaging.');
const builder=path.join(__dirname,'node_modules','electron-builder','cli.js');
if(!fs.existsSync(builder))throw Error('Run npm install --prefix apps/desktop first');
const result=cp.spawnSync(process.execPath,[builder,'--win','nsis','--x64','--publish','never'],
  {cwd:__dirname,env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'},
    stdio:'inherit',timeout:600000});
if(result.error||result.status!==0)throw Error('QA installer packaging failed. No publication performed.');
console.log('Unsigned internal QA build only. Never distribute as production.');
