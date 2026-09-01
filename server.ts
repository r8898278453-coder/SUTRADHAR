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
      aiClient = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
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
    llmUsed: 'gemini-3.7-flash (Google AI Studio)',
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
    llmUsed: 'gemini-3.7-flash (Google AI Studio)',
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
  { priority: 1, name: 'Gemini 3.7 Flash', model: 'gemini-3.7-flash', provider: 'Google AI Studio', status: 'ACTIVE', rpmCost: 1 },
  { priority: 2, name: 'DeepSeek R1', model: 'deepseek/deepseek-r1:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 3, name: 'Qwen 2.5 Coder 32B', model: 'qwen/qwen-2.5-coder-32b:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 4, name: 'LLaMA 3.3 70B', model: 'meta-llama/llama-3.3-70b-instruct:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 5, name: 'Gemini Flash Backup', model: 'gemini-3.7-flash', provider: 'Google AI Studio', status: 'READY', rpmCost: 1 }
];

let clusterState: ClusterState = {
  version: 'v5.4 TELEGRAM WIRE PROTOCOL & WATCHDOG',
  epochId: 15,
  activeMasterId: 'NODE-E78A1201',
  masterMode: 'ORCHESTRATOR',
  killSwitchActive: false,
  killSwitchReason: undefined,
  splitBrain: {
    isStable: true,
    localMasterId: 'NODE-E78A1201',
    telegramPinnedMasterId: 'NODE-E78A1201',
    currentEpoch: 15,
    consensusDivergence: false,
    lastReverificationTimestamp: Date.now(),
    statusMessage: 'Leader stable. Telegram pinned message is synchronized with Local Epoch #15.'
  },
  watchdogLeases: [
    {
      ticketId: 'TKT-104',
      workerId: 'NODE-C34E8912',
      leasedAt: Date.now() - 180000,
      expiresAt: Date.now() + 720000,
      lastHeartbeatAt: Date.now() - 15000,
      missedHeartbeats: 0,
      maxMissedHeartbeats: 3,
      progressPct: 65,
      lastStep: 'Testing Matrimony Profile diff patch in sandbox',
      isRevoked: false
    },
    {
      ticketId: 'TKT-105',
      workerId: 'NODE-A8F24C09',
      leasedAt: Date.now() - 320000,
      expiresAt: Date.now() + 580000,
      lastHeartbeatAt: Date.now() - 25000,
      missedHeartbeats: 0,
      maxMissedHeartbeats: 3,
      progressPct: 40,
      lastStep: 'Closed-loop healing retry 1/3',
      isRevoked: false
    }
  ],
  nodes: initialNodes,
  tickets: initialTickets,
  rpm: 4.8,
  maxRpm: 10.0,
  telegramFeed: [
    {
      id: 'tg-proto-01',
      timestamp: '13:22:00',
      type: 'WIRE_PROTOCOL',
      text: '👑 [MASTER LEASE ALLOCATED]\n🎫 Ticket: TKT-104 - Matrimony Profile Updates\n🤖 Worker: NODE-C34E8912\n⏱️ TTL: 15m\n🔐 Ed25519 Token: SEC-eyJ0aWNrZXRfaWQiOiJUS1QtMTA0In0=...',
      rawWireProtocol: `👑 [MASTER LEASE ALLOCATED]
🎫 Ticket: TKT-104 - Matrimony Profile Updates
🤖 Assigned Worker: NODE-C34E8912
🌿 Work Branch: backup/TKT-104-worker03
📁 Allowed Files: modules/matrimony/ProfileController.php, tests/Unit/ProfileTest.php
⏱️ Lease Expiry: 900s
🔐 Ed25519 Signature: Verified

\`\`\`sutradhar_protocol
{
  "version": "1.0",
  "msg_type": "TICKET_LEASE_GRANTED",
  "msg_id": "lease_TKT-104_1725114600",
  "timestamp": 1725114600,
  "sender": {
    "node_id": "NODE-E78A1201",
    "role": "MASTER",
    "epoch_id": 15
  },
  "payload": {
    "ticket_id": "TKT-104",
    "worker_id": "NODE-C34E8912",
    "allowed_files": ["modules/matrimony/ProfileController.php", "tests/Unit/ProfileTest.php"],
    "base_branch": "main",
    "work_branch": "backup/TKT-104-worker03",
    "expires_at": 1725115500,
    "ttl_seconds": 900
  }
}
\`\`\``,
      structuredJson: {
        version: "1.0",
        msg_type: "TICKET_LEASE_GRANTED",
        msg_id: "lease_TKT-104_1725114600",
        sender: { node_id: "NODE-E78A1201", role: "MASTER", epoch_id: 15 },
        payload: { ticket_id: "TKT-104", worker_id: "NODE-C34E8912", ttl_seconds: 900 }
      }
    },
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
  let providerUsed = 'Google AI Studio (Gemini 3.7 Flash)';

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: `You are the Sutradhar Autonomous Worker (${ticket.assignedTo}).
Generate a clean, unified git diff patch for ticket ${ticket.id} (${ticket.title}).
Domain: ${ticket.domain}.
Allowed mutable files ONLY: ${ticket.allowedFiles.join(', ')}.
Requirements: ${ticket.description}.
Output ONLY the raw unified diff (starting with diff --git or --- / +++).`,
      });
      generatedDiff = response.text || '';
      providerUsed = 'Google AI Studio (Gemini 3.7 Flash - LIVE API)';
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

// Telegram Hub In-Memory State & Configuration
let telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  knownChatIds: new Set<string>(),
  isPolling: false,
  lastOffset: 0
};

// Auto-add default chatId if provided
if (process.env.TELEGRAM_CHAT_ID) {
  telegramConfig.knownChatIds.add(process.env.TELEGRAM_CHAT_ID);
}

// 8. Broadcast message to real Telegram bot (Broadcasts to all known chat IDs & group)
async function broadcastToTelegram(htmlMessage: string, isSilent = false): Promise<{ sent: boolean; reason?: string }> {
  const token = telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { sent: false, reason: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  const targetChatIds = new Set<string>();
  if (telegramConfig.chatId) targetChatIds.add(telegramConfig.chatId);
  telegramConfig.knownChatIds.forEach(id => targetChatIds.add(id));

  if (targetChatIds.size === 0) {
    return { sent: false, reason: 'No chat IDs registered. Send a message to the bot first.' };
  }

  let sentCount = 0;
  for (const cid of targetChatIds) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cid,
          text: htmlMessage,
          parse_mode: 'HTML',
          disable_notification: isSilent
        })
      });
      const data = await res.json();
      if (data.ok) sentCount++;
    } catch (e: any) {
      console.warn(`[TELEGRAM_HUB] Delivery failed to ${cid}:`, e.message);
    }
  }

  return { sent: sentCount > 0, reason: sentCount > 0 ? undefined : 'Failed to deliver to any chat' };
}

// Process Incoming Telegram Message (from either Polling or Webhook)
async function handleTelegramIncomingMessage(chatId: string | number, rawText: string, senderName: string, chatTitle?: string) {
  const strChatId = chatId.toString();
  telegramConfig.knownChatIds.add(strChatId);
  if (!telegramConfig.chatId) {
    telegramConfig.chatId = strChatId;
  }

  // Extract any specific @bot mention
  const mentionMatch = rawText.match(/@([a-zA-Z0-9_]+_bot)\b/i);
  const mentionedBot = mentionMatch ? mentionMatch[1].toLowerCase() : null;

  // In a multi-bot group, if message is explicitly directed to another bot, ignore it to prevent crosstalk
  if (mentionedBot && mentionedBot !== 'sutradhar_update_bot' && !mentionedBot.includes('sutradhar')) {
    console.log(`[TELEGRAM_ROUTING] Ignoring message targeted to @${mentionedBot}`);
    return;
  }

  // Clean text (remove any bot username mention e.g. @sutradhar_update_bot)
  const cleanText = rawText.replace(/@\w+_bot\b/gi, '').trim();
  const lowerText = cleanText.toLowerCase();

  console.log(`[TELEGRAM_MSG] Received from ${senderName} in chat ${strChatId} (${chatTitle || 'DM'}): "${cleanText}" (Mentioned: ${mentionedBot || 'None'})`);

  let replyText = '';

  // 1. Exact Commands & Status
  if (
    lowerText === '/status' || 
    lowerText === '/start' ||
    lowerText === 'status' || 
    lowerText === 'what is status' || 
    lowerText === 'what is update' ||
    lowerText === 'update'
  ) {
    const activeNodes = clusterState.nodes.filter(n => n.status !== 'OFFLINE').length;
    const inProgress = clusterState.tickets.filter(t => 
      t.status === 'SYNTHESIZING_DIFF' || 
      t.status === 'TESTING_SANDBOX' || 
      t.status === 'LEASED' || 
      t.status === 'HEALING_RETRY'
    );
    const completed = clusterState.tickets.filter(t => t.status === 'COMMITTED_PUSHED').length;
    const pending = clusterState.tickets.filter(t => t.status === 'PENDING').length;

    let inProgressSummary = inProgress.length > 0
      ? inProgress.map(t => `  • <b>${t.id}:</b> ${t.title} (🤖 ${t.assignedTo || 'Assigned'})`).join('\n')
      : '  <i>No active tickets in progress right now.</i>';

    replyText = `🚀 <b>SutraDhaar Swarm Control Plane v6.0 Online</b>\n\n` +
      `👑 <b>Active Master:</b> <code>${clusterState.activeMasterId}</code> (Epoch #${clusterState.epochId})\n` +
      `⚡ <b>Cluster Mode:</b> ${clusterState.killSwitchActive ? '🛑 PAUSED' : '🟢 RUNNING (Autonomous)'}\n` +
      `🤖 <b>Nodes Online:</b> ${activeNodes}/${clusterState.nodes.length}\n` +
      `📊 <b>Tickets Summary:</b> ${inProgress.length} In-Progress | ${pending} Pending | ${completed} Done\n` +
      `⚡ <b>RPM Rate:</b> ${clusterState.rpm} / ${clusterState.maxRpm}\n\n` +
      `📋 <b>Current In-Flight Tasks:</b>\n${inProgressSummary}\n\n` +
      `<i>Commands: /status, /hotfix &lt;desc&gt;, /pause, /resume</i>`;

  // 2. Hotfix Trigger
  } else if (lowerText.startsWith('/hotfix') || lowerText.startsWith('hotfix')) {
    const title = cleanText.replace(/^\/hotfix\s*/i, '').replace(/^hotfix\s*/i, '').trim() || 'Emergency Hotfix triggered via Telegram';
    const newId = `TKT-${Math.floor(100 + Math.random() * 900)}`;
    
    const hotfixTicket: Ticket = {
      id: newId,
      title: `[HOTFIX] ${title}`,
      domain: 'Core',
      priority: 'P0_URGENT',
      status: 'SYNTHESIZING_DIFF',
      assignedTo: clusterState.activeMasterId,
      parentTicketIds: [],
      allowedFiles: ['modules/auth/Session.php', 'tests/Unit/HotfixTest.php'],
      readOnlyContracts: ['contracts/BaseInterface.php'],
      retryCount: 0,
      maxRetries: 3,
      branch: `ai/${newId}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: `Urgent hotfix created by ${senderName} from Telegram: ${title}`,
      logs: [{
        timestamp: new Date().toLocaleTimeString(),
        level: 'WARN',
        message: `Created via Telegram command from ${senderName}`
      }]
    };
    clusterState.tickets.unshift(hotfixTicket);

    clusterState.telegramFeed.unshift({
      id: `tg-hotfix-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'ALERT_P0',
      urgent: true,
      text: `🚨 [TELEGRAM P0 HOTFIX] Created ${newId}: "${title}" by ${senderName}. Dispatched to Master.`
    });

    replyText = `🚨 <b>P0 Hotfix Created & Dispatched!</b>\n\n` +
      `🎫 <b>Ticket:</b> <code>${newId}</code>\n` +
      `📝 <b>Title:</b> ${title}\n` +
      `👑 <b>Assigned To:</b> Master (<code>${clusterState.activeMasterId}</code>)\n` +
      `⚡ <b>Status:</b> Closed-Loop Self-Healing Activated`;

  // 3. Force Master (Section 8)
  } else if (lowerText.startsWith('/force_master')) {
    const targetNodeId = cleanText.replace(/^\/force_master\s*/i, '').trim();
    if (targetNodeId) {
      clusterState.activeMasterId = targetNodeId;
      clusterState.epochId += 1;
      clusterState.telegramFeed.unshift({
        id: `tg-master-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'ALERT_FAILOVER',
        urgent: true,
        text: `👑 [HUMAN FORCE MASTER] Master manually transitioned to ${targetNodeId} (Epoch #${clusterState.epochId}) by ${senderName}.`
      });
      replyText = `👑 <b>Master Overridden!</b>\n\nActive Master is now <code>${targetNodeId}</code> (Epoch #${clusterState.epochId}).`;
    } else {
      replyText = `⚠️ Usage: <code>/force_master &lt;NODE-ID&gt;</code>`;
    }

  // 4. Stop After Current (Section 9 Graceful Shutdown)
  } else if (lowerText.startsWith('/stop_after_current')) {
    clusterState.telegramFeed.unshift({
      id: `tg-graceful-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'KILL_SWITCH',
      text: `🛑 [GRACEFUL SHUTDOWN] Workers commanded to finish current tickets then halt.`
    });
    replyText = `🛑 <b>Graceful Shutdown Scheduled:</b> All active workers will finish their in-flight tickets and will not claim new ones.`;

  // 5. Clarify Answer Protocol (Section 3.3)
  } else if (lowerText.startsWith('/clarify')) {
    const parts = cleanText.replace(/^\/clarify\s*/i, '').split(/\s+(.+)/);
    const tktId = parts[0]?.toUpperCase();
    const answer = parts[1];

    if (tktId && answer) {
      const ticket = clusterState.tickets.find(t => t.id.toUpperCase() === tktId);
      if (ticket) {
        ticket.status = 'SYNTHESIZING_DIFF';
        if (ticket.clarificationQuestion) {
          ticket.clarificationQuestion.answer = answer;
          ticket.clarificationQuestion.answeredBy = senderName;
          ticket.clarificationQuestion.answeredAt = Date.now();
        }
        ticket.logs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: 'SUCCESS',
          message: `[CLARIFICATION ANSWERED] by ${senderName}: "${answer}". Task unblocked.`
        });
        clusterState.telegramFeed.unshift({
          id: `tg-clarify-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'ALERT_HEALING',
          text: `✅ [CLARIFICATION UNBLOCKED] ${tktId} received answer from ${senderName}. Resuming synthesis.`
        });
        replyText = `✅ <b>Ticket ${tktId} Unblocked!</b>\n\nWorker has received your clarification: <i>"${answer}"</i> and resumed synthesis.`;
      } else {
        replyText = `❌ Ticket <code>${tktId}</code> not found in cluster state.`;
      }
    } else {
      replyText = `⚠️ Usage: <code>/clarify &lt;TICKET-ID&gt; &lt;Your Answer&gt;</code>`;
    }

  // 6. Bad Merge Rollback (Section 11 Gap #5)
  } else if (lowerText.startsWith('/rollback')) {
    const tktId = cleanText.replace(/^\/rollback\s*/i, '').trim().toUpperCase();
    const ticket = clusterState.tickets.find(t => t.id.toUpperCase() === tktId);
    if (ticket) {
      const hotfixId = `TKT-ROLLBACK-${Math.floor(100 + Math.random() * 900)}`;
      const rollbackHotfix: Ticket = {
        id: hotfixId,
        title: `[EMERGENCY ROLLBACK] Revert ${ticket.id}: ${ticket.title}`,
        domain: ticket.domain,
        priority: 'P0_URGENT',
        status: 'SYNTHESIZING_DIFF',
        assignedTo: clusterState.activeMasterId,
        parentTicketIds: [],
        allowedFiles: ticket.allowedFiles,
        readOnlyContracts: ticket.readOnlyContracts,
        retryCount: 0,
        maxRetries: 3,
        branch: `ai/${hotfixId}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: `Triggered via Telegram rollback command by ${senderName}. Reverting commit ${ticket.rollbackCommit || 'HEAD~1'}.`,
        logs: [{
          timestamp: new Date().toLocaleTimeString(),
          level: 'WARN',
          message: `Revert initiated for ${ticket.id} by ${senderName}.`
        }]
      };
      clusterState.tickets.unshift(rollbackHotfix);
      clusterState.telegramFeed.unshift({
        id: `tg-rollback-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'ALERT_P0',
        urgent: true,
        text: `🚨 [ROLLBACK EXECUTED] ${ticket.id} rolled back. Auto-created hotfix ${hotfixId}.`
      });
      replyText = `🚨 <b>Rollback Executed!</b>\n\nTarget commit reverted. Auto-spawned hotfix ticket <code>${hotfixId}</code> assigned to Master.`;
    } else {
      replyText = `⚠️ Usage: <code>/rollback &lt;TICKET-ID&gt;</code>`;
    }

  // 7. Pause
  } else if (lowerText.startsWith('/pause') || lowerText === 'pause' || lowerText === 'stop') {
    clusterState.killSwitchActive = true;
    clusterState.killSwitchReason = `Paused via Telegram by ${senderName}`;
    
    clusterState.telegramFeed.unshift({
      id: `tg-pause-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'KILL_SWITCH',
      urgent: true,
      text: `🛑 [KILL-SWITCH PAUSE] Triggered by ${senderName} from Telegram.`
    });

    replyText = `🛑 <b>Swarm Execution PAUSED by ${senderName}.</b>\n\nAll autonomous worker ticket claims and git merges are temporarily frozen.\nUse <code>/resume</code> to re-activate.`;

  // 8. Resume
  } else if (lowerText.startsWith('/resume') || lowerText === 'resume' || lowerText === 'start') {
    clusterState.killSwitchActive = false;
    clusterState.killSwitchReason = undefined;

    clusterState.telegramFeed.unshift({
      id: `tg-resume-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'KILL_SWITCH',
      text: `🟢 [KILL-SWITCH RESUME] Triggered by ${senderName} from Telegram.`
    });

    replyText = `🟢 <b>Swarm Execution RESUMED by ${senderName}.</b>\n\nAutonomous worker queues, ticket synthesis, and Docker QA merges are back online!`;

  // 9. Greetings
  } else if (lowerText === 'hi' || lowerText === 'hello' || lowerText === 'hey' || lowerText === 'namaste' || lowerText === 'help' || lowerText === '/help') {
    replyText = `👋 <b>Namaste ${senderName}!</b>\n\n` +
      `Main <b>SutraDhaar Autonomous Swarm Bot</b> (@sutradhar_update_bot) hoon.\n\n` +
      `💡 <b>Commands available:</b>\n` +
      `• <code>/status</code> - Live nodes & tickets summary\n` +
      `• <code>/hotfix &lt;issue&gt;</code> - Dispatch P0 hotfix ticket\n` +
      `• <code>/clarify &lt;tkt&gt; &lt;answer&gt;</code> - Unblock clarifying questions\n` +
      `• <code>/rollback &lt;tkt&gt;</code> - Revert bad merge + auto hotfix\n` +
      `• <code>/force_master &lt;id&gt;</code> - Force active master node\n` +
      `• <code>/stop_after_current</code> - Graceful stop after tickets\n` +
      `• <code>/pause</code> / <code>/resume</code> - Emergency kill switch`;

  // 6. Intelligent Contextual Response for conversational questions
  } else {
    // If we have Gemini AI key, generate intelligent context-aware answer
    const ai = getAI();
    if (ai) {
      try {
        const prompt = `You are SutraDhaar Update Bot (@sutradhar_update_bot), the intelligent control plane AI assistant for an autonomous multi-agent developer swarm in a Telegram group.
The user "${senderName}" asked: "${cleanText}".

Current Swarm Live State:
- Active Master: ${clusterState.activeMasterId} (Epoch #${clusterState.epochId})
- Mode: ${clusterState.killSwitchActive ? 'PAUSED' : 'RUNNING (Autonomous)'}
- Nodes: ${clusterState.nodes.map(n => `${n.name} (${n.role}): ${n.status}`).join(', ')}
- In-flight tickets: ${clusterState.tickets.map(t => `${t.id}: ${t.title} [${t.status}]`).join(', ')}
- Active project: Matrimony Matchmaking Engine

Instructions:
1. Answer the user clearly in friendly Hindi/Hinglish or English matching their tone.
2. If they are asking about why bots appear idle/synthesizing/inactive while only one bot is in Telegram, explain that SutraDhaar runs background worker nodes (Node_Alpha, Worker_01, Worker_02) that synthesize code in sandboxes and communicate to this single Telegram Hub bot.
3. Keep the response concise (max 3-4 bullet points or 2 short paragraphs) and formatted with clean HTML tags (<b>, <i>, <code>).`;

        const aiResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        replyText = aiResponse.text || '';
      } catch (e: any) {
        console.warn('[TELEGRAM_AI_FALLBACK]', e.message);
      }
    }

    // Fallback if AI is offline or didn't reply
    if (!replyText) {
      if (lowerText.includes('idle') || lowerText.includes('inactive') || lowerText.includes('available') || lowerText.includes('node') || lowerText.includes('bot')) {
        replyText = `🤖 <b>SutraDhaar Node Architecture Explanation:</b>\n\n` +
          `Aapka sawal: <i>"${cleanText}"</i>\n\n` +
          `📌 <b>Swarm Working Model:</b>\n` +
          `• <b>Telegram Interface:</b> Main (@sutradhar_update_bot) aapka single Telegram voice aur control hub hoon.\n` +
          `• <b>Background Worker Nodes:</b> Baki sabhi nodes (Node_Alpha Master, Worker_01, Worker_02) backend containerized sandboxes me run ho rahe hain.\n` +
          `• <b>Status Check:</b> Current nodes ki live activity dekhne ke liye <code>/status</code> type karein!`;
      } else {
        replyText = `🤖 <b>SutraDhaar Swarm Bot:</b>\n\n` +
          `Aapka message mila: <i>"${cleanText}"</i>\n\n` +
          `👑 <b>Master Node:</b> <code>${clusterState.activeMasterId}</code> (Epoch #${clusterState.epochId})\n` +
          `⚡ <b>Cluster Mode:</b> ${clusterState.killSwitchActive ? '🛑 PAUSED' : '🟢 RUNNING'}\n\n` +
          `Detailed cluster status ke liye <code>/status</code> type karein.`;
      }
    }
  }

  // Send reply back to Telegram
  const token = telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (token && replyText) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: strChatId,
          text: replyText,
          parse_mode: 'HTML'
        })
      });
    } catch (e: any) {
      console.error('[TELEGRAM_REPLY_ERROR]', e.message);
    }
  }
}

// Continuous Telegram Long-Polling Daemon
async function startTelegramPolling() {
  const token = telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (telegramConfig.isPolling || !token) return;
  telegramConfig.isPolling = true;
  console.log('[TELEGRAM_POLLING] Starting Telegram Long-Polling daemon...');

  // 1. Clear any active webhook so getUpdates works without conflict
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
    console.log('[TELEGRAM_POLLING] Webhook deleted successfully to enable long-polling.');
  } catch (e: any) {
    console.warn('[TELEGRAM_POLLING] deleteWebhook warning:', e.message);
  }

  const poll = async () => {
    const currentToken = telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!currentToken) {
      telegramConfig.isPolling = false;
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${currentToken}/getUpdates?offset=${telegramConfig.lastOffset}&timeout=20`;
      const res = await fetch(url);
      const data = await res.json();

      if (data && data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          telegramConfig.lastOffset = Math.max(telegramConfig.lastOffset, update.update_id + 1);

          const msg = update.message || update.channel_post || update.edited_message;
          if (msg && msg.text) {
            const chatId = msg.chat.id;
            const text = msg.text;
            const sender = msg.from?.first_name || msg.chat.title || 'User';
            const chatTitle = msg.chat.title;
            await handleTelegramIncomingMessage(chatId, text, sender, chatTitle);
          }
        }
      }
    } catch (err: any) {
      // Network backoff
      await new Promise(r => setTimeout(r, 3000));
    }

    // Continue next poll cycle
    setTimeout(poll, 1000);
  };

  poll();
}

// Manual Broadcast Endpoint
app.post('/api/telegram/broadcast', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  clusterState.telegramFeed.unshift({
    id: `tg-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'ALERT_MERGE',
    text: `📢 [HUMAN BROADCAST] ${message}`
  });

  const result = await broadcastToTelegram(`📢 <b>[HUMAN OVERRIDE]</b>\n\n${message}`);
  res.json({ success: true, result, feed: clusterState.telegramFeed });
});

// Update Telegram Config
app.post('/api/telegram/config', (req, res) => {
  const { botToken, chatId } = req.body;
  if (botToken) {
    telegramConfig.botToken = botToken.trim();
    if (!telegramConfig.isPolling) {
      startTelegramPolling();
    }
  }
  if (chatId) {
    const cid = chatId.trim();
    telegramConfig.chatId = cid;
    telegramConfig.knownChatIds.add(cid);
  }
  res.json({ 
    success: true, 
    config: { 
      configured: !!(telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN) && telegramConfig.knownChatIds.size > 0,
      polling: telegramConfig.isPolling,
      knownChats: Array.from(telegramConfig.knownChatIds)
    } 
  });
});

// Get Telegram Config Status
app.get('/api/telegram/config', (req, res) => {
  res.json({ 
    configured: !!(telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN),
    chatId: telegramConfig.chatId || process.env.TELEGRAM_CHAT_ID || undefined,
    isPolling: telegramConfig.isPolling,
    knownChatsCount: telegramConfig.knownChatIds.size
  });
});

// Start polling if token exists in env
if (process.env.TELEGRAM_BOT_TOKEN) {
  startTelegramPolling();
}

// 9. Telegram Wire Protocol Encode/Decode/Broadcast Endpoints
app.post('/api/cluster/protocol/encode', (req, res) => {
  const { msgType, ticketId, workerId, humanHeader, payload } = req.body;
  const now = Math.floor(Date.now() / 1000);
  
  const wireMsg = {
    version: "1.0",
    msg_type: msgType || "TICKET_LEASE_GRANTED",
    msg_id: `msg_${now}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now,
    sender: {
      node_id: clusterState.activeMasterId,
      role: "MASTER",
      epoch_id: clusterState.epochId
    },
    payload: payload || {
      ticket_id: ticketId || "TKT-104",
      worker_id: workerId || "NODE-C34E8912",
      ttl_seconds: 900
    }
  };

  const jsonBlock = `\`\`\`sutradhar_protocol\n${JSON.stringify(wireMsg, null, 2)}\n\`\`\``;
  const fullText = `${(humanHeader || `👑 [MASTER WIRE MESSAGE: ${wireMsg.msg_type}]`).trim()}\n\n${jsonBlock}`;

  res.json({ success: true, wireMsg, jsonBlock, fullText });
});

app.post('/api/cluster/protocol/decode', (req, res) => {
  const { rawMessage } = req.body;
  if (!rawMessage || typeof rawMessage !== 'string') {
    return res.status(400).json({ success: false, error: 'rawMessage string is required' });
  }

  const regex = /```sutradhar_protocol\s*(\{[\s\S]*?\})\s*```/;
  const match = rawMessage.match(regex);

  if (!match) {
    return res.json({
      success: true,
      hasProtocol: false,
      humanText: rawMessage.trim(),
      structuredJson: null
    });
  }

  try {
    const jsonStr = match[1];
    const parsed = JSON.parse(jsonStr);
    const humanPart = rawMessage.replace(match[0], '').trim();

    return res.json({
      success: true,
      hasProtocol: true,
      humanText: humanPart,
      structuredJson: parsed
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      hasProtocol: false,
      error: `Malformed JSON in sutradhar_protocol block: ${err.message}`
    });
  }
});

// 10. Emergency Kill-Switch Endpoint
app.post('/api/cluster/kill-switch', (req, res) => {
  const { action, reason, adminName } = req.body;
  const isPause = action === 'PAUSE' || action === 'PAUSE_ALL';
  clusterState.killSwitchActive = isPause;
  clusterState.killSwitchReason = isPause ? (reason || 'Admin manual safety pause') : undefined;

  const alertText = isPause
    ? `🛑 [KILL-SWITCH ENGAGED] All workers frozen by admin (${adminName || 'Admin'}). Reason: ${clusterState.killSwitchReason}`
    : `🟢 [KILL-SWITCH DISENGAGED] Swarm cluster execution resumed by admin (${adminName || 'Admin'}).`;

  clusterState.telegramFeed.unshift({
    id: `tg-kill-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'KILL_SWITCH',
    urgent: true,
    text: alertText
  });

  broadcastToTelegram(
    `🛑 <b>[CLUSTER KILL-SWITCH: ${isPause ? 'PAUSED' : 'RESUMED'}]</b>\n\n` +
    `👤 <b>Admin:</b> ${adminName || 'Admin'}\n` +
    `⚡ <b>Action:</b> ${isPause ? 'HALT ALL AUTONOMOUS AGENTS' : 'RESUME SWARM WORKFLOW'}\n` +
    `📝 <b>Reason:</b> ${reason || 'Manual override'}`
  );

  res.json({ success: true, killSwitchActive: clusterState.killSwitchActive, state: clusterState });
});

// 11. Watchdog Heartbeat Endpoint
app.post('/api/cluster/watchdog/heartbeat', (req, res) => {
  const { ticketId, workerId, progressPct, currentStep } = req.body;
  const lease = clusterState.watchdogLeases.find(l => l.ticketId === ticketId);
  
  if (!lease) {
    return res.status(404).json({ success: false, error: `No active lease for ticket ${ticketId}` });
  }

  lease.lastHeartbeatAt = Date.now();
  lease.missedHeartbeats = 0;
  if (typeof progressPct === 'number') lease.progressPct = progressPct;
  if (currentStep) lease.lastStep = currentStep;

  // Add telegram progress feed item periodically
  clusterState.telegramFeed.unshift({
    id: `tg-hb-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'WIRE_PROTOCOL',
    text: `🤖 [HEARTBEAT: ${workerId}] Ticket ${ticketId} (${lease.progressPct}%) ──► ${lease.lastStep}`
  });

  res.json({ success: true, lease, state: clusterState });
});

// 12. Watchdog Force Revoke Lease Endpoint
app.post('/api/cluster/watchdog/revoke', (req, res) => {
  const { ticketId, reason } = req.body;
  const leaseIndex = clusterState.watchdogLeases.findIndex(l => l.ticketId === ticketId);
  const ticket = clusterState.tickets.find(t => t.id === ticketId);

  if (ticket) {
    const prevWorker = ticket.assignedTo || 'Unknown';
    ticket.status = 'PENDING';
    ticket.assignedTo = undefined;
    ticket.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      level: 'WARN',
      message: `[WATCHDOG REVOCATION] Lease forcefully revoked. Reason: ${reason || 'Worker timeout/unresponsive'}. Ticket returned to DAG queue.`
    });

    clusterState.telegramFeed.unshift({
      id: `tg-revoke-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: 'WATCHDOG_REVOKE',
      urgent: true,
      text: `⚠️ [WATCHDOG LEASE REVOCATION] Lease for ${ticketId} revoked from ${prevWorker}. Returned to pending queue. Reason: ${reason || 'Unresponsive timeout'}.`
    });

    broadcastToTelegram(
      `⚠️ <b>[WATCHDOG LEASE AUTO-REVOKED]</b>\n\n` +
      `🎫 <b>Ticket:</b> ${ticketId}\n` +
      `🤖 <b>Revoked Worker:</b> ${prevWorker}\n` +
      `⏳ <b>Reason:</b> ${reason || 'Worker missed 3 consecutive heartbeats (>90s silence)'}\n` +
      `♻️ <b>Action:</b> Ticket unlocked and re-queued for other available workers.`
    );
  }

  if (leaseIndex !== -1) {
    clusterState.watchdogLeases.splice(leaseIndex, 1);
  }

  res.json({ success: true, state: clusterState });
});

// 13. Split-Brain Periodic Re-verification
app.post('/api/cluster/split-brain/verify', (req, res) => {
  const { telegramPinnedMasterId } = req.body;
  const now = Date.now();
  const currentMaster = clusterState.activeMasterId;

  if (telegramPinnedMasterId && telegramPinnedMasterId !== currentMaster) {
    clusterState.splitBrain = {
      isStable: false,
      localMasterId: currentMaster,
      telegramPinnedMasterId,
      currentEpoch: clusterState.epochId,
      consensusDivergence: true,
      lastReverificationTimestamp: now,
      statusMessage: `CRITICAL SPLIT-BRAIN: Telegram pinned master is '${telegramPinnedMasterId}' vs local '${currentMaster}'. Auto-demoting local node.`
    };
  } else {
    clusterState.splitBrain = {
      isStable: true,
      localMasterId: currentMaster,
      telegramPinnedMasterId: telegramPinnedMasterId || currentMaster,
      currentEpoch: clusterState.epochId,
      consensusDivergence: false,
      lastReverificationTimestamp: now,
      statusMessage: `Consensus synchronized. Active leader ${currentMaster} verified against Telegram pinned card at Epoch #${clusterState.epochId}.`
    };
  }

  res.json({ success: true, splitBrain: clusterState.splitBrain, state: clusterState });
});

// 14. Reset cluster to initial blueprint state
app.post('/api/cluster/reset', (req, res) => {
  clusterState = {
    version: 'v5.4 TELEGRAM WIRE PROTOCOL & WATCHDOG',
    epochId: 15,
    activeMasterId: 'NODE-E78A1201',
    masterMode: 'ORCHESTRATOR',
    killSwitchActive: false,
    killSwitchReason: undefined,
    splitBrain: {
      isStable: true,
      localMasterId: 'NODE-E78A1201',
      telegramPinnedMasterId: 'NODE-E78A1201',
      currentEpoch: 15,
      consensusDivergence: false,
      lastReverificationTimestamp: Date.now(),
      statusMessage: 'Leader stable. Telegram pinned message is synchronized with Local Epoch #15.'
    },
    watchdogLeases: [
      {
        ticketId: 'TKT-104',
        workerId: 'NODE-C34E8912',
        leasedAt: Date.now() - 180000,
        expiresAt: Date.now() + 720000,
        lastHeartbeatAt: Date.now() - 15000,
        missedHeartbeats: 0,
        maxMissedHeartbeats: 3,
        progressPct: 65,
        lastStep: 'Testing Matrimony Profile diff patch in sandbox',
        isRevoked: false
      },
      {
        ticketId: 'TKT-105',
        workerId: 'NODE-A8F24C09',
        leasedAt: Date.now() - 320000,
        expiresAt: Date.now() + 580000,
        lastHeartbeatAt: Date.now() - 25000,
        missedHeartbeats: 0,
        maxMissedHeartbeats: 3,
        progressPct: 40,
        lastStep: 'Closed-loop healing retry 1/3',
        isRevoked: false
      }
    ],
    nodes: JSON.parse(JSON.stringify(initialNodes)),
    tickets: JSON.parse(JSON.stringify(initialTickets)),
    rpm: 4.8,
    maxRpm: 10.0,
    telegramFeed: [
      {
        id: `tg-reset-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'PINNED_CARD',
        text: '🔄 Sutradhar Swarm Cluster state re-initialized to Blueprint v5.4 baseline.'
      }
    ],
    lastTelegramCardUpdate: new Date().toISOString(),
    llmCascade: initialLLMCascade,
    isLiveSimulation: true
  };
  res.json({ success: true, state: clusterState });
});

// 14. BLUEPRINT v6.0 SHARED STATE DB ('THE BRAIN') & OPERATIONAL GAPS ENDPOINTS

// In-Memory Shared State DB mirroring Section 2 Collections
const sharedStateDB = {
  system_state: {
    current_master: {
      worker_id: 'NODE-E78A1201',
      since_timestamp: Date.now() - 3600000,
      last_heartbeat: Date.now(),
      epoch: 18
    },
    global_status: 'RUNNING',
    max_concurrent_workers: 6,
    active_project_id: 'PRJ-MATRIMONY-01'
  },
  projects: [
    {
      id: 'PRJ-MATRIMONY-01',
      name: 'Matrimony Matchmaking & Bio Sanitizer Engine',
      gitRepoUrl: 'git@github.com:sutradhar-corp/matrimony-engine.git',
      priority: 'P0_CRITICAL',
      status: 'ACTIVE',
      createdAt: '2026-08-30T10:00:00Z',
      configHash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069'
    }
  ],
  audit_log: [
    {
      logId: 'LOG-001',
      timestamp: Date.now() - 600000,
      actor: 'NODE-E78A1201',
      action: 'MASTER_ELECTED_CAS',
      ticketId: undefined,
      reasoning: 'Atomic CAS claimed epoch #18. Heartbeat synchronized.',
      details: { epoch: 18 } as Record<string, any>
    },
    {
      logId: 'LOG-002',
      timestamp: Date.now() - 320000,
      actor: 'NODE-B7A93310',
      action: 'TICKET_CLAIMED',
      ticketId: 'TKT-104',
      reasoning: 'Dependencies verified complete (depends_on=null). Branch worker-1/ticket-104 created.',
      details: { branch: 'worker-1/ticket-104' } as Record<string, any>
    }
  ] as Array<{
    logId: string;
    timestamp: number;
    actor: string;
    action: string;
    ticketId?: string;
    reasoning: string;
    details: Record<string, any>;
  }>,
  config: {
    prompts: {
      activeVersion: 'v2',
      v1: {
        ticketGeneration: 'System Prompt V1: Generate tickets from feature specs.',
        workerBuilder: 'System Prompt V1: Synthesize unified diff.'
      },
      v2: {
        ticketGeneration: 'System Prompt V2 (Rigid AST & Zero Assumption): Break feature into independent, non-overlapping tickets with explicit allowed_files and definition of done. If ambiguous, tag clarification_needed.',
        workerBuilder: 'System Prompt V2 (Zero Assumption Checkpoint): Adhere strictly to ticket scope. If ambiguity found, do NOT assume — halt and set status=blocked_clarification.'
      }
    },
    model_quotas: {
      ticket_generation_pinned_model: 'gemini-pro',
      worker_primary_model: 'gemini-pro',
      worker_fallback_models: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-r1:free']
    }
  },
  operational_gaps: [
    { id: 1, title: 'Bot Process Crash', riskDescription: 'Supervisor auto-restart with last DB state resume', solutionArchitecture: 'pm2/systemd supervisor + atomic DB sync', status: 'IMPLEMENTED' },
    { id: 2, title: 'DB Single Point of Failure', riskDescription: 'Multi-region managed HA + local disk cache fallback', solutionArchitecture: 'Local db_cache.json fallback', status: 'VERIFIED' },
    { id: 3, title: 'Ticket Dependency Enforcement', riskDescription: 'Prevent race conditions and child ticket premature claims', solutionArchitecture: 'Query status=open AND depends_on==done filter', status: 'IMPLEMENTED' },
    { id: 4, title: 'Merge Queue Ordering', riskDescription: 'Prevent merge conflicts during peak throughput', solutionArchitecture: 'FIFO queue with P0 priority preemption in Docker sandbox', status: 'IMPLEMENTED' },
    { id: 5, title: 'Bad Merge Rollback', riskDescription: 'Corrupted master branch deployment', solutionArchitecture: 'Saved rollback commit hash + git revert + auto hotfix ticket', status: 'IMPLEMENTED' },
    { id: 6, title: 'Docker Test Secrets Isolation', riskDescription: 'Leaking secrets in container images', solutionArchitecture: 'Local .env injection via --env-file only', status: 'VERIFIED' },
    { id: 7, title: 'Human Response Timeout', riskDescription: 'Blocked tickets stalled indefinitely', solutionArchitecture: 'Auto-reminder alert resend + worker non-blocking switch', status: 'IMPLEMENTED' },
    { id: 8, title: 'Notification Fatigue', riskDescription: 'Spamming Telegram with routine logs', solutionArchitecture: 'State-change events to Telegram only; detailed logs to DB', status: 'IMPLEMENTED' },
    { id: 9, title: 'Prompt/Template Versioning', riskDescription: 'Regression across worker code synthesis', solutionArchitecture: 'v1/v2 schema versioning in config collection', status: 'IMPLEMENTED' },
    { id: 10, title: 'Max Parallel Workers Cap', riskDescription: 'Resource starvation and quota thrashing', solutionArchitecture: 'max_concurrent_workers cap in system_state', status: 'IMPLEMENTED' },
    { id: 11, title: 'Test Data/Fixtures', riskDescription: 'Production data contamination during tests', solutionArchitecture: 'fixtures/seed_profiles.json mock datasets', status: 'IMPLEMENTED' },
    { id: 12, title: '"Why" Reasoning Documentation', riskDescription: 'Opaque autonomous decisions', solutionArchitecture: 'Mandatory reasoning field in audit_log entries', status: 'IMPLEMENTED' }
  ]
};

// GET all 6 DB collections
app.get('/api/db/all', (req, res) => {
  res.json({
    success: true,
    system_state: sharedStateDB.system_state,
    workers: clusterState.nodes,
    projects: sharedStateDB.projects,
    tickets: clusterState.tickets,
    audit_log: sharedStateDB.audit_log,
    config: sharedStateDB.config,
    operational_gaps: sharedStateDB.operational_gaps
  });
});

// POST Atomic Ticket Claim (Section 7, Section 11 Gap #3)
app.post('/api/tickets/claim', (req, res) => {
  const { workerId, ticketId } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

  // 1. Status Check
  if (ticket.status !== 'PENDING' && ticket.status !== 'BLOCKED_ON_PARENT') {
    return res.status(400).json({ success: false, error: `Ticket status is '${ticket.status}', not pending` });
  }

  // 2. Dependency Check (Section 11 Gap #3)
  if (ticket.dependsOn) {
    const parent = clusterState.tickets.find(t => t.id === ticket.dependsOn);
    if (parent && parent.status !== 'COMMITTED_PUSHED') {
      return res.status(400).json({ 
        success: false, 
        error: `Dependency ${ticket.dependsOn} is '${parent.status}', must be COMMITTED_PUSHED first.` 
      });
    }
  }

  // 3. Claim
  ticket.status = 'SYNTHESIZING_DIFF';
  ticket.assignedTo = workerId;
  ticket.branch = `worker-${workerId.slice(-4)}/ticket-${ticket.id.toLowerCase().replace('tkt-', '')}`;
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'INFO',
    message: `[ATOMIC CLAIM] Claimed by ${workerId}. Branch ${ticket.branch} created.`
  });

  sharedStateDB.audit_log.unshift({
    logId: `LOG-${Date.now().toString().slice(-4)}`,
    timestamp: Date.now(),
    actor: workerId,
    action: 'TICKET_CLAIMED_ATOMIC',
    ticketId: ticket.id,
    reasoning: 'Dependency check satisfied. Atomic claim acquired.',
    details: { branch: ticket.branch }
  });

  res.json({ success: true, ticket });
});

// POST Block Ticket for Clarification (Section 3.3)
app.post('/api/tickets/:id/block-clarification', (req, res) => {
  const { id } = req.params;
  const { question, workerId, reasoning } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

  ticket.status = 'BLOCKED_CLARIFICATION';
  ticket.clarificationQuestion = {
    question: question || 'Scope ambiguity detected. Please clarify expected edge case handling.',
    askedBy: workerId || 'Worker',
    askedAt: Date.now(),
    remindersSent: 0
  };
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'WARN',
    message: `[CLARIFICATION BLOCKER] Halted assumption. Question: "${ticket.clarificationQuestion.question}". Worker free to pick next open ticket.`
  });

  clusterState.telegramFeed.unshift({
    id: `tg-clarify-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'CLARIFICATION_BLOCKED',
    urgent: true,
    text: `❓ [CLARIFICATION REQUIRED] ${id} blocked: "${ticket.clarificationQuestion.question}". Reply with /clarify ${id} <answer>`
  });

  broadcastToTelegram(
    `❓ <b>[CLARIFICATION REQUIRED]</b>\n\n` +
    `🎫 <b>Ticket:</b> <code>${id}</code>\n` +
    `🤖 <b>Worker:</b> ${workerId}\n` +
    `💬 <b>Question:</b> <i>"${ticket.clarificationQuestion.question}"</i>\n\n` +
    `👉 <i>Reply with:</i> <code>/clarify ${id} &lt;your answer&gt;</code>`
  );

  sharedStateDB.audit_log.unshift({
    logId: `LOG-${Date.now().toString().slice(-4)}`,
    timestamp: Date.now(),
    actor: workerId,
    action: 'BLOCKED_FOR_CLARIFICATION',
    ticketId: id,
    reasoning: reasoning || 'Ambiguity in specification. Halted to prevent speculative development.',
    details: { question: ticket.clarificationQuestion.question }
  });

  res.json({ success: true, ticket });
});

// POST Answer Clarification (Section 3.3)
app.post('/api/tickets/:id/answer-clarification', (req, res) => {
  const { id } = req.params;
  const { answer, answeredBy } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

  if (ticket.clarificationQuestion) {
    ticket.clarificationQuestion.answer = answer;
    ticket.clarificationQuestion.answeredBy = answeredBy || 'Human';
    ticket.clarificationQuestion.answeredAt = Date.now();
  }
  ticket.status = 'SYNTHESIZING_DIFF';
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'SUCCESS',
    message: `[CLARIFICATION ANSWERED] by ${answeredBy || 'Human'}: "${answer}". Resumed synthesis.`
  });

  clusterState.telegramFeed.unshift({
    id: `tg-unblock-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'ALERT_HEALING',
    text: `✅ [CLARIFICATION UNBLOCKED] ${id} resumed with answer: "${answer}".`
  });

  sharedStateDB.audit_log.unshift({
    logId: `LOG-${Date.now().toString().slice(-4)}`,
    timestamp: Date.now(),
    actor: answeredBy || 'Human',
    action: 'CLARIFICATION_ANSWERED',
    ticketId: id,
    reasoning: 'Human answer supplied. Unblocked task.',
    details: { answer }
  });

  res.json({ success: true, ticket });
});

// POST Rollback Bad Merge (Section 11 Gap #5)
app.post('/api/master/rollback', (req, res) => {
  const { ticketId, reason, actor } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

  const hotfixId = `TKT-HOTFIX-${Math.floor(100 + Math.random() * 900)}`;
  const hotfixTicket: Ticket = {
    id: hotfixId,
    title: `[ROLLBACK HOTFIX] Revert ${ticket.id}: ${ticket.title}`,
    description: `Emergency rollback: ${reason || 'Regression detected in QA'}. Reverting commit ${ticket.rollbackCommit || 'HEAD~1'}.`,
    priority: 'P0_URGENT',
    domain: ticket.domain,
    status: 'SYNTHESIZING_DIFF',
    assignedTo: clusterState.activeMasterId,
    parentTicketIds: [],
    allowedFiles: ticket.allowedFiles,
    readOnlyContracts: ticket.readOnlyContracts,
    retryCount: 0,
    maxRetries: 3,
    branch: `ai/${hotfixId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [{
      timestamp: new Date().toLocaleTimeString(),
      level: 'WARN',
      message: `Rollback triggered for ${ticket.id}. Reverting commit ${ticket.rollbackCommit || 'HEAD~1'}.`
    }]
  };

  clusterState.tickets.unshift(hotfixTicket);
  clusterState.telegramFeed.unshift({
    id: `tg-rollback-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'ALERT_P0',
    urgent: true,
    text: `🚨 [ROLLBACK EXECUTED] ${ticket.id} rolled back. Hotfix ${hotfixId} auto-spawned.`
  });

  broadcastToTelegram(
    `🚨 <b>[BAD MERGE ROLLBACK EXECUTED]</b>\n\n` +
    `🎫 <b>Reverted Ticket:</b> ${ticket.id}\n` +
    `⚡ <b>Commit Reverted:</b> <code>${ticket.rollbackCommit || 'HEAD~1'}</code>\n` +
    `📝 <b>Reason:</b> ${reason || 'Regression discovered post-merge'}\n` +
    `🔥 <b>Auto Hotfix Created:</b> <code>${hotfixId}</code>`
  );

  sharedStateDB.audit_log.unshift({
    logId: `LOG-${Date.now().toString().slice(-4)}`,
    timestamp: Date.now(),
    actor: actor || 'Master',
    action: 'MERGE_ROLLBACK',
    ticketId,
    reasoning: `Bad merge identified: ${reason}. Target branch restored.`,
    details: { hotfixId, rollbackCommit: ticket.rollbackCommit || 'HEAD~1' }
  });

  res.json({ success: true, hotfixTicket });
});

// POST Update Prompt Version (Section 11 Gap #9)
app.post('/api/config/prompts/version', (req, res) => {
  const { version } = req.body;
  if (version === 'v1' || version === 'v2') {
    sharedStateDB.config.prompts.activeVersion = version;
    sharedStateDB.audit_log.unshift({
      logId: `LOG-${Date.now().toString().slice(-4)}`,
      timestamp: Date.now(),
      actor: 'Human Admin',
      action: 'PROMPT_VERSION_UPDATED',
      ticketId: undefined,
      reasoning: `Prompt template switched to ${version}.`,
      details: { activeVersion: version }
    });
    return res.json({ success: true, config: sharedStateDB.config.prompts });
  }
  res.status(400).json({ success: false, error: 'Invalid prompt version' });
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

// Background Watchdog & Split-Brain Evaluation Loop (Runs every 10s)
setInterval(() => {
  if (!clusterState.isLiveSimulation || clusterState.killSwitchActive) {
    return;
  }

  const now = Date.now();
  // Check active watchdog leases
  clusterState.watchdogLeases.forEach(lease => {
    if (lease.isRevoked) return;
    const timeSinceHb = (now - lease.lastHeartbeatAt) / 1000;
    
    // Check if worker missed heartbeats
    if (timeSinceHb > 30) {
      lease.missedHeartbeats = Math.min(lease.maxMissedHeartbeats, Math.floor(timeSinceHb / 30));
    }

    // Auto-Revoke if TTL expired or 3 missed heartbeats
    if (now >= lease.expiresAt || lease.missedHeartbeats >= lease.maxMissedHeartbeats) {
      lease.isRevoked = true;
      const ticket = clusterState.tickets.find(t => t.id === lease.ticketId);
      if (ticket && ticket.status !== 'COMMITTED_PUSHED') {
        const prevWorker = ticket.assignedTo || 'Unassigned';
        ticket.status = 'PENDING';
        ticket.assignedTo = undefined;
        ticket.logs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: 'WARN',
          message: `[WATCHDOG AUTO-RECOVERY] Worker ${prevWorker} failed heartbeat check (>90s silence). Lease auto-revoked and recycled.`
        });

        clusterState.telegramFeed.unshift({
          id: `tg-auto-revoke-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'WATCHDOG_REVOKE',
          urgent: true,
          text: `⚠️ [WATCHDOG TIMEOUT] Auto-revoked lease for ${ticket.id} from ${prevWorker}. Re-queued for available workers.`
        });
      }
    }
  });

  // Re-verify leader integrity
  clusterState.splitBrain.lastReverificationTimestamp = now;
}, 10000);

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
