import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Copy, 
  Check, 
  Clock, 
  Send, 
  Terminal, 
  ShieldCheck, 
  AlertTriangle,
  Zap
} from 'lucide-react';
import type { ClusterState, TelegramMessage } from '../types.ts';

interface TelegramLiveCardProps {
  state: ClusterState;
  liveCardText: string;
  onRefreshCard: () => void;
  onInjectP0: () => void;
}

export const TelegramLiveCard: React.FC<TelegramLiveCardProps> = ({
  state,
  liveCardText,
  onRefreshCard,
  onInjectP0
}) => {
  const [copied, setCopied] = useState(false);
  const [secondsUntilSync, setSecondsUntilSync] = useState(20);

  // 20s live countdown loop
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilSync(prev => {
        if (prev <= 1) {
          onRefreshCard();
          return 20;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onRefreshCard]);

  const handleCopy = () => {
    navigator.clipboard.writeText(liveCardText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getAlertBadge = (type: TelegramMessage['type']) => {
    switch (type) {
      case 'ALERT_P0':
        return <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">P0 URGENT</span>;
      case 'ALERT_MERGE':
        return <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">MERGE</span>;
      case 'ALERT_HEALING':
        return <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">SELF-HEAL</span>;
      case 'ALERT_FAILOVER':
        return <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">FAILOVER</span>;
      case 'ALERT_RFC':
        return <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">RFC DELEGATION</span>;
      default:
        return <span className="bg-slate-700/50 text-slate-300 text-[10px] px-2 py-0.5 rounded-full font-mono">INFO</span>;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Left Column: Pinned Telegram Live Card (Blueprint Section 8) */}
      <div className="lg:col-span-7 space-y-4">
        
        {/* Telegram Header Container */}
        <div className="bg-[#0e1626] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          
          {/* Telegram Channel Title Bar */}
          <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-cyan-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                <Send className="w-4 h-4 -rotate-45" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  Telegram Event Hub & Live Dashboard
                  <span className="text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                    @SutradharClusterBot
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Channel ID: -10024891024 • Pinned Card auto-refreshed via edit_message_text
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2.5 py-1 rounded-lg font-mono">
                <Clock className="w-3.5 h-3.5 animate-spin" />
                <span>Next Sync: {secondsUntilSync}s</span>
              </div>

              <button
                id="btn-copy-card"
                onClick={handleCopy}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
                title="Copy ASCII Card"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* ASCII Pinned Message Body */}
          <div className="p-4 bg-[#090d16] font-mono text-xs overflow-x-auto">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800/80 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5 text-amber-400">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                PINNED MESSAGE (v5.3 LIVE CARD)
              </span>
              <span>Updated: {new Date(state.lastTelegramCardUpdate).toLocaleTimeString()}</span>
            </div>

            <pre className="text-emerald-400/90 whitespace-pre leading-relaxed selection:bg-emerald-900 selection:text-white">
              {liveCardText}
            </pre>
          </div>

          {/* Card Footer Controls */}
          <div className="px-4 py-2.5 bg-slate-900/60 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Trigger instant update or broadcast P0 alert:
            </span>
            <div className="flex items-center gap-2">
              <button
                id="btn-manual-sync"
                onClick={onRefreshCard}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 font-mono text-[11px] transition"
              >
                Sync Now
              </button>
              <button
                id="btn-test-telegram-ping"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/telegram/test-ping', { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      alert('✅ Message sent to Telegram: Check your Telegram channel/chat!');
                    } else {
                      alert(`ℹ️ Telegram Status: ${data.error}\n\nHint: ${data.hint || ''}`);
                    }
                  } catch (e: any) {
                    alert(`Network error testing Telegram: ${e.message}`);
                  }
                }}
                className="px-2.5 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded font-mono text-[11px] flex items-center gap-1 transition"
                title="Send test message to your configured Telegram bot"
              >
                <Send className="w-3 h-3 text-cyan-400" />
                Send Bot Ping
              </button>
              <button
                id="btn-quick-p0"
                onClick={onInjectP0}
                className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded font-mono text-[11px] flex items-center gap-1 transition"
              >
                <Zap className="w-3 h-3 text-rose-400" />
                Broadcast P0
              </button>
            </div>
          </div>

        </div>

        {/* Blueprint Section 1 Topology Highlights */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-2">
          <h4 className="font-semibold text-slate-200 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            Sutradhar Swarm Operational Principles
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-400 font-mono text-[11px]">
            <li className="flex items-center gap-1.5 bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-cyan-400">▸</span> Dual-Process Hybrid Master
            </li>
            <li className="flex items-center gap-1.5 bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-cyan-400">▸</span> Monotonic Epoch Consensus
            </li>
            <li className="flex items-center gap-1.5 bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-cyan-400">▸</span> Ed25519 Pre-Receive Gatekeeper
            </li>
            <li className="flex items-center gap-1.5 bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-cyan-400">▸</span> 3-Tier Closed-Loop Healing
            </li>
          </ul>
        </div>

      </div>

      {/* Right Column: Telegram Direct Alert Stream */}
      <div className="lg:col-span-5 space-y-4">
        
        <div className="bg-[#0e1626] border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col h-full max-h-[620px]">
          
          <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                Direct Alerts & RFC Escalations
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
              {state.telegramFeed.length} Events
            </span>
          </div>

          {/* Event Stream */}
          <div className="p-4 space-y-3 overflow-y-auto flex-1 font-mono text-xs">
            {state.telegramFeed.map(msg => (
              <div 
                key={msg.id}
                className={`p-3 rounded-lg border transition ${
                  msg.urgent 
                    ? 'bg-rose-950/30 border-rose-800/60 text-rose-200' 
                    : 'bg-slate-900/80 border-slate-800/80 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {getAlertBadge(msg.type)}
                    <span className="text-[10px] text-slate-500">
                      {msg.timestamp}
                    </span>
                  </div>
                  {msg.urgent && (
                    <span className="flex items-center gap-1 text-[10px] text-rose-400 font-bold">
                      <AlertTriangle className="w-3 h-3 text-rose-400" />
                      PRIORITY 0
                    </span>
                  )}
                </div>
                <p className="text-[12px] leading-relaxed text-slate-200 font-sans">
                  {msg.text}
                </p>
              </div>
            ))}
          </div>

        </div>

      </div>

    </div>
  );
};
