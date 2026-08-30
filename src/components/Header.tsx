import React from 'react';
import { 
  ShieldAlert, 
  Zap, 
  Cpu, 
  Radio, 
  RotateCcw, 
  Activity, 
  Layers, 
  GitPullRequest,
  Gauge
} from 'lucide-react';
import type { ClusterState } from '../types.ts';

interface HeaderProps {
  state: ClusterState;
  onOpenP0Modal: () => void;
  onOpenRFCModal: () => void;
  onTriggerFailover: () => void;
  onResetCluster: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  state,
  onOpenP0Modal,
  onOpenRFCModal,
  onTriggerFailover,
  onResetCluster,
  activeTab,
  setActiveTab
}) => {
  const masterNode = state.nodes.find(n => n.id === state.activeMasterId);
  const activeWorkersCount = state.nodes.filter(n => n.status !== 'OFFLINE' && n.role.startsWith('WORKER')).length;

  return (
    <header className="border-b border-slate-800 bg-[#0c121e]/90 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          
          {/* Brand & Cluster Status */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-bold text-lg">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg text-slate-100 tracking-tight flex items-center gap-2">
                  SUTRADHAR
                  <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-mono font-normal">
                    v5.3 SWARM
                  </span>
                </h1>
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  LIVE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Autonomous Multi-Agent Swarm • Zero-Infra Closed-Loop Architecture
              </p>
            </div>
          </div>

          {/* Core Cluster Metrics & Epoch */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-mono">
            {/* Monotonic Epoch */}
            <div className="bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
              <span className="text-slate-400">EPOCH:</span>
              <span className="text-amber-400 font-bold bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                #{state.epochId}
              </span>
            </div>

            {/* Active Master */}
            <div className="bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
              <span className="text-slate-400">MASTER:</span>
              <span className="text-cyan-300 font-semibold flex items-center gap-1">
                <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
                {masterNode?.name || 'Node_Alpha'}
              </span>
              {state.masterMode === 'HYBRID_LOCAL' && (
                <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.2 rounded text-[10px]">
                  LOCAL HYBRID
                </span>
              )}
            </div>

            {/* Rate Limiter */}
            <div className="bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">RATE:</span>
              <span className="text-indigo-300 font-bold">
                {state.rpm.toFixed(1)} / {state.maxRpm} RPM
              </span>
            </div>

            {/* Online Workers */}
            <div className="bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">WORKERS:</span>
              <span className="text-emerald-300 font-bold">
                {activeWorkersCount} Online
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              id="btn-p0-hotfix"
              onClick={onOpenP0Modal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white rounded-lg shadow-sm shadow-rose-900/40 transition active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 fill-white" />
              P0 Hotfix
            </button>

            <button
              id="btn-rfc-delegate"
              onClick={onOpenRFCModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg transition active:scale-95"
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              Bot RFC
            </button>

            <button
              id="btn-trigger-failover"
              onClick={onTriggerFailover}
              title="Simulate Master crash & Monotonic Epoch election"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/40 rounded-lg transition active:scale-95"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              Failover
            </button>

            <button
              id="btn-reset-cluster"
              onClick={onResetCluster}
              title="Reset cluster to blueprint baseline"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 rounded-lg transition"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 mt-3 pt-2 border-t border-slate-800/60 overflow-x-auto">
          {[
            { id: 'dashboard', label: 'Telegram & Live Overview', icon: Radio },
            { id: 'topology', label: 'Swarm Nodes & Pre-Flight', icon: Cpu },
            { id: 'dag', label: 'DAG Tasks & Whitelists', icon: Layers },
            { id: 'sandbox', label: 'Ephemeral Sandbox & Self-Healing', icon: Zap },
            { id: 'crypto', label: 'Ed25519 & Git Gatekeeper', icon: ShieldAlert },
            { id: 'cascade', label: 'LLM Rate & Cascade', icon: Gauge },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  isActive
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
