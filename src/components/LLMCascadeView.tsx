import React, { useState } from 'react';
import { 
  Gauge, 
  Cpu, 
  Sparkles, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  RotateCw, 
  ArrowRight,
  Database,
  ShieldAlert
} from 'lucide-react';
import type { ClusterState, LLMCascadeTier } from '../types.ts';

interface LLMCascadeViewProps {
  state: ClusterState;
}

export const LLMCascadeView: React.FC<LLMCascadeViewProps> = ({ state }) => {
  const [testPrompt, setTestPrompt] = useState('Implement sanitized user bio updates for Matrimony ProfileController with 1000 char constraint.');
  const [selectedProvider, setSelectedProvider] = useState<string>('Google AI Studio (Gemini 2.0 Pro)');
  const [isSimulating, setIsSimulating] = useState(false);
  const [cascadeLog, setCascadeLog] = useState<string[]>([]);

  const handleSimulateCascade = () => {
    setIsSimulating(true);
    setCascadeLog([]);

    const steps = [
      'Token Bucket: Consumed 1 token (Current RPM: 4.8 / 10.0)',
      'Primary [Tier 1]: Attempting Google AI Studio (gemini-2.0-pro)...',
      'Context Preserved: Preserved initial system blueprint prompt & allowed_files whitelist.',
      'Primary Tier Success: HTTP 200 OK received in 1.14s. Synthesis complete.'
    ];

    steps.forEach((step, idx) => {
      setTimeout(() => {
        setCascadeLog(prev => [...prev, step]);
        if (idx === steps.length - 1) {
          setIsSimulating(false);
        }
      }, (idx + 1) * 600);
    });
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Section 6 Spec */}
      <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-xs font-mono">
                Blueprint Section 6
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Leaky-Bucket Rate Limiter (Max 10 RPM) & Context-Preserved Cascade
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Gauge className="w-5 h-5 text-cyan-400" />
              Multi-Tier LLM Cascading & Token Bucket Engine
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Zero-downtime synthesis: if Primary Gemini Pro is rate-limited, requests cascade down OpenRouter models with full stacktrace context.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg font-mono text-xs flex items-center gap-3">
              <div>
                <span className="text-slate-400 block text-[10px]">CURRENT RATE</span>
                <span className="text-cyan-300 font-bold text-sm">{state.rpm.toFixed(1)} RPM</span>
              </div>
              <div className="h-6 w-[1px] bg-slate-700"></div>
              <div>
                <span className="text-slate-400 block text-[10px]">LEAKY BUCKET CAP</span>
                <span className="text-amber-400 font-bold text-sm">{state.maxRpm} RPM</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: 5-Tier Waterfall Cascade Cards + Live Simulation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: 5 Tier Waterfall */}
        <div className="lg:col-span-7 space-y-3">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5 font-mono mb-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            5-Tier Priority Cascade Hierarchy (Blueprint 6.B)
          </h4>

          {state.llmCascade.map(tier => {
            const isPrimary = tier.priority === 1;

            return (
              <div
                key={tier.priority}
                className={`p-4 rounded-xl border transition ${
                  isPrimary 
                    ? 'bg-slate-900 border-cyan-500/50 shadow-md shadow-cyan-500/5 ring-1 ring-cyan-500/20' 
                    : 'bg-[#0c121e] border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-bold ${
                      isPrimary 
                        ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-400/40' 
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      {tier.priority}
                    </span>

                    <div>
                      <div className="flex items-center gap-2">
                        <h5 className="text-sm font-bold text-slate-100">
                          {tier.name}
                        </h5>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          {tier.provider}
                        </span>
                      </div>
                      <code className="text-xs text-cyan-400 font-mono">
                        {tier.model}
                      </code>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                      tier.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                      tier.status === 'READY' ? 'bg-slate-800 text-slate-300 border-slate-700' :
                      'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    }`}>
                      {tier.status}
                    </span>
                    <span className="text-[10px] text-slate-500 block font-mono mt-0.5">
                      Cost: {tier.rpmCost} Token
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Context Preservation Engine & Simulator */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#0e1626] border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                Context-Preserved Cascade Simulator
              </h4>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Synthesizer Prompt:</label>
                <textarea
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  rows={3}
                  className="w-full bg-[#070b12] border border-slate-800 rounded-lg p-2.5 text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs space-y-1">
                <span className="text-slate-300 font-semibold block">Context Preservation Vector (Blueprint 6.C):</span>
                <p className="text-slate-400">• Original prompt + allowed_files</p>
                <p className="text-slate-400">• Failing unified diff patch</p>
                <p className="text-slate-400">• Captured stderr & line stacktrace</p>
              </div>

              <button
                id="btn-simulate-llm-call"
                onClick={handleSimulateCascade}
                disabled={isSimulating}
                className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50"
              >
                <Zap className="w-4 h-4" />
                {isSimulating ? 'Executing Cascade...' : 'Dispatch LLM Synthesis Request'}
              </button>
            </div>

            {/* Cascade Output Log */}
            {cascadeLog.length > 0 && (
              <div className="p-3 bg-[#070b12] border border-slate-800 rounded-lg font-mono text-xs space-y-1.5 max-h-48 overflow-y-auto">
                <span className="text-[10px] text-slate-500 block uppercase">Cascade Event Log:</span>
                {cascadeLog.map((log, i) => (
                  <div key={i} className="text-emerald-400 flex items-start gap-1.5 text-[11px]">
                    <span className="text-slate-600">❯</span>
                    <span>{log}</span>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
};
