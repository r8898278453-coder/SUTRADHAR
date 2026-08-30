import React, { useState } from 'react';
import { 
  Terminal, 
  Play, 
  RotateCw, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  FileCode, 
  Cpu, 
  ShieldCheck, 
  Layers, 
  Zap, 
  Copy, 
  Check
} from 'lucide-react';
import type { Ticket, ClusterState } from '../types.ts';

interface SandboxProps {
  state: ClusterState;
  activeTicket: Ticket;
  onSynthesize: (ticketId: string) => void;
  onTestSandbox: (ticketId: string, simulateFailure?: boolean) => void;
  onSelfHeal: (ticketId: string) => void;
  onVerifyPush: (ticketId: string) => void;
  onSelectTicket: (ticket: Ticket) => void;
}

export const SandboxSelfHealingConsole: React.FC<SandboxProps> = ({
  state,
  activeTicket,
  onSynthesize,
  onTestSandbox,
  onSelfHeal,
  onVerifyPush,
  onSelectTicket
}) => {
  const [selectedTier, setSelectedTier] = useState<1 | 2 | 3>(activeTicket.currentTier || 1);
  const [copied, setCopied] = useState(false);

  const handleCopyDiff = () => {
    if (activeTicket.diffPatch) {
      navigator.clipboard.writeText(activeTicket.diffPatch);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Ephemeral Worktree & Container Specs */}
      <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-xs font-mono">
                Blueprint Section 7
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Ephemeral Git Worktree + Closed-Loop Self-Healing (Max 3 Retries)
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Terminal className="w-5 h-5 text-cyan-400" />
              Isolated Docker Runner & 3-Tier Normalizer Console
            </h3>
          </div>

          {/* Ticket Selector Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">Target Ticket:</span>
            <select
              value={activeTicket.id}
              onChange={(e) => {
                const found = state.tickets.find(t => t.id === e.target.value);
                if (found) onSelectTicket(found);
              }}
              className="bg-slate-900 border border-slate-700 text-cyan-300 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-cyan-500"
            >
              {state.tickets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.id}: {t.title.substring(0, 32)}... ({t.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Disposable Worktree & Docker Sandbox Command Specs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs font-mono">
          <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-cyan-400" />
              Disposable Git Worktree Path:
            </div>
            <code className="text-cyan-300 text-[11px] block truncate">
              git worktree add /opt/sutradhar/workspaces/{activeTicket.id} -b {activeTicket.branch} origin/main
            </code>
          </div>

          <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3">
            <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              Hardened Ephemeral Sandbox Command:
            </div>
            <code className="text-cyan-300 text-[11px] block truncate">
              docker run --rm --memory="512m" --cpus="1.0" --network="none" timeout 45s pytest
            </code>
          </div>
        </div>
      </div>

      {/* Main Console Grid: 3-Tier Normalizer + Diff Viewer + Sandbox Stderr/Stdout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: 3-Tier Patch Normalizer & Diff Viewer */}
        <div className="lg:col-span-6 space-y-4">
          
          <div className="bg-[#0e1626] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            
            {/* 3-Tier Selector Header */}
            <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  3-Tier Patch Normalizer Pipeline
                </h4>
                {activeTicket.diffPatch && (
                  <button
                    onClick={handleCopyDiff}
                    className="p-1 text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1 font-mono"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    Copy Diff
                  </button>
                )}
              </div>

              {/* 3 Tier Buttons */}
              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <button
                  onClick={() => setSelectedTier(1)}
                  className={`p-2 rounded-lg border text-left transition ${
                    selectedTier === 1
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  <div className="text-[10px] text-cyan-400">TIER 1</div>
                  <div className="text-[11px] truncate">git apply --check</div>
                </button>

                <button
                  onClick={() => setSelectedTier(2)}
                  className={`p-2 rounded-lg border text-left transition ${
                    selectedTier === 2
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  <div className="text-[10px] text-cyan-400">TIER 2</div>
                  <div className="text-[11px] truncate">--ignore-space</div>
                </button>

                <button
                  onClick={() => setSelectedTier(3)}
                  className={`p-2 rounded-lg border text-left transition ${
                    selectedTier === 3
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  <div className="text-[10px] text-cyan-400">TIER 3</div>
                  <div className="text-[11px] truncate">--3way merge</div>
                </button>
              </div>
            </div>

            {/* Unified Diff Content */}
            <div className="p-4 bg-[#070b12] font-mono text-xs overflow-x-auto min-h-[300px] max-h-[420px]">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[10px] text-slate-500">
                <span>FILE: {activeTicket.allowedFiles[0] || 'unified_diff.patch'}</span>
                <span>LLM: {activeTicket.llmUsed || 'Gemini Pro'}</span>
              </div>

              {activeTicket.diffPatch ? (
                <pre className="text-slate-300 whitespace-pre leading-relaxed text-xs">
                  {activeTicket.diffPatch.split('\n').map((line, i) => {
                    const isAdd = line.startsWith('+');
                    const isDel = line.startsWith('-');
                    const isHeader = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++');

                    return (
                      <div 
                        key={i} 
                        className={
                          isAdd ? 'text-emerald-400 bg-emerald-950/30 px-1' :
                          isDel ? 'text-rose-400 bg-rose-950/30 px-1' :
                          isHeader ? 'text-cyan-400 font-bold' : 'text-slate-400'
                        }
                      >
                        {line}
                      </div>
                    );
                  })}
                </pre>
              ) : (
                <div className="text-slate-500 flex flex-col items-center justify-center h-48">
                  <p>No unified diff patch generated yet.</p>
                  <button
                    onClick={() => onSynthesize(activeTicket.id)}
                    className="mt-3 px-3 py-1.5 bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-mono hover:bg-cyan-600/30 transition"
                  >
                    Synthesize Diff with LLM
                  </button>
                </div>
              )}
            </div>

          </div>

        </div>

        {/* Right Column: Ephemeral Docker Test Output & Self-Healing Feedback Loop */}
        <div className="lg:col-span-6 space-y-4">
          
          <div className="bg-[#0e1626] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            
            {/* Terminal Header */}
            <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Ephemeral Docker Test Terminal
                </h4>
              </div>

              {/* Retry Badge */}
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${
                  activeTicket.retryCount === 0 ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40' :
                  activeTicket.retryCount < 3 ? 'bg-amber-950/60 text-amber-300 border-amber-800/40' :
                  'bg-rose-950/60 text-rose-300 border-rose-800/40'
                }`}>
                  Retry: {activeTicket.retryCount} / {activeTicket.maxRetries}
                </span>
              </div>
            </div>

            {/* Test Stdout / Stderr Terminal */}
            <div className="p-4 bg-[#070b12] font-mono text-xs overflow-y-auto min-h-[300px] max-h-[420px] space-y-3">
              {activeTicket.testStdout && (
                <div>
                  <span className="text-[10px] text-emerald-400 block mb-1">STDOUT (Pytest Suite):</span>
                  <pre className="text-emerald-400/90 whitespace-pre-wrap text-xs bg-emerald-950/10 p-2.5 rounded border border-emerald-900/40">
                    {activeTicket.testStdout}
                  </pre>
                </div>
              )}

              {activeTicket.testStderr && (
                <div>
                  <span className="text-[10px] text-rose-400 block mb-1 flex items-center gap-1 font-bold">
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                    STDERR / CAPTURED STACKTRACE (Exit != 0):
                  </span>
                  <pre className="text-rose-300 whitespace-pre-wrap text-xs bg-rose-950/30 p-2.5 rounded border border-rose-900/60">
                    {activeTicket.testStderr}
                  </pre>
                </div>
              )}

              {!activeTicket.testStdout && !activeTicket.testStderr && (
                <div className="text-slate-500 flex flex-col items-center justify-center h-48">
                  <p>Ephemeral Docker sandbox ready for execution.</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => onTestSandbox(activeTicket.id, false)}
                      className="px-3 py-1.5 bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-mono hover:bg-emerald-600/30 transition"
                    >
                      Run Passing Test
                    </button>
                    <button
                      onClick={() => onTestSandbox(activeTicket.id, true)}
                      className="px-3 py-1.5 bg-rose-600/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-mono hover:bg-rose-600/30 transition"
                    >
                      Run Failing Test (Stderr)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Terminal Actions */}
            <div className="p-3 bg-slate-900/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onTestSandbox(activeTicket.id, false)}
                  className="px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 rounded-lg flex items-center gap-1.5 transition active:scale-95"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Docker Sandbox
                </button>

                {activeTicket.testStderr && activeTicket.retryCount < activeTicket.maxRetries && (
                  <button
                    onClick={() => onSelfHeal(activeTicket.id)}
                    className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg flex items-center gap-1.5 transition active:scale-95 animate-pulse"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    Auto-Heal (Retry {activeTicket.retryCount + 1}/{activeTicket.maxRetries})
                  </button>
                )}
              </div>

              {activeTicket.status === 'COMMITTED_PUSHED' ? (
                <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                  <CheckCircle className="w-4 h-4" /> Ready for Git Push
                </span>
              ) : activeTicket.retryCount >= activeTicket.maxRetries ? (
                <span className="text-rose-400 flex items-center gap-1 font-semibold">
                  <AlertTriangle className="w-4 h-4" /> Flagged: Human Review
                </span>
              ) : null}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
};
