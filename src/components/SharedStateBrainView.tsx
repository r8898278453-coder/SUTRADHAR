import React, { useState, useEffect } from 'react';
import { Database, ShieldAlert, GitCommit, FileText, Cpu, CheckCircle2, AlertTriangle, RefreshCw, Undo2, MessageSquare, Send, Sparkles, Layers } from 'lucide-react';
import type { ClusterState, Ticket, OperationalGap } from '../types.ts';

interface Props {
  clusterState: ClusterState;
  onRefresh: () => void;
  showToast: (msg: string) => void;
}

export const SharedStateBrainView: React.FC<Props> = ({ clusterState, onRefresh, showToast }) => {
  const [activeSubTab, setActiveSubTab] = useState<'collections' | 'gaps' | 'clarifications' | 'rollback'>('collections');
  const [selectedCollection, setSelectedCollection] = useState<'system_state' | 'workers' | 'projects' | 'tickets' | 'audit_log' | 'config'>('system_state');
  const [dbData, setDbData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [clarifyAnswer, setClarifyAnswer] = useState<{ [tktId: string]: string }>({});
  const [rollbackReason, setRollbackReason] = useState('');
  const [selectedRollbackTicket, setSelectedRollbackTicket] = useState(clusterState.tickets[0]?.id || 'TKT-104');
  const [promptVersion, setPromptVersion] = useState<'v1' | 'v2'>('v2');

  const fetchDbAll = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/db/all');
      if (res.ok) {
        const data = await res.json();
        setDbData(data);
        if (data.config?.prompts?.activeVersion) {
          setPromptVersion(data.config.prompts.activeVersion);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch DB all:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDbAll();
  }, []);

  // Answer Clarification
  const handleAnswerClarification = async (ticketId: string) => {
    const answer = clarifyAnswer[ticketId];
    if (!answer?.trim()) {
      showToast('Please type an answer to clarify.');
      return;
    }
    try {
      const res = await fetch(`/api/tickets/${ticketId}/answer-clarification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer, answeredBy: 'Sahil Khan (Human)' })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Clarification answered for ${ticketId}. Worker resumed synthesis!`);
        setClarifyAnswer(prev => ({ ...prev, [ticketId]: '' }));
        onRefresh();
        fetchDbAll();
      }
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  };

  // Execute Rollback
  const handleRollback = async () => {
    if (!selectedRollbackTicket) return;
    try {
      const res = await fetch('/api/master/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: selectedRollbackTicket,
          reason: rollbackReason || 'Critical regression discovered post-merge in QA sandbox',
          actor: 'Master Node (Alpha)'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Rollback successful! Auto-generated hotfix ${data.hotfixTicket?.id}`);
        setRollbackReason('');
        onRefresh();
        fetchDbAll();
      }
    } catch (e: any) {
      showToast(`Rollback error: ${e.message}`);
    }
  };

  // Switch Prompt Version
  const handlePromptVersionChange = async (ver: 'v1' | 'v2') => {
    try {
      const res = await fetch('/api/config/prompts/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: ver })
      });
      const data = await res.json();
      if (data.success) {
        setPromptVersion(ver);
        showToast(`System Prompt template updated to ${ver.toUpperCase()}`);
        fetchDbAll();
      }
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  };

  const blockedTickets = clusterState.tickets.filter(t => t.status === 'BLOCKED_CLARIFICATION');

  return (
    <div className="space-y-6" id="shared-state-brain-root">
      {/* Top Banner: Golden Rule & Architecture */}
      <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-5 shadow-xl relative overflow-hidden" id="brain-header-banner">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-100">Central Shared State Layer — "The Brain"</h2>
                <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded">
                  Blueprint v6.0
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                <span className="text-amber-400 font-semibold">Golden Rule:</span> Telegram sirf <i>bolta</i> hai kya hua. Shared Database <i>yaad rakhta</i> hai. Decisions are made strictly via Atomic CAS DB transactions.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchDbAll(); onRefresh(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition"
              id="refresh-db-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync State
            </button>
          </div>
        </div>

        {/* Sub Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mt-5 border-t border-slate-800 pt-4" id="brain-subtabs">
          <button
            onClick={() => setActiveSubTab('collections')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
              activeSubTab === 'collections'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
            id="subtab-collections"
          >
            <Layers className="w-3.5 h-3.5" />
            6 Core Collections
          </button>
          <button
            onClick={() => setActiveSubTab('gaps')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
              activeSubTab === 'gaps'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
            id="subtab-gaps"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            12 Operational Gaps Matrix
          </button>
          <button
            onClick={() => setActiveSubTab('clarifications')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
              activeSubTab === 'clarifications'
                ? 'bg-amber-600 text-white shadow'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
            id="subtab-clarifications"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Clarification Checkpoints
            {blockedTickets.length > 0 && (
              <span className="px-1.5 py-0.2 bg-red-500 text-white text-[10px] rounded-full font-bold">
                {blockedTickets.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('rollback')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
              activeSubTab === 'rollback'
                ? 'bg-red-600 text-white shadow'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
            id="subtab-rollback"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Bad Merge Rollback Console
          </button>
        </div>
      </div>

      {/* VIEW 1: 6 CORE COLLECTIONS */}
      {activeSubTab === 'collections' && (
        <div className="space-y-4" id="collections-view">
          {/* Collection Selector Pills */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'system_state', label: 'system_state', icon: Cpu, desc: 'Leader, Epoch, Global Status' },
              { id: 'workers', label: 'workers', icon: ShieldAlert, desc: 'Bot Identities, Quotas, Roles' },
              { id: 'projects', label: 'projects', icon: GitCommit, desc: 'Repo URL, Priorities, Hash' },
              { id: 'tickets', label: 'tickets', icon: FileText, desc: 'DAG Tasks, Scopes, Dependencies' },
              { id: 'audit_log', label: 'audit_log', icon: CheckCircle2, desc: 'Reasoning & Audit Trail' },
              { id: 'config', label: 'config', icon: Sparkles, desc: 'Prompts v1/v2, Quotas, Models' }
            ].map(col => (
              <button
                key={col.id}
                onClick={() => setSelectedCollection(col.id as any)}
                className={`px-3 py-2 rounded-lg text-xs font-mono transition text-left border ${
                  selectedCollection === col.id
                    ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-md'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
                id={`col-btn-${col.id}`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  <col.icon className="w-3.5 h-3.5 text-indigo-400" />
                  📁 {col.label}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{col.desc}</div>
              </button>
            ))}
          </div>

          {/* Collection Content Inspector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg" id="collection-inspector">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <span className="text-xs font-mono text-indigo-400 font-semibold">
                Collection: 📁 {selectedCollection}
              </span>
              {selectedCollection === 'config' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Prompt Template:</span>
                  <button
                    onClick={() => handlePromptVersionChange('v1')}
                    className={`px-2 py-1 text-xs rounded font-mono ${
                      promptVersion === 'v1' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    v1 (Basic)
                  </button>
                  <button
                    onClick={() => handlePromptVersionChange('v2')}
                    className={`px-2 py-1 text-xs rounded font-mono ${
                      promptVersion === 'v2' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    v2 (AST + Zero Assumption)
                  </button>
                </div>
              )}
            </div>

            {/* Render formatted table or JSON based on collection */}
            {selectedCollection === 'audit_log' ? (
              <div className="space-y-2 max-h-96 overflow-y-auto font-mono text-xs pr-1">
                {(dbData?.audit_log || []).map((entry: any, i: number) => (
                  <div key={i} className="bg-slate-950/80 border border-slate-800/80 p-3 rounded-lg flex flex-col gap-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-indigo-400 font-bold">{entry.action}</span>
                      <span className="text-slate-500 text-[10px]">
                        {new Date(entry.timestamp).toLocaleTimeString()} | Actor: {entry.actor}
                      </span>
                    </div>
                    <div className="text-amber-300 text-xs">
                      <b>Why (Reasoning):</b> {entry.reasoning}
                    </div>
                    {entry.details && (
                      <div className="text-[11px] text-slate-400 bg-slate-900/60 p-1.5 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(entry.details)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : selectedCollection === 'workers' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {clusterState.nodes.map(node => (
                  <div key={node.id} className="bg-slate-950 border border-slate-800 p-3.5 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-200">{node.name}</span>
                      <span className={`px-2 py-0.5 text-[10px] rounded font-mono ${
                        node.role === 'MASTER' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {node.role}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      <div>Node ID: <code>{node.id}</code></div>
                      <div>Git Author: <code>{node.gitAuthor}</code></div>
                    </div>
                    <div className="border-t border-slate-800/80 pt-2 text-[11px] space-y-1">
                      <div className="text-slate-300 font-semibold flex items-center justify-between">
                        <span>Gemini Pro Quota:</span>
                        <span className="text-emerald-400 font-mono">42 / 1500 calls</span>
                      </div>
                      <div className="text-slate-300 font-semibold flex items-center justify-between">
                        <span>OpenRouter Free:</span>
                        <span className="text-blue-400 font-mono">8 calls</span>
                      </div>
                      <div className="text-slate-300 font-semibold flex items-center justify-between">
                        <span>Status:</span>
                        <span className="text-slate-200">{node.status}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="bg-slate-950 p-4 rounded-lg text-slate-300 font-mono text-xs overflow-x-auto max-h-96 border border-slate-800">
                {JSON.stringify(dbData ? dbData[selectedCollection] : { loading: true }, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: 12 OPERATIONAL GAPS MATRIX */}
      {activeSubTab === 'gaps' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4" id="operational-gaps-view">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-emerald-400" />
                12 Operational Gaps & Resilient Safeguards
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Full production matrix solving process crashes, split-brain, bad merges, and notification fatigue.
              </p>
            </div>
            <span className="px-2.5 py-1 text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">
              12 / 12 ACTIVE
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" id="gaps-grid">
            {[
              { id: 1, title: 'Bot Process Crash', risk: 'Supervisor auto-restart with last DB state resume', sol: 'pm2/systemd supervisor + atomic DB sync', status: 'IMPLEMENTED' },
              { id: 2, title: 'DB Single Point of Failure', risk: 'Multi-region managed HA + local disk cache fallback', sol: 'Local db_cache.json fallback', status: 'VERIFIED' },
              { id: 3, title: 'Ticket Dependency Enforcement', risk: 'Prevent premature claims on unfinished parent tickets', sol: 'Query status=open AND depends_on==done filter', status: 'IMPLEMENTED' },
              { id: 4, title: 'Merge Queue Ordering', risk: 'Prevent merge conflicts during peak throughput', sol: 'FIFO queue with P0 priority preemption in Docker sandbox', status: 'IMPLEMENTED' },
              { id: 5, title: 'Bad Merge Rollback', risk: 'Corrupted master branch deployment in production', sol: 'Saved rollback commit hash + git revert + auto hotfix ticket', status: 'IMPLEMENTED' },
              { id: 6, title: 'Docker Test Secrets Isolation', risk: 'Leaking API keys/tokens inside container images', sol: 'Local .env injection via --env-file only', status: 'VERIFIED' },
              { id: 7, title: 'Human Response Timeout', risk: 'Blocked tickets stalled indefinitely waiting for input', sol: 'Auto-reminder alert resend + worker non-blocking switch', status: 'IMPLEMENTED' },
              { id: 8, title: 'Notification Fatigue', risk: 'Spamming Telegram with routine synthesis logs', sol: 'State-change events to Telegram only; detailed logs to DB', status: 'IMPLEMENTED' },
              { id: 9, title: 'Prompt/Template Versioning', risk: 'Silent regression across worker code synthesis', sol: 'v1/v2 schema versioning in config collection', status: 'IMPLEMENTED' },
              { id: 10, title: 'Max Parallel Workers Cap', risk: 'Resource starvation and quota thrashing', sol: 'max_concurrent_workers cap in system_state', status: 'IMPLEMENTED' },
              { id: 11, title: 'Test Data/Fixtures', risk: 'Production data contamination during tests', sol: 'fixtures/seed_profiles.json mock datasets', status: 'IMPLEMENTED' },
              { id: 12, title: '"Why" Reasoning Documentation', risk: 'Opaque autonomous decisions without rationale', sol: 'Mandatory reasoning field in audit_log entries', status: 'IMPLEMENTED' }
            ].map(gap => (
              <div key={gap.id} className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-lg space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">
                    #{gap.id} {gap.title}
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                    {gap.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  <span className="text-amber-400 font-medium">Risk:</span> {gap.risk}
                </div>
                <div className="text-[11px] text-slate-400">
                  <span className="text-indigo-400 font-medium">Safeguard:</span> {gap.sol}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 3: CLARIFICATION PROTOCOL CHECKPOINTS */}
      {activeSubTab === 'clarifications' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4" id="clarifications-view">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-amber-400" />
              Clarification Protocol — Zero Assumption Forced Checkpoints
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Workers are strictly forbidden from guessing or making assumptions. When ambiguity is detected, they halt, post a question, and free themselves to work on other open tickets.
            </p>
          </div>

          {blockedTickets.length === 0 ? (
            <div className="p-8 text-center bg-slate-950/60 border border-slate-800 rounded-lg">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <div className="text-sm font-semibold text-slate-200">Zero Blocked Clarifications</div>
              <div className="text-xs text-slate-400 mt-1">All active tickets have crystal clear scopes and definitions of done.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {blockedTickets.map(tkt => (
                <div key={tkt.id} className="bg-slate-950 border border-amber-500/40 p-4 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-amber-400">{tkt.id}: {tkt.title}</span>
                    <span className="px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded font-mono">
                      BLOCKED_CLARIFICATION
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 bg-slate-900 p-3 rounded border border-slate-800">
                    <span className="text-amber-400 font-bold">🤖 Question from {tkt.clarificationQuestion?.askedBy || 'Worker'}:</span>
                    <p className="mt-1 italic">"{tkt.clarificationQuestion?.question}"</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Type your answer to unblock worker..."
                      value={clarifyAnswer[tkt.id] || ''}
                      onChange={e => setClarifyAnswer({ ...clarifyAnswer, [tkt.id]: e.target.value })}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      onClick={() => handleAnswerClarification(tkt.id)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Answer & Unblock
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 4: BAD MERGE ROLLBACK CONSOLE */}
      {activeSubTab === 'rollback' && (
        <div className="bg-slate-900 border border-red-500/30 rounded-xl p-5 shadow-xl space-y-4" id="rollback-console-view">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Undo2 className="w-5 h-5 text-red-400" />
              Bad Merge Rollback Console (Section 11 Gap #5)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              If an edge-case regression is discovered post-merge in production, execute an atomic git revert on the saved commit hash and auto-dispatch an emergency P0 hotfix ticket.
            </p>
          </div>

          <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1">Select Merged Ticket to Rollback:</label>
                <select
                  value={selectedRollbackTicket}
                  onChange={e => setSelectedRollbackTicket(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-red-500"
                >
                  {clusterState.tickets.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.id} - {t.title} ({t.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1">Rollback Reason / Stderr Summary:</label>
                <input
                  type="text"
                  placeholder="e.g. Memory leak discovered in ProfileController under load"
                  value={rollbackReason}
                  onChange={e => setRollbackReason(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-red-500"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={handleRollback}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow-lg transition"
              >
                <Undo2 className="w-4 h-4" />
                Execute Atomic Rollback & Auto-Spawn Hotfix
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
