import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Key, 
  Lock, 
  Unlock, 
  FileCheck, 
  GitCommit, 
  Terminal, 
  CheckCircle2, 
  XCircle,
  Copy,
  Check,
  Zap,
  ArrowRight
} from 'lucide-react';
import type { ClusterState, Ticket, CryptoTokenPayload } from '../types.ts';

interface CryptoGatekeeperProps {
  state: ClusterState;
}

export const CryptoGatekeeper: React.FC<CryptoGatekeeperProps> = ({ state }) => {
  const [selectedTicketId, setSelectedTicketId] = useState(state.tickets[0].id);
  const [customToken, setCustomToken] = useState('');
  const [testBranch, setTestBranch] = useState(`ai/${state.tickets[0].id}`);
  const [verifyResult, setVerifyResult] = useState<{
    verified?: boolean;
    exitCode?: number;
    error?: string;
    message?: string;
    payload?: CryptoTokenPayload;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const activeTicket = state.tickets.find(t => t.id === selectedTicketId) || state.tickets[0];

  const handleTicketChange = (ticketId: string) => {
    setSelectedTicketId(ticketId);
    const t = state.tickets.find(tk => tk.id === ticketId);
    if (t) {
      setTestBranch(`ai/${t.id}`);
      setCustomToken(t.ed25519Token || '');
      setVerifyResult(null);
    }
  };

  const handleVerify = async () => {
    try {
      const token = customToken || activeTicket.ed25519Token || '';
      const res = await fetch('/api/cluster/ticket/verify-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: activeTicket.id,
          tokenHeader: token,
          branch: testBranch
        })
      });
      const data = await res.json();
      setVerifyResult(data);
    } catch (err: any) {
      setVerifyResult({
        verified: false,
        exitCode: 1,
        error: `Network / Hook Execution Error: ${err.message}`
      });
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Decode active token payload if available
  let decodedPayload: CryptoTokenPayload | null = null;
  const tokenToDecode = customToken || activeTicket.ed25519Token || '';
  if (tokenToDecode.startsWith('SEC-')) {
    try {
      const parts = tokenToDecode.replace('SEC-', '').split('.');
      if (parts[0]) {
        decodedPayload = JSON.parse(atob(parts[0]));
      }
    } catch (e) {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Blueprint Section 5 Spec */}
      <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-xs font-mono">
                Blueprint Section 5
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Asymmetric Cryptography & Server-Side Git Pre-Receive Hook
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-cyan-400" />
              Ed25519 Lease Signer & Pre-Receive Gatekeeper
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Master signs leases with <code className="text-cyan-300">master_private_key.pem</code>. Git server rejects unverified pushes with <code className="text-rose-400">Exit 1 (403_STALE_OR_FORGED_LEASE)</code>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">Select Ticket:</span>
            <select
              value={selectedTicketId}
              onChange={(e) => handleTicketChange(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-cyan-300 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-cyan-500"
            >
              {state.tickets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.id} ({t.assignedTo || 'Unassigned'})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Grid: Ed25519 Token Inspector + Git Hook Sandbox Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Token Structure & Base64 Decoder */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Key className="w-4 h-4 text-cyan-400" />
                Ed25519 Cryptographic Token Header
              </h4>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded">
                SEC-TOKEN
              </span>
            </div>

            {/* Token String */}
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Raw Token Header (Commit Message metadata):</span>
                <button
                  onClick={() => handleCopy(tokenToDecode)}
                  className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  Copy
                </button>
              </div>
              <textarea
                value={customToken || activeTicket.ed25519Token || 'No token generated yet.'}
                onChange={(e) => setCustomToken(e.target.value)}
                rows={3}
                className="w-full bg-[#070b12] border border-slate-800 rounded-lg p-2.5 font-mono text-xs text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Decoded Token Payload (Blueprint 5.B) */}
            <div className="space-y-2">
              <span className="text-xs font-mono text-slate-400 block">
                Decoded Asymmetric Payload:
              </span>
              <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3 font-mono text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Ticket ID:</span>
                  <span className="text-slate-200 font-bold">{decodedPayload?.ticketId || activeTicket.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Worker Node:</span>
                  <span className="text-cyan-300">{decodedPayload?.workerId || activeTicket.assignedTo || 'NODE-UNKNOWN'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Monotonic Epoch:</span>
                  <span className="text-amber-400">Epoch #{decodedPayload?.epochId ?? state.epochId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Files SHA-256 Hash:</span>
                  <span className="text-slate-400">{decodedPayload?.filesHash || '8f92a10b44d9c110'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Lease Expiration:</span>
                  <span className="text-slate-300">
                    {decodedPayload?.expiryTimestamp ? new Date(decodedPayload.expiryTimestamp).toLocaleTimeString() : '1 Hour TTL'}
                  </span>
                </div>
              </div>
            </div>

            {/* Asymmetric Keys Architecture Note */}
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs font-mono text-slate-400 space-y-1">
              <div className="text-slate-300 font-semibold flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-cyan-400" />
                Zero-Trust Key Distribution:
              </div>
              <p>• Master Node: Holds <code className="text-amber-300">secrets/master_private_key.pem</code> (chmod 600)</p>
              <p>• Git Server & Workers: Hold only <code className="text-emerald-300">secrets/master_public_key.pub</code></p>
            </div>

          </div>
        </div>

        {/* Right Column: Server-Side Git Hook Simulator */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <GitCommit className="w-4 h-4 text-cyan-400" />
                Git hooks/pre-receive Verification Test
              </h4>
              <span className="text-[10px] font-mono text-slate-400">
                Server-Side Enforcement
              </span>
            </div>

            {/* Test Inputs */}
            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Target Push Branch:</label>
                <input
                  type="text"
                  value={testBranch}
                  onChange={(e) => setTestBranch(e.target.value)}
                  className="w-full bg-[#070b12] border border-slate-800 rounded-lg px-3 py-2 text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Quick Forge/Tamper Buttons to demonstrate gatekeeper */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => setCustomToken('SEC-invalid_base64_tampered.fake_signature')}
                  className="text-[11px] px-2.5 py-1 bg-rose-950/40 text-rose-300 border border-rose-800/40 rounded hover:bg-rose-900/40 transition"
                >
                  Tamper Token (Forged Signature)
                </button>
                <button
                  onClick={() => setTestBranch('ai/TKT-WRONG-999')}
                  className="text-[11px] px-2.5 py-1 bg-amber-950/40 text-amber-300 border border-amber-800/40 rounded hover:bg-amber-900/40 transition"
                >
                  Mismatched Branch
                </button>
                <button
                  onClick={() => {
                    setCustomToken(activeTicket.ed25519Token || '');
                    setTestBranch(`ai/${activeTicket.id}`);
                  }}
                  className="text-[11px] px-2.5 py-1 bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 rounded hover:bg-emerald-900/40 transition"
                >
                  Restore Valid Token
                </button>
              </div>

              <button
                id="btn-run-gatekeeper-check"
                onClick={handleVerify}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/20 transition active:scale-95"
              >
                <ShieldCheck className="w-4 h-4" />
                Execute hooks/pre-receive Verification
              </button>
            </div>

            {/* Verification Result Output */}
            {verifyResult && (
              <div className={`p-4 rounded-lg border font-mono text-xs space-y-2 ${
                verifyResult.exitCode === 0 
                  ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300' 
                  : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
              }`}>
                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center gap-1.5">
                    {verifyResult.exitCode === 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
                    Hook Result: Exit Code {verifyResult.exitCode}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-950">
                    {verifyResult.exitCode === 0 ? 'PUSH ACCEPTED' : 'PUSH REJECTED'}
                  </span>
                </div>

                <p className="text-[11px]">
                  {verifyResult.message || verifyResult.error}
                </p>

                {verifyResult.exitCode === 0 && (
                  <div className="text-[10px] text-emerald-400/80 pt-1 border-t border-emerald-800/40">
                    → Fast-forward merged into remote branch <code className="text-white">tested/{activeTicket.id}</code>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
};
