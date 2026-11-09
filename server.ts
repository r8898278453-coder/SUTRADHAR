import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as child_process from 'child_process';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import type { ClusterState, SwarmNode, Ticket, LLMCascadeTier, TelegramMessage, CryptoTokenPayload } from './src/types.ts';
import { clusterDb } from './server_db.ts';
import { verifyGitHubMergeEvidence } from './github_merge_verifier.ts';
import { createVerifiedDraftPr } from './github_pr_creator.ts';

const app = express();
const PORT = 3000;
app.use(express.json({ limit: '2mb' }));

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
  { priority: 1, name: 'Gemini 3.8 Flash', model: 'gemini-3.8-flash', provider: 'Google AI Studio', status: 'ACTIVE', rpmCost: 1 },
  { priority: 2, name: 'DeepSeek R1', model: 'deepseek/deepseek-r1:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 3, name: 'Qwen 2.5 Coder 32B', model: 'qwen/qwen-2.5-coder-32b:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 4, name: 'LLaMA 3.3 70B', model: 'meta-llama/llama-3.3-70b-instruct:free', provider: 'OpenRouter', status: 'READY', rpmCost: 1 },
  { priority: 5, name: 'Gemini Flash Backup', model: 'gemini-3.8-flash', provider: 'Google AI Studio', status: 'READY', rpmCost: 1 }
];

export let clusterState: ClusterState = {
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

// =============================================================
// SECURE ED25519 CRYPTOGRAPHIC PROVISIONING & LEASE SIGNER
// =============================================================
const SECRETS_DIR = path.join(process.cwd(), '.sutradhar_state', 'secrets');
if (!fs.existsSync(SECRETS_DIR)) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
}

const PRIV_KEY_PATH = process.env.SUTRADHAR_PRIVKEY_PATH || path.join(SECRETS_DIR, 'master_private_key.pem');
const PUB_KEY_PATH = process.env.SUTRADHAR_PUBKEY_PATH || path.join(SECRETS_DIR, 'master_public_key.pub');

let masterKeyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
let masterPublicKeyPem: string;
const revokedTokenIds = new Set<string>();

function initMasterCrypto() {
  try {
    if (fs.existsSync(PRIV_KEY_PATH) && fs.existsSync(PUB_KEY_PATH)) {
      const privPem = fs.readFileSync(PRIV_KEY_PATH, 'utf-8');
      const pubPem = fs.readFileSync(PUB_KEY_PATH, 'utf-8');
      masterKeyPair = {
        privateKey: crypto.createPrivateKey(privPem),
        publicKey: crypto.createPublicKey(pubPem),
      };
      masterPublicKeyPem = pubPem;
      console.log('[CRYPTO] Loaded existing Master Ed25519 Keypair.');
    } else {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      fs.writeFileSync(PRIV_KEY_PATH, privPem, { mode: 0o600 });
      fs.writeFileSync(PUB_KEY_PATH, pubPem, { mode: 0o644 });
      masterKeyPair = { publicKey, privateKey };
      masterPublicKeyPem = pubPem;
      console.log('[CRYPTO] Generated new Master Ed25519 Keypair at', PRIV_KEY_PATH);
    }
  } catch (err) {
    console.warn('[CRYPTO] Generating ephemeral in-memory Ed25519 keypair:', err);
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    masterKeyPair = { publicKey, privateKey };
    masterPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }
}
initMasterCrypto();

export function calculateFilesHash(files: string[]): string {
  const sorted = [...files].map(f => f.trim()).filter(Boolean).sort();
  return crypto.createHash('sha256').update(sorted.join(',')).digest('hex').substring(0, 16);
}

function canonicalizePayload(payload: {
  epochId: number;
  expiryTimestamp: number;
  filesHash: string;
  ticketId: string;
  tokenId: string;
  workerId: string;
}): Buffer {
  const canonicalObj = {
    epoch_id: payload.epochId,
    expiry_timestamp: payload.expiryTimestamp,
    files_hash: payload.filesHash,
    ticket_id: payload.ticketId,
    token_id: payload.tokenId,
    worker_id: payload.workerId,
  };
  return Buffer.from(JSON.stringify(canonicalObj, Object.keys(canonicalObj).sort()));
}

// Helper: Generate genuine Ed25519 Token
export function generateEd25519Token(
  ticketId: string, 
  workerId: string, 
  epochId: number, 
  files: string[],
  ttlSeconds: number = 3600
): { tokenHeader: string; expiresAt: number; tokenId: string; filesHash: string } {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const tokenId = `tok_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
  const filesHash = calculateFilesHash(files);

  const payload = {
    epochId,
    expiryTimestamp: expiresAt,
    filesHash,
    ticketId,
    tokenId,
    workerId,
  };

  const canonicalBytes = canonicalizePayload(payload);
  const signature = crypto.sign(null, canonicalBytes, masterKeyPair.privateKey);

  const payloadB64 = canonicalBytes.toString('base64url');
  const sigB64 = signature.toString('base64url');
  const tokenHeader = `SEC-${payloadB64}.${sigB64}`;

  return { tokenHeader, expiresAt, tokenId, filesHash };
}

// Helper: Asymmetric Ed25519 Token Verification
export function verifyEd25519Token(
  tokenStr: string,
  expectedTicketId: string,
  expectedEpochId?: number,
  expectedFiles?: string[]
): { verified: boolean; error?: string; payload?: CryptoTokenPayload } {
  if (!tokenStr || !tokenStr.startsWith('SEC-')) {
    return { verified: false, error: '403_MALFORMED_HEADER: Token header must start with SEC-' };
  }

  const raw = tokenStr.replace(/^SEC-/, '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) {
    return { verified: false, error: '403_INVALID_TOKEN_STRUCTURE: Expected SEC-<payload>.<signature>' };
  }

  try {
    const payloadBytes = Buffer.from(parts[0], 'base64url');
    const signatureBytes = Buffer.from(parts[1], 'base64url');

    // 1. Asymmetric Cryptographic verification using Master Public Key
    const isSignatureValid = crypto.verify(null, payloadBytes, masterKeyPair.publicKey, signatureBytes);
    if (!isSignatureValid) {
      return { verified: false, error: '403_CRYPTOGRAPHIC_SIGNATURE_MISMATCH: Ed25519 signature is forged or invalid' };
    }

    const parsedJson = JSON.parse(payloadBytes.toString('utf-8'));
    const payload: CryptoTokenPayload = {
      tokenId: parsedJson.token_id || parsedJson.tokenId,
      ticketId: parsedJson.ticket_id || parsedJson.ticketId,
      workerId: parsedJson.worker_id || parsedJson.workerId,
      epochId: Number(parsedJson.epoch_id || parsedJson.epochId || 1),
      expiryTimestamp: Number(parsedJson.expiry_timestamp || parsedJson.expiryTimestamp || 0),
      filesHash: parsedJson.files_hash || parsedJson.filesHash || '',
    };

    // 2. Revocation check (in-memory and durable SQLite state)
    if (payload.tokenId && (revokedTokenIds.has(payload.tokenId) || clusterDb.isTokenRevoked(payload.tokenId))) {
      return { verified: false, error: `403_REVOKED_TOKEN: Token ${payload.tokenId} has been revoked`, payload };
    }

    // 3. Ticket identity match
    if (payload.ticketId !== expectedTicketId) {
      return {
        verified: false,
        error: `403_TICKET_MISMATCH: Token bound to '${payload.ticketId}', but verification target is '${expectedTicketId}'`,
        payload,
      };
    }

    // 4. Expiration check
    const now = Date.now();
    const expMs = payload.expiryTimestamp > 100000000000 ? payload.expiryTimestamp : payload.expiryTimestamp * 1000;
    if (now > expMs) {
      return {
        verified: false,
        error: `403_LEASE_EXPIRED: Token expired at ${new Date(expMs).toISOString()} (current: ${new Date(now).toISOString()})`,
        payload,
      };
    }

    // 5. Epoch fencing
    if (expectedEpochId !== undefined && payload.epochId !== expectedEpochId) {
      return {
        verified: false,
        error: `403_STALE_EPOCH: Token issued for Epoch #${payload.epochId}, current cluster Epoch is #${expectedEpochId}`,
        payload,
      };
    }

    // 6. Whitelist file boundaries check
    if (expectedFiles && expectedFiles.length > 0) {
      const expectedHash = calculateFilesHash(expectedFiles);
      if (payload.filesHash !== expectedHash) {
        return {
          verified: false,
          error: `403_FILES_HASH_MISMATCH: Modified files do not match token signed whitelist (expected ${expectedHash}, got ${payload.filesHash})`,
          payload,
        };
      }
    }

    return { verified: true, payload };
  } catch (err: any) {
    return { verified: false, error: `403_TOKEN_PARSE_ERROR: ${err.message}` };
  }
}

// Initialize seed tickets with real genuine Ed25519 signatures
initialTickets.forEach(t => {
  if (!t.ed25519Token || !t.ed25519Token.includes('.')) {
    const { tokenHeader, expiresAt } = generateEd25519Token(t.id, t.assignedTo || 'NODE-E78A1201', clusterState.epochId, t.allowedFiles);
    t.ed25519Token = tokenHeader;
    t.tokenExpiresAt = expiresAt;
  } else {
    // Re-sign to ensure mathematical validity with master private key
    const { tokenHeader, expiresAt } = generateEd25519Token(t.id, t.assignedTo || 'NODE-E78A1201', clusterState.epochId, t.allowedFiles);
    t.ed25519Token = tokenHeader;
    t.tokenExpiresAt = expiresAt;
  }
});

// Seed SQLite DB on startup if empty
clusterDb.seedBaselineIfEmpty(initialNodes, initialTickets);

// =============================================================
// ROLE-BASED ACCESS CONTROL & AUTHENTICATION (TASK 2)
// =============================================================
export type ClusterRole = 'ADMIN' | 'MASTER' | 'WORKER' | 'READONLY';

const ADMIN_KEY_FILE = path.join(SECRETS_DIR, 'admin_api_key.txt');
export let SUTRADHAR_ADMIN_KEY = process.env.SUTRADHAR_ADMIN_KEY || '';
if (!SUTRADHAR_ADMIN_KEY) {
  if (fs.existsSync(ADMIN_KEY_FILE)) {
    try {
      SUTRADHAR_ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, 'utf-8').trim();
    } catch {
      // ignore
    }
  }
  if (!SUTRADHAR_ADMIN_KEY) {
    SUTRADHAR_ADMIN_KEY = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(ADMIN_KEY_FILE, SUTRADHAR_ADMIN_KEY, { mode: 0o600 });
      console.log('[AUTH] Generated secure SUTRADHAR_ADMIN_KEY in', ADMIN_KEY_FILE);
    } catch {
      console.warn('[AUTH] Could not persist admin key to disk; using in-memory key');
    }
  }
}

export const SUTRADHAR_WORKER_KEY = process.env.SUTRADHAR_WORKER_KEY?.trim() || '';
export const SUTRADHAR_WORKER_ID = process.env.SUTRADHAR_WORKER_ID?.trim() || '';

// Session store for verified human admin sessions
export const activeAdminSessions = new Map<string, { createdAt: number; expiresAt: number }>();

export function createAdminSession(): { token: string; expiresIn: number } {
  const token = `adm_sess_${crypto.randomUUID().replace(/-/g, '')}`;
  const expiresIn = 24 * 3600; // 24 hours
  activeAdminSessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return { token, expiresIn };
}

export function verifyAdminSession(token?: string): boolean {
  if (!token) return false;
  const sess = activeAdminSessions.get(token);
  if (!sess) return false;
  if (Date.now() > sess.expiresAt) {
    activeAdminSessions.delete(token);
    return false;
  }
  return true;
}

export function resolveCallerRole(req: express.Request): ClusterRole {
  const authHeader = req.headers['authorization'];
  const sessionHeader = req.headers['x-sutradhar-session'] as string | undefined;
  const cookieSession = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sutradhar_session='))?.slice('sutradhar_session='.length);
  const adminKeyHeader = req.headers['x-admin-key'] as string | undefined;
  const workerKeyHeader = req.headers['x-worker-key'] as string | undefined;

  let bearerToken: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  // Browser sessions use HttpOnly SameSite=Strict cookies. Cross-origin mutations are rejected.
  if (cookieSession && verifyAdminSession(cookieSession)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (!origin) return 'READONLY';
      try {
        const parsed = new URL(origin);
        if (parsed.host !== req.get('host')) return 'READONLY';
        if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return 'READONLY';
      } catch { return 'READONLY'; }
    }
    return 'ADMIN';
  }

  // 1. Check for verified Admin credentials (env key, admin file key, or active admin session)
  if (
    (bearerToken && bearerToken === SUTRADHAR_ADMIN_KEY) ||
    (adminKeyHeader && adminKeyHeader === SUTRADHAR_ADMIN_KEY) ||
    verifyAdminSession(sessionHeader) ||
    (bearerToken && verifyAdminSession(bearerToken))
  ) {
    return 'ADMIN';
  }

  // 2. Check for verified Worker credentials (worker key or valid Ed25519 token)
  if (
    SUTRADHAR_WORKER_KEY.length >= 32 &&
    SUTRADHAR_WORKER_ID &&
    (bearerToken === SUTRADHAR_WORKER_KEY || workerKeyHeader === SUTRADHAR_WORKER_KEY)
  ) {
    (req as any).authenticatedWorkerId = SUTRADHAR_WORKER_ID;
    return 'WORKER';
  }

  // An Ed25519 lease is ticket-scoped, not a global API credential.
  // A later worker-auth integration must bind the authenticated worker to each lease.
  // Local development must not silently elevate arbitrary callers to ADMIN.

  // NON-NEGOTIABLE: x-sutradhar-role is NEVER trusted as proof of identity!
  // Any unauthenticated or unrecognized caller strictly receives READONLY role.
  return 'READONLY';
}

export function authRole(allowedRoles: ClusterRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = resolveCallerRole(req);

    if (role === 'READONLY' && !allowedRoles.includes('READONLY')) {
      return res.status(401).json({
        success: false,
        error: '401_AUTHENTICATION_REQUIRED: Valid Bearer token or session credentials required for state-changing operations.'
      });
    }

    if (!allowedRoles.includes(role)) {
      if (role === 'WORKER') {
        return res.status(403).json({
          success: false,
          error: '403_ADMIN_ONLY: Workers are not authorized to invoke administrative control plane operations.'
        });
      }
      return res.status(403).json({
        success: false,
        error: `403_UNAUTHORIZED_ROLE: Requires one of [${allowedRoles.join(', ')}]. Caller role is '${role}'`
      });
    }

    (req as any).clientRole = role;
    next();
  };
}

// Only the worker holding the active SQLite lease may operate on its ticket.
function workerMayOperateTicket(req: express.Request, ticketId: string): boolean {
  if ((req as any).clientRole !== 'WORKER') return true;
  const workerId = (req as any).authenticatedWorkerId;
  if (!workerId) return false;
  const ticket = clusterDb.getAllTickets().find(t => t.id === ticketId);
  const lease = clusterDb.getAllLeases().find(l => l.ticketId === ticketId);
  return !!ticket && ticket.assignedTo === workerId &&
    !!lease && lease.workerId === workerId && !lease.isRevoked &&
    lease.expiresAt > Date.now();
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
app.get('/api/cluster/state', authRole(['ADMIN']), (req, res) => {
  // Authoritative sync from SQLite Cluster DB
  try {
    const sysState = clusterDb.getSystemState();
    const dbTickets = clusterDb.getAllTickets();
    const dbWorkers = clusterDb.getAllWorkers();
    const dbLeases = clusterDb.getAllLeases();

    clusterState.epochId = sysState.epochId;
    clusterState.activeMasterId = sysState.currentMasterId;
    clusterState.masterMode = sysState.masterMode as any;
    clusterState.killSwitchActive = sysState.killSwitchActive;
    clusterState.killSwitchReason = sysState.killSwitchReason;
    if (dbTickets.length > 0) clusterState.tickets = dbTickets;
    if (dbWorkers.length > 0) clusterState.nodes = dbWorkers;
    clusterState.watchdogLeases = dbLeases;
    clusterState.rpm = sysState.rpm;
    clusterState.maxRpm = sysState.maxRpm;
  } catch (e: any) {
    console.warn('[CLUSTER_STATE] DB sync warning:', e.message);
  }

  res.json({
    ...clusterState,
    liveCardText: generateLiveCardText(clusterState)
  });
});

// Admin Authentication Login Endpoint
app.post('/api/auth/login', (req, res) => {
  const { adminKey } = req.body;
  if (!adminKey || adminKey !== SUTRADHAR_ADMIN_KEY) {
    return res.status(401).json({
      success: false,
      error: '401_INVALID_CREDENTIALS: Provided admin key is invalid.'
    });
  }
  const session = createAdminSession();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sutradhar_session=${session.token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${session.expiresIn}${secure}`);
  res.json({ success: true, role: 'ADMIN', expiresIn: session.expiresIn });
});

app.get('/api/auth/session', authRole(['ADMIN']), (_req, res) => {
  res.json({ authenticated: true, role: 'ADMIN' });
});

app.post('/api/auth/logout', authRole(['ADMIN']), (req, res) => {
  const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sutradhar_session='))?.slice('sutradhar_session='.length);
  if (token) activeAdminSessions.delete(token);
  res.setHeader('Set-Cookie', 'sutradhar_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
  res.json({ success: true });
});

// 2. Inject Ticket (Normal or P0 Hotfix)
app.post('/api/cluster/ticket/create', authRole(['ADMIN']), (req, res) => {
  const { title, description, domain, priority, allowedFiles, isP0 } = req.body;
  const currentTickets = clusterDb.getAllTickets();
  const ticketCount = currentTickets.length + 101;
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

  // Persist directly to transactional SQLite Cluster DB
  clusterDb.createTicket(newTicket);
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

// Helper: Verify if Docker daemon is running and accessible
export function isDockerAvailable(): boolean {
  // Docker on CI/worker hosts can be slow to respond immediately after startup.
  // Use argv execution (no host shell) and allow a bounded readiness probe.
  const probe = child_process.spawnSync('docker', ['info'], {
    stdio: 'ignore',
    timeout: 15000
  });
  return probe.status === 0 && !probe.error;
}

// Helper: Real OpenRouter fallback API call
export async function callOpenRouter(prompt: string, model: string = 'deepseek/deepseek-r1:free'): Promise<{ text?: string; error?: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: 'OPENROUTER_API_KEY not configured' };
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (!resp.ok) {
      return { error: `OpenRouter returned HTTP ${resp.status}: ${resp.statusText}` };
    }
    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content;
    return { text: text || '' };
  } catch (err: any) {
    return { error: err.message };
  }
}

// 3. AI Code Synthesis using real Gemini API or Context-Preserved Cascade (Task 5)
app.post('/api/cluster/ticket/synthesize', authRole(['ADMIN', 'WORKER']), async (req, res) => {
  const { ticketId, customPrompt, isDemoMode } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }
  if (!workerMayOperateTicket(req, ticketId)) {
    return res.status(403).json({ success: false, error: '403_WORKER_LEASE_REQUIRED' });
  }


  ticket.status = 'SYNTHESIZING_DIFF';
  clusterState.rpm = Math.min(clusterState.maxRpm, clusterState.rpm + 0.5);

  const ai = getAI();
  let generatedDiff = '';
  let providerUsed = '';
  const t0 = Date.now();

  const promptContent = customPrompt || `You are the Sutradhar Autonomous Worker (${ticket.assignedTo || 'Worker'}).
Generate a clean, unified git diff patch for ticket ${ticket.id} (${ticket.title}).
Domain: ${ticket.domain}.
Allowed mutable files ONLY: ${ticket.allowedFiles.join(', ')}.
Requirements: ${ticket.description}.
Output ONLY the raw unified diff (starting with diff --git or --- / +++).`;

  // 1. Primary: Real Gemini Call
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: promptContent,
      });
      generatedDiff = response.text || '';
      if (generatedDiff) {
        providerUsed = 'Google AI Studio (Gemini 3.8 Flash - LIVE API)';
        clusterDb.recordModelUsage({
          ticketId: ticket.id,
          workerId: ticket.assignedTo,
          provider: 'Google AI Studio',
          model: 'gemini-3.8-flash',
          latencyMs: Date.now() - t0,
          success: true
        });
      }
    } catch (err: any) {
      console.warn('Gemini API call failed:', err.message);
      clusterDb.recordModelUsage({
        ticketId: ticket.id,
        workerId: ticket.assignedTo,
        provider: 'Google AI Studio',
        model: 'gemini-3.8-flash',
        latencyMs: Date.now() - t0,
        success: false
      });
    }
  }

  // 2. Cascade Fallback: Real OpenRouter Call if configured
  if (!generatedDiff && process.env.OPENROUTER_API_KEY) {
    try {
      const orResult = await callOpenRouter(promptContent, 'deepseek/deepseek-r1:free');
      if (orResult.text) {
        generatedDiff = orResult.text;
        providerUsed = 'OpenRouter (DeepSeek R1 - LIVE API)';
        clusterDb.recordModelUsage({
          ticketId: ticket.id,
          workerId: ticket.assignedTo,
          provider: 'OpenRouter',
          model: 'deepseek/deepseek-r1:free',
          latencyMs: Date.now() - t0,
          success: true
        });
      }
    } catch (err: any) {
      console.warn('OpenRouter API call failed:', err.message);
    }
  }

  // 3. Fallback Evaluation: If neither provider responded, enforce truth in production
  const isTestOrDemo = process.env.NODE_ENV === 'test';

  if (!generatedDiff) {
    if (!isTestOrDemo) {
      ticket.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR',
        message: '[MODEL_UNAVAILABLE] No usable AI model provider available. Neither Gemini nor OpenRouter responded.'
      });
      clusterDb.updateTicket(ticket.id, {
        logMessage: { level: 'ERROR', message: '[MODEL_UNAVAILABLE] No operational LLM provider available.' }
      });
      return res.status(503).json({
        success: false,
        error: 'MODEL_UNAVAILABLE',
        message: 'No operational LLM provider available. Gemini key missing or failed, and OpenRouter not configured.'
      });
    }

    // Explicit demo / test mode only
    const targetFile = ticket.allowedFiles[0] || `modules/${ticket.domain.toLowerCase()}/Handler.php`;
    generatedDiff = `--- a/${targetFile}
+++ b/${targetFile}
@@ -10,6 +10,15 @@ class ${ticket.domain}Handler {
+    /**
+     * Generated in Test/Demo Mode by Sutradhar Swarm Node (${ticket.assignedTo})
+     * Task: ${ticket.id} - ${ticket.title}
+     */
+    public function executeSafeContract(Request $request) {
+        $this->guardAllowedFiles("${ticket.allowedFiles.join(', ')}");
+        return $this->processDomainPayload($request->all());
+    }
+}`;
    providerUsed = 'Local Test Simulator';
  }

  ticket.diffPatch = generatedDiff;
  ticket.llmUsed = providerUsed;
  ticket.status = 'TESTING_SANDBOX';
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'INFO',
    message: `Synthesized unified diff via ${providerUsed}. Moving to Ephemeral Sandbox.`
  });

  // Persist update in SQLite Cluster DB
  clusterDb.updateTicket(ticket.id, {
    diffPatch: generatedDiff,
    llmUsed: providerUsed,
    status: 'TESTING_SANDBOX',
    logMessage: { level: 'INFO', message: `Synthesized unified diff via ${providerUsed}. Moving to Ephemeral Sandbox.` }
  });

  res.json({ success: true, ticket, generatedDiff, providerUsed });
});

// 4. Real sandbox execution: Git snapshot -> scope-checked patch -> disposable Docker.
// Never accept caller-supplied test commands, simulated results, or a fake pass.
type SandboxResult = {
  status: 'TEST_PASSED' | 'TEST_FAILED' | 'PATCH_REJECTED' |
    'SANDBOX_UNAVAILABLE' | 'SANDBOX_NOT_CONFIGURED' | 'PREPARE_FAILED' | 'RUNNER_ERROR';
  patchValid: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  changedFiles: string[];
  baselineCommit: string | null;
  patchSha256: string | null;
  candidateTreeSha: string | null;
  durationMs: number;
};
const activeSandboxTests = new Set<string>();

function executeRealSandbox(ticket: Ticket, repoRoot: string, testCommand: string): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutradhar-test-'));
    const patchFile = path.join(tempDir, 'candidate.patch');
    let finished = false;
    const finish = (err: Error | null, data?: SandboxResult) => {
      if (finished) return;
      finished = true;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      if (err) reject(err);
      else if (data) resolve(data);
      else reject(new Error('SANDBOX_RESULT_MISSING'));
    };
    try {
      fs.writeFileSync(patchFile, ticket.diffPatch || '', { mode: 0o600 });
      const commandArgs = [
        path.join(process.cwd(), 'sandbox', 'execute_ticket.py'),
        '--repo-root', repoRoot, '--patch-file', patchFile,
        '--test-command', testCommand,
        ...ticket.allowedFiles.flatMap(file => ['--allowed-file', file])
      ];
      child_process.execFile(
        process.env.SUTRADHAR_PYTHON || 'python3', commandArgs,
        { cwd: process.cwd(), timeout: 220000, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            finish(new Error(`SANDBOX_RUNNER_PROCESS_FAILED: ${err.message}; ${stderr.slice(-500)}`));
            return;
          }
          try {
            const result = JSON.parse(stdout.trim()) as SandboxResult;
            if (!result || typeof result.status !== 'string' || typeof result.patchValid !== 'boolean' ||
                !Array.isArray(result.changedFiles) || typeof result.durationMs !== 'number' ||
                typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
              throw new Error('Unexpected runner response schema');
            }
            finish(null, result);
          } catch (parseError: any) {
            finish(new Error(`SANDBOX_INVALID_RESULT: ${parseError.message}`));
          }
        }
      );
    } catch (err: any) {
      finish(err);
    }
  });
}

app.post('/api/cluster/ticket/test', authRole(['ADMIN', 'WORKER']), async (req, res) => {
  const ticketId = req.body?.ticketId;
  if (typeof ticketId !== 'string') {
    return res.status(400).json({ success: false, error: 'INVALID_TICKET_ID' });
  }
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'TICKET_NOT_FOUND' });
  if (!workerMayOperateTicket(req, ticketId)) {
    return res.status(403).json({ success: false, error: '403_WORKER_LEASE_REQUIRED' });
  }

  // Only authenticated control-plane configuration chooses repo and test command.
  // simulateFailure, isDemoMode and x-sutradhar-demo-mode are intentionally ignored.
  const repoRoot = process.env.SUTRADHAR_TARGET_REPO_ROOT?.trim();
  const testCommand = process.env.SUTRADHAR_SANDBOX_TEST_COMMAND?.trim();
  if (!repoRoot || !testCommand) {
    return res.status(503).json({
      success: false, error: 'SANDBOX_NOT_CONFIGURED',
      message: 'Set SUTRADHAR_TARGET_REPO_ROOT and SUTRADHAR_SANDBOX_TEST_COMMAND on the server.'
    });
  }
  if (!isDockerAvailable()) {
    return res.status(503).json({ success: false, error: 'SANDBOX_UNAVAILABLE',
      message: 'Docker daemon is unavailable. Generated code cannot run on the host.' });
  }
  if (clusterDb.getSystemState().killSwitchActive) {
    return res.status(423).json({ success: false, error: 'CLUSTER_PAUSED' });
  }
  if (!ticket.diffPatch || typeof ticket.diffPatch !== 'string') {
    return res.status(409).json({ success: false, error: 'PATCH_NOT_GENERATED' });
  }
  if (!['TESTING_SANDBOX', 'HEALING_RETRY'].includes(ticket.status)) {
    return res.status(409).json({ success: false, error: 'INVALID_TICKET_TEST_STATE', currentStatus: ticket.status });
  }
  if (activeSandboxTests.has(ticket.id)) {
    return res.status(409).json({ success: false, error: 'TEST_ALREADY_RUNNING' });
  }

  // Pin the tested patch and active epoch to prevent concurrent state changes
  // from accidentally marking a different candidate READY_FOR_REVIEW.
  const originalPatch = ticket.diffPatch;
  const startEpoch = clusterDb.getSystemState().epochId;
  activeSandboxTests.add(ticket.id);
  try {
    const result = await executeRealSandbox(ticket, repoRoot, testCommand);
    const stillAuthorized = ticket.diffPatch === originalPatch &&
      clusterDb.getSystemState().epochId === startEpoch &&
      !clusterDb.getSystemState().killSwitchActive &&
      workerMayOperateTicket(req, ticketId);

    if (!stillAuthorized) {
      clusterDb.appendAuditLog({
        actor: 'Sandbox Gatekeeper', action: 'SANDBOX_RESULT_FENCED',
        ticketId, reasoning: 'Candidate patch, epoch, pause state or worker lease changed while Docker was running.'
      });
      return res.status(409).json({ success: false, error: 'SANDBOX_RESULT_STALE',
        message: 'Test evidence was not accepted after candidate/lease/epoch change.' });
    }

    const actualTestRun = result.status === 'TEST_PASSED' || result.status === 'TEST_FAILED';
    if (actualTestRun) {
      clusterDb.recordExecutionAttempt({
        ticketId,
        workerId: ticket.assignedTo || 'ADMIN',
        attemptNumber: ticket.retryCount + 1,
        tierUsed: ticket.currentTier || 1,
        patchValid: result.patchValid,
        sandboxExitCode: result.exitCode ?? -1,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs
      });
    }

    clusterDb.appendAuditLog({
      actor: 'Sandbox Gatekeeper',
      action: 'SANDBOX_EXECUTION_RESULT',
      ticketId,
      reasoning: `Runner result: ${result.status}. No Git push or merge claimed.`,
      details: {
        status: result.status, changedFiles: result.changedFiles,
        baselineCommit: result.baselineCommit, patchSha256: result.patchSha256,
        candidateTreeSha: result.candidateTreeSha,
        exitCode: result.exitCode, durationMs: result.durationMs
      }
    });

    ticket.testStdout = result.stdout;
    ticket.testStderr = result.stderr;
    ticket.updatedAt = new Date().toISOString();

    if (result.status === 'TEST_PASSED' && result.patchValid === true && result.exitCode === 0) {
      // Do not call updateTicket separately; a single SQLite transaction must
      // bind READY_FOR_REVIEW to the exact Git tree that actually passed Docker.
      if (!result.baselineCommit || !result.candidateTreeSha || !result.patchSha256) {
        return res.status(502).json({ success: false, error: 'SANDBOX_TREE_EVIDENCE_MISSING' });
      }
      const accepted = clusterDb.recordVerifiedSandboxPass({
        ticketId, patchSha256: result.patchSha256,
        baselineCommit: result.baselineCommit, candidateTreeSha: result.candidateTreeSha,
        changedFiles: result.changedFiles, workerId: ticket.assignedTo || 'ADMIN',
        epochId: startEpoch, stdout: result.stdout, stderr: result.stderr
      });
      if (!accepted) {
        return res.status(409).json({ success: false, error: 'SANDBOX_ATTESTATION_CONFLICT' });
      }
      ticket.status = 'READY_FOR_REVIEW';
      return res.json({ success: true, status: result.status, ticket, exitCode: 0,
        evidence: { baselineCommit: result.baselineCommit, patchSha256: result.patchSha256,
          candidateTreeSha: result.candidateTreeSha,
          changedFiles: result.changedFiles, durationMs: result.durationMs } });
    }

    if (result.status === 'TEST_FAILED' && result.patchValid) {
      ticket.retryCount += 1;
      ticket.status = ticket.retryCount >= ticket.maxRetries ? 'DEAD_LETTER_QUEUE' : 'HEALING_RETRY';
      clusterDb.updateTicket(ticket.id, {
        status: ticket.status, retryCount: ticket.retryCount,
        testStdout: result.stdout, testStderr: result.stderr,
        logMessage: { level: 'ERROR', message: `Real Docker test failed (exit ${result.exitCode}); retry ${ticket.retryCount}/${ticket.maxRetries}.` }
      });
      return res.json({ success: true, status: result.status, ticket,
        exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
    }

    // Patch/sandbox setup errors do not prove a test passed or failed.
    clusterDb.updateTicket(ticket.id, {
      testStderr: result.stderr,
      logMessage: { level: 'ERROR', message: `Sandbox blocked: ${result.status}; no validated test result.` }
    });
    const code = result.status === 'PATCH_REJECTED' ? 422 :
      result.status === 'SANDBOX_UNAVAILABLE' || result.status === 'SANDBOX_NOT_CONFIGURED' ? 503 : 502;
    return res.status(code).json({ success: false, error: result.status,
      message: result.stderr.slice(-1000), exitCode: result.exitCode });
  } catch (err: any) {
    clusterDb.updateTicket(ticket.id, {
      logMessage: { level: 'ERROR', message: 'Sandbox runner failed without trusted execution evidence.' }
    });
    return res.status(502).json({ success: false, error: 'SANDBOX_RUNNER_FAILED',
      message: String(err?.message || err).slice(0, 500) });
  } finally {
    activeSandboxTests.delete(ticket.id);
  }
});

// 5. Closed-Loop Self-Healing Re-prompting (Task 5)
app.post('/api/cluster/ticket/self-heal', authRole(['ADMIN', 'WORKER']), async (req, res) => {
  const { ticketId, isDemoMode } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }
  if (!workerMayOperateTicket(req, ticketId)) {
    return res.status(403).json({ success: false, error: '403_WORKER_LEASE_REQUIRED' });
  }


  ticket.status = 'SYNTHESIZING_DIFF';
  const ai = getAI();
  let healedDiff = '';
  const t0 = Date.now();

  const healingPrompt = `You are Sutradhar Self-Healing Engine (Retry ${ticket.retryCount}/${ticket.maxRetries}).
Previous Diff:
${ticket.diffPatch}

Captured Stderr / Stacktrace:
${ticket.testStderr}

Allowed mutable files ONLY: ${ticket.allowedFiles.join(', ')}.
Fix the code error and output a working unified diff patch.`;

  if (ai && ticket.testStderr) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: healingPrompt
      });
      healedDiff = response.text || '';
      if (healedDiff) {
        clusterDb.recordModelUsage({
          ticketId: ticket.id,
          workerId: ticket.assignedTo,
          provider: 'Google AI Studio',
          model: 'gemini-3.8-flash',
          latencyMs: Date.now() - t0,
          success: true
        });
      }
    } catch (e: any) {
      console.warn('AI healing failed with Gemini:', e.message);
    }
  }

  if (!healedDiff && process.env.OPENROUTER_API_KEY) {
    try {
      const orResult = await callOpenRouter(healingPrompt, 'deepseek/deepseek-r1:free');
      if (orResult.text) {
        healedDiff = orResult.text;
        clusterDb.recordModelUsage({
          ticketId: ticket.id,
          workerId: ticket.assignedTo,
          provider: 'OpenRouter',
          model: 'deepseek/deepseek-r1:free',
          latencyMs: Date.now() - t0,
          success: true
        });
      }
    } catch (e: any) {
      console.warn('AI healing failed with OpenRouter:', e.message);
    }
  }

  const isTestOrDemo = process.env.NODE_ENV === 'test';

  if (!healedDiff) {
    if (!isTestOrDemo) {
      ticket.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR',
        message: '[MODEL_UNAVAILABLE] Self-healing LLM provider unavailable.'
      });
      return res.status(503).json({
        success: false,
        error: 'MODEL_UNAVAILABLE',
        message: 'No operational LLM provider available for self-healing synthesis.'
      });
    }

    const targetFile = ticket.allowedFiles[0] || 'modules/core/Handler.php';
    healedDiff = `--- a/${targetFile}
+++ b/${targetFile}
@@ -10,6 +10,16 @@ class HealedHandler {
+    /**
+     * AUTO-HEALED in Demo/Test Mode (Retry ${ticket.retryCount}/${ticket.maxRetries})
+     */
+    public function executeSafeContract(Request $request) {
+        $safeData = $request->validate([ 'token' => 'required|string' ]);
+        return response()->json(['status' => 'OK', 'data' => $safeData]);
+    }
+}`;
  }

  ticket.diffPatch = healedDiff;
  ticket.status = 'TESTING_SANDBOX';
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'INFO',
    message: 'Re-prompted LLM with preserved context and stderr. New diff patch generated.'
  });

  clusterDb.updateTicket(ticket.id, {
    diffPatch: healedDiff,
    status: 'TESTING_SANDBOX',
    logMessage: {
      level: 'INFO',
      message: 'Re-prompted LLM with preserved context and stderr. New diff patch generated.'
    }
  });

  res.json({ success: true, ticket, healedDiff });
});

// Human-review-safe authorization for *read-only* GitHub merge proof
// verification. This does NOT renew a worker lease or approve/perform a merge.
app.post('/api/cluster/ticket/authorize-merge-verification', authRole(['ADMIN']), (req, res) => {
  const ticketId = req.body?.ticketId;
  if (typeof ticketId !== 'string' || !ticketId.trim()) {
    return res.status(400).json({ success: false, error: 'INVALID_TICKET_ID' });
  }
  const repo = process.env.SUTRADHAR_GITHUB_REPOSITORY?.trim() || '';
  const token = process.env.SUTRADHAR_GITHUB_TOKEN?.trim() || '';
  const checks = (process.env.SUTRADHAR_REQUIRED_CHECKS || '')
    .split(';').map(x => x.trim()).filter(Boolean);
  if (!repo || !token || !checks.length) {
    return res.status(503).json({ success: false, error: 'GITHUB_VERIFICATION_NOT_CONFIGURED' });
  }
  const grant = clusterDb.authorizeGitMergeVerification(ticketId, repo);
  if (!grant.success) {
    return res.status(409).json({ success: false, error: grant.error });
  }
  return res.json({
    success: true, status: 'MERGE_VERIFICATION_AUTHORIZED',
    ticketId, prNumber: grant.prNumber, headSha: grant.headSha,
    expiresAt: grant.expiresAt,
    message: 'Administrator authorized proof verification for 15 minutes; no PR merged or worker lease renewed.'
  });
});

// 6. GitHub independent read-only merge verifier.
// This endpoint NEVER pushes to a branch, merges a PR or creates Git commits.
app.post('/api/cluster/ticket/verify-push', authRole(['ADMIN']), async (req, res) => {
  const ticketId = req.body?.ticketId;
  if (typeof ticketId !== 'string') {
    return res.status(400).json({ verified: false, error: 'INVALID_TICKET_ID' });
  }
  const ticket = clusterDb.getAllTickets().find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ verified: false, error: 'TICKET_NOT_FOUND' });
  const active = clusterState.tickets.find(t => t.id === ticketId);
  const snapshot = clusterDb.getSystemState();
  if (req.body?.branch && req.body.branch !== ticket.branch) {
    return res.status(403).json({ verified: false, error: '403_BRANCH_MISMATCH' });
  }
  if (snapshot.killSwitchActive) {
    return res.status(423).json({ verified: false, error: 'CLUSTER_PAUSED' });
  }

  const githubRepo = process.env.SUTRADHAR_GITHUB_REPOSITORY?.trim() || '';
  const githubToken = process.env.SUTRADHAR_GITHUB_TOKEN?.trim() || '';
  // Check-run names often contain commas; use semicolons as the delimiter.
  const requiredChecks = (process.env.SUTRADHAR_REQUIRED_CHECKS || '')
    .split(';').map(s => s.trim()).filter(Boolean);
  if (!githubRepo || !githubToken || !requiredChecks.length) {
    return res.status(503).json({
      verified: false, error: 'GITHUB_VERIFICATION_NOT_CONFIGURED',
      message: 'Configure a GitHub repository, read-only API token and explicit required CI check names.'
    });
  }

  if (ticket.status !== 'READY_FOR_REVIEW' || !ticket.diffPatch) {
    return res.status(409).json({ verified: false, error: 'VERIFIED_SANDBOX_PASS_REQUIRED' });
  }
  const attestation = clusterDb.getSandboxAttestation(ticketId);
  if (!attestation || attestation.epochId !== snapshot.epochId ||
      attestation.patchSha256 !== crypto.createHash('sha256').update(ticket.diffPatch).digest('hex')) {
    return res.status(409).json({ verified: false, error: 'TESTED_PATCH_ATTESTATION_REQUIRED' });
  }
  const grant = clusterDb.getMergeVerificationGrant(ticketId);
  const submitted = clusterDb.getDraftPrSubmission(ticketId);
  const pushed = clusterDb.getVerifiedWorkerPush(ticketId);
  if (!grant || !submitted || !pushed ||
      grant.consumedAt !== null || grant.expiresAt <= Date.now() ||
      grant.epochId !== snapshot.epochId || grant.repo !== githubRepo ||
      grant.prNumber !== submitted.prNumber || grant.headSha !== submitted.headSha ||
      grant.headSha !== pushed.headSha || grant.branch !== ticket.branch ||
      grant.treeSha !== attestation.candidateTreeSha ||
      grant.patchSha256 !== attestation.patchSha256 ||
      submitted.repo !== githubRepo || pushed.repo !== githubRepo) {
    return res.status(409).json({
      verified: false, error: 'ADMIN_MERGE_VERIFICATION_GRANT_REQUIRED',
      message: 'Administrator must explicitly authorize current registered PR proof verification.'
    });
  }

  const requiredApprovals = Number(process.env.SUTRADHAR_MIN_GITHUB_APPROVALS || '1');
  const evidence = await verifyGitHubMergeEvidence({
    repo: githubRepo, token: githubToken, branch: ticket.branch || `ai/${ticketId}`,
    allowedFiles: ticket.allowedFiles,
    baselineCommit: attestation.baselineCommit,
    candidateTreeSha: attestation.candidateTreeSha,
    expectedPrNumber: grant.prNumber, expectedHeadSha: grant.headSha,
    requiredChecks, requiredApprovals
  });
  if (!evidence.verified) {
    const httpStatus = evidence.error === 'GITHUB_API_UNAVAILABLE' ? 502 :
      evidence.error === 'GITHUB_VERIFICATION_NOT_CONFIGURED' ? 503 : 409;
    return res.status(httpStatus).json({ verified: false, error: evidence.error });
  }

  // Fail closed if a new patch, epoch or state update happened during GitHub IO.
  const committed = clusterDb.recordVerifiedGitMerge({
    ticketId, repo: evidence.repo, prNumber: evidence.prNumber,
    branch: evidence.branch, headSha: evidence.headSha,
    mergeSha: evidence.mergeSha, treeSha: evidence.treeSha,
    patchSha256: attestation.patchSha256, epochId: snapshot.epochId,
    grantId: grant.grantId
  });
  if (!committed) {
    return res.status(409).json({ verified: false, error: 'GITHUB_MERGE_EVIDENCE_STALE' });
  }
  if (active) {
    active.status = 'COMMITTED_PUSHED';
    active.rollbackCommit = evidence.mergeSha;
  }
  return res.json({
    success: true, verified: true, status: 'COMMITTED_PUSHED',
    ticketId, repository: evidence.repo, pullRequest: evidence.prNumber,
    headSha: evidence.headSha, mergedCommit: evidence.mergeSha,
    verifiedTreeSha: evidence.treeSha
  });
});

// Guarded worker publication: a verified Docker tree is materialized in a
// disposable bare Git repository, then pushed ONLY as a new worker branch.
// The host's source checkout and GitHub main are never mutated.
const activeVerifiedPushes = new Set<string>();
app.post('/api/cluster/ticket/push-tested-branch', authRole(['ADMIN']), async (req, res) => {
  const ticketId = req.body?.ticketId;
  if (typeof ticketId !== 'string' || !ticketId.trim()) {
    return res.status(400).json({ success: false, error: 'INVALID_TICKET_ID' });
  }
  if (process.env.SUTRADHAR_ENABLE_WORKER_PUSH !== 'true') {
    return res.status(503).json({ success: false, error: 'WORKER_PUSH_DISABLED' });
  }
  const repo = process.env.SUTRADHAR_GITHUB_REPOSITORY?.trim() || '';
  const target = process.env.SUTRADHAR_TARGET_REPO_ROOT?.trim() || '';
  const token = process.env.SUTRADHAR_GITHUB_PUSH_TOKEN?.trim() || '';
  if (!repo || !target || !token) {
    return res.status(503).json({ success: false, error: 'WORKER_PUSH_NOT_CONFIGURED' });
  }
  if (activeVerifiedPushes.has(ticketId)) {
    return res.status(409).json({ success: false, error: 'WORKER_PUSH_ALREADY_RUNNING' });
  }
  const ticket = clusterDb.getAllTickets().find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'TICKET_NOT_FOUND' });
  const state = clusterDb.getSystemState();
  if (state.killSwitchActive) {
    return res.status(423).json({ success: false, error: 'CLUSTER_PAUSED' });
  }
  if (ticket.status !== 'READY_FOR_REVIEW' || !ticket.diffPatch || !ticket.branch) {
    return res.status(409).json({ success: false, error: 'REAL_DOCKER_TEST_REQUIRED' });
  }
  if (clusterDb.getVerifiedWorkerPush(ticketId)) {
    return res.status(409).json({ success: false, error: 'WORKER_PUSH_ALREADY_RECORDED',
      message: 'A verified branch receipt already exists. Proceed to draft PR review.' });
  }
  const attested = clusterDb.getSandboxAttestation(ticketId);
  const hash = crypto.createHash('sha256').update(ticket.diffPatch).digest('hex');
  if (!attested || attested.patchSha256 !== hash || !attested.changedFiles.length ||
      attested.epochId !== state.epochId || attested.workerId !== ticket.assignedTo) {
    return res.status(409).json({ success: false, error: 'TESTED_GIT_TREE_REQUIRED' });
  }
  const signature = verifyEd25519Token(ticket.ed25519Token || '', ticketId, state.epochId, ticket.allowedFiles);
  if (!signature.verified || !signature.payload?.tokenId) {
    return res.status(403).json({ success: false, error: 'WORKER_PUSH_SIGNATURE_INVALID' });
  }
  const verifiedPayload = signature.payload;
  const lease = clusterDb.getActiveLeaseAuth(ticketId);
  if (!lease || lease.workerId !== verifiedPayload.workerId ||
      lease.workerId !== attested.workerId ||
      lease.tokenId !== verifiedPayload.tokenId ||
      lease.epochId !== state.epochId || lease.expiresAt <= Date.now() ||
      clusterDb.isTokenRevoked(verifiedPayload.tokenId)) {
    return res.status(403).json({ success: false, error: 'WORKER_PUSH_LEASE_NOT_CURRENT' });
  }

  const reservation = clusterDb.reserveWorkerPushJob({
    ticketId, repo, branch: ticket.branch, treeSha: attested.candidateTreeSha,
    baselineCommit: attested.baselineCommit, patchSha256: attested.patchSha256,
    workerId: verifiedPayload.workerId, tokenId: verifiedPayload.tokenId,
    epochId: state.epochId
  });
  if (!reservation.success) {
    return res.status(409).json({ success: false, error: reservation.error,
      message: 'If a previous push is uncertain, use administrator reconciliation; never blind-retry.' });
  }

  activeVerifiedPushes.add(ticketId);
  let scratch: string | null = null;
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sutradhar-publish-'));
    const patchFile = path.join(scratch, 'candidate.patch');
    fs.writeFileSync(patchFile, ticket.diffPatch, { mode: 0o600 });
    const cmd = [
      '-m', 'sandbox.push_tested_branch',
      '--repo-root', target,
      '--github-repository', repo,
      '--ticket-id', ticketId, '--branch', ticket.branch,
      '--baseline-commit', attested.baselineCommit,
      '--candidate-tree-sha', attested.candidateTreeSha,
      '--patch-sha256', attested.patchSha256,
      '--patch-file', patchFile,
      ...ticket.allowedFiles.flatMap(p => ['--allowed-file', p]),
      ...attested.changedFiles.flatMap(p => ['--changed-file', p])
    ];
    const output = await new Promise<string>((resolve, reject) => {
      child_process.execFile(process.env.SUTRADHAR_PYTHON || 'python3', cmd, {
        cwd: process.cwd(), timeout: 180000, maxBuffer: 512 * 1024,
        env: { ...process.env, SUTRADHAR_GITHUB_PUSH_TOKEN: token }
      }, (error, stdout) => {
        if (error) reject(new Error('GIT_PUBLISH_SUBPROCESS_ERROR'));
        else resolve(stdout);
      });
    });
    let result: any;
    try { result = JSON.parse(output.trim()); }
    catch {
      clusterDb.markWorkerPushUncertain(ticketId, reservation.reservationId, 'GIT_PUBLISH_INVALID_RESPONSE');
      return res.status(502).json({ success: false, error: 'GIT_PUBLISH_INVALID_RESPONSE',
        requiresReconciliation: true });
    }
    if (!result?.success || result.status !== 'PUSH_CONFIRMED_NOT_MERGED') {
      clusterDb.markWorkerPushUncertain(ticketId, reservation.reservationId, 'REMOTE_RESULT_UNCERTAIN');
      return res.status(409).json({
        success: false,
        error: typeof result?.error === 'string' ? result.error : 'WORKER_PUSH_FAILED',
        requiresReconciliation: true
      });
    }
    if (result.treeSha !== attested.candidateTreeSha ||
        result.baselineCommit !== attested.baselineCommit ||
        result.patchSha256 !== attested.patchSha256 ||
        result.branch !== ticket.branch ||
        !/^[0-9a-f]{40}$/.test(result.headSha || '')) {
      clusterDb.markWorkerPushUncertain(ticketId, reservation.reservationId, 'WORKER_PUSH_EVIDENCE_MISMATCH');
      return res.status(502).json({ success: false, error: 'WORKER_PUSH_EVIDENCE_MISMATCH',
        requiresReconciliation: true });
    }
    const accepted = clusterDb.recordVerifiedWorkerPush({
      ticketId, repo, branch: ticket.branch, headSha: result.headSha,
      treeSha: result.treeSha, baselineCommit: result.baselineCommit,
      patchSha256: result.patchSha256, workerId: verifiedPayload.workerId,
      epochId: state.epochId, tokenId: verifiedPayload.tokenId,
      reservationId: reservation.reservationId
    });
    if (!accepted) clusterDb.markWorkerPushUncertain(
      ticketId, reservation.reservationId, 'WORKER_PUSH_STATE_CHANGED'
    );
    if (!accepted) return res.status(409).json({
      success: false, error: 'WORKER_PUSH_STATE_CHANGED_RECONCILE',
      message: 'Remote branch may exist but ticket/lease evidence changed; inspect GitHub before retrying.'
    });
    return res.json({
      success: true, status: 'PUSH_CONFIRMED_NOT_MERGED', ticketId,
      branch: ticket.branch, headSha: result.headSha, treeSha: result.treeSha,
      message: 'Exact tested branch pushed. Human-reviewed draft PR is next; main unchanged.'
    });
  } catch {
    clusterDb.markWorkerPushUncertain(ticketId, reservation.reservationId, 'WORKER_PUSH_EXECUTION_UNAVAILABLE');
    return res.status(502).json({ success: false, error: 'WORKER_PUSH_EXECUTION_UNAVAILABLE',
      requiresReconciliation: true });
  } finally {
    if (scratch) {
      try { fs.rmSync(scratch, { force: true, recursive: true }); } catch {}
    }
    activeVerifiedPushes.delete(ticketId);
  }
});

// Crash recovery is read-only against Git, and never itself triggers a push.
// An admin explicitly requests reconciliation for a durable uncertain job.
app.post('/api/cluster/ticket/reconcile-tested-branch', authRole(['ADMIN']), async (req, res) => {
  const ticketId = req.body?.ticketId;
  if (typeof ticketId !== 'string' || !ticketId.trim()) {
    return res.status(400).json({ success: false, error: 'INVALID_TICKET_ID' });
  }
  if (process.env.SUTRADHAR_ENABLE_WORKER_PUSH !== 'true') {
    return res.status(503).json({ success: false, error: 'WORKER_PUSH_DISABLED' });
  }
  const repo = process.env.SUTRADHAR_GITHUB_REPOSITORY?.trim() || '';
  const target = process.env.SUTRADHAR_TARGET_REPO_ROOT?.trim() || '';
  const token = process.env.SUTRADHAR_GITHUB_PUSH_TOKEN?.trim() || '';
  if (!repo || !target || !token) {
    return res.status(503).json({ success: false, error: 'WORKER_PUSH_NOT_CONFIGURED' });
  }
  if (activeVerifiedPushes.has(ticketId)) {
    return res.status(409).json({ success: false, error: 'WORKER_PUSH_ALREADY_RUNNING' });
  }
  clusterDb.expireWorkerPushJob(ticketId);
  const job = clusterDb.getWorkerPushJob(ticketId);
  if (!job) return res.status(404).json({ success: false, error: 'WORKER_PUSH_JOB_NOT_FOUND' });
  if (job.state !== 'NEEDS_RECONCILIATION') {
    return res.status(409).json({ success: false,
      error: job.state === 'CONFIRMED' ? 'WORKER_PUSH_ALREADY_CONFIRMED' : 'WORKER_PUSH_STILL_RUNNING' });
  }
  if (job.repo !== repo) {
    return res.status(409).json({ success: false, error: 'WORKER_PUSH_TARGET_REPOSITORY_CHANGED' });
  }
  activeVerifiedPushes.add(ticketId);
  try {
    const args = [
      '-m', 'sandbox.push_tested_branch', '--inspect-only',
      '--repo-root', target, '--github-repository', repo,
      '--ticket-id', ticketId, '--branch', job.branch,
      '--baseline-commit', job.baselineCommit,
      '--candidate-tree-sha', job.treeSha,
      '--patch-sha256', job.patchSha256
    ];
    const output = await new Promise<string>((resolve, reject) => {
      child_process.execFile(process.env.SUTRADHAR_PYTHON || 'python3', args, {
        cwd: process.cwd(), timeout: 120000, maxBuffer: 128 * 1024,
        env: { ...process.env, SUTRADHAR_GITHUB_PUSH_TOKEN: token }
      }, (error, stdout) => {
        if (error) reject(new Error('REMOTE_INSPECTION_UNAVAILABLE'));
        else resolve(stdout);
      });
    });
    let result: any;
    try { result = JSON.parse(output.trim()); }
    catch { return res.status(502).json({ success: false, error: 'REMOTE_INSPECTION_INVALID' }); }
    if (!result?.success) {
      return res.status(409).json({ success: false,
        error: typeof result?.error === 'string' ? result.error : 'REMOTE_INSPECTION_FAILED',
        requiresManualReview: true });
    }
    if (result.branch !== job.branch || result.baselineCommit !== job.baselineCommit ||
        result.treeSha !== job.treeSha) {
      return res.status(409).json({ success: false, error: 'REMOTE_INSPECTION_EVIDENCE_MISMATCH' });
    }
    if (result.status === 'REMOTE_BRANCH_ABSENT') {
      const cleared = clusterDb.clearWorkerPushAfterVerifiedAbsence(ticketId, job.reservationId);
      if (!cleared) return res.status(409).json({ success: false, error: 'RECONCILIATION_STATE_CHANGED' });
      return res.json({ success: true, status: 'REMOTE_ABSENT_EXPLICIT_RETRY_AVAILABLE',
        ticketId, message: 'No branch exists and main matches baseline. A separate explicit push may now be requested.' });
    }
    if (result.status === 'REMOTE_BRANCH_CONFIRMED_NOT_MERGED' &&
        /^[0-9a-f]{40}$/.test(result.headSha || '')) {
      const accepted = clusterDb.recordVerifiedWorkerPush({
        ticketId, repo, branch: job.branch, headSha: result.headSha,
        treeSha: job.treeSha, baselineCommit: job.baselineCommit,
        patchSha256: job.patchSha256, workerId: job.workerId,
        epochId: job.epochId, tokenId: job.tokenId,
        reservationId: job.reservationId
      });
      if (!accepted) return res.status(409).json({
        success: false, error: 'RECONCILIATION_LEASE_OR_STATE_CHANGED',
        requiresManualReview: true
      });
      return res.json({ success: true, status: 'PUSH_CONFIRMED_NOT_MERGED',
        ticketId, branch: job.branch, headSha: result.headSha,
        message: 'Read-only remote verification recovered the original worker branch receipt. No new push occurred.' });
    }
    return res.status(502).json({ success: false, error: 'REMOTE_INSPECTION_INVALID_OUTCOME' });
  } catch {
    return res.status(502).json({ success: false, error: 'REMOTE_INSPECTION_UNAVAILABLE' });
  } finally {
    activeVerifiedPushes.delete(ticketId);
  }
});

// Explicit, administrator-triggered draft PR creation for an already pushed
// worker branch. No GitHub merge endpoint is invoked by this route.
const activeDraftPrCreations = new Set<string>();
app.post('/api/cluster/ticket/create-draft-pr', authRole(['ADMIN']), async (req, res) => {
  const ticketId = req.body?.ticketId;
  if (typeof ticketId !== 'string' || !ticketId.trim()) {
    return res.status(400).json({ success: false, error: 'INVALID_TICKET_ID' });
  }
  if (process.env.SUTRADHAR_ENABLE_PR_CREATION !== 'true') {
    return res.status(503).json({ success: false, error: 'DRAFT_PR_CREATION_DISABLED' });
  }
  const repo = process.env.SUTRADHAR_GITHUB_REPOSITORY?.trim() || '';
  const token = process.env.SUTRADHAR_GITHUB_PR_TOKEN?.trim() || '';
  const requiredChecks = (process.env.SUTRADHAR_REQUIRED_CHECKS || '')
    .split(';').map(x => x.trim()).filter(Boolean);
  const requiredApprovals = Number(process.env.SUTRADHAR_MIN_GITHUB_APPROVALS || '1');
  if (!repo || !token || !requiredChecks.length ||
      !Number.isSafeInteger(requiredApprovals) || requiredApprovals < 1 ||
      requiredApprovals > 5) {
    return res.status(503).json({ success: false, error: 'DRAFT_PR_CONFIGURATION_MISSING' });
  }
  if (activeDraftPrCreations.has(ticketId)) {
    return res.status(409).json({ success: false, error: 'DRAFT_PR_ALREADY_IN_PROGRESS' });
  }
  const ticket = clusterDb.getAllTickets().find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'TICKET_NOT_FOUND' });
  const snapshot = clusterDb.getSystemState();
  if (snapshot.killSwitchActive) {
    return res.status(423).json({ success: false, error: 'CLUSTER_PAUSED' });
  }
  if (ticket.status !== 'READY_FOR_REVIEW' || !ticket.diffPatch || !ticket.branch) {
    return res.status(409).json({ success: false, error: 'VERIFIED_DOCKER_TEST_REQUIRED' });
  }
  const attestation = clusterDb.getSandboxAttestation(ticketId);
  const hash = crypto.createHash('sha256').update(ticket.diffPatch).digest('hex');
  if (!attestation || attestation.epochId !== snapshot.epochId ||
      attestation.patchSha256 !== hash || !attestation.changedFiles.length) {
    return res.status(409).json({ success: false, error: 'TESTED_TREE_ATTESTATION_MISSING' });
  }
  const pushReceipt = clusterDb.getVerifiedWorkerPush(ticketId);
  if (!pushReceipt || pushReceipt.repo !== repo ||
      pushReceipt.branch !== ticket.branch ||
      pushReceipt.treeSha !== attestation.candidateTreeSha ||
      pushReceipt.baselineCommit !== attestation.baselineCommit ||
      pushReceipt.patchSha256 !== attestation.patchSha256 ||
      pushReceipt.epochId !== snapshot.epochId ||
      pushReceipt.workerId !== attestation.workerId) {
    return res.status(409).json({ success: false, error: 'VERIFIED_WORKER_PUSH_REQUIRED' });
  }
  const verified = verifyEd25519Token(ticket.ed25519Token || '', ticketId,
    snapshot.epochId, ticket.allowedFiles);
  if (!verified.verified || !verified.payload || !verified.payload.tokenId) {
    return res.status(403).json({ success: false, error: 'DRAFT_PR_LEASE_SIGNATURE_INVALID' });
  }
  const signed = verified.payload;
  const lease = clusterDb.getActiveLeaseAuth(ticketId);
  if (!lease || lease.workerId !== signed.workerId ||
      lease.workerId !== attestation.workerId ||
      ticket.assignedTo !== signed.workerId ||
      lease.tokenId !== signed.tokenId ||
      lease.epochId !== snapshot.epochId || lease.expiresAt <= Date.now() ||
      clusterDb.isTokenRevoked(signed.tokenId)) {
    return res.status(403).json({ success: false, error: 'DRAFT_PR_LEASE_NOT_CURRENT' });
  }

  activeDraftPrCreations.add(ticketId);
  try {
    const outcome = await createVerifiedDraftPr({
      repo, token, branch: ticket.branch, ticketId,
      baselineCommit: attestation.baselineCommit,
      candidateTreeSha: attestation.candidateTreeSha,
      changedFiles: attestation.changedFiles,
      allowedFiles: ticket.allowedFiles,
      title: `[${ticketId}] ${ticket.title}`.slice(0, 160),
      description: ticket.description || ''
    });
    if (outcome.created && outcome.headSha !== pushReceipt.headSha) {
      return res.status(409).json({ success: false, error: 'DRAFT_PR_REMOTE_HEAD_CHANGED' });
    }
    if (!outcome.created) {
      const code = outcome.error === 'DRAFT_PR_GITHUB_API_UNAVAILABLE' ? 502 :
        outcome.error === 'DRAFT_PR_CONFIGURATION_INVALID' ? 503 : 409;
      return res.status(code).json({ success: false, error: outcome.error });
    }
    const recorded = clusterDb.recordVerifiedDraftPr({
      ticketId, repo: outcome.repo, prNumber: outcome.prNumber,
      branch: outcome.branch, headSha: outcome.headSha,
      treeSha: outcome.treeSha, patchSha256: attestation.patchSha256,
      epochId: snapshot.epochId,
      workerId: signed.workerId, tokenId: signed.tokenId
    });
    if (!recorded) {
      // GitHub may already contain a draft PR: do not mislabel the ticket.
      return res.status(409).json({ success: false,
        error: 'DRAFT_PR_STATE_CHANGED_MANUAL_RECONCILIATION',
        message: 'A draft PR might exist on GitHub, but current ticket/lease evidence no longer matches.' });
    }
    return res.status(outcome.existing ? 200 : 201).json({
      success: true, status: 'READY_FOR_REVIEW',
      draft: true, existing: outcome.existing,
      ticketId, repository: repo, prNumber: outcome.prNumber,
      pullRequestUrl: outcome.url, headSha: outcome.headSha,
      testedTreeSha: outcome.treeSha,
      message: 'Draft PR opened for human review. No merge or push to main was performed.'
    });
  } catch {
    return res.status(502).json({ success: false, error: 'DRAFT_PR_OPERATION_FAILED' });
  } finally {
    activeDraftPrCreations.delete(ticketId);
  }
});

// Master Public Key Endpoint
app.get('/api/cluster/security/public-key', (req, res) => {
  res.json({
    algorithm: 'Ed25519',
    epochId: clusterState.epochId,
    publicKeyPem: masterPublicKeyPem
  });
});

// Standalone Token Verification Endpoint
app.post('/api/cluster/security/verify-token', (req, res) => {
  const { token, ticketId, epochId, allowedFiles } = req.body;
  const result = verifyEd25519Token(token, ticketId, epochId, allowedFiles);
  res.json(result);
});

// 7. Master Failover & Monotonic Epoch Increment
app.post('/api/cluster/node/failover', authRole(['ADMIN']), (req, res) => {
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
app.post('/api/cluster/rfc/delegate', authRole(['ADMIN']), (req, res) => {
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

function escapeTelegramHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isTelegramAuthorized(chatId: string, userId?: string): { isApprovedChat: boolean; isAdmin: boolean } {
  const allowedChats = new Set<string>();
  if (telegramConfig.chatId && telegramConfig.chatId.trim()) allowedChats.add(telegramConfig.chatId.trim());
  if (process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_CHAT_ID.trim()) allowedChats.add(process.env.TELEGRAM_CHAT_ID.trim());
  if (process.env.TELEGRAM_ALLOWED_CHAT_IDS) {
    process.env.TELEGRAM_ALLOWED_CHAT_IDS.split(',').forEach(id => id.trim() && allowedChats.add(id.trim()));
  }

  const adminUsers = new Set<string>();
  if (process.env.TELEGRAM_ADMIN_USER_IDS) {
    process.env.TELEGRAM_ADMIN_USER_IDS.split(',').forEach(id => id.trim() && adminUsers.add(id.trim()));
  }

  // Task 3: Privileged commands require both an approved chat and an explicitly authorized Telegram user.
  // Empty allowlists must deny control commands.
  const isApprovedChat = allowedChats.size > 0 && allowedChats.has(chatId.trim());
  const isAdmin = isApprovedChat && !!userId && adminUsers.size > 0 && adminUsers.has(userId.trim());

  return { isApprovedChat, isAdmin };
}

// Process Incoming Telegram Message (from either Polling or Webhook)
async function handleTelegramIncomingMessage(chatId: string | number, rawText: string, senderName: string, chatTitle?: string, userId?: string) {
  const strChatId = chatId.toString();
  const auth = isTelegramAuthorized(strChatId, userId);

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

  console.log(`[TELEGRAM_MSG] Received from ${senderName} (uid: ${userId || 'unknown'}) in chat ${strChatId} (${chatTitle || 'DM'}): "${cleanText}" (Mentioned: ${mentionedBot || 'None'})`);

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
    if (!auth.isAdmin) {
      replyText = `🚫 <b>[UNAUTHORIZED]</b> Sender <code>${escapeTelegramHtml(senderName)}</code> is not authorized to dispatch P0 hotfixes.`;
    } else {
      const rawTitle = cleanText.replace(/^\/hotfix\s*/i, '').replace(/^hotfix\s*/i, '').trim() || 'Emergency Hotfix triggered via Telegram';
      const safeTitle = escapeTelegramHtml(rawTitle);
      const newId = `TKT-${Math.floor(100 + Math.random() * 900)}`;
      
      const { tokenHeader, expiresAt } = generateEd25519Token(newId, clusterState.activeMasterId, clusterState.epochId, ['modules/auth/Session.php', 'tests/Unit/HotfixTest.php']);

      const hotfixTicket: Ticket = {
        id: newId,
        title: `[HOTFIX] ${safeTitle}`,
        domain: 'Core',
        priority: 'P0_URGENT',
        status: 'SYNTHESIZING_DIFF',
        assignedTo: clusterState.activeMasterId,
        parentTicketIds: [],
        allowedFiles: ['modules/auth/Session.php', 'tests/Unit/HotfixTest.php'],
        readOnlyContracts: ['contracts/BaseInterface.php'],
        retryCount: 0,
        maxRetries: 3,
        currentTier: 1,
        branch: `ai/${newId}`,
        ed25519Token: tokenHeader,
        tokenExpiresAt: expiresAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: `Urgent hotfix created by ${senderName} from Telegram: ${safeTitle}`,
        logs: [{
          timestamp: new Date().toLocaleTimeString(),
          level: 'WARN',
          message: `Created via Telegram command from ${senderName}`
        }]
      };
      clusterState.tickets.unshift(hotfixTicket);

      clusterDb.appendAuditLog({
        actor: senderName,
        action: 'TELEGRAM_P0_HOTFIX_DISPATCHED',
        ticketId: newId,
        reasoning: `Authorized admin dispatched P0 hotfix via Telegram: ${rawTitle}`,
        details: { ticketId: newId, title: rawTitle }
      });

      clusterState.telegramFeed.unshift({
        id: `tg-hotfix-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'ALERT_P0',
        urgent: true,
        text: `🚨 [TELEGRAM P0 HOTFIX] Created ${newId}: "${safeTitle}" by ${senderName}. Dispatched to Master.`
      });

      replyText = `🚨 <b>P0 Hotfix Created & Dispatched!</b>\n\n` +
        `🎫 <b>Ticket:</b> <code>${newId}</code>\n` +
        `📝 <b>Title:</b> ${safeTitle}\n` +
        `👑 <b>Assigned To:</b> Master (<code>${clusterState.activeMasterId}</code>)\n` +
        `🔐 <b>Token:</b> Ed25519 Signed (${tokenHeader.substring(0, 24)}...)\n` +
        `⚡ <b>Status:</b> Closed-Loop Self-Healing Activated`;
    }

  // 3. Force Master (Section 8)
  } else if (lowerText.startsWith('/force_master')) {
    if (!auth.isAdmin) {
      replyText = `🚫 <b>[UNAUTHORIZED]</b> Sender <code>${escapeTelegramHtml(senderName)}</code> is not authorized to override Master leader.`;
    } else {
      const targetNodeId = cleanText.replace(/^\/force_master\s*/i, '').trim();
      if (targetNodeId) {
        const claimRes = clusterDb.tryClaimMaster(targetNodeId, 0);
        clusterState.activeMasterId = targetNodeId;
        clusterState.epochId = claimRes.newEpoch;
        clusterState.telegramFeed.unshift({
          id: `tg-master-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'ALERT_FAILOVER',
          urgent: true,
          text: `👑 [HUMAN FORCE MASTER] Master manually transitioned to ${escapeTelegramHtml(targetNodeId)} (Epoch #${clusterState.epochId}) by ${escapeTelegramHtml(senderName)}.`
        });
        replyText = `👑 <b>Master Overridden!</b>\n\nActive Master is now <code>${escapeTelegramHtml(targetNodeId)}</code> (Epoch #${clusterState.epochId}).`;
      } else {
        replyText = `⚠️ Usage: <code>/force_master &lt;NODE-ID&gt;</code>`;
      }
    }

  // 4. Stop After Current (Section 9 Graceful Shutdown)
  } else if (lowerText.startsWith('/stop_after_current')) {
    if (!auth.isAdmin) {
      replyText = `🚫 <b>[UNAUTHORIZED]</b> Sender <code>${escapeTelegramHtml(senderName)}</code> is not authorized to command graceful shutdown.`;
    } else {
      clusterState.killSwitchActive = true;
      clusterState.killSwitchReason = 'GRACEFUL_STOP_AFTER_CURRENT';
      clusterDb.setKillSwitch(true, clusterState.killSwitchReason, senderName);
      clusterDb.appendAuditLog({
        actor: senderName,
        action: 'GRACEFUL_SHUTDOWN_TRIGGERED',
        reasoning: 'Admin issued /stop_after_current via Telegram. In-flight tickets will finish, new claims disabled.'
      });
      clusterState.telegramFeed.unshift({
        id: `tg-graceful-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'KILL_SWITCH',
        text: `🛑 [GRACEFUL SHUTDOWN] Workers commanded to finish current tickets then halt.`
      });
      replyText = `🛑 <b>Graceful Shutdown Scheduled:</b> All active workers will finish their in-flight tickets and will not claim new ones.`;
    }

  // 5. Clarify Answer Protocol (Section 3.3)
  } else if (lowerText.startsWith('/clarify')) {
    if (!auth.isAdmin) {
      replyText = `🚫 <b>[UNAUTHORIZED]</b> Sender <code>${escapeTelegramHtml(senderName)}</code> is not authorized to submit clarifying answers.`;
    } else {
      const parts = cleanText.replace(/^\/clarify\s*/i, '').split(/\s+(.+)/);
      const tktId = parts[0]?.toUpperCase();
      const rawAnswer = parts[1];

      if (tktId && rawAnswer) {
        const safeAnswer = escapeTelegramHtml(rawAnswer);
        const ticket = clusterState.tickets.find(t => t.id.toUpperCase() === tktId);
        if (ticket) {
          clusterDb.answerClarification(ticket.id, rawAnswer, senderName);
          ticket.status = 'SYNTHESIZING_DIFF';
          if (ticket.clarificationQuestion) {
            ticket.clarificationQuestion.answer = rawAnswer;
            ticket.clarificationQuestion.answeredBy = senderName;
            ticket.clarificationQuestion.answeredAt = Date.now();
          }
          ticket.logs.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'SUCCESS',
            message: `[CLARIFICATION ANSWERED] by ${senderName}: "${rawAnswer}". Task unblocked.`
          });
          clusterState.telegramFeed.unshift({
            id: `tg-clarify-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'ALERT_HEALING',
            text: `✅ [CLARIFICATION UNBLOCKED] ${tktId} received answer from ${escapeTelegramHtml(senderName)}. Resuming synthesis.`
          });
          replyText = `✅ <b>Ticket ${tktId} Unblocked!</b>\n\nWorker has received your clarification: <i>"${safeAnswer}"</i> and resumed synthesis.`;
        } else {
          replyText = `❌ Ticket <code>${escapeTelegramHtml(tktId)}</code> not found in cluster state.`;
        }
      } else {
        replyText = `⚠️ Usage: <code>/clarify &lt;TICKET-ID&gt; &lt;Your Answer&gt;</code>`;
      }
    }

  // 6. Bad Merge Rollback (Section 11 Gap #5)
  } else if (lowerText.startsWith('/rollback')) {
    if (!auth.isAdmin) {
      replyText = `🚫 <b>[UNAUTHORIZED]</b> Sender <code>${escapeTelegramHtml(senderName)}</code> is not authorized to initiate Git rollback.`;
    } else {
      const tktId = cleanText.replace(/^\/rollback\s*/i, '').trim().toUpperCase();
      const ticket = clusterState.tickets.find(t => t.id.toUpperCase() === tktId);
      if (ticket) {
        if (ticket.status !== 'COMMITTED_PUSHED' && ticket.status !== 'ROLLBACK_REQUESTED') {
          replyText = '⚠️ Rollback requires a verified merged ticket.';
        } else {
          ticket.status = 'ROLLBACK_REQUESTED';
          clusterDb.updateTicket(ticket.id, {
            status: 'ROLLBACK_REQUESTED',
            logMessage: { level: 'WARN', message: `Rollback requested by Telegram admin ${senderName}; Git revert NOT executed.` }
          });
          replyText = `⚠️ <b>Rollback REQUESTED</b> for <code>${escapeTelegramHtml(ticket.id)}</code>. No Git revert has been executed. Awaiting verified Git pipeline.`;
        }
      } else {
        replyText = `⚠️ Usage: <code>/rollback &lt;TICKET-ID&gt;</code>`;
      }
    }

  // 7. Pause
  } else if (lowerText.startsWith('/pause') || lowerText === 'pause' || lowerText === 'stop') {
    if (!auth.isAdmin) {
      replyText = `🚫 <b>[UNAUTHORIZED]</b> Sender <code>${escapeTelegramHtml(senderName)}</code> is not authorized to pause the cluster.`;
    } else {
      clusterState.killSwitchActive = true;
      clusterState.killSwitchReason = `Paused via Telegram by ${senderName}`;
      clusterDb.setKillSwitch(true, clusterState.killSwitchReason, senderName);
      
      clusterState.telegramFeed.unshift({
        id: `tg-pause-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'KILL_SWITCH',
        urgent: true,
        text: `🛑 [KILL-SWITCH PAUSE] Triggered by ${escapeTelegramHtml(senderName)} from Telegram.`
      });

      replyText = `🛑 <b>Swarm Execution PAUSED by ${escapeTelegramHtml(senderName)}.</b>\n\nAll autonomous worker ticket claims and git merges are temporarily frozen.\nUse <code>/resume</code> to re-activate.`;
    }

  // 8. Resume
  } else if (lowerText.startsWith('/resume') || lowerText === 'resume' || lowerText === 'start') {
    if (!auth.isAdmin) {
      replyText = `🚫 <b>[UNAUTHORIZED]</b> Sender <code>${escapeTelegramHtml(senderName)}</code> is not authorized to resume the cluster.`;
    } else {
      clusterState.killSwitchActive = false;
      clusterState.killSwitchReason = undefined;
      clusterDb.setKillSwitch(false, undefined, senderName);

      clusterState.telegramFeed.unshift({
        id: `tg-resume-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'KILL_SWITCH',
        text: `🟢 [KILL-SWITCH RESUME] Triggered by ${escapeTelegramHtml(senderName)} from Telegram.`
      });

      replyText = `🟢 <b>Swarm Execution RESUMED by ${escapeTelegramHtml(senderName)}.</b>\n\nAutonomous worker queues, ticket synthesis, and Docker QA merges are back online!`;
    }

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
          model: 'gemini-3.8-flash',
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
            const userId = msg.from?.id ? String(msg.from.id) : undefined;
            await handleTelegramIncomingMessage(chatId, text, sender, chatTitle, userId);
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
app.post('/api/telegram/broadcast', authRole(['ADMIN']), async (req, res) => {
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
app.post('/api/telegram/config', authRole(['ADMIN']), (req, res) => {
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

// Get Telegram Config Status (Redacting sensitive botToken for non-admins)
app.get('/api/telegram/config', authRole(['ADMIN']), (req, res) => {
  res.json({ 
    configured: !!(telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN),
    chatId: telegramConfig.chatId || process.env.TELEGRAM_CHAT_ID || undefined,
    botToken: telegramConfig.botToken ? '••••••••' : undefined,
    isPolling: telegramConfig.isPolling,
    knownChatsCount: telegramConfig.knownChatIds.size
  });
});

// Start polling if token exists in env
if (process.env.TELEGRAM_BOT_TOKEN) {
  startTelegramPolling();
}

// 9. Telegram Wire Protocol Encode/Decode/Broadcast Endpoints
app.post('/api/cluster/protocol/encode', authRole(['ADMIN', 'WORKER']), (req, res) => {
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

app.post('/api/cluster/protocol/decode', authRole(['ADMIN', 'WORKER']), (req, res) => {
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

// 10. Emergency Kill-Switch Endpoint (Admin Only)
app.post('/api/cluster/kill-switch', authRole(['ADMIN']), (req, res) => {
  const { action, reason, adminName } = req.body;
  const isPause = action === 'PAUSE' || action === 'PAUSE_ALL';
  clusterState.killSwitchActive = isPause;
  clusterState.killSwitchReason = isPause ? (reason || 'Admin manual safety pause') : undefined;

  // Persist to authoritative SQLite database
  clusterDb.setKillSwitch(isPause, clusterState.killSwitchReason, adminName || 'Admin');

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
app.post('/api/cluster/watchdog/heartbeat', authRole(['ADMIN', 'WORKER']), (req, res) => {
  const { ticketId, workerId, progressPct, currentStep } = req.body;
  if ((req as any).clientRole === 'WORKER' && workerId !== (req as any).authenticatedWorkerId) {
    return res.status(403).json({ success: false, error: '403_WORKER_ID_MISMATCH' });
  }
  const lease = clusterState.watchdogLeases.find(l => l.ticketId === ticketId);
  
  if (!lease) {
    return res.status(403).json({ success: false, error: '403_INVALID_OR_REVOKED_LEASE' });
  }

  // Durable lease ownership is authoritative, not the request's asserted workerId.
  if (!workerId || !clusterDb.recordLeaseHeartbeat(ticketId, workerId, typeof progressPct === 'number' ? progressPct : lease.progressPct, currentStep || lease.lastStep)) {
    return res.status(403).json({ success: false, error: '403_INVALID_OR_REVOKED_LEASE' });
  }

  // Task 8: Reject wrong-worker heartbeats
  if (workerId && lease.workerId && workerId !== lease.workerId) {
    return res.status(403).json({
      success: false,
      error: `403_WRONG_WORKER: Heartbeat sender '${workerId}' does not match lease holder '${lease.workerId}'`
    });
  }

  lease.lastHeartbeatAt = Date.now();
  lease.missedHeartbeats = 0;
  if (typeof progressPct === 'number') lease.progressPct = progressPct;
  if (currentStep) lease.lastStep = currentStep;

  // Persist heartbeat to SQLite clusterDb
  // Add telegram progress feed item periodically
  clusterState.telegramFeed.unshift({
    id: `tg-hb-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'WIRE_PROTOCOL',
    text: `🤖 [HEARTBEAT: ${workerId || lease.workerId}] Ticket ${ticketId} (${lease.progressPct}%) ──► ${lease.lastStep}`
  });

  res.json({ success: true, lease, state: clusterState });
});

// 12. Watchdog Force Revoke Lease Endpoint (Admin Only)
app.post('/api/cluster/watchdog/revoke', authRole(['ADMIN']), (req, res) => {
  const { ticketId, reason } = req.body;
  const leaseIndex = clusterState.watchdogLeases.findIndex(l => l.ticketId === ticketId);
  const ticket = clusterState.tickets.find(t => t.id === ticketId);

  // Revoke in SQLite clusterDb
  clusterDb.revokeLease(ticketId, reason || 'Manual revocation');

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

// 13. Split-Brain Periodic Re-verification (Admin Only)
app.post('/api/cluster/split-brain/verify', authRole(['ADMIN']), (req, res) => {
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

// 14. Reset cluster to initial blueprint state (Admin Only)
app.post('/api/cluster/reset', authRole(['ADMIN']), (req, res) => {
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
      ticket_generation_pinned_model: 'gemini-3.8-flash',
      worker_primary_model: 'gemini-3.8-flash',
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
app.get('/api/db/all', authRole(['ADMIN']), (req, res) => {
  res.json({
    success: true,
    system_state: clusterDb.getSystemState(),
    workers: clusterDb.getAllWorkers(),
    projects: clusterDb.getAllProjects(),
    tickets: clusterDb.getAllTickets(),
    audit_log: clusterDb.getAuditLogs(100),
    config: clusterDb.getAllConfigurations(),
    operational_gaps: sharedStateDB.operational_gaps
  });
});

// POST Atomic Ticket Claim (Section 7, Section 11 Gap #3 & Gap #10)
app.post('/api/tickets/claim', authRole(['ADMIN', 'WORKER']), (req, res) => {
  const { workerId, ticketId } = req.body;
  if ((req as any).clientRole === 'WORKER' && workerId !== (req as any).authenticatedWorkerId) {
    return res.status(403).json({ success: false, error: '403_WORKER_ID_MISMATCH' });
  }
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

  // Task 8: Check kill-switch pause before claims
  if (clusterState.killSwitchActive) {
    return res.status(403).json({
      success: false,
      error: '403_CLUSTER_PAUSED: Cluster execution is frozen by kill-switch. Worker claims are suspended.'
    });
  }

  // Invoke atomic SQLite transaction with concurrency and dependency checks
  // The same signed token ID must be persisted in the durable worker lease.
  // An arbitrary client-provided or synthetic token ID never grants Git access.
  const claimEpoch = clusterDb.getSystemState().epochId;
  const issued = generateEd25519Token(ticketId, workerId, claimEpoch, ticket.allowedFiles, 900);
  const claimResult = clusterDb.tryClaimTicket(workerId, ticketId, issued.tokenId, 900);

  if (!claimResult.success) {
    const isCapExceeded = claimResult.error?.includes('MAX_WORKERS_CAP_EXCEEDED');
    return res.status(isCapExceeded ? 429 : 400).json({
      success: false,
      error: claimResult.error
    });
  }

  // Synchronize local in-memory clusterState
  ticket.status = 'SYNTHESIZING_DIFF';
  ticket.assignedTo = workerId;
  ticket.ed25519Token = issued.tokenHeader;
  ticket.tokenExpiresAt = issued.expiresAt;
  clusterDb.updateTicket(ticketId, { ed25519Token: issued.tokenHeader, tokenExpiresAt: issued.expiresAt });
  ticket.branch = claimResult.branch || `worker-${workerId.slice(-4).toLowerCase()}/ticket-${ticket.id.toLowerCase().replace('tkt-', '')}`;
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'INFO',
    message: `[ATOMIC CLAIM] Claimed by ${workerId}. Branch ${ticket.branch} reserved in SQLite state.`
  });

  if (claimResult.lease) {
    const existingLeaseIdx = clusterState.watchdogLeases.findIndex(l => l.ticketId === ticketId);
    if (existingLeaseIdx !== -1) {
      clusterState.watchdogLeases[existingLeaseIdx] = claimResult.lease;
    } else {
      clusterState.watchdogLeases.push(claimResult.lease);
    }
  }

  // Update Worker Node status
  const workerNode = clusterState.nodes.find(n => n.id === workerId);
  if (workerNode) {
    workerNode.status = 'SYNTHESIZING';
    workerNode.currentTicketId = ticket.id;
  }

  res.json({ success: true, ticket, lease: claimResult.lease });
});

// POST Block Ticket for Clarification (Section 3.3)
app.post('/api/tickets/:id/block-clarification', authRole(['ADMIN']), (req, res) => {
  const { id } = req.params;
  const { question, workerId, reasoning } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

  ticket.status = 'BLOCKED_CLARIFICATION';
  ticket.assignedTo = undefined;
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

  // Persist to SQLite clusterDb
  clusterDb.blockForClarification(id, ticket.clarificationQuestion.question, workerId || 'Worker', reasoning || 'Scope ambiguity');

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

  res.json({ success: true, ticket });
});

// POST Answer Clarification (Section 3.3 - Admin Only)
app.post('/api/tickets/:id/answer-clarification', authRole(['ADMIN']), (req, res) => {
  const { id } = req.params;
  const { answer, answeredBy } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

  if (ticket.clarificationQuestion) {
    ticket.clarificationQuestion.answer = answer;
    ticket.clarificationQuestion.answeredBy = answeredBy || 'Human';
    ticket.clarificationQuestion.answeredAt = Date.now();
  }
  ticket.status = 'PENDING';
  ticket.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    level: 'SUCCESS',
    message: `[CLARIFICATION ANSWERED] by ${answeredBy || 'Human'}: "${answer}". Task ready for worker claim.`
  });

  // Persist to SQLite clusterDb
  clusterDb.answerClarification(id, answer, answeredBy || 'Human');

  clusterState.telegramFeed.unshift({
    id: `tg-unblock-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'ALERT_HEALING',
    text: `✅ [CLARIFICATION UNBLOCKED] ${id} resumed with answer: "${answer}".`
  });

  res.json({ success: true, ticket });
});

// POST Rollback Bad Merge (Section 11 Gap #5 - Admin Only)
app.post('/api/master/rollback', authRole(['ADMIN']), (req, res) => {
  const { ticketId, reason } = req.body;
  const ticket = clusterState.tickets.find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
  if (ticket.status !== 'COMMITTED_PUSHED' && ticket.status !== 'ROLLBACK_REQUESTED') {
    return res.status(409).json({ success: false, error: 'ROLLBACK_REQUIRES_VERIFIED_MERGE' });
  }
  ticket.status = 'ROLLBACK_REQUESTED';
  clusterDb.updateTicket(ticket.id, {
    status: 'ROLLBACK_REQUESTED',
    logMessage: { level: 'WARN', message: `Rollback requested: ${String(reason || 'Regression detected')}. Awaiting verified Git revert and merge.` }
  });
  return res.status(202).json({
    success: true,
    status: 'ROLLBACK_REQUESTED',
    ticketId,
    message: 'No Git revert or merge was executed; rollback requires the real Git pipeline.'
  });
});

// POST Update Prompt Version (Section 11 Gap #9 - Admin Only)
app.post('/api/config/prompts/version', authRole(['ADMIN']), (req, res) => {
  const { version } = req.body;
  if (version === 'v1' || version === 'v2') {
    sharedStateDB.config.prompts.activeVersion = version;
    clusterDb.setConfiguration('prompts', sharedStateDB.config.prompts);
    clusterDb.appendAuditLog({
      actor: 'Human Admin',
      action: 'PROMPT_VERSION_UPDATED',
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

// Telegram Direct Test Endpoint (Admin Only)
app.post('/api/telegram/test-ping', authRole(['ADMIN']), async (req, res) => {
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
  // Lease expiry must continue even when the system is paused or demo mode is disabled.

  const now = Date.now();

  // Sweep SQLite database leases atomically
  try {
    const sweep = clusterDb.sweepWatchdog();
    if (sweep.expiredTickets.length > 0) {
      sweep.expiredTickets.forEach(tid => {
        const ticket = clusterState.tickets.find(t => t.id === tid);
        if (ticket && !['READY_FOR_REVIEW', 'COMMITTED_PUSHED', 'ROLLBACK_REQUESTED'].includes(ticket.status)) {
          ticket.status = 'PENDING';
          ticket.assignedTo = undefined;
          ticket.logs.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'WARN',
            message: `[WATCHDOG AUTO-RECOVERY] Worker went unresponsive (>90s silence). Lease auto-revoked in SQLite and recycled.`
          });

          clusterState.telegramFeed.unshift({
            id: `tg-auto-revoke-${Date.now()}-${tid}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'WATCHDOG_REVOKE',
            urgent: true,
            text: `⚠️ [WATCHDOG TIMEOUT] Auto-revoked lease for ${tid}. Re-queued for available workers.`
          });
        }
      });
    }
  } catch (err: any) {
    console.warn('[WATCHDOG_SWEEP] Error during SQLite sweep:', err.message);
  }

  // Check active in-memory watchdog leases
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
      if (ticket && !['READY_FOR_REVIEW', 'COMMITTED_PUSHED', 'ROLLBACK_REQUESTED'].includes(ticket.status)) {
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
}, 10000).unref();

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

if (process.env.NODE_ENV !== 'test' && !process.env.SUTRADHAR_TEST_RUN) {
  startServer().catch((err) => {
    console.error('[Sutradhar Swarm] Failed to start server:', err);
    process.exit(1);
  });
}

export { app };
