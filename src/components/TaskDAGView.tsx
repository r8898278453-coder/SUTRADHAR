import React, { useState } from 'react';
import { 
  Layers, 
  ArrowRight, 
  Lock, 
  CheckCircle, 
  Clock, 
  ShieldAlert, 
  FileCode, 
  Code, 
  Zap, 
  Play, 
  RotateCw,
  GitBranch,
  ShieldCheck,
  Filter
} from 'lucide-react';
import type { Ticket, ClusterState } from '../types.ts';

interface TaskDAGViewProps {
  state: ClusterState;
  onSynthesize: (ticketId: string) => void;
  onTest: (ticketId: string, simulateFailure?: boolean) => void;
  onVerifyPush: (ticketId: string) => void;
  onSelectTicketForConsole: (ticket: Ticket) => void;
}

export const TaskDAGView: React.FC<TaskDAGViewProps> = ({
  state,
  onSynthesize,
  onTest,
  onVerifyPush,
  onSelectTicketForConsole
}) => {
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(state.tickets[2] || state.tickets[0]);

  const filteredTickets = state.tickets.filter(t => {
    if (selectedDomain === 'ALL') return true;
    return t.domain === selectedDomain;
  });

  const getStatusBadge = (status: Ticket['status']) => {
    switch (status) {
      case 'HEALING_RETRY':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <RotateCw className="w-3 h-3 text-amber-400 animate-spin" />
            HEALING RETRY
          </span>
        );
      case 'DEAD_LETTER_QUEUE':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-600 animate-pulse">
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            DEAD LETTER QUEUE (HITL)
          </span>
        );
      case 'COMMITTED_PUSHED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <CheckCircle className="w-3 h-3 text-emerald-400" />
            tested/ MERGED
          </span>
        );
      case 'TESTING_SANDBOX':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            <Play className="w-3 h-3 text-cyan-400 animate-spin" />
            SANDBOX DOCKER
          </span>
        );
      case 'SYNTHESIZING_DIFF':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
            SYNTHESIZING
          </span>
        );
      case 'BLOCKED_ON_PARENT':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            <Lock className="w-3 h-3 text-slate-500" />
            BLOCKED ON PARENT
          </span>
        );
      case 'LEASED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            <Clock className="w-3 h-3 text-indigo-400" />
            LEASED
          </span>
        );
      case 'NEEDS_HUMAN_REVIEW':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            NEEDS HUMAN REVIEW
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {status}
          </span>
        );
    }
  };

  const getDomainColor = (domain: Ticket['domain']) => {
    switch (domain) {
      case 'Auth': return 'text-cyan-400 border-cyan-500/30 bg-cyan-950/40';
      case 'Matrimony': return 'text-rose-400 border-rose-500/30 bg-rose-950/40';
      case 'Media': return 'text-purple-400 border-purple-500/30 bg-purple-950/40';
      case 'Core': return 'text-amber-400 border-amber-500/30 bg-amber-950/40';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* DAG Filter & Controls */}
      <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            DAG Task Graph & Domain Whitelist Scheduler (Blueprint Section 4)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Strict parent dependency resolution with immutable <code className="text-cyan-300">allowed_files</code> blast-radius boundaries.
          </p>
        </div>

        {/* Domain Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {['ALL', 'Core', 'Auth', 'Matrimony', 'Media'].map(domain => (
            <button
              key={domain}
              onClick={() => setSelectedDomain(domain)}
              className={`px-3 py-1 text-xs font-mono rounded-lg transition ${
                selectedDomain === domain
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {domain}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: DAG Tickets List + Selected Ticket Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Tickets Graph / List */}
        <div className="lg:col-span-6 space-y-3">
          {filteredTickets.map(ticket => {
            const isSelected = selectedTicket?.id === ticket.id;
            const assignedNode = state.nodes.find(n => n.id === ticket.assignedTo);

            return (
              <div
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                className={`p-4 rounded-xl border transition cursor-pointer relative ${
                  isSelected 
                    ? 'bg-slate-900 border-cyan-500 ring-1 ring-cyan-500/30' 
                    : 'bg-[#0c121e] border-slate-800 hover:border-slate-700 hover:bg-slate-900/40'
                }`}
              >
                {/* Header row */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold font-mono text-cyan-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {ticket.id}
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${getDomainColor(ticket.domain)}`}>
                      {ticket.domain}
                    </span>
                    {ticket.priority === 'P0_URGENT' && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                        P0 HOTFIX
                      </span>
                    )}
                  </div>
                  {getStatusBadge(ticket.status)}
                </div>

                {/* Title */}
                <h4 className="text-sm font-semibold text-slate-100 mb-1">
                  {ticket.title}
                </h4>
                <p className="text-xs text-slate-400 line-clamp-2 mb-3">
                  {ticket.description}
                </p>

                {/* DAG Dependencies & Worker */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-800/60 text-xs font-mono text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <span>Assigned:</span>
                    <span className="text-slate-200 font-semibold">
                      {assignedNode?.name || 'Waiting for Parent'}
                    </span>
                  </div>

                  {ticket.parentTicketIds.length > 0 && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <span>Depends on:</span>
                      {ticket.parentTicketIds.map(pid => (
                        <span key={pid} className="bg-slate-950 px-1.5 py-0.2 rounded border border-slate-800 text-amber-300">
                          {pid}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Deep Ticket Whitelist & Actions Inspector */}
        <div className="lg:col-span-6">
          {selectedTicket ? (
            <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-xl space-y-5 sticky top-20">
              
              {/* Ticket Top Info */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-cyan-400 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
                      {selectedTicket.id}
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${getDomainColor(selectedTicket.domain)}`}>
                      {selectedTicket.domain} Module
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Branch: <code className="text-slate-200">{selectedTicket.branch}</code>
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-100">
                    {selectedTicket.title}
                  </h3>
                </div>

                <div>
                  {getStatusBadge(selectedTicket.status)}
                </div>
              </div>

              {/* Description */}
              <div className="text-xs text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 block text-[10px] font-mono uppercase tracking-wider mb-1">Task Specification:</span>
                {selectedTicket.description}
              </div>

              {/* Whitelist Blast Radius (Blueprint Section 4.B) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-300 flex items-center gap-1.5 font-semibold">
                    <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                    allowed_files Whitelist (Blast Radius Lock):
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/40">
                    AST Guard Active
                  </span>
                </div>
                <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3 font-mono text-xs space-y-1">
                  {selectedTicket.allowedFiles.map(file => (
                    <div key={file} className="flex items-center gap-2 text-cyan-300">
                      <span className="text-emerald-400">✓</span>
                      <span>{file}</span>
                      <span className="text-[10px] text-slate-500 ml-auto">MUTABLE</span>
                    </div>
                  ))}
                  {selectedTicket.readOnlyContracts?.map(contract => (
                    <div key={contract} className="flex items-center gap-2 text-slate-400">
                      <span className="text-amber-400">🔒</span>
                      <span>{contract}</span>
                      <span className="text-[10px] text-amber-500/80 ml-auto">READ-ONLY CONTRACT</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Pipeline Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-wider">
                  Swarm Execution Controls:
                </span>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    id={`btn-synth-${selectedTicket.id}`}
                    onClick={() => onSynthesize(selectedTicket.id)}
                    className="px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    1. LLM Diff
                  </button>

                  <button
                    id={`btn-test-${selectedTicket.id}`}
                    onClick={() => onTest(selectedTicket.id, false)}
                    className="px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <Play className="w-3.5 h-3.5 text-cyan-400" />
                    2. Sandbox Test
                  </button>

                  <button
                    id={`btn-verify-${selectedTicket.id}`}
                    onClick={() => onVerifyPush(selectedTicket.id)}
                    className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    3. Git Push
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => onTest(selectedTicket.id, true)}
                    className="text-[11px] font-mono text-rose-400 hover:text-rose-300 underline"
                  >
                    Simulate Docker Test Failure (Self-Healing Trigger)
                  </button>

                  <button
                    onClick={() => onSelectTicketForConsole(selectedTicket)}
                    className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    Open in Terminal Console <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Execution Logs */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <span className="text-[10px] font-mono text-slate-400 block uppercase">
                  Ticket Event Audit Log:
                </span>
                <div className="bg-[#070b12] rounded-lg p-2.5 max-h-32 overflow-y-auto space-y-1 font-mono text-[11px]">
                  {selectedTicket.logs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-slate-500 text-[10px]">{log.timestamp}</span>
                      <span className={
                        log.level === 'SUCCESS' ? 'text-emerald-400' :
                        log.level === 'WARN' ? 'text-amber-400' :
                        log.level === 'ERROR' ? 'text-rose-400' : 'text-slate-300'
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-8 text-center text-slate-400">
              Select a DAG ticket to inspect its whitelist and execution pipeline.
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
