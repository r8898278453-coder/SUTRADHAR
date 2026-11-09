import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { TelegramLiveCard } from './components/TelegramLiveCard.tsx';
import { TelegramWireWatchdogView } from './components/TelegramWireWatchdogView.tsx';
import { TopologyView } from './components/TopologyView.tsx';
import { TaskDAGView } from './components/TaskDAGView.tsx';
import { SandboxSelfHealingConsole } from './components/SandboxSelfHealingConsole.tsx';
import { CryptoGatekeeper } from './components/CryptoGatekeeper.tsx';
import { LLMCascadeView } from './components/LLMCascadeView.tsx';
import { SharedStateBrainView } from './components/SharedStateBrainView.tsx';
import { P0HotfixModal } from './components/P0HotfixModal.tsx';
import { RFCDelegationModal } from './components/RFCDelegationModal.tsx';
import { fallbackClusterState } from './data/fallbackClusterState.ts';
import type { ClusterState, Ticket } from './types.ts';

export const App: React.FC = () => {
  const [state, setState] = useState<ClusterState>(fallbackClusterState);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(fallbackClusterState.tickets[2] || fallbackClusterState.tickets[0]);
  const [isP0ModalOpen, setIsP0ModalOpen] = useState(false);
  const [isRFCModalOpen, setIsRFCModalOpen] = useState(false);
  const [liveCardText, setLiveCardText] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [adminKey, setAdminKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(res => setAuthenticated(res.ok))
      .catch(() => setAuthenticated(false))
      .finally(() => setCheckingAuth(false));
  }, []);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey })
      });
      if (!res.ok) {
        setLoginError('Invalid admin key or login unavailable.');
        return;
      }
      setAdminKey('');
      setAuthenticated(true);
    } catch {
      setLoginError('Cannot contact the control plane.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
    finally { setAuthenticated(false); setState(fallbackClusterState); setActiveTicket(null); }
  };

  // Fetch cluster state
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/cluster/state');
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const data = await res.json();
        setState(data);
        setLiveCardText(data.liveCardText || '');
        if (data.tickets && data.tickets.length > 0) {
          setActiveTicket(prev => {
            if (!prev) return data.tickets[2] || data.tickets[0];
            const refreshed = data.tickets.find((t: Ticket) => t.id === prev.id);
            return refreshed || prev;
          });
        }
      }
    } catch (e) {
      console.warn('Live API syncing unavailable, using reactive state:', e);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchState();
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, [fetchState, authenticated]);

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

  // Handler: Actual isolated Docker test (no simulated pass/fail path)
  const handleTestSandbox = async (ticketId: string) => {
    showToast(`Running real isolated Docker tests for ${ticketId}...`);
    try {
      const res = await fetch('/api/cluster/ticket/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(`Sandbox blocked: ${data.error || data.message || res.status}`);
      } else if (data.status === 'TEST_PASSED' && data.exitCode === 0) {
        showToast(`Docker tests passed (exit 0); ready for review, NOT merged.`);
      } else if (data.status === 'TEST_FAILED') {
        showToast(`Docker tests failed (exit ${data.exitCode}); self-healing can use actual stderr.`);
      } else {
        showToast(`Sandbox status: ${data.status || 'unknown'}`);
      }
      await fetchState();
    } catch (error) {
      showToast(`Sandbox request error: ${error}`);
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

  // Push exactly the candidate that already passed real Docker to a new
  // worker branch. Never push to main or claim a merge here.
  const handlePushTestedBranch = async (ticketId: string) => {
    try {
      const response = await fetch('/api/cluster/ticket/push-tested-branch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await response.json();
      if (response.ok && data.status === 'PUSH_CONFIRMED_NOT_MERGED') {
        showToast(`Verified branch ${data.branch} at ${data.headSha?.slice(0, 12)}; not merged. Create draft PR next.`);
      } else {
        showToast(`Worker push blocked: ${data.error || response.status}`);
      }
      await fetchState();
    } catch (error) {
      showToast(`Worker push failed: ${error}`);
    }
  };

  // Recover an uncertain push with read-only Git inspection, never re-pushing.
  const handleReconcileWorkerPush = async (ticketId: string) => {
    try {
      const response = await fetch('/api/cluster/ticket/reconcile-tested-branch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await response.json();
      if (response.ok && data.status === 'PUSH_CONFIRMED_NOT_MERGED') {
        showToast(`Recovered remote branch ${data.branch} at ${data.headSha?.slice(0, 12)}; draft PR can follow.`);
      } else if (response.ok && data.status === 'REMOTE_ABSENT_EXPLICIT_RETRY_AVAILABLE') {
        showToast('Remote branch absent; explicitly request Push Tested Branch if still authorized.');
      } else {
        showToast(`Push reconciliation blocked: ${data.error || response.status}; no automatic retry.`);
      }
      await fetchState();
    } catch (error) {
      showToast(`Push reconciliation unavailable: ${error}`);
    }
  };

  // Submit only an existing, exact Docker-tested branch as a draft GitHub PR.
  const handleCreateDraftPr = async (ticketId: string) => {
    try {
      const response = await fetch('/api/cluster/ticket/create-draft-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await response.json();
      if (response.ok && data.success && data.draft) {
        showToast(`GitHub draft PR #${data.prNumber} ${data.existing ? 'already exists' : 'created'}; awaiting human review, not merged.`);
      } else {
        showToast(`Draft PR blocked: ${data.error || response.status}`);
      }
      await fetchState();
    } catch (error) {
      showToast(`Draft PR error: ${error}`);
    }
  };

  // Administrator authorization to verify remote PR merge evidence. This
  // creates no Git commit, renews no worker token and does not merge a PR.
  const handleAuthorizeMergeVerification = async (ticketId: string) => {
    try {
      const response = await fetch('/api/cluster/ticket/authorize-merge-verification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await response.json();
      if (response.ok && data.status === 'MERGE_VERIFICATION_AUTHORIZED') {
        showToast(`PR #${data.prNumber}: 15-minute remote proof check authorized; not merged by this action.`);
      } else {
        showToast(`Merge proof authorization denied: ${data.error || response.status}`);
      }
      await fetchState();
    } catch (error) {
      showToast(`Merge proof authorization unavailable: ${error}`);
    }
  };

  // Handler: Verify merged GitHub PR
  const handleVerifyPush = async (ticketId: string) => {
    try {
      const res = await fetch('/api/cluster/ticket/verify-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const data = await res.json();
      if (data.verified) {
        showToast(`Verified remote Git merge evidence for ${ticketId}.`);
      } else {
        showToast(`Git merge not verified: ${data.error || 'Missing remote evidence'}`);
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

  // Handler: Claim Ticket
  const handleClaimTicket = async (ticketId: string, workerId: string) => {
    showToast(`⚡ Worker ${workerId} claiming ${ticketId}...`);
    try {
      const res = await fetch('/api/tickets/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, workerId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Claimed ${ticketId}! Branch ${data.ticket.branch} allocated.`);
        await fetchState();
      } else {
        showToast(`❌ Claim Failed: ${data.error}`);
      }
    } catch (e) {
      showToast(`Claim error: ${e}`);
    }
  };

  // Handler: Block Clarification
  const handleBlockClarification = async (ticketId: string, question: string, reason?: string) => {
    showToast(`❓ Halting ${ticketId} for clarification...`);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/block-clarification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, workerId: 'Worker-Node', reasoning: reason })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`⚠️ ${ticketId} halted: Question posted to Telegram wire.`);
        await fetchState();
      }
    } catch (e) {
      showToast(`Clarify error: ${e}`);
    }
  };

  // Handler: Answer Clarification
  const handleAnswerClarification = async (ticketId: string, answer: string) => {
    showToast(`💬 Submitting architectural answer for ${ticketId}...`);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/answer-clarification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer, answeredBy: 'Master Architect' })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ ${ticketId} unblocked! Worker resuming diff synthesis.`);
        await fetchState();
      }
    } catch (e) {
      showToast(`Answer error: ${e}`);
    }
  };

  // Handler: Rollback Bad Merge
  const handleRollback = async (ticketId: string, reason?: string) => {
    showToast(`Requesting rollback review for ${ticketId}...`);
    try {
      const res = await fetch('/api/master/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, reason, actor: 'Master Process 2' })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Rollback requested for ${ticketId}; no Git revert has executed yet.`);
        await fetchState();
      }
    } catch (e) {
      showToast(`Rollback error: ${e}`);
    }
  };

  // Reviewed GitHub rollback: separate, administrator-triggered stages.
  // None of these stages directly updates target main.
  const handleRollbackPrepare = async (ticketId: string) => {
    try {
      const res = await fetch('/api/master/rollback/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const body = await res.json();
      showToast(res.ok
        ? `Rollback branch ${body.branch} pushed after Docker test; not merged.`
        : `Rollback preparation blocked: ${body.error || res.status}; no completion claimed.`);
      await fetchState();
    } catch (error) { showToast(`Rollback preparation unavailable: ${error}`); }
  };
  const handleRollbackDraft = async (ticketId: string) => {
    try {
      const res = await fetch('/api/master/rollback/create-draft-pr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const body = await res.json();
      showToast(res.ok
        ? `Rollback draft PR #${body.prNumber} opened; human review and CI still required.`
        : `Rollback draft PR blocked: ${body.error || res.status}`);
      await fetchState();
    } catch (error) { showToast(`Rollback draft PR unavailable: ${error}`); }
  };
  const handleRollbackVerify = async (ticketId: string) => {
    try {
      const res = await fetch('/api/master/rollback/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId })
      });
      const body = await res.json();
      showToast(body.verified
        ? `Rollback PR #${body.prNumber} independently verified merged into main.`
        : `Rollback not verified: ${body.error || res.status}`);
      await fetchState();
    } catch (error) { showToast(`Rollback verification unavailable: ${error}`); }
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

  if (checkingAuth) {
    return <div className="min-h-screen bg-[#080d17] text-slate-100 flex items-center justify-center">Checking control plane session…</div>;
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#080d17] text-slate-100 flex items-center justify-center p-6">
        <form onSubmit={handleLogin} className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#101a2b] p-8 shadow-2xl space-y-5">
          <h1 className="text-2xl font-bold">SUTRADHAR Control Plane</h1>
          <p className="text-sm text-slate-400">Administrator authentication is required to view cluster state or operate workers.</p>
          <label className="block text-sm text-slate-200" htmlFor="adminKey">Administrator key</label>
          <input id="adminKey" type="password" autoComplete="current-password" value={adminKey} onChange={e => setAdminKey(e.target.value)} required className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-3 text-white" />
          {loginError && <p role="alert" className="text-sm text-red-400">{loginError}</p>}
          <button type="submit" disabled={loggingIn || !adminKey.trim()} className="w-full rounded-lg bg-cyan-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">{loggingIn ? 'Signing in…' : 'Sign in securely'}</button>
          <p className="text-xs text-slate-500">The key is verified by the backend. The browser receives only an HttpOnly session cookie.</p>
        </form>
      </div>
    );
  }

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
      
      <div className="absolute right-4 top-2 z-50"><button type="button" onClick={handleLogout} className="rounded border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">Sign out</button></div>

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
        {activeTab === 'brain' && (
          <SharedStateBrainView
            clusterState={state}
            onRefresh={fetchState}
            showToast={showToast}
          />
        )}

        {activeTab === 'dashboard' && (
          <TelegramLiveCard
            state={state}
            liveCardText={liveCardText}
            onRefreshCard={fetchState}
            onInjectP0={() => setIsP0ModalOpen(true)}
          />
        )}

        {activeTab === 'watchdog_protocol' && (
          <TelegramWireWatchdogView
            state={state}
            onRefresh={fetchState}
            onShowToast={showToast}
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
            onPushTestedBranch={handlePushTestedBranch}
            onReconcileWorkerPush={handleReconcileWorkerPush}
            onCreateDraftPr={handleCreateDraftPr}
            onAuthorizeMergeVerification={handleAuthorizeMergeVerification}
            onVerifyPush={handleVerifyPush}
            onSelectTicketForConsole={(t) => {
              setActiveTicket(t);
              setActiveTab('sandbox');
            }}
            onClaimTicket={handleClaimTicket}
            onBlockClarification={handleBlockClarification}
            onAnswerClarification={handleAnswerClarification}
            onRollback={handleRollback}
            onRollbackPrepare={handleRollbackPrepare}
            onRollbackDraft={handleRollbackDraft}
            onRollbackVerify={handleRollbackVerify}
          />
        )}

        {activeTab === 'sandbox' && (
          <SandboxSelfHealingConsole
            state={state}
            activeTicket={currentActiveTicket}
            onSynthesize={handleSynthesize}
            onTestSandbox={handleTestSandbox}
            onSelfHeal={handleSelfHeal}
            onPushTestedBranch={handlePushTestedBranch}
            onReconcileWorkerPush={handleReconcileWorkerPush}
            onCreateDraftPr={handleCreateDraftPr}
            onAuthorizeMergeVerification={handleAuthorizeMergeVerification}
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
