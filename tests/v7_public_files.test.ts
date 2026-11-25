import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {publicCentralFiles} from '../v7/public_files.ts';
test('Central public HTTP allowlist serves UI and manifest, never private build files or fallback HTML',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sut-public-'));
  const publicAssets=['index.html','app.css','dashboard.js','owner-crash-crosscheck.js','release-manifest.json'];
  for(const name of publicAssets)fs.writeFileSync(path.join(root,name),'public fixture '+name);
  fs.mkdirSync(path.join(root,'v7'));
  for(const name of ['server.cjs','v7-agent.cjs','v7/schema.sql','.env','identity.json'])
    fs.writeFileSync(path.join(root,name),'PRIVATE_FIXTURE');
  const app=express();
  app.get('/v7/health',(_req,res)=>res.json({ready:true}));
  app.use(publicCentralFiles(root));
  const server=app.listen(0,'127.0.0.1');
  try{
    await once(server,'listening');
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    for(const name of publicAssets){
      const r=await fetch(base+'/'+name);
      assert.equal(r.status,200,name);
      assert.equal(await r.text(),'public fixture '+name);
      assert.equal(r.headers.get('cache-control'),'no-store');
      assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    }
    assert.equal(await (await fetch(base+'/')).text(),'public fixture index.html');
    assert.equal((await fetch(base+'/dashboard.js',{method:'HEAD'})).status,200);
    assert.deepEqual(await (await fetch(base+'/v7/health')).json(),{ready:true});
    for(const name of ['server.cjs','v7-agent.cjs','v7/schema.sql','.env','identity.json','unknown.js','v7/nonexistent','%73erver.cjs','__proto__']){
      const r=await fetch(base+'/'+name);
      assert.equal(r.status,404,name);
      assert.deepEqual(await r.json(),{accepted:false,error_code:'NOT_FOUND'});
    }
    assert.equal((await fetch(base+'/dashboard.js',{method:'POST'})).status,404);
    fs.unlinkSync(path.join(root,'owner-crash-crosscheck.js'));
    const missing=await fetch(base+'/owner-crash-crosscheck.js');
    assert.equal(missing.status,503);
    assert.deepEqual(await missing.json(),{accepted:false,error_code:'PUBLIC_ASSET_UNAVAILABLE'});
    if(process.platform!=='win32'){
      fs.symlinkSync(path.join(root,'server.cjs'),path.join(root,'owner-crash-crosscheck.js'));
      assert.equal((await fetch(base+'/owner-crash-crosscheck.js')).status,503);
    }
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
