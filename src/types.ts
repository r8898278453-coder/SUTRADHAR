export type NodeRole = 'MASTER' | 'STANDBY' | 'WORKER_AUTH' | 'WORKER_MATRIMONY' | 'WORKER_MEDIA';
export type NodeStatus = 'ACTIVE' | 'IDLE' | 'SYNTHESIZING' | 'TESTING' | 'HEALING' | 'OFFLINE' | 'LOCAL_HYBRID';

export interface HealthMatrix {
  dns: { ok: boolean; rttMs: number };
  gitSsh: { ok: boolean; headSha: string };
  docker: { ok: boolean; status: string };
  memory: { ok: boolean; freeMb: number };
  llm: { ok: boolean; provider: string };
}

export interface SwarmNode {
  id: string; // e.g. NODE-A9F34B21
  name: string;
  role: NodeRole;
  domain: string;
  status: NodeStatus;
  macAddress: string;
  gitAuthor: string;
  uptimeSeconds: number;
  health: HealthMatrix;
  currentTicketId?: string;
  isHybridLocal?: boolean;
}

export type TicketStatus = 
  | 'PENDING'
  | 'BLOCKED_ON_PARENT'
  | 'LEASED'
  | 'SYNTHESIZING_DIFF'
  | 'TESTING_SANDBOX'
  | 'HEALING_RETRY'
  | 'COMMITTED_PUSHED'
  | 'DEAD_LETTER_QUEUE'
  | 'NEEDS_HUMAN_REVIEW';

export type TicketPriority = 'P0_URGENT' | 'P1_HIGH' | 'P2_NORMAL';

export interface Ticket {
  id: string; // e.g. TKT-104
  title: string;
  description: string;
  priority: TicketPriority;
  domain: 'Auth' | 'Matrimony' | 'Media' | 'Core';
  status: TicketStatus;
  assignedTo?: string; // Node ID
  parentTicketIds: string[];
  allowedFiles: string[];
  readOnlyContracts: string[];
  retryCount: number;
  maxRetries: number;
  currentTier?: 1 | 2 | 3;
  diffPatch?: string;
  testStderr?: string;
  testStdout?: string;
  ed25519Token?: string;
  tokenExpiresAt?: number;
  branch: string;
  llmUsed?: string;
  createdAt: string;
  updatedAt: string;
  logs: Array<{ timestamp: string; level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'; message: string }>;
}

export interface CryptoTokenPayload {
  ticketId: string;
  workerId: string;
  epochId: number;
  expiryTimestamp: number;
  filesHash: string;
}

export interface TelegramMessage {
  id: string;
  timestamp: string;
  type: 'PINNED_CARD' | 'ALERT_P0' | 'ALERT_RFC' | 'ALERT_MERGE' | 'ALERT_FAILOVER' | 'ALERT_HEALING';
  text: string;
  urgent?: boolean;
}

export interface LLMCascadeTier {
  priority: number;
  name: string;
  model: string;
  provider: 'Google AI Studio' | 'OpenRouter';
  status: 'READY' | 'ACTIVE' | 'RATE_LIMITED' | 'FALLBACK';
  rpmCost: number;
}

export interface ClusterState {
  version: string;
  epochId: number;
  activeMasterId: string;
  masterMode: 'ORCHESTRATOR' | 'HYBRID_LOCAL' | 'FAILOVER';
  nodes: SwarmNode[];
  tickets: Ticket[];
  rpm: number;
  maxRpm: number;
  telegramFeed: TelegramMessage[];
  lastTelegramCardUpdate: string;
  llmCascade: LLMCascadeTier[];
  isLiveSimulation: boolean;
}
