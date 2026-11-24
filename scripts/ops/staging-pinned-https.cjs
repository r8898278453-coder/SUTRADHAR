/**
 * Read-only Hostinger staging HTTPS transport with a validated, fixed IP.
 * The TLS SNI name and certificate identity stay bound to the Owner-pinned
 * hostname. Never resolve the hostname a second time after public-IP review.
 * Does not follow redirects, carry credentials, or expose a mutation method.
 */
'use strict';
const https=require('node:https');
const net=require('node:net');
const {Readable}=require('node:stream');
const HOST=/^[a-z0-9.-]+$/;
function blocked(message){throw Error('STAGING_PINNED_HTTPS_'+message);}
function createPinnedFetcher({
  origin,hostname,address,family,requester=https.request
}){
  let base;
  try{base=new URL(origin);}catch{blocked('ORIGIN_INVALID');}
  if(base.protocol!=='https:'||base.origin!==origin||
     base.hostname!==hostname||base.port||base.username||base.password||
     typeof hostname!=='string'||!HOST.test(hostname)||
     net.isIP(address)!==family||![4,6].includes(family)||
     typeof requester!=='function')
    blocked('PIN_INVALID');
  return async function pinnedGet(url,options={}){
    let target;
    try{target=new URL(url);}catch{blocked('URL_INVALID');}
    if(target.origin!==origin||target.hash||target.search||
       !['/','/v7/health','/release-manifest.json','/dashboard.js','/app.css','/owner-crash-crosscheck.js'].includes(target.pathname)||
       options.method!=='GET'||options.redirect!=='error'||
       options.credentials!=='omit')
      blocked('METHOD_OR_PATH_DENIED');
    return new Promise((resolve,reject)=>{
      let req;
      try{
        req=requester(target,{
          method:'GET',agent:false,servername:hostname,
          rejectUnauthorized:true,timeout:12000,maxHeaderSize:16384,
          signal:options.signal,
          headers:{Accept:target.pathname==='/'?'text/html':target.pathname.endsWith('.js')?'text/javascript':target.pathname.endsWith('.css')?'text/css':'application/json'},
          lookup:(requested,_lookupOptions,callback)=>{
            if(requested!==hostname)
              return callback(Error('STAGING_PINNED_HOSTNAME_CHANGED'));
            callback(null,address,family);
          }
        },incoming=>{
          try{
            const headers=new Headers();
            for(const [key,value] of Object.entries(incoming.headers||{})){
              if(typeof value==='string')headers.set(key,value);
              else if(Array.isArray(value))
                for(const element of value)headers.append(key,element);
            }
            const response=new Response(Readable.toWeb(incoming),
              {status:incoming.statusCode,headers});
            resolve(response);
          }catch(e){
            try{incoming.destroy();}catch{}
            reject(e);
          }
        });
      }catch(e){reject(e);return;}
      req.on('error',reject);
      req.on('timeout',()=>req.destroy(Error('STAGING_PINNED_TIMEOUT')));
      req.end();
    });
  };
}
module.exports={createPinnedFetcher};
