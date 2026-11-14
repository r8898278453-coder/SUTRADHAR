'use strict';
/** Pure desktop setup validators: no Electron import, network or side effects. */
const crypto=require('node:crypto');
const ID_RE=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/;
function normalizeCentralUrl(input) {
  if(typeof input!=='string'||input.length>500||!input.trim())throw Error('Enter the Central HTTPS URL');
  let url;
  try {url=new URL(input.trim());}catch{throw Error('Enter a valid Central HTTPS URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     (url.pathname!=='/'&&url.pathname!=='')||!url.hostname||
     !url.hostname.includes('.')||url.hostname.endsWith('.'))
    throw Error('Use an HTTPS domain only, e.g. https://central.example.com');
  return url.origin;
}
function cleanPcName(value) {
  if(typeof value!=='string')throw Error('Enter a PC name');
  const s=value.trim();
  if(s.length<2||s.length>64||/[\x00-\x1f<>]/.test(s))throw Error('PC name must be 2–64 readable characters');
  return s;
}
function agentCount(value){
  const count=Number(value);
  if(!Number.isSafeInteger(count)||count<1||count>4)throw Error('Choose 1–4 agents for this PC');
  return count;
}
function agentIds(count){
  const n=agentCount(count);
  return Array.from({length:n},()=> 'agent_'+crypto.randomUUID().replace(/-/g,''));
}
function validateAgentIds(ids){
  if(!Array.isArray(ids)||ids.length<1||ids.length>4||
     ids.some(x=>typeof x!=='string'||!ID_RE.test(x))||new Set(ids).size!==ids.length)
    throw Error('Invalid or duplicate agent identifiers');
  return ids.slice();
}
function validateSettings(value){
  if(!value||typeof value!=='object')throw Error('Missing setup settings');
  return {centralUrl:normalizeCentralUrl(value.centralUrl),
    pcName:cleanPcName(value.pcName),agentIds:validateAgentIds(value.agentIds)};
}
function validateEnrollmentCode(value){
  if(typeof value!=='string'||value.length<32||value.length>256||/\s/.test(value))
    throw Error('Enter the secure 32+ character enrollment code from the Owner');
  return value;
}
module.exports={normalizeCentralUrl,cleanPcName,agentCount,agentIds,
  validateAgentIds,validateSettings,validateEnrollmentCode};
