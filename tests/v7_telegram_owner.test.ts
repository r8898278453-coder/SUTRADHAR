import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOwnerTelegram,telegramReceiptText} from '../v7/telegram_owner.ts';
const nowMs=Date.UTC(2026,10,24,8),secret='x'.repeat(40);
const env={TELEGRAM_WEBHOOK_SECRET:secret,TELEGRAM_ADMIN_USER_ID:'12345',TELEGRAM_ALLOWED_CHAT_ID:'12345',TELEGRAM_BOT_USERNAME:'SutradharTestBot'};
function body(text='/status'){return {update_id:123,message:{from:{id:12345,is_bot:false},chat:{id:12345,type:'private'},date:nowMs/1000,text}};}
const parse=(b:any,e:NodeJS.ProcessEnv=env,s:unknown=secret)=>parseOwnerTelegram({body:b,secret:s,env:e,nowMs});
test('strict Telegram adapter accepts only fixed private Owner commands and stable redelivery ID',()=>{
  for(const [text,command] of [['/status','STATUS'],['/pause','PAUSE'],['/resume@SutradharTestBot','RESUME']]){
    const result=parse(body(text));assert.deepEqual(result,{kind:'command',command,request_id:'tg_123',chat_id:'12345'});
    assert.deepEqual(parse(body(text)),result);
  }
});
test('wrong secrets, users, chats, forwarded commands and bots never reach Owner command service',()=>{
  for(const mutation of [
    (x:any)=>{x.message.from.id=12346;},(x:any)=>{x.message.from.id='12345';},
    (x:any)=>{x.message.from.is_bot=true;},(x:any)=>{x.message.chat.type='group';},
    (x:any)=>{x.message.chat.id=12346;},(x:any)=>{x.message.forward_origin={};},
    (x:any)=>{x.message.via_bot={};}
  ]){const x=body();mutation(x);assert.equal(parse(x).kind,'denied');}
  assert.equal(parse(body(),env,'wrong').kind,'denied');
  assert.equal(parse(body(),{...env,TELEGRAM_WEBHOOK_SECRET:'short'},'short').kind,'denied');
  assert.equal(parse(body(),{...env,TELEGRAM_ALLOWED_CHAT_ID:'54321'}).kind,'denied');
});
test('unknown, stale, future, edited, malformed and other-bot messages are ignored',()=>{
  for(const text of ['/approve','/force_master','/pause@OtherBot','/pause now','constructor','__proto__','/status@SutradharTestBot@OtherBot'])
    assert.equal(parse(body(text)).kind,'ignored',text);
  for(const x of [
    {...body(),update_id:undefined},{...body(),update_id:'123'},
    {...body(),update_id:-1},{...body(),message:{...body().message,date:nowMs/1000-301}},
    {...body(),message:{...body().message,date:nowMs/1000+31}},
    {update_id:123,edited_message:body().message}
  ])assert.equal(parse(x).kind,'ignored');
});
test('status notification never serializes arbitrary database fields',()=>{
  const text=telegramReceiptText('STATUS',{state:{cluster:{phase:'READY',paused:false,epoch:7,master_agent_id:'agent_abc',private_key:'SECRET_MARKER',backup1:'https://example.invalid/'}}});
  assert.match(text,/Master: agent_abc/);
  assert.doesNotMatch(text,/SECRET_MARKER|example.invalid/);
});
