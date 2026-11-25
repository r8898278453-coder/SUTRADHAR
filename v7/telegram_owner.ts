/** Strict, narrow Owner Telegram command adapter. No independent state or authority. */
import {createHash,timingSafeEqual} from 'node:crypto';
type Command='STATUS'|'PAUSE'|'RESUME';
export type TelegramDecision={kind:'denied'|'ignored'}|
  {kind:'command';command:Command;request_id:string;chat_id:string};
const tokenPattern=/^[A-Za-z0-9_-]{32,256}$/;
const positiveId=(x:unknown)=>typeof x==='string'&&/^[1-9][0-9]{0,15}$/.test(x)&&Number.isSafeInteger(Number(x));
const id=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0?String(x):null;
function eq(a:string,b:string){
  const hash=(s:string)=>createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(a),hash(b));
}
export function parseOwnerTelegram({body,secret,env,nowMs=Date.now()}:
  {body:any;secret:unknown;env:NodeJS.ProcessEnv;nowMs?:number}):TelegramDecision{
  const configured=env.TELEGRAM_WEBHOOK_SECRET;
  if(typeof configured!=='string'||!tokenPattern.test(configured)||
    typeof secret!=='string'||!tokenPattern.test(secret)||!eq(secret,configured)||
    !positiveId(env.TELEGRAM_ADMIN_USER_ID)||!positiveId(env.TELEGRAM_ALLOWED_CHAT_ID)||
    env.TELEGRAM_ADMIN_USER_ID!==env.TELEGRAM_ALLOWED_CHAT_ID)return {kind:'denied'};
  if(!body||typeof body!=='object'||Array.isArray(body))return {kind:'denied'};
  const msg=body.message;
  if(!msg)return {kind:'ignored'};
  if(id(msg.from?.id)!==env.TELEGRAM_ADMIN_USER_ID||msg.from?.is_bot!==false||
    id(msg.chat?.id)!==env.TELEGRAM_ALLOWED_CHAT_ID||msg.chat?.type!=='private'||
    msg.sender_chat||msg.forward_origin||msg.forward_from||msg.forward_from_chat||
    msg.is_automatic_forward||msg.via_bot)return {kind:'denied'};
  if(!Number.isSafeInteger(body.update_id)||body.update_id<0||
    !Number.isSafeInteger(msg.date)||msg.date<=0||!Number.isFinite(nowMs)||
    nowMs-msg.date*1000>300000||msg.date*1000-nowMs>30000)return {kind:'ignored'};
  if(typeof msg.text!=='string'||msg.text.length>80)return {kind:'ignored'};
  const match=/^\/(status|pause|resume)(?:@([A-Za-z0-9_]{5,32}))?$/.exec(msg.text.trim());
  if(!match)return {kind:'ignored'};
  if(match[2]&&(!env.TELEGRAM_BOT_USERNAME||
    match[2].toLowerCase()!==env.TELEGRAM_BOT_USERNAME.toLowerCase()))return {kind:'ignored'};
  return {kind:'command',command:match[1].toUpperCase() as Command,
    request_id:'tg_'+body.update_id,chat_id:env.TELEGRAM_ALLOWED_CHAT_ID!};
}
// Keep notification limited to role IDs and coarse operational state, never
// echo raw command payloads, arbitrary database rows, URLs or credentials.
export function telegramReceiptText(command:Command,result:any):string{
  if(command==='PAUSE'||command==='RESUME')return result?.state?.paused===true?
    'SUTRADHAR: cluster paused.':'SUTRADHAR: cluster resumed.';
  const c=result?.state?.cluster||{};
  const safeId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(v)?v:'none';
  const phase=['READY','RECOVERING','NO_MASTER','WAITING'].includes(c.phase)?c.phase:'unknown';
  const epoch=String(c.epoch??'');
  return ['SUTRADHAR status','Phase: '+phase,'Paused: '+Boolean(c.paused),
    'Epoch: '+(/^\d{1,20}$/.test(epoch)?epoch:'unknown'),
    'Master: '+safeId(c.master_agent_id),'Backup 1: '+safeId(c.backup1),
    'Backup 2: '+safeId(c.backup2)].join('\n');
}
