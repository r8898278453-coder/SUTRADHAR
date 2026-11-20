/**
 * Fail-closed reconciliation for an already-existing agent ID after restart.
 * The signed GET /v7/nodes/me response is filtered by Central to the exact
 * approved node key; a duplicate ID alone proves NOTHING about ownership.
 */
import {ID_RE} from './rules.ts';

export function verifyExistingAgentOnOwnNode(
  snapshot:unknown,expectedNodeId:unknown,expectedAgentId:unknown
):true {
  if(typeof expectedNodeId!=='string'||!/^node_[0-9a-f]{32}$/.test(expectedNodeId)||
     typeof expectedAgentId!=='string'||!ID_RE.test(expectedAgentId)||
     !snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
    throw Error('AGENT_RESTART_IDENTITY_CONTEXT_INVALID');
  const s=snapshot as Record<string,unknown>;
  if(s.node_id!==expectedNodeId||!Array.isArray(s.agents)||
     s.agents.length>30)
    throw Error('AGENT_RESTART_NODE_PROOF_MISMATCH');
  const matches=s.agents.filter((x:unknown)=>{
    return x&&typeof x==='object'&&!Array.isArray(x)&&
      (x as Record<string,unknown>).agent_id===expectedAgentId;
  });
  if(matches.length!==1)
    throw Error('AGENT_EXISTS_ON_DIFFERENT_NODE_OR_NOT_OWNED');
  const registered=matches[0] as Record<string,unknown>;
  if(registered.state!=='APPROVED')
    throw Error('AGENT_RESTART_APPROVAL_REQUIRED');
  return true;
}
