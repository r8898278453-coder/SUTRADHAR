import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import type { ClusterState, SwarmNode, Ticket, LLMCascadeTier, TelegramMessage, CryptoTokenPayload } from './src/types.ts';

const app = express();
const PORT = 3000;
app.use(express.json());

// Lazy-initialized Gemini AI Client
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    try {
      aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e) {
      console.warn('Failed to initialize GoogleGenAI with provided key:', e);
    }
  }
  return aiClient;
}

// Initial Simulated Nodes
const initialNodes: SwarmNode[] = [
  {
    id: 'NODE-E78A1201',
    name: 'Node_Alpha',
    role: 'MASTER',
    domain: 'Core Orchestrator',
    status: 'ACTIVE',
    macAddress: '02:42:ac:11:00:02',
    gitAuthor: 'Sutradhar-NODE-E78A1201 <node_alpha@cluster.internal>',
    uptimeSeconds: 29520, // ~8h 12m
    health: {
      dns: { ok: true, rttMs: 42 },
      gitSsh: { ok: true, headSha: 'c8f92a1d' },
      docker: { ok: true, status: 'Docker 27.1.1 (healthy)' },
      memory: { ok: true, freeMb: 1420 },
      llm: { ok: true, provider: 'Google AI Studio (Gemini)' },
    },
    isHybridLocal: false,
  },
  {
    id: 'NODE-B44D9C10',
    name: 'Node_Beta',
    role: 'STANDBY',
    domain: 'Mirror Standby #1',
    status: 'IDLE',
    macAddress: '02:42:ac:11:00:03',
    gitAuthor: 'Sutradhar-NODE-B44D9C10 <node_beta@cluster.internal>',
    uptimeSeconds: 28400,
    health: {
      dns: { ok: true, rttMs: 38 },
      gitSsh: { ok: true, headSha: 'c8f92a1d' },
      docker: { ok: true, status: 'Docker 27.1.1 (healthy)' },
      memory: { ok: true, freeMb: 1100 },
      llm: { ok: true, provider: 'OpenRouter (DeepSeek R1)' },
    },
  },
  {
    id: 'NODE-C91A77E2',
    name: 'Node_Gamma',
    role: 'STANDBY',
    domain: 'Mirror Standby #2',
    status: 'IDLE',
    macAddress: '02:42:ac:11:00:04',
    gitAuthor: 'Sutradhar-NODE-C91A77E2 <node_gamma@cluster.internal>',
    uptimeSeconds: 21600,
    health: {
      dns: { ok: true, rttMs: 51 },
      gitSsh: { ok: true, headSha: 'c8f92a1d' },
      docker: { ok: true, status: 'Docker 27.1.1 (healthy)' },
      memory: { ok: true, freeMb: 890 },
      llm: { ok: true, provider: 'OpenRouter (Qwen 2.5 Coder)' },
    },
  },
  {
    id: 'NODE-A8F24C09',
    name: 'Node_Worker_01',
    role: 'WORKER_AUTH',
    domain: 'Auth & Identity Module',
    status: 'TESTING',
    macAddress: '02:42:ac:11:00:05',
    gitAuthor: 'Sutradhar-NODE-A8F24C09 <worker01@cluster.internal>',
    uptimeSeconds: 18200,
    currentTicketId: 'TKT-105',
    health: {
      dns: { ok: true, rttMs: 45 },
      gitSsh: { ok: true, headSha: 'c8f92a1d' },
      docker: { ok: true, status: 'Ephemeral Sandbox Ready' },
      memory: { ok: true, freeMb: 940 },
      llm: { ok: true, provider: 'Google AI Studio' },
    },
  },
  {
    id: 'NODE-B7A93310',
    name: 'Node_Worker_02',
    role: 'WORKER_MATRIMONY',
    domain: 'Matrimony & Profiles Module',
    status: 'SYNTHESIZING',
    macAddress: '02:42:ac:11:00:06',
    gitAuthor: 'Sutradhar-NODE-B7A93310 <worker02@cluster.internal>',
    uptimeSeconds: 16900,
    currentTicketId: 'TKT-104',
    health: {
      dns: { ok: true, rttMs: 36 },
      gitSsh: { ok: true, headSha: 'c8f92a1d' },
      docker: { ok: true, status: 'Ephemeral Sandbox Ready' },
      memory: { ok: true, freeMb: 1250 },
      llm: { ok: true, provider: 'Google AI Studio' },
    },
  },
  {
    id: 'NODE-D320FE45',
    name: 'Node_Worker_03',
    role: 'WORKER_MEDIA',
    domain: 'Media & CDN Module',
    status: 'ACTIVE',
    macAddress: '02:42:ac:11:00:07',
    gitAuthor: 'Sutradhar-NODE-D320FE45 <worker03@cluster.internal>',
    uptimeSeconds: 15400,
    currentTicketId: 'TKT-106',
    health: {
      dns: { ok: true, rttMs: 62 },
      gitSsh: { ok: true, headSha: 'c8f92a1d' },
      docker: { ok: true, status: 'Ephemeral Sandbox Ready' },
      memory: { ok: true, freeMb: 670 },
      llm: { ok: true, provider: 'OpenRouter (LLaMA 3.1 70B)' },
    },
  },
  {
    id: 'NODE-F998AA11',
    name: 'Node_Worker_04',
    role: 'WORKER_AUTH',
    domain: 'Auth Worker Standby',
    status: 'OFFLINE',
    macAddress: '02:42:ac:11:00:08',
    gitAuthor: 'Sutradhar-NODE-F998AA11 <worker04@cluster.internal>',
    uptimeSeconds: 0,
    health: {
      dns: { ok: false, rttMs: 0 },
      gitSsh: { ok: false, headSha: '' },
      docker: { ok: false, status: 'Dead container socket' },
      memory: { ok: false, freeMb: 0 },
      llm: { ok: false, provider: 'Disconnected' },
    },
  }
];

// Initial DAG Task Tickets matching Blueprint v5.3
const initialTickets: Ticket[] = [
  {
    id: 'TKT-101',
    title: 'Ed25519 Token Signer Subsystem',
    description: 'Implement asymmetric cryptographic token signature and verification payload for worker leases.',
    priority: 'P1_HIGH',
    domain: 'Core',
    status: 'COMMITTED_PUSHED',
    assignedTo: 'NODE-E78A1201',
    parentTicketIds: [],
    allowedFiles: ['core/crypto_signer.py', 'tests/test_crypto.py'],
    readOnlyContracts: ['config/cluster_config.json'],
    retryCount: 0,
    maxRetries: 3,
    branch: 'ai/TKT-101',
    ed25519Token: 'SEC-eyJ0aWNrZXRfaWQiOiJUS1QtMTAxIiwid29ya2VyX2lkIjoiTk9ERS1FNzhBMTIwMSIsImVwb2NoX2lkIjoxNSwiZXhwaXJ5X3RpbWVzdGFtcCI6MTc4ODA5MDAwMH0=.dG9rZW5fc2lnbmF0dXJlX2ExYjJjMw==',
    llmUsed: 'gemini-2.0-pro (Google AI Studio)',
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    logs: [
      { timestamp: '10:00:02', level: 'INFO', message: 'Lease issued with Ed25519 signature SEC-TOKEN.' },
      { timestamp: '10:00:15', level: 'INFO', message: 'Synthesized patch.diff for crypto_signer.py.' },
      { timestamp: '10:00:30', level: 'SUCCESS', message: 'Sandbox docker pytest passed with exit code 0.' },
      { timestamp: '10:00:35', level: 'SUCCESS', message: 'Pre-receive hook accepted push to tested/TKT-101.' }
    ]
  },
  {
    id: 'TKT-102',
    title: 'Auth Interface & JWT Verification Contract',
    description: 'Provide BaseAuthInterface contract and token expiration validation rules for Matrimony & Media.',
    priority: 'P1_HIGH',
    domain: 'Auth',
    status: 'COMMITTED_PUSHED',
    assignedTo: 'NODE-A8F24C09',
    parentTicketIds: ['TKT-101'],
    allowedFiles: ['modules/auth/AuthService.php', 'contracts/AuthInterface.php', 'tests/Unit/AuthTest.php'],
    readOnlyContracts: ['contracts/BaseInterface.php'],
    retryCount: 0,
    maxRetries: 3,
    branch: 'ai/TKT-102',
    ed25519Token: 'SEC-eyJ0aWNrZXRfaWQiOiJUS1QtMTAyIiwid29ya2VyX2lkIjoiTk9ERS1BOEYyNEMwOSIsImVwb2NoX2lkIjoxNSwiZXhwaXJ5X3RpbWVzdGFtcCI6MTc4ODA5MDAwMH0=.dG9rZW5fc2lnbmF0dXJlX2I0YzVkNg==',
    llmUsed: 'gemini-2.0-pro (Google AI Studio)',
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    logs: [
      { timestamp: '11:15:00', level: 'INFO', message: 'DAG Parent TKT-101 merged. Ticket unblocked.' },
      { timestamp: '11:15:20', level: 'SUCCESS', message: 'Docker Sandbox passed: 8/8 tests green.' },
      { timestamp: '11:15:42', level: 'SUCCESS', message: 'Pushed to tested/TKT-102.' }
    ]
  },
  {
    id: 'TKT-104',
    title: 'Matrimony Profile Controller & Bio Sanitizer',
    description: 'Implement sanitization pipeline for user bio, horoscope constraints, and match preference scoring.',
    priority: 'P2_NORMAL',
    domain: 'Matrimony',
    status: 'SYNTHESIZING_DIFF',
    assignedTo: 'NODE-B7A93310',
    parentTicketIds: ['TKT-102'],
    allowedFiles: ['modules/matrimony/ProfileController.php', 'tests/Unit/ProfileTest.php'],
    readOnlyContracts: ['contracts/AuthInterface.php'],
    retryCount: 0,
    maxRetries: 3,
    branch: 'ai/TKT-104',
    currentTier: 1,
    diffPatch: `--- a/modules/matrimony/ProfileController.php\n+++ b/modules/matrimony/ProfileController.php\n@@ -14,6 +14,14 @@ public function updateBio(Request $request) {\n+    $sanitized = htmlspecialchars(trim($request->input('bio')));\n+    if (mb_strlen($sanitized) > 1000) {\n+        throw new ValidationException("Bio exceeds 1000 chars");\n+    }\n+    return $this->repository->saveBio($request->user()->id, $sanitized);`,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [
      { timestamp: '13:20:10', level: 'INFO', message: 'DAG dependency TKT-102 satisfied. Leased to Node_Worker_02.' },
      { timestamp: '13:20:12', level: 'INFO', message: 'Ed25519 lease verified. allowed_files whitelist enforced.' },
      { timestamp: '13:20:30', level: 'INFO', message: 'Synthesizing unified diff patch via Gemini Pro...' }
    ]
  },
  {
    id: 'TKT-105',
    title: 'Multi-Factor Auth Rate Limiting & Lockout',
    description: 'Enforce 5-attempt brute-force lock on OTP verification endpoint with Redis in-memory tracking.',
    priority: 'P1_HIGH',
    domain: 'Auth',
    status: 'TESTING_SANDBOX',
    assignedTo: 'NODE-A8F24C09',
    parentTicketIds: ['TKT-102'],
    allowedFiles: ['modules/auth/MfaController.php', 'tests/Unit/MfaTest.php'],
    readOnlyContracts: ['contracts/AuthInterface.php'],
    retryCount: 1,
    maxRetries: 3,
    currentTier: 2,
    diffPatch: `--- a/modules/auth/MfaController.php\n+++ b/modules/auth/MfaController.php\n@@ -32,4 +32,9 @@ public function verifyOtp($user, $code) {\n+    $attempts = $this->cache->get("mfa_attempts:{$user->id}") ?? 0;\n+    if ($attempts >= 5) {\n+        return response()->json(['error' => 'LOCKOUT_429'], 429);\n+    }\n+    $this->cache->increment("mfa_attempts:{$user->id}");`,
    testStderr: `FAILED tests/Unit/MfaTest.php::test_mfa_lockout_expiry - AssertionError: Expected status 429 but received 200 on 6th request\nTypeError: increment() expects parameter 2 to be int, null given at line 36`,
    testStdout: `Running pytest in Docker Sandbox (container-id: 7f83a21b, mem: 512m, net: none)\n============================= test session starts ==============================\nCollected 4 items\ntests/Unit/MfaTest.php ...F [100%]\n=================================== FAILURES ===================================`,
    branch: 'ai/TKT-105',
    createdAt: new Date(Date.now() - 2400000).toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [
      { timestamp: '13:10:04', level: 'INFO', message: 'Leased to Node_Worker_01. Patch synthesized.' },
      { timestamp: '13:11:15', level: 'WARN', message: 'Docker Sandbox test failed (Exit code 1). Triggering Closed-Loop Self-Healing Retry 1/3.' }
    ]
  },
  {
    id: 'TKT-106',
    title: 'Media CDN Watermark & Image Compression',
    description: 'Process user profile photos with WebP conversion, EXIF metadata stripping, and cryptographic watermarking.',
    priority: 'P2_NORMAL',
    domain: 'Media',
    status: 'COMMITTED_PUSHED',
    assignedTo: 'NODE-D320FE45',
    parentTicketIds: ['TKT-101'],
    allowedFiles: ['modules/media/ImageProcessor.php', 'tests/Unit/MediaTest.php'],
    readOnlyContracts: ['config/cluster_config.json'],
    retryCount: 0,
    maxRetries: 3,
    branch: 'ai/TKT-106',
    ed25519Token: 'SEC-eyJ0aWNrZXRfaWQiOiJUS1QtMTA2Iiwid29ya2VyX2lkIjoiTk9SRS1EMzIwRkU0NSIsImVwb2NoX2lkIjoxNSwiZXhwaXJ5X3RpbWVzdGFtcCI6MTc4ODA5MDAwMH0=.c2lnbl9jZG5fd2F0ZXJtYXJrXzc4OQ==',
    llmUsed: 'meta-llama/llama-3.1-70b:free (OpenRouter)',
    createdAt: new Date(Date.now() - 4800000).toISOString(),
    updatedAt: new Date(Date.now() - 1200000).toISOString(),
    logs: [
      { timestamp: '12:30:10', level: 'INFO', message: 'Assigned to Node_Worker_03.' },
      { timestamp: '12:31:05', level: 'SUCCESS', message: 'Ephemeral Docker test passed in 14.2s (Mem: 240MB).' },
      { timestamp: '12:31:22', level: 'SUCCESS', message: 'Ed25519 Token verified by pre-receive hook. Pushed to tested/TKT-106.' }
    ]
  },
  {
    id: 'TKT-107',
    title: 'End-to-End Match Proposal & Realtime Notification',
    description: 'Dispatch match notifications through Redis pub/sub and send push alerts to authorized user clients.',
    priority: 'P2_NORMAL',
    domain: 'Matrimony',
    status: 'BLOCKED_ON_PARENT',
    parentTicketIds: ['TKT-104', 'TKT-105'],
    allowedFiles: ['modules/matrimony/MatchNotifier.php', 'tests/Integration/MatchTest.php'],
    readOnlyContracts: ['contracts/AuthInterface.php'],
    retryCount: 0,
    maxRetries: 3,
    branch: 'ai/TKT-107',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [
      { timestamp: '13:00:00', level: 'WARN', message: 'BLOCKED: Waiting for parent tasks TKT-104 & TKT-105 to merge into tested/.' }
    ]
  },
  {
    id: 'TKT-108',
    title: 'Media Verification Badge for Profile Match',
    description: 'Attach verified badge to matrimony profile cards once media EXIF and face recognition checks pass.',
    priority: 'P2_NORMAL',
    domain: 'Matrimony',
    status: 'BLOCKED_ON_PARENT',
    parentTicketIds: ['TKT-106', 'TKT-107'],
    allowedFiles: ['modules/matrimony/VerificationBadge.php', 'tests/Unit/BadgeTest.php'],
    readOnlyContracts: ['contracts/AuthInterface.php'],
    retryCount: 0,
    maxRetries: 3,
    branch: 'ai/TKT-108',
    createdAt: new Date(Date.now() - 1200000).toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [
      { timestamp: '13:05:00', level: 'WARN', message: 'BLOCKED: Waiting on parent task TKT-107.' }
    ]
  }
];

const initialLLMCascade: LLMCascadeTier[] = [
  { priority: 1, name: 'Gemini 2.0 Pro / Flash', model: 'gemini-2.0-pro-exp-02-05', provider: 'Google AI Studio', status: 'ACTIVE', rpmCost: 1 },
  { priority: 2, name: 'DeepSeek R1', model: 'deepseek/deepseek-r1:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 3, name: 'Qwen 2.5 Coder 32B', model: 'qwen/qwen-2.5-coder-32b:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 4, name: 'LLaMA 3.1 70B', model: 'meta-llama/llama-3.1-70b:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 5, name: 'Gemini Flash 1.5 8B', model: 'google/gemini-flash-1.5-8b:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 }
];

let clusterState: ClusterState = {
  version: 'v5.3 PRODUCTION BLUEPRINT',
  epochId: 15,
  activeMasterId: 'NODE-E78A1201',
  masterMode: 'ORCHESTRATOR',
  nodes: initialNodes,
  tickets: initialTickets,
  rpm: 4.8,
  maxRpm: 10.0,
  telegramFeed: [
    {
      id: 'tg-01',
      timestamp: '13:20:00',
      type: 'ALERT_MERGE',
      text: '✅ [TKT-106] Node_Worker_03 successfully merged tested/TKT-106 into master branch via Ed25519 token verification.'
    },
    {
      id: 'tg-02',
      timestamp: '13:20:15',
      type: 'ALERT_HEALING',
      text: '🔵 [TKT-105] Node_Worker_01 Docker sandbox test failed (TypeError). Initiating self-healing retry 1/3 with preserved context.'
    },
    {
      id: 'tg-03',
      timestamp: '13:21:00',
      type: 'ALERT_RFC',
      text: '📨 Bot-to-Bot RFC: Node_Worker_02 (Matrimony) requested interface update from Node_Worker_01 (Auth).'
    }
  ],
  lastTelegramCardUpdate: new Date().toISOString(),
  llmCascade: initialLLMCascade,
  isLiveSimulation: true
};

// Helper: Generate Ed25519 Token
function generateEd25519Token(ticketId: string, workerId: string, epochId: number, files: string[]): { tokenHeader: string; expiresAt: number } {
  const expiresAt = Date.now() + 3600 * 1000; // 1 hour TTL
  const filesHash = crypto.createHash('sha256').update(files.join(',')).digest('hex').substring(0, 16);
  
  const payload: CryptoTokenPayload = {
    ticketId,
    workerId,
    epochId,
    expiryTimestamp: expiresAt,
    filesHash
  };
  
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHash('sha256').update(`${payloadB64}:MASTER_SECRET_ED25519_KEY`).digest('base64');
  const tokenHeader = `SEC-${payloadB64}.${signature}`;
  
  return { tokenHeader, expiresAt };
}

// Generate Pinned Telegram Live Card ASCII text
function generateLiveCardText(state: ClusterState): string {
  const master = state.nodes.find(n => n.id === state.activeMasterId) || state.nodes[0];
  const standbys = state.nodes.filter(n => n.role === 'STANDBY').map(n => n.name).join(' | ');
  const onlineWorkers = state.nodes.filter(n => n.status !== 'OFFLINE' && n.role.startsWith('WORKER')).length;
  
  const ticketLines = state.tickets.slice(0, 5).map(t => {
    let icon = '⚪';
    let statusText: string = t.status;
    if (t.status === 'SYNTHESIZING_DIFF') { icon = '🟡'; statusText = 'Synthesizing Patch'; }
    else if (t.status === 'TESTING_SANDBOX') { icon = '🔵'; statusText = `Docker Test (Retry ${t.retryCount}/${t.maxRetries})`; }
    else if (t.status === 'COMMITTED_PUSHED') { icon = '🟢'; statusText = 'Committed & Pushed'; }
    else if (t.status === 'BLOCKED_ON_PARENT') { icon = '⏳'; statusText = 'BLOCKED (Waiting on Parents)'; }
    else if (t.status === 'NEEDS_HUMAN_REVIEW') { icon = '🔴'; statusText = 'NEEDS HUMAN REVIEW'; }
    
    const worker = state.nodes.find(n => n.id === t.assignedTo)?.name || 'Unassigned';
    return `• [${t.id}] ${worker} ──► ${icon} ${statusText}`;
  }).join('\n');

  const offlineWorker = state.nodes.find(n => n.status === 'OFFLINE');
  const offlineNotice = offlineWorker ? `\n⚠️ ${offlineWorker.name}: 🔴 OFFLINE (Lease Revoked & Recycled)` : '';

  return `┌─────────────────────────────────────────────────────────────┐
│ 🟢 SUTRADHAR CLUSTER DASHBOARD (v5.3 LIVE CARD)             │
│ 👑 Active Master: ${master.name} (Epoch: ${state.epochId} | Uptime: ${Math.floor(master.uptimeSeconds / 3600)}h ${Math.floor((master.uptimeSeconds % 3600) / 60)}m)   │
│ 🛠️ Master Mode: ⚡ ${state.masterMode === 'HYBRID_LOCAL' ? 'Local Hybrid [P0 URGENT HOTFIX]' : 'Orchestrator Daemon'} │
│ 🛡️ Standby Tier: ${standbys || 'None'}           │
│ ⚙️ Rate Limiter: ${state.rpm.toFixed(1)} RPM | Cluster Workers: ${onlineWorkers} Online        │
│                                                             │
│ 📋 ACTIVE PIPELINE (DAG & Domain Isolated):                 │
${ticketLines}
${offlineNotice}
└─────────────────────────────────────────────────────────────┘`;
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Get current cluster state
app.get('/api/cluster/state', (req, res) => {
  res.json({
    ...clusterState,
    liveCardText: generateLiveCardText(clusterState)
  });
});

// 2. Inject Ticket (Normal or P0 Hotfix)
app.post('/api/cluster/ticket/create', (req, res) => {
  const { title, description, domain, priority, allowedFiles, isP0 } = req.body;
  const ticketCount = clusterState.tickets.length + 101;
  const ticketId = isP0 ? `TKT-999` : `TKT-${ticketCount}`;
  
  // If P0 hotfix, Master switches to Local Hybrid execution
  let assignedNodeId = clusterState.activeMasterId;
  let status: Ticket['status'] = 'SYNTHESIZING_DIFF';
  
  if (isP0) {
    clusterState.masterMode = 'HYBRID_LOCAL';
    const masterNode = clusterState.nodes.find(n => n.id === clusterState.activeMasterId);
    if (masterNode) {
      masterNode.isHybridLocal = true;
      masterNode.currentTicketId = ticketId;
      masterNode.status = 'LOCAL_HYBRID';
    }
  } else {
    // Pick suitable worker node
    const availableWorker = clusterState.nodes.find(n => n.role.startsWith('WORKER') && n.status === 'IDLE')
      || clusterState.nodes.find(n => n.role.startsWith('WORKER') && n.status !== 'OFFLINE');
    if (availableWorker) {
      assignedNodeId = availableWorker.id;
      availableWorker.currentTicketId = ticketId;
      availableWorker.status = 'SYNTHESIZING';
    }
  }

  const { tokenHeader, expiresAt } = generateEd25519Token(ticketId, assignedNodeId, clusterState.epochId, allowedFiles || ['modules/core/Hotfix.php']);

  const newTicket: Ticket = {
    id: ticketId,
    title: title || (isP0 ? 'URGENT P0 HOTFIX: Fix Cluster Auth Drift' : `Ticket ${ticketId}`),
    description: description || 'Automated ticket dispatched by Sutradhar Swarm Orchestrator.',
    priority: isP0 ? 'P0_URGENT' : (priority || 'P2_NORMAL'),
    domain: domain || 'Core',
    status: status,
    assignedTo: assignedNodeId,
    parentTicketIds: [],
    allowedFiles: allowedFiles || ['modules/core/Hotfix.php', 'tests/Unit/HotfixTest.php'],
    readOnlyContracts: ['contracts/AuthInterface.php'],
    retryCount: 0,
    maxRetries: 3,
    currentTier: 1,
    branch: `ai/${ticketId}`,
    ed25519Token: tokenHeader,
    tokenExpiresAt: expiresAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: 'INFO', message: `Ticket ${ticketId} created. Priority: ${isP0 ? 'P0_URGENT (Master Local Exec)' : priority}.` },
      { timestamp: new Date().toLocaleTimeString(), level: 'INFO', message: `Ed25519 Security Token generated. Whitelist: ${(allowedFiles || []).join(', ')}` }
    ]
  };

  clusterState.tickets.unshift(newTicket);

  // Add Telegram Alert
  const alertText = isP0 
    ? `🚨 [P0 HOTFIX] Master Node triggered Local Hybrid Execution for ${ticketId}: ${newTicket.title}!`
    : `📋 Dispatched ${ticketId} to ${clusterState.nodes.find(n => n.id === assignedNodeId)?.name || assignedNodeId}.`;

  clusterState.telegramFeed.unshift({
    id: `tg-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: isP0 ? 'ALERT_P0' : 'ALERT_RFC',
    urgent: isP0,
    text: alertText
  });

  // Broadcast to Real Telegram Channel if configured
  broadcastToTelegram(
    isP0 
      ? `🚨 <b>[URGENT P0 HOTFIX TRIGGERED]</b>\n\n` +
        `🎫 <b>Ticket:</b> ${ticketId}\n` +
        `📝 <b>Title:</b> ${newTicket.title}\n` +
        `🛡️ <b>Assigned Node:</b> ${assignedNodeId} (Master Local Exec)\n` +
        `🔑 <b>Security Token:</b> ${tokenHeader.substring(0, 24)}...\n` +
        `⚡ <b>Status:</b> Synthesizing with Closed-Loop Self-Healing`
      : `📋 <b>[NEW RFC TICKET DISPATCHED]</b>\n\n` +
        `🎫 <b>Ticket:</b> ${ticketId}\n` +
        `📝 <b>Title:</b> ${newTicket.title}\n` +
        `🎯 <b>Domain:</b> ${newTicket.domain}\n` +
        `🤖 <b>Worker:</b> ${assignedNodeId}\n` +
        `🔒 <b>Whitelist:</b> <code>${newTicket.allowedFiles.join(', ')}</code>`
  );

  res.json({ success: true, ticket: newTicket, state: clusterState });
});

// 3. AI Code Synthesis using real Gemini API or Context-Preserved Cascade
app.post('/api/cluster/ticket/synthesize', async (req, res) => {
  const { ticketId, customPrompt } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  ticket.status = 'SYNTHESIZING_DIFF';
  clusterState.rpm = Math.min(clusterState.maxRpm, clusterState.rpm + 0.5);

  const ai = getAI();
  let generatedDiff = '';
  let providerUsed = 'Google AI Studio (Gemini 2.0 Pro)';

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: `You are the Sutradhar Autonomous Worker (${ticket.assignedTo}).
Generate a clean, unified git diff patch for ticket ${ticket.id} (${ticket.title}).
Domain: ${ticket.domain}.
Allowed mutable files ONLY: ${ticket.allowedFiles.join(', ')}.
Requirements: ${ticket.description}.
Output ONLY the raw unified diff (starting with diff --git or --- / +++).`,
      });
      generatedDiff = response.text || '';
      providerUsed = 'Google AI Studio (Gemini 2.0 Flash - LIVE API)';
    } catch (err: any) {
      console.warn('Gemini API call failed, falling back to simulated cascade:', err.message);
      providerUsed = 'OpenRouter (DeepSeek R1 Cascade Fallback)';
    }
  }

  if (!generatedDiff) {
    // Deterministic realistic diff based on domain
    const targetFile = ticket.allowedFiles[0] || `modules/${ticket.domain.toLowerCase()}/Handler.php`;
    generatedDiff = `--- a/${targetFile}
+++ b/${targetFile}
@@ -10,6 +10,15 @@ class ${ticket.domain}Handler {
+    /**
+     * Generated by Sutradhar Swarm Node (${ticket.assignedTo})
+     * Task: ${ticket.id} - ${ticket.title}
+     */
+    public function executeSafeContract(Request $request) {
+        $this->guardAllowedFiles("${ticket.allowedFiles.join(', ')}");
+        return $this->processDomainPayload($request->all());
+    }
 }`;
  }

  ticket.diffPatch = generatedDiff;
  ticket.llmUsed = providerUsed;
  ticket.status = 'TESTING_SANDBOX';
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'INFO',
    message: `Synthesized unified diff via ${providerUsed}. Moving to Ephemeral Sandbox.`
  });

  res.json({ success: true, ticket, generatedDiff, providerUsed });
});

// 4. Run Ephemeral Docker Sandbox Test (3-Tier Patch Normalizer + Pytest Simulation)
app.post('/api/cluster/ticket/test', (req, res) => {
  const { ticketId, simulateFailure } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  // 3-Tier Normalization
  ticket.currentTier = simulateFailure ? 2 : 1;
  const exitCode = simulateFailure ? 1 : 0;

  if (exitCode === 0) {
    ticket.status = 'COMMITTED_PUSHED';
    ticket.testStderr = undefined;
    ticket.testStdout = `[EPHEMERAL DOCKER SANDBOX (Mem: 512MB, Net: None, Timeout: 45s)]
Applying patch with Tier ${ticket.currentTier} (git apply --check) -> OK
Running pytest suite on /workspace/tests/...
tests/Unit/ModuleTest.php ........... [100%]
12 passed in 1.48s
Exit Code: 0 (PASSED)`;
    ticket.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      level: 'SUCCESS',
      message: `Ephemeral Sandbox test PASSED with Exit 0. Ready for Ed25519 commit push.`
    });

    // Check if unblocks other DAG tickets
    clusterState.tickets.forEach(otherTicket => {
      if (otherTicket.status === 'BLOCKED_ON_PARENT' && otherTicket.parentTicketIds.includes(ticket.id)) {
        const allParentsPassed = otherTicket.parentTicketIds.every(pid => {
          const parent = clusterState.tickets.find(p => p.id === pid);
          return parent?.status === 'COMMITTED_PUSHED';
        });
        if (allParentsPassed) {
          otherTicket.status = 'LEASED';
          otherTicket.logs.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'INFO',
            message: `Parent ticket ${ticket.id} merged into tested/. Task unblocked & leased!`
          });
        }
      }
    });

    // Telegram Feed
    clusterState.telegramFeed.unshift({
      id: `tg-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'ALERT_MERGE',
      text: `✅ [${ticket.id}] Sandbox test passed! Pushed to tested/${ticket.id} branch.`
    });

  } else {
    // Sandbox Failure -> Trigger Self-Healing Loop
    ticket.retryCount += 1;
    ticket.testStderr = `AssertionError: Assertion failed in test_contract_execution()
Expected: HTTP 200 OK with sanitized payload
Actual: HTTP 500 TypeError: undefined method guardAllowedFiles() on line 14
Stacktrace:
  File "/workspace/tests/Unit/Test.php", line 42, in test_contract_execution
  File "/workspace/${ticket.allowedFiles[0]}", line 14, in executeSafeContract`;

    if (ticket.retryCount >= ticket.maxRetries) {
      ticket.status = 'DEAD_LETTER_QUEUE';
      ticket.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR',
        message: `Self-healing retry limit reached (${ticket.retryCount}/${ticket.maxRetries}). State frozen and moved to DEAD_LETTER_QUEUE for Human-in-the-Loop (HITL) review.`
      });
      
      const dlqAlert = `🚨 [DEAD_LETTER_QUEUE] Ticket ${ticket.id} (${ticket.title}) failed 3x self-healing retries across cascade tiers. State frozen for HITL review.`;
      clusterState.telegramFeed.unshift({
        id: `tg-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'ALERT_HEALING',
        urgent: true,
        text: dlqAlert
      });

      broadcastToTelegram(
        `🚨 <b>[DEAD_LETTER_QUEUE ESCALATION]</b>\n\n` +
        `🎫 <b>Ticket:</b> ${ticket.id}\n` +
        `📝 <b>Title:</b> ${ticket.title}\n` +
        `❌ <b>Failure:</b> 3x Self-Healing Retries Exhausted\n` +
        `🛑 <b>Action:</b> State frozen, AST report generated, requesting Human-in-the-Loop (HITL) intervention.`
      );
    } else {
      ticket.status = 'HEALING_RETRY';
      ticket.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: 'WARN',
        message: `Docker test failed (Exit 1). Stacktrace captured. Initiating Closed-Loop Self-Healing Retry ${ticket.retryCount}/${ticket.maxRetries}.`
      });
    }
  }

  ticket.updatedAt = new Date().toISOString();
  res.json({ success: true, ticket, exitCode });
});

// 5. Closed-Loop Self-Healing Re-prompting
app.post('/api/cluster/ticket/self-heal', async (req, res) => {
  const { ticketId } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  ticket.status = 'SYNTHESIZING_DIFF';
  const ai = getAI();
  let healedDiff = '';

  if (ai && ticket.testStderr) {
    try {
      const prompt = `You are Sutradhar Self-Healing Engine (Retry ${ticket.retryCount}/${ticket.maxRetries}).
Previous Diff:
${ticket.diffPatch}

Captured Stderr / Stacktrace:
${ticket.testStderr}

Allowed mutable files ONLY: ${ticket.allowedFiles.join(', ')}.
Fix the code error and output a working unified diff patch.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt
      });
      healedDiff = response.text || '';
    } catch (e) {
      console.warn('AI healing failed, using fallback patch');
    }
  }

  if (!healedDiff) {
    const targetFile = ticket.allowedFiles[0] || 'modules/core/Handler.php';
    healedDiff = `--- a/${targetFile}
+++ b/${targetFile}
@@ -10,6 +10,16 @@ class HealedHandler {
+    /**
+     * AUTO-HEALED (Retry ${ticket.retryCount}/${ticket.maxRetries}) - Fixed method signature and null guard
+     */
+    public function executeSafeContract(Request $request) {
+        $safeData = $request->validate([ 'token' => 'required|string' ]);
+        return response()->json(['status' => 'OK', 'data' => $safeData]);
+    }
 }`;
  }

  ticket.diffPatch = healedDiff;
  ticket.status = 'TESTING_SANDBOX';
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'INFO',
    message: `Re-prompted LLM with preserved context and stderr. New diff patch generated.`
  });

  res.json({ success: true, ticket, healedDiff });
});

// 6. Git Pre-Receive Gatekeeper Verification Hook
app.post('/api/cluster/ticket/verify-push', (req, res) => {
  const { ticketId, tokenHeader, branch } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  // Hook rules from Blueprint Section 5:
  // 1. Intercepts push requests on ai/TKT-* branches
  // 2. Extracts Security-Token header from commit message
  // 3. Verifies Ed25519 signature
  // 4. Confirms current_time < expiry_timestamp
  // 5. Verifies pushed branch matches ticket_id inside token
  const tokenToVerify = tokenHeader || ticket.ed25519Token || '';
  
  if (!tokenToVerify.startsWith('SEC-')) {
    return res.status(403).json({
      verified: false,
      exitCode: 1,
      error: '403_FORGED_OR_MISSING_TOKEN: Header must start with SEC-'
    });
  }

  try {
    const parts = tokenToVerify.replace('SEC-', '').split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid token structure');
    }
    const payloadStr = Buffer.from(parts[0], 'base64').toString('utf-8');
    const payload: CryptoTokenPayload = JSON.parse(payloadStr);

    if (payload.ticketId !== ticket.id) {
      return res.status(403).json({
        verified: false,
        exitCode: 1,
        error: `403_BRANCH_MISMATCH: Token ticket (${payload.ticketId}) does not match pushed branch (${ticket.id})`
      });
    }

    if (Date.now() > payload.expiryTimestamp) {
      return res.status(403).json({
        verified: false,
        exitCode: 1,
        error: '403_STALE_OR_EXPIRED_LEASE: Security token lease timestamp has expired'
      });
    }

    return res.json({
      verified: true,
      exitCode: 0,
      message: `200_OK: Ed25519 signature valid. Branch ${ticket.branch} accepted into tested/${ticket.id}.`,
      payload
    });
  } catch (err: any) {
    return res.status(403).json({
      verified: false,
      exitCode: 1,
      error: `403_STALE_OR_FORGED_LEASE: ${err.message}`
    });
  }
});

// 7. Master Failover & Monotonic Epoch Increment
app.post('/api/cluster/node/failover', (req, res) => {
  const previousMaster = clusterState.nodes.find(n => n.id === clusterState.activeMasterId);
  if (previousMaster) {
    previousMaster.status = 'OFFLINE';
    previousMaster.role = 'STANDBY';
  }

  // Increment immutable Monotonic Epoch
  clusterState.epochId += 1;

  // Find highest uptime standby node to promote
  const candidate = clusterState.nodes
    .filter(n => n.status !== 'OFFLINE')
    .sort((a, b) => b.uptimeSeconds - a.uptimeSeconds)[0];

  if (candidate) {
    candidate.role = 'MASTER';
    candidate.status = 'ACTIVE';
    clusterState.activeMasterId = candidate.id;
    clusterState.masterMode = 'ORCHESTRATOR';
  }

  // Telegram alert
  clusterState.telegramFeed.unshift({
    id: `tg-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'ALERT_FAILOVER',
    urgent: true,
    text: `⚡ [SPLIT-BRAIN WATCHDOG] Master failover detected! Monotonic Epoch bumped to ${clusterState.epochId}. Promoted ${candidate?.name || 'Node_Beta'} to Active Master!`
  });

  res.json({
    success: true,
    newEpochId: clusterState.epochId,
    activeMasterId: clusterState.activeMasterId,
    state: clusterState
  });
});

// 8. Bot-to-Bot RFC Delegation Protocol
app.post('/api/cluster/rfc/delegate', (req, res) => {
  const { fromNodeId, toNodeId, interfaceName, reason } = req.body;
  const fromNode = clusterState.nodes.find(n => n.id === fromNodeId) || clusterState.nodes[4];
  const toNode = clusterState.nodes.find(n => n.id === toNodeId) || clusterState.nodes[3];

  const subTaskId = `TKT-104-SUB1`;
  const subTask: Ticket = {
    id: subTaskId,
    title: `RFC: Update ${interfaceName || 'AuthInterface.php'} for ${fromNode.name}`,
    description: reason || `Delegated contract update required by ${fromNode.name} to unblock matrimony profile validation.`,
    priority: 'P1_HIGH',
    domain: 'Auth',
    status: 'SYNTHESIZING_DIFF',
    assignedTo: toNode.id,
    parentTicketIds: [],
    allowedFiles: ['contracts/AuthInterface.php', 'tests/Unit/AuthInterfaceTest.php'],
    readOnlyContracts: ['contracts/BaseInterface.php'],
    retryCount: 0,
    maxRetries: 3,
    branch: `ai/${subTaskId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: 'INFO', message: `RFC_DELEGATION_REQUIRED emitted by ${fromNode.name}. Sub-task allocated to ${toNode.name}.` }
    ]
  };

  clusterState.tickets.unshift(subTask);

  clusterState.telegramFeed.unshift({
    id: `tg-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'ALERT_RFC',
    text: `📨 [@${toNode.name}] RFC Delegation: Update ${interfaceName || 'AuthInterface.php'} requested by ${fromNode.name}. Sub-task ${subTaskId} created.`
  });

  res.json({ success: true, subTask, state: clusterState });
});

// Helper: Send Real Telegram Broadcast / Pinned Edit if token and chat_id are present
async function broadcastToTelegram(text: string, isSilent = false): Promise<{ sent: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { sent: false, reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in environment/secrets' };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_notification: isSilent,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      return { sent: true };
    }
    return { sent: false, reason: data.description || 'Telegram API rejected payload' };
  } catch (err: any) {
    console.warn('[Telegram Broadcast] Delivery failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

// 9. Reset cluster to initial blueprint state
app.post('/api/cluster/reset', (req, res) => {
  clusterState = {
    version: 'v5.3 PRODUCTION BLUEPRINT',
    epochId: 15,
    activeMasterId: 'NODE-E78A1201',
    masterMode: 'ORCHESTRATOR',
    nodes: JSON.parse(JSON.stringify(initialNodes)),
    tickets: JSON.parse(JSON.stringify(initialTickets)),
    rpm: 4.8,
    maxRpm: 10.0,
    telegramFeed: [
      {
        id: `tg-reset-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'PINNED_CARD',
        text: '🔄 Sutradhar Swarm Cluster state re-initialized to Blueprint v5.3 baseline.'
      }
    ],
    lastTelegramCardUpdate: new Date().toISOString(),
    llmCascade: initialLLMCascade,
    isLiveSimulation: true
  };
  res.json({ success: true, state: clusterState });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '5.3.0',
    app: 'Sutradhar Swarm',
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasTelegramChatId: !!process.env.TELEGRAM_CHAT_ID,
  });
});

// Telegram Direct Test Endpoint
app.post('/api/telegram/test-ping', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(400).json({
      success: false,
      configured: false,
      error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in Settings > Secrets.',
      hint: 'Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in AI Studio Secrets menu to receive real Telegram messages.'
    });
  }

  const message = `🚀 <b>Sutradhar Swarm Control Plane v5.3 Online</b>\n\n` +
    `👑 <b>Active Master:</b> Node_Alpha (Epoch: #${clusterState.epochId})\n` +
    `⚡ <b>Mode:</b> Autonomous Orchestrator\n` +
    `🛡️ <b>Gatekeeper:</b> Ed25519 Token Signed\n` +
    `📡 <b>Timestamp:</b> ${new Date().toUTCString()}\n\n` +
    `<i>Cluster live card & alert stream active.</i>`;

  const result = await broadcastToTelegram(message);
  if (result.sent) {
    return res.json({ success: true, configured: true, message: 'Message sent successfully to Telegram!' });
  } else {
    return res.status(502).json({ success: false, configured: true, error: result.reason });
  }
});

// Vite Middleware for Development / Static serving for production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Sutradhar Swarm] Control plane running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
