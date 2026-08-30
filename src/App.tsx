import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { TelegramLiveCard } from './components/TelegramLiveCard.tsx';
import { TopologyView } from './components/TopologyView.tsx';
import { TaskDAGView } from './components/TaskDAGView.tsx';
import { SandboxSelfHealingConsole } from './components/SandboxSelfHealingConsole.tsx';
import { CryptoGatekeeper } from './components/CryptoGatekeeper.tsx';
import { LLMCascadeView } from './components/LLMCascadeView.tsx';
import { P0HotfixModal } from './components/P0HotfixModal.tsx';
import { RFCDelegationModal } from './components/RFCDelegationModal.tsx';
import type { ClusterState, Ticket } from './types.ts';

export const App: React.FC = () => {
  const [state, setState] = useState<ClusterState | null>(null);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [isP0ModalOpen, setIsP0ModalOpen] = useState(false);
  const [isRFCModalOpen, setIsRFCModalOpen] = useState(false);
  const [liveCardText, setLiveCardText] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Fetch cluster state
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/cluster/state');
      if (res.ok) {
        const data = await res.json();
        setState(data);
        setLiveCardText(data.liveCardText || '');
        if (!activeTicket && data.tickets && data.tickets.length > 0) {
          setActiveTicket(data.tickets[2] || data.tickets[0]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch cluster state:', e);
    }
  }, [activeTicket]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Handler: Synthesize patch
  const handleSynthesize = async (ticketId: string) => {
    showToast(`Synthesizing unified diff for ${ticketId} via Gemini Pro / Cascade...`);
    try {
      const res = await fetch('/api/cluster/ticket/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Diff synthesized via ${data.providerUsed}!`);
        await fetchState();
      }
    } catch (e) {
      showToast(`Synthesis failed: ${e}`);
    }
  };

  // Handler: Ephemeral Sandbox Test
  const handleTestSandbox = async (ticketId: string, simulateFailure = false) => {
    showToast(simulateFailure ? `Running Sandbox test with injected failure...` : `Running Ephemeral Docker sandbox pytest suite...`);
    try {
      const res = await fetch('/api/cluster/ticket/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, simulateFailure })
      });
      const data = await res.json();
      if (data.success) {
        if (data.exitCode === 0) {
          showToast(`✅ Sandbox test passed (Exit 0)! Ready for Ed25519 push.`);
        } else {
          showToast(`⚠️ Docker Sandbox failed (Exit 1). Triggering Self-Healing loop.`);
        }
        await fetchState();
      }
    } catch (e) {
      showToast(`Sandbox test error: ${e}`);
    }
  };

  // Handler: Self-Healing Re-prompt
  const handleSelfHeal = async (ticketId: string) => {
    showToast(`Triggering Closed-Loop Self-Healing with preserved stderr stacktrace...`);
    try {
      const res = await fetch('/api/cluster/ticket/self-heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Auto-healed patch synthesized! Re-testing in sandbox...`);
        await fetchState();
      }
    } catch (e) {
      showToast(`Self-healing error: ${e}`);
    }
  };

  // Handler: Verify & Git Push
  const handleVerifyPush = async (ticketId: string) => {
    try {
      const res = await fetch('/api/cluster/ticket/verify-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await res.json();
      if (data.verified) {
        showToast(`✅ Ed25519 Token Verified! Push accepted into tested/${ticketId}.`);
      } else {
        showToast(`❌ Git Hook Rejected: ${data.error}`);
      }
      await fetchState();
    } catch (e) {
      showToast(`Verification error: ${e}`);
    }
  };

  // Handler: Failover & Monotonic Epoch Increment
  const handleTriggerFailover = async () => {
    showToast(`⚡ Master heartbeat missed (>90s). Initiating Monotonic Epoch election...`);
    try {
      const res = await fetch('/api/cluster/node/failover', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        showToast(`👑 Promoted ${data.state?.nodes?.find((n: any) => n.id === data.activeMasterId)?.name || 'New Master'}! Epoch incremented to #${data.newEpochId}.`);
        await fetchState();
      }
    } catch (e) {
      showToast(`Failover error: ${e}`);
    }
  };

  // Handler: P0 Hotfix submit
  const handleSubmitP0 = async (formData: { title: string; description: string; allowedFiles: string[] }) => {
    showToast(`🚨 Dispatching P0 Hotfix to Master Process 2 (Local Hybrid)...`);
    try {
      const res = await fetch('/api/cluster/ticket/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, isP0: true })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`P0 Ticket ${data.ticket.id} created! Master is now executing local hybrid patch.`);
        setActiveTab('sandbox');
        setActiveTicket(data.ticket);
        await fetchState();
      }
    } catch (e) {
      showToast(`P0 error: ${e}`);
    }
  };

  // Handler: RFC Delegation submit
  const handleSubmitRFC = async (formData: { fromNodeId: string; toNodeId: string; interfaceName: string; reason: string }) => {
    showToast(`📨 Emitting RFC_DELEGATION_REQUIRED event across worker nodes...`);
    try {
      const res = await fetch('/api/cluster/rfc/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Sub-task ${data.subTask.id} allocated for contract update!`);
        setActiveTab('dag');
        await fetchState();
      }
    } catch (e) {
      showToast(`RFC delegation error: ${e}`);
    }
  };

  // Handler: Reset cluster baseline
  const handleResetCluster = async () => {
    try {
      const res = await fetch('/api/cluster/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`🔄 Cluster state reset to Blueprint v5.3 baseline.`);
        setState(data.state);
        setActiveTicket(data.state.tickets[2] || data.state.tickets[0]);
      }
    } catch (e) {
      showToast(`Reset error: ${e}`);
    }
  };

  if (!state) {
    return (
      <div className="min-h-screen bg-[#070b12] text-slate-100 flex items-center justify-center font-mono">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-cyan-300">Booting Sutradhar Swarm Control Plane (v5.3)...</p>
        </div>
      </div>
    );
  }

  const currentActiveTicket = activeTicket || state.tickets[0];

  return (
    <div className="min-h-screen bg-[#080d17] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      
      {/* Top Header & Metrics */}
      <Header
        state={state}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenP0Modal={() => setIsP0ModalOpen(true)}
        onOpenRFCModal={() => setIsRFCModalOpen(true)}
        onTriggerFailover={handleTriggerFailover}
        onResetCluster={handleResetCluster}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'dashboard' && (
          <TelegramLiveCard
            state={state}
            liveCardText={liveCardText}
            onRefreshCard={fetchState}
            onInjectP0={() => setIsP0ModalOpen(true)}
          />
        )}

        {activeTab === 'topology' && (
          <TopologyView
            state={state}
            onTriggerFailover={handleTriggerFailover}
          />
        )}

        {activeTab === 'dag' && (
          <TaskDAGView
            state={state}
            onSynthesize={handleSynthesize}
            onTest={handleTestSandbox}
            onVerifyPush={handleVerifyPush}
            onSelectTicketForConsole={(t) => {
              setActiveTicket(t);
              setActiveTab('sandbox');
            }}
          />
        )}

        {activeTab === 'sandbox' && (
          <SandboxSelfHealingConsole
            state={state}
            activeTicket={currentActiveTicket}
            onSynthesize={handleSynthesize}
            onTestSandbox={handleTestSandbox}
            onSelfHeal={handleSelfHeal}
            onVerifyPush={handleVerifyPush}
            onSelectTicket={(t) => setActiveTicket(t)}
          />
        )}

        {activeTab === 'crypto' && (
          <CryptoGatekeeper state={state} />
        )}

        {activeTab === 'cascade' && (
          <LLMCascadeView state={state} />
        )}
      </main>

      {/* Modals */}
      <P0HotfixModal
        isOpen={isP0ModalOpen}
        onClose={() => setIsP0ModalOpen(false)}
        onSubmitP0={handleSubmitP0}
        state={state}
      />

      <RFCDelegationModal
        isOpen={isRFCModalOpen}
        onClose={() => setIsRFCModalOpen(false)}
        onSubmitRFC={handleSubmitRFC}
        state={state}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-cyan-500/60 text-slate-100 font-mono text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></div>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#070b12] py-4 text-center text-xs font-mono text-slate-500">
        SUTRADHAR AUTONOMOUS MULTI-AGENT SWARM (v5.3 PRODUCTION BLUEPRINT) • Zero-Infra Cost Architecture
      </footer>

    </div>
  );
};
