/**
 * v7 alpha pilot ONLY: positive, time-limited Owner opt-in for persisting
 * already authenticated heartbeat packets in the append-only event table.
 *
 * An accidental lingering ENABLED=true must never create unlimited rows.
 * Does not authorize or validate node heartbeats; Central already does that.
 */
export const PILOT_PACKET_MAX_RECORDS_PER_NODE = 64;
export const PILOT_PACKET_MAX_WINDOW_MS = 60 * 60 * 1000;
const canonicalUtc = (value:unknown):number|null => {
  if(typeof value!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return null;
  const ms=Date.parse(value);
  return Number.isSafeInteger(ms)&&ms>=0&&
    new Date(ms).toISOString()===value?ms:null;
};
export function permitSignedHeartbeatPilotRecord({
  enabled,startsAt,endsAt,serverNowMs,rawBodyLength,existingNodeRecords
}:{
  enabled:unknown;startsAt:unknown;endsAt:unknown;
  serverNowMs:unknown;rawBodyLength:unknown;existingNodeRecords:unknown;
}):boolean {
  if(enabled!=='true'||!Number.isSafeInteger(serverNowMs)||
     Number(serverNowMs)<1||
     !Number.isSafeInteger(rawBodyLength)||Number(rawBodyLength)<20||
     Number(rawBodyLength)>8192||
     !Number.isSafeInteger(existingNodeRecords)||
     Number(existingNodeRecords)<0||
     Number(existingNodeRecords)>=PILOT_PACKET_MAX_RECORDS_PER_NODE)
    return false;
  const start=canonicalUtc(startsAt),end=canonicalUtc(endsAt);
  return start!==null&&end!==null&&end>start&&
    end-start<=PILOT_PACKET_MAX_WINDOW_MS&&
    Number(serverNowMs)>=start&&Number(serverNowMs)<end;
}
