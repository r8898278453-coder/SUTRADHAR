import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Radio, 
  Terminal, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Play, 
  Pause, 
  Send, 
  Layers, 
  Activity, 
  Code2, 
  Eye, 
  Cpu, 
  Trash2,
  Check
} from 'lucide-react';
import type { ClusterState, WatchdogLease, TelegramMessage } from '../types.ts';

interface TelegramWireWatchdogViewProps {
  state: ClusterState;
  onRefresh: () => void;
  onShowToast: (msg: string) => void;
}

export const TelegramWireWatchdogView: React.FC<TelegramWireWatchdogViewProps> = ({
  state,
  onRefresh,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'watchdog' | 'protocol' | 'splitbrain' | 'killswitch'>('watchdog');
  const [rawProtocolInput, setRawProtocolInput] = useState<string>(
`👑 [MASTER LEASE ALLOCATED]
🎫 Ticket: TKT-104 - Matrimony Profile Updates
🤖 Assigned Worker: NODE-C34E8912
🌿 Work Branch: backup/TKT-104-worker03
📁 Allowed Files: modules/matrimony/ProfileController.php, tests/Unit/ProfileTest.php
⏱️ Lease Expiry: 900s
🔐 Ed25519 Signature: Verified

\`\`\`sutradhar_protocol
{
  "version": "1.0",
  "msg_type": "TICKET_LEASE_GRANTED",
  "msg_id": "lease_TKT-104_1725114600",
  "timestamp": 1725114600,
  "sender": {
    "node_id": "NODE-E78A1201",
    "role": "MASTER",
    "epoch_id": 15
  },
  "payload": {
    "ticket_id": "TKT-104",
    "worker_id": "NODE-C34E8912",
    "allowed_files": ["modules/matrimony/ProfileController.php", "tests/Unit/ProfileTest.php"],
    "base_branch": "main",
    "work_branch": "backup/TKT-104-worker03",
    "expires_at": 1725115500,
    "ttl_seconds": 900
  }
}
\`\`\``
  );
  const [decodedResult, setDecodedResult] = useState<any>(null);
  const [killReason, setKillReason] = useState<string>('Emergency maintenance / Master node failover review');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Decode Telegram Wire Message
  const handleDecodeMessage = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch('/api/cluster/protocol/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawMessage: rawProtocolInput })
      });
      const data = await res.json();
      setDecodedResult(data);
      if (data.hasProtocol) {
        onShowToast('✅ Successfully parsed embedded JSON protocol payload without regex!');
      } else {
        onShowToast('ℹ️ Plain message decoded (no sutradhar_protocol block found).');
      }
    } catch (e: any) {
      onShowToast(`Decode failed: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Trigger Worker Heartbeat
  const handleSendHeartbeat = async (ticketId: string, workerId: string, progressPct: number) => {
    try {
      const res = await fetch('/api/cluster/watchdog/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          workerId,
          progressPct: Math.min(100, progressPct + 15),
          currentStep: `Active synthesis & pytest running in sandbox (${progressPct + 15}%)`
        })
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(`💓 Heartbeat refreshed for ${ticketId}! Missed counter reset to 0.`);
        onRefresh();
      }
    } catch (e: any) {
      onShowToast(`Heartbeat failed: ${e.message}`);
    }
  };

  // Force Revoke Dead Ticket
  const handleForceRevoke = async (ticketId: string) => {
    try {
      const res = await fetch('/api/cluster/watchdog/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          reason: 'Worker silent >90s (Simulated Dead Ticket Crash)'
        })
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(`⚠️ Lease for ${ticketId} forcefully revoked! Returned to DAG queue.`);
        onRefresh();
      }
    } catch (e: any) {
      onShowToast(`Revoke failed: ${e.message}`);
    }
  };

  // Toggle Kill Switch
  const handleToggleKillSwitch = async (action: 'PAUSE' | 'RESUME') => {
    try {
      const res = await fetch('/api/cluster/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: killReason,
          adminName: 'Cluster Admin (@Admin)'
        })
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(action === 'PAUSE' ? '🛑 Kill Switch ENGAGED! All workers paused.' : '🟢 Kill Switch DISENGAGED! Operations resumed.');
        onRefresh();
      }
    } catch (e: any) {
      onShowToast(`Kill switch toggle failed: ${e.message}`);
    }
  };

  // Verify Split-Brain
  const handleVerifySplitBrain = async (pinnedMasterId?: string) => {
    try {
      const res = await fetch('/api/cluster/split-brain/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramPinnedMasterId: pinnedMasterId || state.activeMasterId
        })
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.splitBrain.consensusDivergence ? '🚨 Split-Brain Detected! Local master self-demoted.' : '✅ Consensus Stable! Local & Telegram Masters match.');
        onRefresh();
      }
    } catch (e: any) {
      onShowToast(`Split-Brain verification failed: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Kill Switch Banner if Active */}
      {state.killSwitchActive && (
        <div className="bg-rose-950/80 border-2 border-rose-600 rounded-xl p-4 flex items-center justify-between shadow-2xl animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-600 rounded-lg text-white font-bold">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-rose-200 uppercase tracking-wider">
                🛑 CLUSTER EXECUTION EMERGENCY PAUSED (KILL SWITCH ACTIVE)
              </h4>
              <p className="text-xs text-rose-300">
                Reason: {state.killSwitchReason || 'Manual administrator override'}. All autonomous tickets and git pushes are suspended.
              </p>
            </div>
          </div>
          <button
            id="btn-resume-cluster-banner"
            onClick={() => handleToggleKillSwitch('RESUME')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg transition"
          >
            Resume Swarm Execution
          </button>
        </div>
      )}

      {/* Sub Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0d1424] border border-slate-800 p-2 rounded-xl">
        <div className="flex items-center gap-2">
          {[
            { id: 'watchdog', label: '⏱️ Dead-Ticket Watchdog', desc: 'Lease TTL & Heartbeats' },
            { id: 'protocol', label: '📡 Telegram Wire-Protocol', desc: 'Dual Human + JSON Block' },
            { id: 'splitbrain', label: '🧠 Split-Brain & Epochs', desc: 'Single Pinned Master' },
            { id: 'killswitch', label: '🛑 Human Oversight & Kill Switch', desc: 'Emergency Pause' },
          ].map(tab => (
            <button
              key={tab.id}
              id={`subtab-${tab.id}`}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 rounded-lg text-xs font-mono font-medium transition text-left ${
                activeTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <div>{tab.label}</div>
            </button>
          ))}
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 rounded-lg transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh State
        </button>
      </div>

      {/* Tab 1: Watchdog & Dead-Ticket Recovery */}
      {activeTab === 'watchdog' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-1">
                <span>ACTIVE WATCHDOG LEASES</span>
                <Clock className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold text-slate-100 font-mono">
                {state.watchdogLeases.filter(l => !l.isRevoked).length}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Leases monitored with 15m absolute TTL and 30s heartbeat interval.
              </p>
            </div>

            <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-1">
                <span>3-STRIKE MISSED HEARBEATS</span>
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-amber-300 font-mono">
                {state.watchdogLeases.reduce((acc, l) => acc + l.missedHeartbeats, 0)} Total
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Auto-revocation triggered after 3 consecutive missed beats (&gt;90s).
              </p>
            </div>

            <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-1">
                <span>HITL ESCALATION QUEUE</span>
                <ShieldAlert className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-rose-300 font-mono">
                {state.tickets.filter(t => t.status === 'DEAD_LETTER_QUEUE').length} Dead Tickets
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Tickets requiring Human-in-the-Loop review after repeated failures.
              </p>
            </div>
          </div>

          {/* Active Lease Monitor Table */}
          <div className="bg-[#0e1626] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  Live Ticket Leases & Heartbeat Health Monitor
                </h3>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Watchdog Daemon: ACTIVE (Sweep every 10s)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="bg-slate-900/50 text-slate-400 border-b border-slate-800">
                    <th className="px-4 py-3">Ticket ID</th>
                    <th className="px-4 py-3">Assigned Worker</th>
                    <th className="px-4 py-3">Heartbeat Status</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Time to Expiry</th>
                    <th className="px-4 py-3 text-right">Watchdog Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {state.watchdogLeases.map((lease) => {
                    const remainingMs = Math.max(0, lease.expiresAt - Date.now());
                    const remainingMins = Math.floor(remainingMs / 60000);
                    const remainingSecs = Math.floor((remainingMs % 60000) / 1000);
                    const isSilent = lease.missedHeartbeats > 0;

                    return (
                      <tr key={lease.ticketId} className={`hover:bg-slate-800/30 ${lease.isRevoked ? 'opacity-40 bg-rose-950/10' : ''}`}>
                        <td className="px-4 py-3 font-semibold text-cyan-300">
                          {lease.ticketId}
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {lease.workerId}
                        </td>
                        <td className="px-4 py-3">
                          {lease.isRevoked ? (
                            <span className="text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800 text-[10px]">
                              REVOKED
                            </span>
                          ) : isSilent ? (
                            <span className="text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-700/60 text-[10px] flex items-center gap-1 w-fit">
                              <AlertTriangle className="w-3 h-3 text-amber-400 animate-pulse" />
                              {lease.missedHeartbeats}/{lease.maxMissedHeartbeats} Strikes Missed
                            </span>
                          ) : (
                            <span className="text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-700/60 text-[10px] flex items-center gap-1 w-fit">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                              Healthy (&lt;15s)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-32">
                            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                              <span>{lease.progressPct}%</span>
                              <span className="truncate max-w-[80px]">{lease.lastStep}</span>
                            </div>
                            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-cyan-500 h-full rounded-full transition-all"
                                style={{ width: `${lease.progressPct}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {remainingMins}m {remainingSecs}s
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button
                            onClick={() => handleSendHeartbeat(lease.ticketId, lease.workerId, lease.progressPct)}
                            disabled={lease.isRevoked}
                            className="px-2.5 py-1 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 border border-cyan-700/50 rounded text-[11px] transition"
                          >
                            💓 Heartbeat
                          </button>
                          <button
                            onClick={() => handleForceRevoke(lease.ticketId)}
                            disabled={lease.isRevoked}
                            className="px-2.5 py-1 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 rounded text-[11px] transition"
                          >
                            ⚠️ Revoke (Dead)
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Telegram Wire Protocol Inspector */}
      {activeTab === 'protocol' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-4">
            <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-cyan-400" />
                  Dual-Format Telegram Message Input
                </h3>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                  Human UI + Embedded JSON Block
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Paste any Telegram bot message containing human-readable card text and a <code className="text-cyan-300">```sutradhar_protocol</code> machine block:
              </p>

              <textarea
                value={rawProtocolInput}
                onChange={(e) => setRawProtocolInput(e.target.value)}
                rows={12}
                className="w-full bg-[#080d17] border border-slate-700/80 rounded-lg p-3 text-xs font-mono text-cyan-200 focus:outline-none focus:border-cyan-500/80"
              />

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handleDecodeMessage}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-lg shadow-lg shadow-cyan-900/30 transition active:scale-95"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isProcessing ? 'Parsing...' : 'Deterministic Parse (Zero-Regex)'}
                </button>

                <button
                  onClick={() => {
                    setRawProtocolInput(
`🤖 [WORKER HEARTBEAT]
🎫 Ticket: TKT-104
⚡ Worker: NODE-C34E8912
📊 Progress: 75%
📍 Status: Sandbox pytest executed successfully (Exit 0)

\`\`\`sutradhar_protocol
{
  "version": "1.0",
  "msg_type": "TICKET_HEARTBEAT_PROGRESS",
  "msg_id": "hb_TKT-104_${Date.now()}",
  "timestamp": ${Math.floor(Date.now() / 1000)},
  "sender": {
    "node_id": "NODE-C34E8912",
    "role": "WORKER",
    "epoch_id": ${state.epochId}
  },
  "payload": {
    "ticket_id": "TKT-104",
    "worker_id": "NODE-C34E8912",
    "progress_pct": 75,
    "current_step": "Sandbox test passed"
  }
}
\`\`\``
                    );
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 underline font-mono"
                >
                  Load Worker Heartbeat Example
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-4">
            <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  Deterministic Parsed Output
                </h3>
                {decodedResult?.hasProtocol && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> PROTOCOL VERIFIED
                  </span>
                )}
              </div>

              {decodedResult ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-mono text-slate-400 uppercase">Human Card Portion:</label>
                    <div className="bg-[#080d17] border border-slate-800 p-3 rounded-lg text-xs font-mono text-slate-200 whitespace-pre-wrap">
                      {decodedResult.humanText || '(Empty)'}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-slate-400 uppercase">Machine JSON Payload:</label>
                    <pre className="bg-[#080d17] border border-slate-800 p-3 rounded-lg text-xs font-mono text-emerald-300 overflow-x-auto">
                      {JSON.stringify(decodedResult.structuredJson, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="bg-[#080d17] border border-slate-800/80 rounded-lg p-8 text-center text-xs font-mono text-slate-500 space-y-2">
                  <Code2 className="w-8 h-8 mx-auto text-slate-600" />
                  <p>Click "Deterministic Parse" to inspect how worker bots cleanly decode incoming telegram messages without regex fragility.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Split-Brain & Monotonic Epochs */}
      {activeTab === 'splitbrain' && (
        <div className="space-y-6">
          <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-cyan-400" />
                  3-Layer Split-Brain Prevention Engine
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Guarantees that network delays or simultaneous announcements never produce 2 active Master nodes.
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 ${
                state.splitBrain?.isStable 
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' 
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse'
              }`}>
                <span className={`w-2 h-2 rounded-full ${state.splitBrain?.isStable ? 'bg-emerald-400' : 'bg-rose-400 animate-ping'}`}></span>
                {state.splitBrain?.isStable ? 'CONSENSUS STABLE' : 'DIVERGENCE DETECTED'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="bg-[#080d17] border border-slate-800 p-3.5 rounded-lg space-y-1">
                <span className="text-[11px] font-mono text-slate-400">1. PINNED TELEGRAM LEADER</span>
                <div className="text-sm font-mono font-bold text-cyan-300">
                  {state.splitBrain?.telegramPinnedMasterId || state.activeMasterId}
                </div>
                <p className="text-[10px] text-slate-500">
                  Single source of truth in Telegram channel.
                </p>
              </div>

              <div className="bg-[#080d17] border border-slate-800 p-3.5 rounded-lg space-y-1">
                <span className="text-[11px] font-mono text-slate-400">2. LOCAL MONOTONIC EPOCH</span>
                <div className="text-sm font-mono font-bold text-amber-300">
                  Epoch #{state.epochId}
                </div>
                <p className="text-[10px] text-slate-500">
                  Strictly incrementing counter; stale epochs are rejected.
                </p>
              </div>

              <div className="bg-[#080d17] border border-slate-800 p-3.5 rounded-lg space-y-1">
                <span className="text-[11px] font-mono text-slate-400">3. GIT PRE-RECEIVE LOCK</span>
                <div className="text-sm font-mono font-bold text-emerald-300">
                  Ed25519 Token Guard
                </div>
                <p className="text-[10px] text-slate-500">
                  Pre-receive hook blocks pushes without active epoch token.
                </p>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-lg text-xs font-mono text-slate-300 flex items-center justify-between">
              <div>
                <span className="text-slate-500">Status Diagnosis: </span>
                <span>{state.splitBrain?.statusMessage || 'All nodes synchronized to current Epoch leader.'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleVerifySplitBrain()}
                  className="px-3 py-1.5 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 border border-cyan-700/50 rounded text-xs transition"
                >
                  Verify Consensus
                </button>
                <button
                  onClick={() => handleVerifySplitBrain('NODE-ROGUE-99')}
                  title="Simulate another bot posting a rogue master claim in Telegram"
                  className="px-3 py-1.5 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/40 rounded text-xs transition"
                >
                  Simulate Split-Brain Attack
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Emergency Kill-Switch & Human Oversight */}
      {activeTab === 'killswitch' && (
        <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-6 space-y-6">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
              Emergency Cluster Kill-Switch & Human Oversight (HITL)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Instantly freezes or resumes all SutraDhaar worker operations, ticket leasing, and automated Git merges across the entire cluster.
            </p>
          </div>

          <div className="bg-[#080d17] border border-slate-800 p-4 rounded-xl space-y-4">
            <div>
              <label className="text-xs font-mono text-slate-300 block mb-1">
                Emergency Pause Reason / Audit Log Note:
              </label>
              <input
                type="text"
                value={killReason}
                onChange={(e) => setKillReason(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                placeholder="e.g. Master node failover review or database maintenance"
              />
            </div>

            <div className="flex items-center gap-4">
              <button
                id="btn-pause-all-workers"
                onClick={() => handleToggleKillSwitch('PAUSE')}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-rose-700 to-red-700 hover:from-rose-600 hover:to-red-600 text-white font-bold text-xs rounded-lg shadow-lg shadow-rose-950/50 transition active:scale-95"
              >
                <Pause className="w-4 h-4 fill-white" />
                PAUSE ALL AGENTS (EMERGENCY FREEZE)
              </button>

              <button
                id="btn-resume-all-workers"
                onClick={() => handleToggleKillSwitch('RESUME')}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600 text-white font-bold text-xs rounded-lg shadow-lg shadow-emerald-950/50 transition active:scale-95"
              >
                <Play className="w-4 h-4 fill-white" />
                RESUME SWARM EXECUTION
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
