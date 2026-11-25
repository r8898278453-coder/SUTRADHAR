/** Central HTTP public-file boundary. No SPA fallback to arbitrary paths. */
import type {RequestHandler} from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
const publicFiles:Readonly<Record<string,string>>=Object.freeze({
  '/':'index.html',
  '/index.html':'index.html',
  '/app.css':'app.css',
  '/dashboard.js':'dashboard.js',
  '/owner-crash-crosscheck.js':'owner-crash-crosscheck.js',
  '/release-manifest.json':'release-manifest.json'
});
export function publicCentralFiles(dir:string):RequestHandler{
  const root=path.resolve(dir);
  return (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if((req.method!=='GET'&&req.method!=='HEAD')||!Object.hasOwn(publicFiles,req.path)){
      res.status(404).json({accepted:false,error_code:'NOT_FOUND'});return;
    }
    const file=publicFiles[req.path];
    // Fixed names only; a link or nonregular file is never a public asset.
    try{
      const st=fs.lstatSync(path.join(root,file));
      if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('UNTRUSTED');
    }catch{
      res.status(503).json({accepted:false,error_code:'PUBLIC_ASSET_UNAVAILABLE'});return;
    }
    res.sendFile(file,{root,dotfiles:'deny',cacheControl:false},err=>{
      if(!err)return;
      if(res.headersSent){res.destroy();return;}
      res.status(503).json({accepted:false,error_code:'PUBLIC_ASSET_UNAVAILABLE'});
    });
  };
}
