import React, { useState } from 'react';
import { 
  Server, 
  Cpu, 
  ShieldCheck, 
  ShieldAlert, 
  Activity, 
  CheckCircle2, 
  XCircle, 
  Key, 
  Layers, 
  RotateCw,
  Zap,
  Radio,
  Terminal,
  HelpCircle
} from 'lucide-react';
import type { SwarmNode, ClusterState } from '../types.ts';

interface TopologyViewProps {
  state: ClusterState;
  onTriggerFailover: () => void;
  onNodeAction?: (nodeId: string, action: 'RESTART' | 'REVOKE' | 'HEALTH_CHECK') => void;
}

export const TopologyView: React.FC<TopologyViewProps> = ({
  state,
  onTriggerFailover,
  onNodeAction
}) => {
  const [selectedNode, setSelectedNode] = useState<SwarmNode | null>(state.nodes[0]);
  const [customMac, setCustomMac] = useState('00:1B:44:11:3A:B7');

  // Calculate deterministic UUID
  const calculateNodeId = (mac: string) => {
    // Simple deterministic hash calculation simulation
    let hash = 0;
    for (let i = 0; i < mac.length; i++) {
      hash = ((hash << 5) - hash) + mac.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8).toUpperCase();
    return `NODE-${hex}`;
  };

  const getStatusColor = (status: SwarmNode['status']) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'LOCAL_HYBRID':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/30 animate-pulse';
      case 'SYNTHESIZING':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'TESTING':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
      case 'HEALING':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'IDLE':
        return 'bg-slate-700/30 text-slate-400 border-slate-700';
      case 'OFFLINE':
        return 'bg-red-950/40 text-red-400 border-red-800/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Consensus, Monotonic Epoch & Hierarchy */}
      <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-xs font-mono">
                Consensus Algorithm
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Dynamic Hierarchy: Sorted by (uptime_seconds DESC, node_id ASC)
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Server className="w-5 h-5 text-cyan-400" />
              Sutradhar Node Topology & Consensus Cluster (v5.3)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Monotonic Epoch <strong className="text-amber-400">#{state.epochId}</strong> • Split-Brain Watchdog threshold: 3 missed heartbeats (&gt;90s)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="btn-simulate-failover"
              onClick={onTriggerFailover}
              className="px-3.5 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold font-mono flex items-center gap-2 transition"
            >
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Simulate Master Crash & Failover
            </button>
          </div>
        </div>
      </div>

      {/* Grid: Topology Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.nodes.map(node => {
          const isMaster = node.role === 'MASTER';
          const isStandby = node.role === 'STANDBY';
          const isSelected = selectedNode?.id === node.id;

          return (
            <div
              key={node.id}
              onClick={() => setSelectedNode(node)}
              className={`p-4 rounded-xl border transition cursor-pointer relative overflow-hidden ${
                isSelected 
                  ? 'bg-slate-900 border-cyan-500 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/40' 
                  : 'bg-[#0c121e] border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60'
              }`}
            >
              {/* Role Header Badge */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                    isMaster 
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                      : isStandby 
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' 
                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                  }`}>
                    {node.role}
                  </span>
                  {node.isHybridLocal && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded">
                      ⚡ LOCAL HYBRID
                    </span>
                  )}
                </div>

                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${getStatusColor(node.status)}`}>
                  {node.status}
                </span>
              </div>

              {/* Node Title & UUID */}
              <div className="mb-3">
                <h4 className="text-sm font-bold text-slate-100 flex items-center justify-between">
                  <span>{node.name}</span>
                  <span className="text-[11px] font-mono text-cyan-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                    {node.id}
                  </span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">{node.domain}</p>
              </div>

              {/* 5-Point Health Bar Micro Matrix */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800/60 font-mono text-[10px]">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Uptime:</span>
                  <span className="text-slate-200">{Math.floor(node.uptimeSeconds / 3600)}h {Math.floor((node.uptimeSeconds % 3600) / 60)}m</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Active Ticket:</span>
                  <span className="text-amber-400 font-semibold">{node.currentTicketId || 'None (Idle)'}</span>
                </div>

                {/* 5 Health Check Indicators */}
                <div className="grid grid-cols-5 gap-1 pt-1 text-center">
                  <div title={`DNS: ${node.health.dns.rttMs}ms`} className={`p-1 rounded ${node.health.dns.ok ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'}`}>
                    DNS
                  </div>
                  <div title={`SSH: ${node.health.gitSsh.ok ? 'OK' : 'Fail'}`} className={`p-1 rounded ${node.health.gitSsh.ok ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'}`}>
                    SSH
                  </div>
                  <div title={`Docker: ${node.health.docker.status}`} className={`p-1 rounded ${node.health.docker.ok ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'}`}>
                    DOC
                  </div>
                  <div title={`RAM Free: ${node.health.memory.freeMb}MB`} className={`p-1 rounded ${node.health.memory.ok ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'}`}>
                    RAM
                  </div>
                  <div title={`LLM API: ${node.health.llm.provider}`} className={`p-1 rounded ${node.health.llm.ok ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'}`}>
                    LLM
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Node Deep Inspection & 5-Point Matrix (Blueprint Section 2) */}
      {selectedNode && (
        <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  Node Pre-Flight & Provisioning Inspector: {selectedNode.name}
                </h4>
                <span className="text-xs font-mono bg-cyan-950/60 text-cyan-400 border border-cyan-800/40 px-2 py-0.5 rounded">
                  {selectedNode.id}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Git Author: <code className="text-slate-300">{selectedNode.gitAuthor}</code>
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-slate-400">MAC Address:</span>
              <span className="text-slate-200 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                {selectedNode.macAddress}
              </span>
            </div>
          </div>

          {/* 5-Point Matrix Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-4">
            
            {/* 1. DNS / Telegram Ping */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>1. DNS / Ping</span>
                {selectedNode.health.dns.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              </div>
              <p className="text-xs font-bold text-slate-200 font-mono">
                {selectedNode.health.dns.ok ? `${selectedNode.health.dns.rttMs}ms (HTTP 200)` : 'Timeout / RTT > 500ms'}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">api.telegram.org</p>
            </div>

            {/* 2. Git SSH Deploy Key */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>2. Git SSH Auth</span>
                {selectedNode.health.gitSsh.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              </div>
              <p className="text-xs font-bold text-slate-200 font-mono truncate">
                {selectedNode.health.gitSsh.ok ? `HEAD: ${selectedNode.health.gitSsh.headSha}` : 'SSH Handshake Error'}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">Ed25519 Non-Interactive</p>
            </div>

            {/* 3. Docker Service */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>3. Docker Service</span>
                {selectedNode.health.docker.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              </div>
              <p className="text-xs font-bold text-slate-200 font-mono truncate">
                {selectedNode.health.docker.ok ? 'Exit 0 (Healthy)' : 'Socket Dead'}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">Hardened Non-Root</p>
            </div>

            {/* 4. Memory / RAM */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>4. RAM & Storage</span>
                {selectedNode.health.memory.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              </div>
              <p className="text-xs font-bold text-slate-200 font-mono">
                {selectedNode.health.memory.freeMb} MB Free
              </p>
              <p className="text-[10px] text-slate-500 font-mono">&gt;500MB Threshold Met</p>
            </div>

            {/* 5. LLM API Key */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>5. LLM Cascade</span>
                {selectedNode.health.llm.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              </div>
              <p className="text-xs font-bold text-slate-200 font-mono truncate">
                {selectedNode.health.llm.ok ? 'Connected' : 'Offline'}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">{selectedNode.health.llm.provider}</p>
            </div>

          </div>

          {/* Blueprint Non-Interactive SSH Spec */}
          <div className="mt-4 p-3 bg-[#070b12] border border-slate-800/80 rounded-lg font-mono text-[11px] text-slate-300">
            <div className="text-slate-400 mb-1 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              Non-Interactive SSH Provisioning Command (Blueprint Section 2.B):
            </div>
            <code className="text-cyan-300 block overflow-x-auto whitespace-pre">
{`export GIT_SSH_COMMAND="ssh -i /opt/sutradhar/secrets/id_ed25519_worker \\
  -o StrictHostKeyChecking=accept-new \\
  -o BatchMode=yes \\
  -o ConnectTimeout=10"`}
            </code>
          </div>
        </div>
      )}

      {/* Deterministic Identity Calculator (Blueprint Section 2.A) */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
        <h4 className="text-xs font-bold text-slate-200 mb-2 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          Deterministic Identity Generator (NODE-&lt;SHA256(MAC)[:8]&gt;)
        </h4>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <label className="text-[10px] font-mono text-slate-400 block mb-1">Enter Hardware MAC Address:</label>
            <input 
              type="text" 
              value={customMac}
              onChange={e => setCustomMac(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="w-full sm:w-auto">
            <label className="text-[10px] font-mono text-slate-400 block mb-1">Computed Cluster Node ID:</label>
            <div className="bg-cyan-950/40 border border-cyan-800/40 text-cyan-300 font-mono font-bold text-xs px-4 py-2 rounded-lg text-center">
              {calculateNodeId(customMac)}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
