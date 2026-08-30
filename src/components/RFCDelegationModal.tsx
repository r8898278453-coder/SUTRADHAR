import React, { useState } from 'react';
import { GitPullRequest, X, ArrowRight, MessageSquare, ShieldCheck } from 'lucide-react';
import type { ClusterState } from '../types.ts';

interface RFCModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitRFC: (data: { fromNodeId: string; toNodeId: string; interfaceName: string; reason: string }) => void;
  state: ClusterState;
}

export const RFCDelegationModal: React.FC<RFCModalProps> = ({
  isOpen,
  onClose,
  onSubmitRFC,
  state
}) => {
  const workerNodes = state.nodes.filter(n => n.role.startsWith('WORKER') && n.status !== 'OFFLINE');
  const [fromNodeId, setFromNodeId] = useState(workerNodes[1]?.id || state.nodes[4]?.id || '');
  const [toNodeId, setToNodeId] = useState(workerNodes[0]?.id || state.nodes[3]?.id || '');
  const [interfaceName, setInterfaceName] = useState('contracts/AuthInterface.php');
  const [reason, setReason] = useState('Matrimony profile validation requires update in AuthInterface->verifyUserTier() method signature.');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitRFC({ fromNodeId, toNodeId, interfaceName, reason });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0e1626] border border-cyan-500/40 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-cyan-950/60 border-b border-slate-800 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <GitPullRequest className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-sm">
                Bot-to-Bot RFC Protocol (Blueprint Section 4.C)
              </h3>
              <span className="text-[11px] text-cyan-300 font-mono">
                Cross-Domain Contract Delegation & Sub-Task Graph
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 font-mono text-xs">
          
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 text-slate-300 text-xs space-y-1">
            <span className="text-cyan-400 font-bold block">RFC Workflow:</span>
            <p className="text-[11px] text-slate-400">
              1. Emits <code className="text-cyan-300">RFC_DELEGATION_REQUIRED</code> event.<br />
              2. Master pauses Requester lease & assigns sub-task to Target Module owner.<br />
              3. Requester resumes automatically once sub-task merges into <code className="text-emerald-400">tested/</code>.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-300 block mb-1">Requester Node:</label>
              <select
                value={fromNodeId}
                onChange={e => setFromNodeId(e.target.value)}
                className="w-full bg-[#070b12] border border-slate-800 rounded-lg px-3 py-2 text-cyan-300 focus:outline-none focus:border-cyan-500"
              >
                {state.nodes.filter(n => n.status !== 'OFFLINE').map(n => (
                  <option key={n.id} value={n.id}>{n.name} ({n.domain.split(' ')[0]})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-slate-300 block mb-1">Target Owner Node:</label>
              <select
                value={toNodeId}
                onChange={e => setToNodeId(e.target.value)}
                className="w-full bg-[#070b12] border border-slate-800 rounded-lg px-3 py-2 text-cyan-300 focus:outline-none focus:border-cyan-500"
              >
                {state.nodes.filter(n => n.status !== 'OFFLINE').map(n => (
                  <option key={n.id} value={n.id}>{n.name} ({n.domain.split(' ')[0]})</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-slate-300 block mb-1">Target Contract / Interface File:</label>
            <input
              type="text"
              value={interfaceName}
              onChange={e => setInterfaceName(e.target.value)}
              required
              className="w-full bg-[#070b12] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="text-slate-300 block mb-1">Delegation Requirement:</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              required
              className="w-full bg-[#070b12] border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg flex items-center gap-1.5 shadow-lg shadow-cyan-600/30 transition active:scale-95"
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              Emit RFC Delegation Event
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
