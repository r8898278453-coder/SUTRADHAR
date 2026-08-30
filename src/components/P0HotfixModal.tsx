import React, { useState } from 'react';
import { Zap, X, ShieldAlert, AlertTriangle } from 'lucide-react';
import type { ClusterState } from '../types.ts';

interface P0ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitP0: (data: { title: string; description: string; allowedFiles: string[] }) => void;
  state: ClusterState;
}

export const P0HotfixModal: React.FC<P0ModalProps> = ({
  isOpen,
  onClose,
  onSubmitP0,
  state
}) => {
  const [title, setTitle] = useState('URGENT P0: Fix Critical Auth Interface Drift');
  const [description, setDescription] = useState('Immediate zero-day fix required for JWT session revocation in Auth contract.');
  const [allowedFiles, setAllowedFiles] = useState('modules/core/Hotfix.php, tests/Unit/HotfixTest.php');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitP0({
      title,
      description,
      allowedFiles: allowedFiles.split(',').map(f => f.trim()).filter(Boolean)
    });
    onClose();
  };

  const masterNode = state.nodes.find(n => n.id === state.activeMasterId);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0e1626] border border-rose-600/50 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-rose-950/80 to-slate-900 border-b border-rose-800/40 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-600/30 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <Zap className="w-5 h-5 fill-rose-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                Inject Urgent P0 Hotfix (Blueprint Section 3.C)
              </h3>
              <span className="text-[11px] text-rose-300/80 font-mono">
                Bypasses worker queues • Master Local Hybrid Execution
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
          
          <div className="bg-rose-950/20 border border-rose-800/30 rounded-lg p-3 text-rose-200 text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              Hybrid Master Engine Activated:
            </div>
            <p className="text-[11px] text-rose-300/80">
              Active Master (<strong>{masterNode?.name || 'Node_Alpha'}</strong>) will self-sign an Ed25519 lease with <code className="text-white">worker_id="MASTER_LOCAL"</code> and execute the sandbox immediately.
            </p>
          </div>

          <div>
            <label className="text-slate-300 block mb-1">Hotfix Title:</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              className="w-full bg-[#070b12] border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="text-slate-300 block mb-1">Specification & Problem Statement:</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              required
              className="w-full bg-[#070b12] border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="text-slate-300 block mb-1">allowed_files Whitelist (comma separated):</label>
            <input
              type="text"
              value={allowedFiles}
              onChange={e => setAllowedFiles(e.target.value)}
              required
              className="w-full bg-[#070b12] border border-slate-800 rounded-lg px-3 py-2 text-cyan-300 focus:outline-none focus:border-rose-500"
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
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg flex items-center gap-1.5 shadow-lg shadow-rose-600/30 transition active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 fill-white" />
              Dispatch P0 Hotfix
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
