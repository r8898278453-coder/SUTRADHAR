import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import type { 
  ClusterState, 
  SwarmNode, 
  Ticket, 
  WatchdogLease, 
  AuditLogEntry, 
  ProjectInfo, 
  TicketStatus,
  TelegramMessage,
  LLMCascadeTier 
} from './src/types.ts';

const STATE_DIR = path.join(process.cwd(), '.sutradhar_state');
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export const DB_PATH = path.join(STATE_DIR, 'cluster.db');

export class ClusterDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    this.db = new DatabaseSync(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS system_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_master_id TEXT NOT NULL,
        epoch_id INTEGER NOT NULL DEFAULT 1,
        master_mode TEXT NOT NULL DEFAULT 'ORCHESTRATOR',
        global_status TEXT NOT NULL DEFAULT 'RUNNING',
        kill_switch_active INTEGER NOT NULL DEFAULT 0,
        kill_switch_reason TEXT,
        max_concurrent_workers INTEGER NOT NULL DEFAULT 6,
        active_project_id TEXT,
        rpm REAL NOT NULL DEFAULT 0.0,
        max_rpm REAL NOT NULL DEFAULT 10.0,
        last_heartbeat INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workers (
        worker_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        domain TEXT,
        mac_address TEXT,
        git_author TEXT,
        uptime_seconds INTEGER DEFAULT 0,
        current_ticket_id TEXT,
        last_seen INTEGER NOT NULL,
        capabilities_json TEXT,
        health_json TEXT,
        quota_json TEXT,
        is_hybrid_local INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        git_repo_url TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'P1_HIGH',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at INTEGER NOT NULL,
        config_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL DEFAULT 'P2_NORMAL',
        domain TEXT NOT NULL DEFAULT 'Core',
        status TEXT NOT NULL DEFAULT 'PENDING',
        assigned_to TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        current_tier INTEGER DEFAULT 1,
        branch TEXT,
        ed25519_token TEXT,
        token_expires_at INTEGER,
        diff_patch TEXT,
        test_stdout TEXT,
        test_stderr TEXT,
        rollback_commit TEXT,
        llm_used TEXT,
        allowed_files_json TEXT NOT NULL,
        read_only_contracts_json TEXT,
        clarification_question_json TEXT,
        logs_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ticket_dependencies (
        parent_ticket_id TEXT NOT NULL,
        child_ticket_id TEXT NOT NULL,
        PRIMARY KEY (parent_ticket_id, child_ticket_id)
      );

      CREATE TABLE IF NOT EXISTS worker_leases (
        ticket_id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        token_id TEXT NOT NULL,
        leased_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_heartbeat_at INTEGER NOT NULL,
        missed_heartbeats INTEGER DEFAULT 0,
        max_missed_heartbeats INTEGER DEFAULT 3,
        progress_pct INTEGER DEFAULT 0,
        last_step TEXT,
        is_revoked INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        log_id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        ticket_id TEXT,
        reasoning TEXT NOT NULL,
        details_json TEXT
      );

      CREATE TABLE IF NOT EXISTS configuration (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        ticket_id TEXT,
        worker_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS merge_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        token TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        enqueued_at INTEGER NOT NULL,
        processed_at INTEGER,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS execution_attempts (
        attempt_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        tier_used INTEGER NOT NULL,
        patch_valid INTEGER NOT NULL,
        sandbox_exit_code INTEGER,
        stdout TEXT,
        stderr TEXT,
        duration_ms INTEGER,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token_id TEXT PRIMARY KEY,
        revoked_at INTEGER NOT NULL,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS sandbox_attestations (
        ticket_id TEXT PRIMARY KEY,
        patch_sha256 TEXT NOT NULL,
        baseline_commit TEXT NOT NULL,
        candidate_tree_sha TEXT NOT NULL,
        changed_files_json TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        verified_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verified_git_merges (
        ticket_id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        merge_sha TEXT NOT NULL,
        tree_sha TEXT NOT NULL,
        verified_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rollback_proposals (
        ticket_id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        repo TEXT NOT NULL,
        original_merge_sha TEXT NOT NULL,
        baseline_commit TEXT NOT NULL,
        tested_merge_tree TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        branch TEXT NOT NULL,
        revert_head_sha TEXT,
        revert_tree_sha TEXT,
        pr_number INTEGER,
        status TEXT NOT NULL CHECK(status IN
          ('PREPARING','BRANCH_PUSHED','PR_CREATING','DRAFT_PR','NEEDS_RECONCILIATION','COMPLETED')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verified_git_rollbacks (
        ticket_id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        branch TEXT NOT NULL,
        rollback_head_sha TEXT NOT NULL,
        original_merge_sha TEXT NOT NULL,
        reverted_tree_sha TEXT NOT NULL,
        rollback_merge_sha TEXT NOT NULL,
        verified_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS draft_pr_submissions (
        ticket_id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        tree_sha TEXT NOT NULL,
        patch_sha256 TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verified_worker_pushes (
        ticket_id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        tree_sha TEXT NOT NULL,
        baseline_commit TEXT NOT NULL,
        patch_sha256 TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        pushed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS merge_verification_grants (
        ticket_id TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        candidate_tree_sha TEXT NOT NULL,
        patch_sha256 TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS worker_push_jobs (
        ticket_id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        baseline_commit TEXT NOT NULL,
        candidate_tree_sha TEXT NOT NULL,
        patch_sha256 TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('RUNNING','NEEDS_RECONCILIATION','CONFIRMED')),
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_error TEXT
      );
    `);

    // Migration for deployed databases: retain existing rollback reservation
    // rows while adding a cross-process, epoch-fenced reconciliation mutex.
    const rollbackColumns = this.db.prepare('PRAGMA table_info(rollback_proposals)').all() as any[];
    if (!rollbackColumns.some(c => c.name === 'recovery_token')) {
      this.db.exec('ALTER TABLE rollback_proposals ADD COLUMN recovery_token TEXT');
    }
    if (!rollbackColumns.some(c => c.name === 'recovery_started_at')) {
      this.db.exec('ALTER TABLE rollback_proposals ADD COLUMN recovery_started_at INTEGER');
    }

    // Ensure baseline system_state row
    const row = this.db.prepare('SELECT id FROM system_state WHERE id = 1').get();
    if (!row) {
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO system_state (
          id, current_master_id, epoch_id, master_mode, global_status,
          kill_switch_active, kill_switch_reason, max_concurrent_workers,
          active_project_id, rpm, max_rpm, last_heartbeat, updated_at
        ) VALUES (
          1, 'NODE-E78A1201', 15, 'ORCHESTRATOR', 'RUNNING',
          0, NULL, 6, 'PRJ-MATRIMONY-01', 4.8, 10.0, ?, ?
        )
      `).run(now, now);
    }
  }

  // System State Operations
  public getSystemState(): {
    currentMasterId: string;
    epochId: number;
    masterMode: string;
    globalStatus: string;
    killSwitchActive: boolean;
    killSwitchReason?: string;
    maxConcurrentWorkers: number;
    activeProjectId: string;
    rpm: number;
    maxRpm: number;
    lastHeartbeat: number;
  } {
    const row = this.db.prepare('SELECT * FROM system_state WHERE id = 1').get() as any;
    return {
      currentMasterId: row.current_master_id,
      epochId: Number(row.epoch_id),
      masterMode: row.master_mode,
      globalStatus: row.global_status,
      killSwitchActive: Boolean(row.kill_switch_active),
      killSwitchReason: row.kill_switch_reason || undefined,
      maxConcurrentWorkers: Number(row.max_concurrent_workers),
      activeProjectId: row.active_project_id || 'PRJ-MATRIMONY-01',
      rpm: Number(row.rpm),
      maxRpm: Number(row.max_rpm),
      lastHeartbeat: Number(row.last_heartbeat),
    };
  }

  public setKillSwitch(active: boolean, reason?: string, adminName: string = 'Human Admin'): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE system_state
      SET kill_switch_active = ?, kill_switch_reason = ?, updated_at = ?
      WHERE id = 1
    `).run(active ? 1 : 0, reason || null, now);

    this.appendAuditLog({
      actor: adminName,
      action: active ? 'KILL_SWITCH_ENGAGED' : 'KILL_SWITCH_DISENGAGED',
      reasoning: reason || (active ? 'Emergency pause triggered' : 'Cluster execution resumed'),
      details: { active, reason }
    });
  }

  // Atomic Master Election CAS
  public tryClaimMaster(candidateId: string, heartbeatTtlMs: number = 90000): { success: boolean; activeMasterId: string; newEpoch: number } {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.getSystemState();

      if (current.currentMasterId === candidateId) {
        this.db.prepare('UPDATE system_state SET last_heartbeat = ?, updated_at = ? WHERE id = 1').run(now, now);
        this.db.exec('COMMIT');
        return { success: true, activeMasterId: candidateId, newEpoch: current.epochId };
      }

      if (now - current.lastHeartbeat < heartbeatTtlMs) {
        this.db.exec('COMMIT');
        return { success: false, activeMasterId: current.currentMasterId, newEpoch: current.epochId };
      }

      // Previous master dead or failover -> Increment Monotonic Epoch atomically
      const newEpoch = current.epochId + 1;
      const res = this.db.prepare(`
        UPDATE system_state 
        SET current_master_id = ?, epoch_id = ?, last_heartbeat = ?, updated_at = ?
        WHERE id = 1 AND epoch_id = ?
      `).run(candidateId, newEpoch, now, now, current.epochId);

      if (res.changes !== 1) {
        throw new Error('ELECTION_CAS_CONFLICT: Epoch changed during election');
      }

      // Promote candidate worker node in workers table if registered
      this.db.prepare(`
        UPDATE workers SET role = 'MASTER', status = 'ACTIVE' WHERE worker_id = ?
      `).run(candidateId);

      this.appendAuditLog({
        actor: candidateId,
        action: 'MASTER_ELECTED_CAS',
        reasoning: `Previous master timed out or failover triggered. Monotonic Epoch bumped to #${newEpoch}.`,
        details: { candidateId, newEpoch, previousMaster: current.currentMasterId }
      });

      this.db.exec('COMMIT');
      return { success: true, activeMasterId: candidateId, newEpoch };
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      const fallbackState = this.getSystemState();
      return { success: false, activeMasterId: fallbackState.currentMasterId, newEpoch: fallbackState.epochId };
    }
  }

  // Atomic Ticket Claim with Dependency & Concurrency Guarantees
  public tryClaimTicket(workerId: string, ticketId: string, tokenId: string, ttlSeconds: number = 900): {
    success: boolean;
    error?: string;
    branch?: string;
    lease?: WatchdogLease;
  } {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const system = this.getSystemState();

      if (system.killSwitchActive) {
        this.db.exec('ROLLBACK');
        return { success: false, error: `KILL_SWITCH_ACTIVE: ${system.killSwitchReason || 'Cluster is paused'}` };
      }

      // 1. Concurrency limit check
      const activeWorkersCount = this.db.prepare(`
        SELECT COUNT(*) as cnt FROM tickets 
        WHERE status IN ('SYNTHESIZING_DIFF', 'TESTING_SANDBOX', 'HEALING_RETRY')
      `).get() as any;

      if (activeWorkersCount.cnt >= system.maxConcurrentWorkers) {
        this.db.exec('ROLLBACK');
        return { 
          success: false, 
          error: `MAX_WORKERS_CAP_EXCEEDED: Maximum ${system.maxConcurrentWorkers} concurrent workers allowed.` 
        };
      }

      // 2. Ticket state check
      const ticketRow = this.db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId) as any;
      if (!ticketRow) {
        this.db.exec('ROLLBACK');
        return { success: false, error: `Ticket ${ticketId} not found` };
      }

      if (ticketRow.status !== 'PENDING' && ticketRow.status !== 'BLOCKED_ON_PARENT') {
        this.db.exec('ROLLBACK');
        return { success: false, error: `Ticket ${ticketId} is currently in '${ticketRow.status}' state.` };
      }

      // 3. Dependency check: verify all parent tickets are COMMITTED_PUSHED
      const parents = this.db.prepare(`
        SELECT parent_ticket_id FROM ticket_dependencies WHERE child_ticket_id = ?
      `).all(ticketId) as Array<{ parent_ticket_id: string }>;

      for (const p of parents) {
        const parentRow = this.db.prepare('SELECT status FROM tickets WHERE ticket_id = ?').get(p.parent_ticket_id) as any;
        if (!parentRow || parentRow.status !== 'COMMITTED_PUSHED') {
          this.db.exec('ROLLBACK');
          return { 
            success: false, 
            error: `Parent ticket ${p.parent_ticket_id} is not yet COMMITTED_PUSHED. Ticket remains blocked.` 
          };
        }
      }

      // 4. Atomic claim update
      const branch = `worker-${workerId.slice(-4).toLowerCase()}/ticket-${ticketId.toLowerCase().replace('tkt-', '')}`;
      const expiresAt = now + ttlSeconds * 1000;

      const existingLogs = ticketRow.logs_json ? JSON.parse(ticketRow.logs_json) : [];
      existingLogs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: 'INFO',
        message: `[ATOMIC CLAIM] Ticket leased to ${workerId}. Branch ${branch} reserved. Epoch #${system.epochId}.`
      });

      const updateRes = this.db.prepare(`
        UPDATE tickets
        SET status = 'SYNTHESIZING_DIFF',
            assigned_to = ?,
            branch = ?,
            logs_json = ?,
            updated_at = ?
        WHERE ticket_id = ?
          AND (status = 'PENDING' OR status = 'BLOCKED_ON_PARENT')
      `).run(workerId, branch, JSON.stringify(existingLogs), now, ticketId);

      if (updateRes.changes !== 1) {
        throw new Error('CLAIM_CONFLICT: Ticket was claimed by another worker concurrently');
      }

      // Record worker lease
      this.db.prepare(`
        INSERT OR REPLACE INTO worker_leases (
          ticket_id, worker_id, epoch_id, token_id, leased_at, expires_at,
          last_heartbeat_at, missed_heartbeats, max_missed_heartbeats, progress_pct,
          last_step, is_revoked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 3, 10, 'Lease acquired, beginning synthesis', 0)
      `).run(ticketId, workerId, system.epochId, tokenId, now, expiresAt, now);

      // Update worker status
      this.db.prepare(`
        UPDATE workers SET status = 'SYNTHESIZING', current_ticket_id = ? WHERE worker_id = ?
      `).run(ticketId, workerId);

      this.appendAuditLog({
        actor: workerId,
        action: 'TICKET_CLAIMED_ATOMIC',
        ticketId,
        reasoning: 'Dependencies verified, concurrency cap checked, atomic lease acquired.',
        details: { branch, epochId: system.epochId, tokenId, expiresAt }
      });

      this.db.exec('COMMIT');

      const lease: WatchdogLease = {
        ticketId,
        workerId,
        leasedAt: now,
        expiresAt,
        lastHeartbeatAt: now,
        missedHeartbeats: 0,
        maxMissedHeartbeats: 3,
        progressPct: 10,
        lastStep: 'Lease acquired, beginning synthesis',
        isRevoked: false
      };

      return { success: true, branch, lease };
    } catch (err: any) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      return { success: false, error: err.message || 'CLAIM_FAILED' };
    }
  }

  // Durable Token Revocation (Task 9)
  public getActiveLeaseAuth(ticketId: string): {
    workerId: string; tokenId: string; epochId: number; expiresAt: number;
  } | null {
    const lease = this.db.prepare(`SELECT worker_id, token_id, epoch_id, expires_at
      FROM worker_leases WHERE ticket_id = ? AND is_revoked = 0`).get(ticketId) as any;
    if (!lease) return null;
    return {
      workerId: lease.worker_id, tokenId: lease.token_id,
      epochId: Number(lease.epoch_id), expiresAt: Number(lease.expires_at)
    };
  }

  public revokeToken(tokenId: string, reason: string = 'Token explicitly revoked'): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO revoked_tokens (token_id, revoked_at, reason)
      VALUES (?, ?, ?)
    `).run(tokenId, now, reason);

    this.appendAuditLog({
      actor: 'Security Gatekeeper',
      action: 'TOKEN_REVOKED',
      reasoning: reason,
      details: { tokenId }
    });
  }

  public isTokenRevoked(tokenId: string): boolean {
    const row = this.db.prepare('SELECT token_id FROM revoked_tokens WHERE token_id = ?').get(tokenId);
    return Boolean(row);
  }

  // Update Ticket Status
  public updateTicket(ticketId: string, updates: Partial<{
    status: TicketStatus;
    diffPatch: string;
    testStdout: string;
    testStderr: string;
    rollbackCommit: string;
    llmUsed: string;
    retryCount: number;
    currentTier: 1 | 2 | 3;
    assignedTo: string | null;
    branch: string;
    ed25519Token: string;
    tokenExpiresAt: number;
    logMessage: { level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'; message: string };
  }>): boolean {
    const row = this.db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId) as any;
    if (!row) return false;

    const now = Date.now();
    let logs = row.logs_json ? JSON.parse(row.logs_json) : [];
    if (updates.logMessage) {
      logs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: updates.logMessage.level,
        message: updates.logMessage.message,
      });
    }

    const shouldClearAssignedTo = updates.assignedTo === null;
    const newAssignedTo = updates.assignedTo !== undefined && updates.assignedTo !== null ? updates.assignedTo : null;

    this.db.prepare(`
      UPDATE tickets SET
        status = COALESCE(?, status),
        diff_patch = COALESCE(?, diff_patch),
        test_stdout = COALESCE(?, test_stdout),
        test_stderr = COALESCE(?, test_stderr),
        rollback_commit = COALESCE(?, rollback_commit),
        llm_used = COALESCE(?, llm_used),
        retry_count = COALESCE(?, retry_count),
        current_tier = COALESCE(?, current_tier),
        assigned_to = CASE WHEN ? = 1 THEN NULL WHEN ? IS NOT NULL THEN ? ELSE assigned_to END,
        branch = COALESCE(?, branch),
        ed25519_token = COALESCE(?, ed25519_token),
        token_expires_at = COALESCE(?, token_expires_at),
        logs_json = ?,
        updated_at = ?
      WHERE ticket_id = ?
    `).run(
      updates.status || null,
      updates.diffPatch !== undefined ? updates.diffPatch : null,
      updates.testStdout !== undefined ? updates.testStdout : null,
      updates.testStderr !== undefined ? updates.testStderr : null,
      updates.rollbackCommit || null,
      updates.llmUsed || null,
      updates.retryCount !== undefined ? updates.retryCount : null,
      updates.currentTier || null,
      shouldClearAssignedTo ? 1 : 0,
      newAssignedTo,
      newAssignedTo,
      updates.branch || null,
      updates.ed25519Token || null,
      updates.tokenExpiresAt || null,
      JSON.stringify(logs),
      now,
      ticketId
    );

    return true;
  }

  // Clarification Protocol
  public blockForClarification(ticketId: string, question: string, askedBy: string, reasoning: string): boolean {
    const row = this.db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId) as any;
    if (!row) return false;

    const now = Date.now();
    const clarObj = {
      question,
      askedBy,
      askedAt: now,
      remindersSent: 0,
    };

    let logs = row.logs_json ? JSON.parse(row.logs_json) : [];
    logs.push({
      timestamp: new Date().toLocaleTimeString(),
      level: 'WARN',
      message: `[CLARIFICATION BLOCK] Halted assumption. Question: "${question}". Worker released to pick open tasks.`
    });

    this.db.prepare(`
      UPDATE tickets
      SET status = 'BLOCKED_CLARIFICATION',
          clarification_question_json = ?,
          assigned_to = NULL,
          logs_json = ?,
          updated_at = ?
      WHERE ticket_id = ?
    `).run(JSON.stringify(clarObj), JSON.stringify(logs), now, ticketId);

    // Free worker node
    this.db.prepare(`UPDATE workers SET status = 'IDLE', current_ticket_id = NULL WHERE worker_id = ?`).run(askedBy);

    // Remove lease
    this.db.prepare('DELETE FROM worker_leases WHERE ticket_id = ?').run(ticketId);

    this.appendAuditLog({
      actor: askedBy,
      action: 'BLOCKED_FOR_CLARIFICATION',
      ticketId,
      reasoning: reasoning || 'Ambiguity in specification. Halted to prevent speculative development.',
      details: { question }
    });

    return true;
  }

  public answerClarification(ticketId: string, answer: string, answeredBy: string = 'Human'): boolean {
    const row = this.db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId) as any;
    if (!row) return false;

    const now = Date.now();
    let clarObj = row.clarification_question_json ? JSON.parse(row.clarification_question_json) : {};
    clarObj.answer = answer;
    clarObj.answeredBy = answeredBy;
    clarObj.answeredAt = now;

    let logs = row.logs_json ? JSON.parse(row.logs_json) : [];
    logs.push({
      timestamp: new Date().toLocaleTimeString(),
      level: 'SUCCESS',
      message: `[CLARIFICATION ANSWERED] by ${answeredBy}: "${answer}". Task ready for worker claim.`
    });

    this.db.prepare(`
      UPDATE tickets
      SET status = 'PENDING',
          clarification_question_json = ?,
          logs_json = ?,
          updated_at = ?
      WHERE ticket_id = ?
    `).run(JSON.stringify(clarObj), JSON.stringify(logs), now, ticketId);

    this.appendAuditLog({
      actor: answeredBy,
      action: 'CLARIFICATION_ANSWERED',
      ticketId,
      reasoning: 'Clarification answer provided. Task returned to PENDING DAG queue.',
      details: { answer }
    });

    return true;
  }

  /**
   * Fail-closed rollback reservation. No duplicate push across processes and
   * no retry when a prior Git write may have succeeded.
   */
  public reserveVerifiedRollback(ticketId: string, repo: string):
    { success: true; reservationId: string; mergedCommit: string;
      baselineCommit: string; testedTree: string; branch: string; changedFiles: string[]; allowedFiles: string[]; epochId: number } |
    { success: false; error: string } {
    const deny = (error: string): { success: false; error: string } => ({ success: false, error });
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,85}$/.test(ticketId)) return deny('ROLLBACK_INVALID_REQUEST');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const t = this.db.prepare('SELECT * FROM tickets WHERE ticket_id=?').get(ticketId) as any;
      const m = this.db.prepare('SELECT * FROM verified_git_merges WHERE ticket_id=?').get(ticketId) as any;
      const a = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id=?').get(ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id=1').get() as any;
      const existing = this.db.prepare('SELECT ticket_id FROM rollback_proposals WHERE ticket_id=?').get(ticketId) as any;
      if (existing) { this.db.exec('ROLLBACK'); return deny('ROLLBACK_ALREADY_RESERVED_RECONCILE'); }
      if (!t || !m || !a || !sys || sys.kill_switch_active ||
          t.status !== 'ROLLBACK_REQUESTED' || m.repo !== repo ||
          m.merge_sha !== t.rollback_commit || m.tree_sha !== a.candidate_tree_sha ||
          Number(a.epoch_id) !== Number(sys.epoch_id) ||
          !t.diff_patch || crypto.createHash('sha256').update(t.diff_patch).digest('hex') !== a.patch_sha256) {
        this.db.exec('ROLLBACK');
        return deny('ROLLBACK_VERIFIED_ORIGIN_REQUIRED');
      }
      const changedFiles = JSON.parse(a.changed_files_json || '[]');
      const allowedFiles = JSON.parse(t.allowed_files_json || '[]');
      if (!Array.isArray(changedFiles) || !Array.isArray(allowedFiles) || !changedFiles.length ||
          !changedFiles.every(x => typeof x === 'string' && allowedFiles.includes(x))) {
        this.db.exec('ROLLBACK'); return deny('ROLLBACK_FILE_SCOPE_UNSAFE');
      }
      const reservationId = crypto.randomUUID();
      const branch = 'rollback/' + ticketId;
      const now = Date.now();
      this.db.prepare(`INSERT INTO rollback_proposals
        (ticket_id, reservation_id, repo, original_merge_sha, baseline_commit,
         tested_merge_tree, epoch_id, branch, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PREPARING', ?, ?)`).run(
          ticketId, reservationId, repo, m.merge_sha, a.baseline_commit,
          m.tree_sha, sys.epoch_id, branch, now, now
        );
      this.appendAuditLog({
        actor: 'Rollback Gatekeeper', action: 'ROLLBACK_PREPARATION_RESERVED', ticketId,
        reasoning: 'Verified original merge reserved for Docker-tested inverse branch; no remote operation yet.',
        details: { repo, branch, originalMergeSha: m.merge_sha, baselineSha: a.baseline_commit }
      });
      this.db.exec('COMMIT');
      return { success: true, reservationId, mergedCommit: m.merge_sha,
        baselineCommit: a.baseline_commit, testedTree: m.tree_sha, branch,
        changedFiles, allowedFiles, epochId: Number(sys.epoch_id) };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public getRollbackProposal(ticketId: string): {
    reservationId: string; repo: string; originalMergeSha: string;
    baselineCommit: string; testedMergeTree: string; epochId: number;
    branch: string; headSha: string | null; revertedTree: string | null;
    prNumber: number | null; status: string;
  } | null {
    const r = this.db.prepare('SELECT * FROM rollback_proposals WHERE ticket_id=?')
      .get(ticketId) as any;
    return r ? {
      reservationId: r.reservation_id, repo: r.repo,
      originalMergeSha: r.original_merge_sha, baselineCommit: r.baseline_commit,
      testedMergeTree: r.tested_merge_tree, epochId: Number(r.epoch_id),
      branch: r.branch, headSha: r.revert_head_sha, revertedTree: r.revert_tree_sha,
      prNumber: r.pr_number == null ? null : Number(r.pr_number), status: r.status
    } : null;
  }

  public markRollbackUncertain(ticketId: string, reservationId: string): boolean {
    return this.db.prepare(`UPDATE rollback_proposals
      SET status='NEEDS_RECONCILIATION', updated_at=?
      WHERE ticket_id=? AND reservation_id=? AND status IN ('PREPARING','PR_CREATING')`)
      .run(Date.now(), ticketId, reservationId).changes === 1;
  }

  /**
   * An explicit admin recovery request acquires a distributed mutex in SQLite.
   * Recent PREPARING and PR_CREATING operations cannot be interrupted: the
   * original subprocess might still be mutating remote GitHub. Expired
   * operations remain fenced and must be verified remotely before retrying.
   */
  public reserveRollbackReconciliation(ticketId: string, repo: string):
    { success: true; recoveryToken: string; reservationId: string;
      originalMergeSha: string; baselineCommit: string; testedTree: string;
      branch: string; headSha: string | null; revertedTree: string | null;
      changedFiles: string[]; allowedFiles: string[]; epochId: number } |
    { success: false; error: string } {
    const deny = (error: string): { success: false; error: string } => ({ success: false, error });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = Date.now();
      const p = this.db.prepare('SELECT * FROM rollback_proposals WHERE ticket_id=?')
        .get(ticketId) as any;
      const t = this.db.prepare('SELECT * FROM tickets WHERE ticket_id=?')
        .get(ticketId) as any;
      const m = this.db.prepare('SELECT * FROM verified_git_merges WHERE ticket_id=?')
        .get(ticketId) as any;
      const a = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id=?')
        .get(ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id=1')
        .get() as any;
      const changedFiles = a ? JSON.parse(a.changed_files_json || '[]') : [];
      const allowedFiles = t ? JSON.parse(t.allowed_files_json || '[]') : [];
      if (!p || !t || !m || !a || !sys || sys.kill_switch_active ||
          t.status !== 'ROLLBACK_REQUESTED' || p.repo !== repo || m.repo !== repo ||
          t.rollback_commit !== m.merge_sha || p.original_merge_sha !== m.merge_sha ||
          p.baseline_commit !== a.baseline_commit || p.tested_merge_tree !== a.candidate_tree_sha ||
          Number(p.epoch_id) !== Number(sys.epoch_id) ||
          Number(a.epoch_id) !== Number(sys.epoch_id) ||
          !t.diff_patch ||
          crypto.createHash('sha256').update(t.diff_patch).digest('hex') !== a.patch_sha256 ||
          !Array.isArray(changedFiles) || !changedFiles.length ||
          !Array.isArray(allowedFiles) ||
          !changedFiles.every(x => typeof x === 'string' && allowedFiles.includes(x))) {
        this.db.exec('ROLLBACK'); return deny('ROLLBACK_RECOVERY_PROVENANCE_INVALID');
      }
      if (p.status === 'COMPLETED' || p.status === 'DRAFT_PR' || p.status === 'BRANCH_PUSHED') {
        this.db.exec('ROLLBACK'); return deny('ROLLBACK_RECOVERY_NOT_NEEDED');
      }
      const stale = now - Number(p.updated_at) >= 360000;
      if (!['PREPARING', 'PR_CREATING', 'NEEDS_RECONCILIATION'].includes(p.status)) {
        this.db.exec('ROLLBACK'); return deny('ROLLBACK_RECOVERY_STATE_INVALID');
      }
      if (p.status !== 'NEEDS_RECONCILIATION' && !stale) {
        this.db.exec('ROLLBACK'); return deny('ROLLBACK_RECOVERY_OPERATION_STILL_ACTIVE');
      }
      const lockStale = p.recovery_started_at != null &&
        now - Number(p.recovery_started_at) >= 360000;
      if (p.recovery_token && !lockStale) {
        this.db.exec('ROLLBACK'); return deny('ROLLBACK_RECOVERY_ALREADY_RUNNING');
      }
      if (p.recovery_token && p.status !== 'NEEDS_RECONCILIATION' && !stale) {
        this.db.exec('ROLLBACK'); return deny('ROLLBACK_RECOVERY_OPERATION_STILL_ACTIVE');
      }
      const recoveryToken = crypto.randomUUID();
      this.db.prepare(`UPDATE rollback_proposals
        SET status='NEEDS_RECONCILIATION', recovery_token=?, recovery_started_at=?,
            updated_at=?
        WHERE ticket_id=? AND reservation_id=?`)
        .run(recoveryToken, now, now, ticketId, p.reservation_id);
      this.db.exec('COMMIT');
      return {
        success: true, recoveryToken, reservationId: p.reservation_id,
        originalMergeSha: p.original_merge_sha, baselineCommit: p.baseline_commit,
        testedTree: p.tested_merge_tree, branch: p.branch,
        headSha: p.revert_head_sha, revertedTree: p.revert_tree_sha,
        changedFiles, allowedFiles, epochId: Number(sys.epoch_id)
      };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public failRollbackReconciliation(ticketId: string, reservationId: string,
    recoveryToken: string): boolean {
    return this.db.prepare(`UPDATE rollback_proposals
      SET recovery_token=NULL, recovery_started_at=NULL, updated_at=?
      WHERE ticket_id=? AND reservation_id=? AND recovery_token=?
      AND status='NEEDS_RECONCILIATION'`)
      .run(Date.now(), ticketId, reservationId, recoveryToken).changes === 1;
  }

  /**
   * Accept only read-only Git + actual Docker + read-only GitHub PR proof.
   * No state can be restored from an arbitrary user supplied SHA.
   */
  public finishRollbackReconciliation(input: {
    ticketId: string; reservationId: string; recoveryToken: string;
    repo: string; originalMergeSha: string; baselineCommit: string;
    testedTree: string; epochId: number;
    result: 'ABSENT' | 'BRANCH_PUSHED' | 'DRAFT_PR';
    branch: string; headSha?: string; revertedTree?: string;
    prNumber?: number;
  }): boolean {
    if (input.result !== 'ABSENT' && (
          !/^[0-9a-f]{40}$/.test(input.headSha || '') ||
          !/^[0-9a-f]{40}$/.test(input.revertedTree || ''))) return false;
    if (input.result === 'DRAFT_PR' && (
        !Number.isSafeInteger(input.prNumber) || (input.prNumber ?? 0) < 1)) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const p = this.db.prepare('SELECT * FROM rollback_proposals WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const t = this.db.prepare('SELECT * FROM tickets WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const m = this.db.prepare('SELECT * FROM verified_git_merges WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const a = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id=1')
        .get() as any;
      if (!p || !t || !m || !a || !sys || sys.kill_switch_active ||
          p.status !== 'NEEDS_RECONCILIATION' ||
          p.reservation_id !== input.reservationId ||
          p.recovery_token !== input.recoveryToken ||
          p.repo !== input.repo || p.branch !== input.branch ||
          p.original_merge_sha !== input.originalMergeSha ||
          p.baseline_commit !== input.baselineCommit ||
          p.tested_merge_tree !== input.testedTree ||
          m.merge_sha !== input.originalMergeSha || m.repo !== input.repo ||
          t.status !== 'ROLLBACK_REQUESTED' || t.rollback_commit !== input.originalMergeSha ||
          a.baseline_commit !== input.baselineCommit ||
          a.candidate_tree_sha !== input.testedTree ||
          Number(sys.epoch_id) !== input.epochId ||
          Number(p.epoch_id) !== input.epochId ||
          Number(a.epoch_id) !== input.epochId ||
          !t.diff_patch ||
          crypto.createHash('sha256').update(t.diff_patch).digest('hex') !== a.patch_sha256) {
        this.db.exec('ROLLBACK'); return false;
      }
      if (input.result === 'ABSENT' &&
          (p.revert_head_sha || p.revert_tree_sha || p.pr_number != null)) {
        this.db.exec('ROLLBACK'); return false;
      }
      if (input.result !== 'ABSENT' && (
          (p.revert_head_sha && p.revert_head_sha !== input.headSha) ||
          (p.revert_tree_sha && p.revert_tree_sha !== input.revertedTree) ||
          (p.pr_number != null && p.pr_number !== input.prNumber))) {
        this.db.exec('ROLLBACK'); return false;
      }
      if (input.result === 'ABSENT') {
        this.db.prepare(`DELETE FROM rollback_proposals
          WHERE ticket_id=? AND reservation_id=? AND recovery_token=?`)
          .run(input.ticketId, input.reservationId, input.recoveryToken);
      } else {
        this.db.prepare(`UPDATE rollback_proposals
          SET status=?, revert_head_sha=?, revert_tree_sha=?, pr_number=?,
              recovery_token=NULL, recovery_started_at=NULL, updated_at=?
          WHERE ticket_id=? AND reservation_id=?`).run(
            input.result, input.headSha!, input.revertedTree!,
            input.result === 'DRAFT_PR' ? input.prNumber! : null,
            Date.now(), input.ticketId, input.reservationId
          );
      }
      this.appendAuditLog({
        actor: 'Rollback Reconciliation', action: 'ROLLBACK_REMOTE_STATE_RECONCILED',
        ticketId: input.ticketId,
        reasoning: 'Read-only remote Git/GitHub inspection and Docker retest; no push, PR create or merge performed.',
        details: { result: input.result, repo: input.repo, branch: input.branch,
          headSha: input.headSha || null, prNumber: input.prNumber ?? null }
      });
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public recordRollbackPrepared(input: {
    ticketId: string; reservationId: string; repo: string; branch: string;
    originalMergeSha: string; baselineCommit: string; testedMergeTree: string;
    headSha: string; revertedTree: string; epochId: number;
  }): boolean {
    if (![input.originalMergeSha, input.baselineCommit, input.testedMergeTree,
          input.headSha, input.revertedTree].every(x => /^[0-9a-f]{40}$/.test(x))) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = this.db.prepare('SELECT * FROM rollback_proposals WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const t = this.db.prepare('SELECT status FROM tickets WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id=1')
        .get() as any;
      if (!r || !t || !sys || sys.kill_switch_active ||
          r.status !== 'PREPARING' || t.status !== 'ROLLBACK_REQUESTED' ||
          r.reservation_id !== input.reservationId || r.repo !== input.repo ||
          r.branch !== input.branch || r.original_merge_sha !== input.originalMergeSha ||
          r.baseline_commit !== input.baselineCommit || r.tested_merge_tree !== input.testedMergeTree ||
          Number(r.epoch_id) !== input.epochId || Number(sys.epoch_id) !== input.epochId) {
        this.db.exec('ROLLBACK'); return false;
      }
      this.db.prepare(`UPDATE rollback_proposals
        SET status='BRANCH_PUSHED', revert_head_sha=?, revert_tree_sha=?, updated_at=?
        WHERE ticket_id=? AND reservation_id=?`).run(
          input.headSha, input.revertedTree, Date.now(), input.ticketId, input.reservationId
        );
      this.appendAuditLog({
        actor: 'Rollback Gatekeeper', action: 'ROLLBACK_BRANCH_PUSH_CONFIRMED', ticketId: input.ticketId,
        reasoning: 'Docker-tested reverse Git tree pushed to a new rollback branch; no PR merge occurred.',
        details: { repo: input.repo, branch: input.branch, headSha: input.headSha, revertedTree: input.revertedTree }
      });
      this.db.exec('COMMIT'); return true;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public reserveRollbackDraftPr(ticketId: string, reservationId: string): boolean {
    const r = this.db.prepare(`UPDATE rollback_proposals
      SET status='PR_CREATING', updated_at=? WHERE ticket_id=?
      AND reservation_id=? AND status='BRANCH_PUSHED'
      AND EXISTS(SELECT 1 FROM tickets WHERE ticket_id=? AND status='ROLLBACK_REQUESTED')
      AND epoch_id=(SELECT epoch_id FROM system_state WHERE id=1)
      AND (SELECT kill_switch_active FROM system_state WHERE id=1)=0`)
      .run(Date.now(), ticketId, reservationId, ticketId);
    return r.changes === 1;
  }

  public recordRollbackDraftPr(ticketId: string, reservationId: string,
    repo: string, prNumber: number, branch: string, headSha: string, revertedTree: string): boolean {
    if (!Number.isSafeInteger(prNumber) || prNumber < 1 ||
        ![headSha, revertedTree].every(x => /^[0-9a-f]{40}$/.test(x))) return false;
    const row = this.db.prepare(`UPDATE rollback_proposals
      SET status='DRAFT_PR', pr_number=?, updated_at=?
      WHERE ticket_id=? AND reservation_id=? AND status='PR_CREATING'
      AND repo=? AND branch=? AND revert_head_sha=? AND revert_tree_sha=?
      AND epoch_id=(SELECT epoch_id FROM system_state WHERE id=1)
      AND (SELECT kill_switch_active FROM system_state WHERE id=1)=0`)
      .run(prNumber, Date.now(), ticketId, reservationId,
        repo, branch, headSha, revertedTree);
    if (row.changes !== 1) return false;
    this.appendAuditLog({
      actor: 'Rollback Gatekeeper', action: 'ROLLBACK_DRAFT_PR_RECORDED', ticketId,
      reasoning: 'GitHub draft PR opened for independent human review. No merge or rollback completion claimed.',
      details: { repo, branch, prNumber, headSha, revertedTree }
    });
    return true;
  }

  public recordVerifiedGitRollback(input: {
    ticketId: string; repo: string; prNumber: number; branch: string;
    headSha: string; originalMergeSha: string; revertedTree: string;
    rollbackMergeSha: string; epochId: number;
  }): boolean {
    if (![input.headSha, input.originalMergeSha, input.revertedTree, input.rollbackMergeSha]
      .every(x => /^[0-9a-f]{40}$/.test(x)) ||
      !Number.isSafeInteger(input.prNumber) || input.prNumber < 1) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const p = this.db.prepare('SELECT * FROM rollback_proposals WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const t = this.db.prepare('SELECT status, rollback_commit FROM tickets WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const m = this.db.prepare('SELECT * FROM verified_git_merges WHERE ticket_id=?')
        .get(input.ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id=1')
        .get() as any;
      if (!p || !t || !m || !sys || sys.kill_switch_active ||
          p.status !== 'DRAFT_PR' || t.status !== 'ROLLBACK_REQUESTED' ||
          t.rollback_commit !== input.originalMergeSha ||
          m.repo !== input.repo || m.merge_sha !== input.originalMergeSha ||
          p.repo !== input.repo || p.pr_number !== input.prNumber ||
          p.branch !== input.branch || p.revert_head_sha !== input.headSha ||
          p.revert_tree_sha !== input.revertedTree ||
          p.original_merge_sha !== input.originalMergeSha ||
          Number(p.epoch_id) !== input.epochId ||
          Number(sys.epoch_id) !== input.epochId) {
        this.db.exec('ROLLBACK'); return false;
      }
      const now = Date.now();
      this.db.prepare(`UPDATE rollback_proposals SET status='COMPLETED', updated_at=?
        WHERE ticket_id=?`).run(now, input.ticketId);
      this.db.prepare(`INSERT INTO verified_git_rollbacks
        (ticket_id,repo,pr_number,branch,rollback_head_sha,original_merge_sha,
         reverted_tree_sha,rollback_merge_sha,verified_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          input.ticketId, input.repo, input.prNumber, input.branch,
          input.headSha, input.originalMergeSha, input.revertedTree,
          input.rollbackMergeSha, now
        );
      this.db.prepare(`UPDATE tickets SET status='ROLLBACK_COMPLETED',
        rollback_commit=?, updated_at=? WHERE ticket_id=?`).run(
          input.rollbackMergeSha, now, input.ticketId
        );
      this.appendAuditLog({
        actor: 'Rollback GitHub Verifier', action: 'REMOTE_ROLLBACK_VERIFIED',
        ticketId: input.ticketId,
        reasoning: 'GitHub approved PR merged and exact restored tree verified against original baseline; no simulated completion.',
        details: { repo: input.repo, prNumber: input.prNumber,
          headSha: input.headSha, rollbackMergeSha: input.rollbackMergeSha,
          restoredTree: input.revertedTree }
      });
      this.db.exec('COMMIT'); return true;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  // Rollback is a request until an independently verified Git revert has merged.
  // Never treat hotfix creation or a database write as proof that code was reverted.
  public rollbackMerge(ticketId: string, reason: string, actor: string = 'Master'): { success: boolean; hotfixId?: string } {
    const row = this.db.prepare('SELECT status FROM tickets WHERE ticket_id = ?').get(ticketId) as { status: string } | undefined;
    if (!row || (row.status !== 'COMMITTED_PUSHED' && row.status !== 'ROLLBACK_REQUESTED')) {
      return { success: false };
    }

    this.db.prepare(`
      UPDATE tickets SET status = 'ROLLBACK_REQUESTED', updated_at = ?
      WHERE ticket_id = ?
    `).run(Date.now(), ticketId);

    this.appendAuditLog({
      actor,
      action: 'ROLLBACK_REQUESTED',
      ticketId,
      reasoning: `Rollback requested: ${reason}. No Git revert has been executed or merged.`
    });

    return { success: true };
  }

  // Heartbeat & Watchdog Sweeper
  public recordLeaseHeartbeat(ticketId: string, workerId: string, progressPct: number, currentStep: string): boolean {
    const now = Date.now();
    const lease = this.db.prepare('SELECT * FROM worker_leases WHERE ticket_id = ?').get(ticketId) as any;
    if (!lease || lease.worker_id !== workerId || lease.is_revoked) {
      return false;
    }

    this.db.prepare(`
      UPDATE worker_leases
      SET last_heartbeat_at = ?, missed_heartbeats = 0, progress_pct = ?, last_step = ?
      WHERE ticket_id = ?
    `).run(now, progressPct, currentStep, ticketId);

    // Also update worker last_seen
    this.db.prepare('UPDATE workers SET last_seen = ? WHERE worker_id = ?').run(now, workerId);

    return true;
  }

  public sweepWatchdog(): { expiredTickets: string[]; revokedWorkers: string[] } {
    const now = Date.now();
    const leases = this.db.prepare('SELECT * FROM worker_leases WHERE is_revoked = 0').all() as any[];
    const expiredTickets: string[] = [];
    const revokedWorkers: string[] = [];

    for (const lease of leases) {
      const timeSinceHb = (now - lease.last_heartbeat_at) / 1000;
      const missed = Math.floor(timeSinceHb / 30);
      const isExpired = now >= lease.expires_at || missed >= lease.max_missed_heartbeats;

      if (isExpired) {
        // Revoke lease
        this.db.prepare('UPDATE worker_leases SET is_revoked = 1 WHERE ticket_id = ?').run(lease.ticket_id);
        // A Docker-tested ticket awaiting human GitHub review must NOT be
        // recycled to PENDING after the worker's short execution lease expires.
        // The worker lease is revoked, but immutable review provenance remains.
        const ticketRow = this.db.prepare('SELECT status, logs_json FROM tickets WHERE ticket_id = ?')
          .get(lease.ticket_id) as any;
        const preserveReview = ['READY_FOR_REVIEW', 'COMMITTED_PUSHED', 'ROLLBACK_REQUESTED']
          .includes(ticketRow?.status);
        let logs = ticketRow?.logs_json ? JSON.parse(ticketRow.logs_json) : [];
        logs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: 'WARN',
          message: preserveReview
            ? '[WATCHDOG] Execution lease expired; review evidence preserved. Administrator merge-verification grant required.'
            : `[WATCHDOG AUTO-RECOVERY] Worker ${lease.worker_id} went unresponsive (>90s silence). Lease auto-revoked and recycled.`
        });
        if (preserveReview) {
          this.db.prepare('UPDATE tickets SET logs_json=?, updated_at=? WHERE ticket_id=?')
            .run(JSON.stringify(logs), now, lease.ticket_id);
        } else {
          this.db.prepare(`UPDATE tickets SET status='PENDING', assigned_to=NULL,
            logs_json=?, updated_at=? WHERE ticket_id=?`)
            .run(JSON.stringify(logs), now, lease.ticket_id);
        }

        // Mark worker offline
        this.db.prepare(`
          UPDATE workers SET status = 'OFFLINE', current_ticket_id = NULL WHERE worker_id = ?
        `).run(lease.worker_id);

        expiredTickets.push(lease.ticket_id);
        revokedWorkers.push(lease.worker_id);

        this.appendAuditLog({
          actor: 'Sutradhar Watchdog',
          action: 'WATCHDOG_LEASE_AUTO_REVOKED',
          ticketId: lease.ticket_id,
          reasoning: `Worker ${lease.worker_id} missed ${missed} heartbeats (>90s). Lease recycled to prevent stalled DAG.`,
          details: { workerId: lease.worker_id, missedHeartbeats: missed }
        });
      } else if (missed > lease.missed_heartbeats) {
        this.db.prepare('UPDATE worker_leases SET missed_heartbeats = ? WHERE ticket_id = ?').run(missed, lease.ticket_id);
      }
    }

    return { expiredTickets, revokedWorkers };
  }

  // Audit Logging
  public appendAuditLog(entry: {
    actor: string;
    action: string;
    ticketId?: string;
    reasoning: string;
    details?: Record<string, any>;
  }): void {
    const logId = `LOG-${crypto.randomUUID()}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO audit_log (log_id, timestamp, actor, action, ticket_id, reasoning, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      now,
      entry.actor,
      entry.action,
      entry.ticketId || null,
      entry.reasoning,
      entry.details ? JSON.stringify(entry.details) : null
    );
  }

  public getAuditLogs(limit: number = 50): AuditLogEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
    return rows.map(r => ({
      logId: r.log_id,
      timestamp: Number(r.timestamp),
      actor: r.actor,
      action: r.action,
      ticketId: r.ticket_id || undefined,
      reasoning: r.reasoning,
      details: r.details_json ? JSON.parse(r.details_json) : {}
    }));
  }

  // Model Usage Accounting
  public recordModelUsage(usage: {
    ticketId?: string;
    workerId?: string;
    provider: string;
    model: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs: number;
    success: boolean;
  }): void {
    this.db.prepare(`
      INSERT INTO model_usage (
        timestamp, ticket_id, worker_id, provider, model, tokens_in, tokens_out, latency_ms, success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      usage.ticketId || null,
      usage.workerId || null,
      usage.provider,
      usage.model,
      usage.tokensIn || 0,
      usage.tokensOut || 0,
      usage.latencyMs,
      usage.success ? 1 : 0
    );
  }

  // Export full snapshot for dashboard consumption
  public getAllTickets(): Ticket[] {
    const rows = this.db.prepare('SELECT * FROM tickets ORDER BY updated_at DESC').all() as any[];
    return rows.map(r => {
      // Find parent ticket IDs
      const deps = this.db.prepare('SELECT parent_ticket_id FROM ticket_dependencies WHERE child_ticket_id = ?').all(r.ticket_id) as any[];
      return {
        id: r.ticket_id,
        title: r.title,
        description: r.description || '',
        priority: r.priority,
        domain: r.domain,
        status: r.status,
        assignedTo: r.assigned_to || undefined,
        parentTicketIds: deps.map(d => d.parent_ticket_id),
        allowedFiles: JSON.parse(r.allowed_files_json || '[]'),
        readOnlyContracts: JSON.parse(r.read_only_contracts_json || '[]'),
        retryCount: Number(r.retry_count || 0),
        maxRetries: Number(r.max_retries || 3),
        currentTier: r.current_tier as (1 | 2 | 3),
        diffPatch: r.diff_patch || undefined,
        testStdout: r.test_stdout || undefined,
        testStderr: r.test_stderr || undefined,
        rollbackCommit: r.rollback_commit || undefined,
        llmUsed: r.llm_used || undefined,
        branch: r.branch || `ai/${r.ticket_id}`,
        ed25519Token: r.ed25519_token || undefined,
        tokenExpiresAt: r.token_expires_at || undefined,
        clarificationQuestion: r.clarification_question_json ? JSON.parse(r.clarification_question_json) : undefined,
        createdAt: new Date(Number(r.created_at)).toISOString(),
        updatedAt: new Date(Number(r.updated_at)).toISOString(),
        logs: r.logs_json ? JSON.parse(r.logs_json) : [],
      };
    });
  }

  public getAllWorkers(): SwarmNode[] {
    const rows = this.db.prepare('SELECT * FROM workers').all() as any[];
    return rows.map(r => ({
      id: r.worker_id,
      name: r.name,
      role: r.role,
      domain: r.domain || 'Worker',
      status: r.status,
      macAddress: r.mac_address || '02:42:ac:11:00:00',
      gitAuthor: r.git_author || `${r.name} <${r.worker_id.toLowerCase()}@cluster.internal>`,
      uptimeSeconds: Number(r.uptime_seconds || 0),
      currentTicketId: r.current_ticket_id || undefined,
      isHybridLocal: Boolean(r.is_hybrid_local),
      health: r.health_json ? JSON.parse(r.health_json) : {
        dns: { ok: true, rttMs: 40 },
        gitSsh: { ok: true, headSha: 'c8f92a1d' },
        docker: { ok: true, status: 'Healthy' },
        memory: { ok: true, freeMb: 1024 },
        llm: { ok: true, provider: 'Google AI Studio' }
      },
      quotaUsage: r.quota_json ? JSON.parse(r.quota_json) : undefined
    }));
  }

  public getAllLeases(): WatchdogLease[] {
    const rows = this.db.prepare('SELECT * FROM worker_leases WHERE is_revoked = 0').all() as any[];
    return rows.map(r => ({
      ticketId: r.ticket_id,
      workerId: r.worker_id,
      leasedAt: Number(r.leased_at),
      expiresAt: Number(r.expires_at),
      lastHeartbeatAt: Number(r.last_heartbeat_at),
      missedHeartbeats: Number(r.missed_heartbeats),
      maxMissedHeartbeats: Number(r.max_missed_heartbeats),
      progressPct: Number(r.progress_pct),
      lastStep: r.last_step || 'Working',
      isRevoked: Boolean(r.is_revoked)
    }));
  }

  public revokeLease(ticketId: string, reason: string = 'Manual revocation'): boolean {
    const now = Date.now();
    const lease = this.db.prepare('SELECT * FROM worker_leases WHERE ticket_id = ?').get(ticketId) as any;
    if (!lease) return false;

    this.db.prepare('UPDATE worker_leases SET is_revoked = 1 WHERE ticket_id = ?').run(ticketId);
    if (lease.token_id) this.revokeToken(lease.token_id, reason);

    const ticketRow = this.db.prepare('SELECT status, logs_json FROM tickets WHERE ticket_id = ?').get(ticketId) as any;
    let logs = ticketRow?.logs_json ? JSON.parse(ticketRow.logs_json) : [];
    logs.push({
      timestamp: new Date().toLocaleTimeString(),
      level: 'WARN',
      message: ['COMMITTED_PUSHED', 'ROLLBACK_REQUESTED', 'ROLLBACK_COMPLETED'].includes(ticketRow?.status)
        ? `[WATCHDOG REVOCATION] Lease revoked: ${reason}. Final merge/rollback status preserved.`
        : `[WATCHDOG REVOCATION] Lease revoked: ${reason}. Ticket reset to PENDING.`
    });

    if (['COMMITTED_PUSHED', 'ROLLBACK_REQUESTED', 'ROLLBACK_COMPLETED'].includes(ticketRow?.status)) {
      this.db.prepare('UPDATE tickets SET logs_json=?, updated_at=? WHERE ticket_id=?')
        .run(JSON.stringify(logs), now, ticketId);
    } else {
      this.db.prepare(`UPDATE tickets
        SET status='PENDING', assigned_to=NULL, logs_json=?, updated_at=? WHERE ticket_id=?`)
        .run(JSON.stringify(logs), now, ticketId);
    }

    this.appendAuditLog({
      actor: 'Sutradhar Watchdog',
      action: 'WATCHDOG_LEASE_REVOKED',
      ticketId,
      reasoning: reason,
      details: { workerId: lease.worker_id }
    });

    return true;
  }

  public createTicket(ticket: Ticket, projectId: string = 'PRJ-MATRIMONY-01'): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO tickets (
        ticket_id, project_id, title, description, priority, domain, status,
        assigned_to, retry_count, max_retries, current_tier, branch, ed25519_token,
        token_expires_at, diff_patch, test_stdout, test_stderr, rollback_commit,
        llm_used, allowed_files_json, read_only_contracts_json, logs_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticket.id,
      projectId,
      ticket.title,
      ticket.description || '',
      ticket.priority || 'P2_NORMAL',
      ticket.domain || 'Core',
      ticket.status || 'PENDING',
      ticket.assignedTo || null,
      ticket.retryCount || 0,
      ticket.maxRetries || 3,
      ticket.currentTier || 1,
      ticket.branch || `ai/${ticket.id}`,
      ticket.ed25519Token || null,
      ticket.tokenExpiresAt || null,
      ticket.diffPatch || null,
      ticket.testStdout || null,
      ticket.testStderr || null,
      ticket.rollbackCommit || null,
      ticket.llmUsed || null,
      JSON.stringify(ticket.allowedFiles || []),
      JSON.stringify(ticket.readOnlyContracts || []),
      JSON.stringify(ticket.logs || []),
      now,
      now
    );

    if (ticket.parentTicketIds && ticket.parentTicketIds.length > 0) {
      for (const pid of ticket.parentTicketIds) {
        this.db.prepare(`
          INSERT OR IGNORE INTO ticket_dependencies (parent_ticket_id, child_ticket_id)
          VALUES (?, ?)
        `).run(pid, ticket.id);
      }
    }

    this.appendAuditLog({
      actor: ticket.assignedTo || 'Master',
      action: 'TICKET_CREATED',
      ticketId: ticket.id,
      reasoning: `Ticket ${ticket.id} (${ticket.title}) created and inserted into DAG state.`,
      details: { priority: ticket.priority, domain: ticket.domain, allowedFiles: ticket.allowedFiles }
    });
  }

  public getAllProjects(): ProjectInfo[] {
    const rows = this.db.prepare('SELECT * FROM projects').all() as any[];
    if (rows.length === 0) {
      return [{
        id: 'PRJ-MATRIMONY-01',
        name: 'Matrimony Matchmaking & Bio Sanitizer Engine',
        gitRepoUrl: 'git@github.com:sutradhar-corp/matrimony-engine.git',
        priority: 'P0_CRITICAL',
        status: 'ACTIVE',
        createdAt: '2026-08-30T10:00:00Z',
        configHash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069'
      }];
    }
    return rows.map(r => ({
      id: r.project_id,
      name: r.name,
      gitRepoUrl: r.git_repo_url,
      priority: r.priority,
      status: r.status,
      createdAt: new Date(Number(r.created_at)).toISOString(),
      configHash: r.config_hash || ''
    }));
  }

  public getAllConfigurations(): Record<string, any> {
    const rows = this.db.prepare('SELECT * FROM configuration').all() as any[];
    const result: Record<string, any> = {
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
    };
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value_json);
      } catch (e) {
        result[r.key] = r.value_json;
      }
    }
    return result;
  }

  public setConfiguration(key: string, value: any): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO configuration (key, value_json, updated_at)
      VALUES (?, ?, ?)
    `).run(key, JSON.stringify(value), now);
  }

  public recordExecutionAttempt(attempt: {
    attemptId?: string;
    ticketId: string;
    workerId: string;
    attemptNumber: number;
    tierUsed: number;
    patchValid: boolean;
    sandboxExitCode: number;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
  }): void {
    const id = attempt.attemptId || `ATT-${crypto.randomUUID()}`;
    this.db.prepare(`
      INSERT INTO execution_attempts (
        attempt_id, ticket_id, worker_id, attempt_number, tier_used, patch_valid,
        sandbox_exit_code, stdout, stderr, duration_ms, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      attempt.ticketId,
      attempt.workerId,
      attempt.attemptNumber,
      attempt.tierUsed,
      attempt.patchValid ? 1 : 0,
      attempt.sandboxExitCode,
      attempt.stdout || null,
      attempt.stderr || null,
      attempt.durationMs || 1500,
      Date.now()
    );
  }

  /**
   * A successful Docker run is not a merge. Store its immutable tree identity
   * while atomically transitioning the matching persisted candidate to review.
   */
  public recordVerifiedSandboxPass(input: {
    ticketId: string;
    patchSha256: string;
    baselineCommit: string;
    candidateTreeSha: string;
    changedFiles: string[];
    epochId: number;
    workerId: string;
    stdout: string;
    stderr: string;
  }): boolean {
    const sha1 = /^[0-9a-f]{40}$/;
    const sha256 = /^[0-9a-f]{64}$/;
    if (!sha1.test(input.baselineCommit) || !sha1.test(input.candidateTreeSha) ||
        !sha256.test(input.patchSha256) || !input.changedFiles.length) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const ticket = this.db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(input.ticketId) as any;
      const system = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id = 1').get() as any;
      if (!ticket || !system || system.kill_switch_active ||
          !['TESTING_SANDBOX', 'HEALING_RETRY'].includes(ticket.status) ||
          Number(system.epoch_id) !== input.epochId ||
          !ticket.diff_patch ||
          crypto.createHash('sha256').update(ticket.diff_patch).digest('hex') !== input.patchSha256 ||
          (ticket.assigned_to && ticket.assigned_to !== input.workerId)) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const allowed = JSON.parse(ticket.allowed_files_json || '[]') as string[];
      if (!input.changedFiles.every(file => allowed.includes(file))) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const now = Date.now();
      const logs = JSON.parse(ticket.logs_json || '[]') as any[];
      logs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: 'SUCCESS',
        message: `Real Docker test passed for tree ${input.candidateTreeSha.slice(0, 12)}. Git merge not yet verified.`
      });
      this.db.prepare(`UPDATE tickets
        SET status = 'READY_FOR_REVIEW', test_stdout = ?, test_stderr = ?, logs_json = ?, updated_at = ?
        WHERE ticket_id = ?`).run(input.stdout, input.stderr, JSON.stringify(logs), now, input.ticketId);
      this.db.prepare(`INSERT INTO sandbox_attestations
        (ticket_id, patch_sha256, baseline_commit, candidate_tree_sha, changed_files_json, worker_id, epoch_id, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticket_id) DO UPDATE SET
          patch_sha256=excluded.patch_sha256, baseline_commit=excluded.baseline_commit,
          candidate_tree_sha=excluded.candidate_tree_sha, changed_files_json=excluded.changed_files_json,
          worker_id=excluded.worker_id, epoch_id=excluded.epoch_id, verified_at=excluded.verified_at
      `).run(input.ticketId, input.patchSha256, input.baselineCommit,
        input.candidateTreeSha, JSON.stringify(input.changedFiles), input.workerId, input.epochId, now);
      this.appendAuditLog({
        actor: input.workerId, action: 'SANDBOX_TREE_ATTESTED', ticketId: input.ticketId,
        reasoning: 'Real Docker exit 0; candidate tree persisted for independent remote Git verification.',
        details: { baselineCommit: input.baselineCommit, candidateTreeSha: input.candidateTreeSha,
          patchSha256: input.patchSha256, changedFiles: input.changedFiles, epochId: input.epochId }
      });
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public getSandboxAttestation(ticketId: string): {
    patchSha256: string; baselineCommit: string; candidateTreeSha: string;
    changedFiles: string[]; workerId: string; epochId: number; verifiedAt: number;
  } | null {
    const r = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id = ?').get(ticketId) as any;
    return r ? {
      patchSha256: r.patch_sha256, baselineCommit: r.baseline_commit,
      candidateTreeSha: r.candidate_tree_sha, changedFiles: JSON.parse(r.changed_files_json),
      workerId: r.worker_id, epochId: Number(r.epoch_id), verifiedAt: Number(r.verified_at)
    } : null;
  }

  /**
   * Cross-process SQLite reservation. A timed-out RUNNING job is NEVER retried
   * automatically: the remote push may have succeeded just before a crash.
   */
  public reserveWorkerPushJob(input: {
    ticketId: string; repo: string; branch: string;
    treeSha: string; baselineCommit: string; patchSha256: string;
    workerId: string; tokenId: string; epochId: number;
  }): { success: true; reservationId: string } | { success: false; error: string } {
    const fail = (error: string): { success: false; error: string } => ({ success: false, error });
    if (!/^[0-9a-f]{40}$/.test(input.treeSha) ||
        !/^[0-9a-f]{40}$/.test(input.baselineCommit) ||
        !/^[0-9a-f]{64}$/.test(input.patchSha256) ||
        !input.tokenId || !input.workerId) return fail('WORKER_PUSH_RESERVATION_INVALID');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = Date.now();
      const t = this.db.prepare('SELECT status, branch, assigned_to, diff_patch FROM tickets WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const a = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const l = this.db.prepare('SELECT * FROM worker_leases WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id = 1')
        .get() as any;
      const receipt = this.db.prepare('SELECT ticket_id FROM verified_worker_pushes WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      if (receipt || !t || !a || !l || !sys || sys.kill_switch_active ||
          t.status !== 'READY_FOR_REVIEW' || t.branch !== input.branch ||
          t.assigned_to !== input.workerId || !t.diff_patch ||
          crypto.createHash('sha256').update(t.diff_patch).digest('hex') !== input.patchSha256 ||
          a.patch_sha256 !== input.patchSha256 || a.baseline_commit !== input.baselineCommit ||
          a.candidate_tree_sha !== input.treeSha || a.worker_id !== input.workerId ||
          Number(a.epoch_id) !== input.epochId || Number(sys.epoch_id) !== input.epochId ||
          l.worker_id !== input.workerId || l.token_id !== input.tokenId ||
          Number(l.epoch_id) !== input.epochId || l.is_revoked ||
          Number(l.expires_at) <= now || this.isTokenRevoked(input.tokenId)) {
        this.db.exec('ROLLBACK');
        return fail('WORKER_PUSH_RESERVATION_PRECONDITION_FAILED');
      }
      const prev = this.db.prepare('SELECT * FROM worker_push_jobs WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      if (prev) {
        const same = prev.repo === input.repo && prev.branch === input.branch &&
          prev.baseline_commit === input.baselineCommit &&
          prev.candidate_tree_sha === input.treeSha &&
          prev.patch_sha256 === input.patchSha256 && prev.worker_id === input.workerId &&
          prev.token_id === input.tokenId && Number(prev.epoch_id) === input.epochId;
        if (!same) {
          this.db.exec('ROLLBACK');
          return fail('WORKER_PUSH_RESERVATION_MISMATCH');
        }
        if (prev.state === 'RUNNING' && Number(prev.expires_at) <= now) {
          this.db.prepare(`UPDATE worker_push_jobs SET state='NEEDS_RECONCILIATION',
            last_error='RESERVATION_EXPIRED', updated_at=? WHERE ticket_id=?`)
            .run(now, input.ticketId);
          this.db.exec('COMMIT');
          return fail('WORKER_PUSH_RECOVERY_REQUIRED');
        }
        this.db.exec('ROLLBACK');
        return fail(prev.state === 'RUNNING' ? 'WORKER_PUSH_RESERVED' :
          prev.state === 'CONFIRMED' ? 'WORKER_PUSH_ALREADY_CONFIRMED' :
          'WORKER_PUSH_RECOVERY_REQUIRED');
      }
      const reservationId = crypto.randomUUID();
      // 5-minute window, longer than the 180s push process timeout.
      this.db.prepare(`INSERT INTO worker_push_jobs
        (ticket_id, reservation_id, repo, branch, baseline_commit, candidate_tree_sha,
         patch_sha256, worker_id, token_id, epoch_id, state, started_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?)`).run(
          input.ticketId, reservationId, input.repo, input.branch, input.baselineCommit,
          input.treeSha, input.patchSha256, input.workerId, input.tokenId,
          input.epochId, now, now, now + 300000
        );
      this.db.exec('COMMIT');
      return { success: true, reservationId };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public getWorkerPushJob(ticketId: string): {
    reservationId: string; repo: string; branch: string; baselineCommit: string;
    treeSha: string; patchSha256: string; workerId: string; tokenId: string;
    epochId: number; state: string; expiresAt: number; lastError: string | null;
  } | null {
    const r = this.db.prepare('SELECT * FROM worker_push_jobs WHERE ticket_id = ?')
      .get(ticketId) as any;
    return r ? {
      reservationId: r.reservation_id, repo: r.repo, branch: r.branch,
      baselineCommit: r.baseline_commit, treeSha: r.candidate_tree_sha,
      patchSha256: r.patch_sha256, workerId: r.worker_id, tokenId: r.token_id,
      epochId: Number(r.epoch_id), state: r.state, expiresAt: Number(r.expires_at),
      lastError: r.last_error
    } : null;
  }

  public markWorkerPushUncertain(ticketId: string, reservationId: string, reason: string): boolean {
    const allowed = /^[A-Z_]{3,64}$/.test(reason) ? reason : 'REMOTE_RESULT_UNCERTAIN';
    const r = this.db.prepare(`UPDATE worker_push_jobs
      SET state='NEEDS_RECONCILIATION', last_error=?, updated_at=?
      WHERE ticket_id=? AND reservation_id=? AND state='RUNNING'`)
      .run(allowed, Date.now(), ticketId, reservationId);
    return r.changes === 1;
  }

  public expireWorkerPushJob(ticketId: string): boolean {
    const now = Date.now();
    const r = this.db.prepare(`UPDATE worker_push_jobs
      SET state='NEEDS_RECONCILIATION', last_error='RESERVATION_EXPIRED', updated_at=?
      WHERE ticket_id=? AND state='RUNNING' AND expires_at<=?`)
      .run(now, ticketId, now);
    return r.changes === 1;
  }

  /**
   * Explicit administrator reconciliation after a read-only remote inspection
   * proves the branch is absent AND remote main is still the tested baseline.
   * No implicit retry or automatic push.
   */
  public clearWorkerPushAfterVerifiedAbsence(ticketId: string, reservationId: string): boolean {
    const r = this.db.prepare(`DELETE FROM worker_push_jobs
      WHERE ticket_id=? AND reservation_id=? AND state='NEEDS_RECONCILIATION'
      AND NOT EXISTS(SELECT 1 FROM verified_worker_pushes WHERE ticket_id=?)`)
      .run(ticketId, reservationId, ticketId);
    return r.changes === 1;
  }

  /** Durable receipt for an independently verified worker-branch push. */
  public recordVerifiedWorkerPush(input: {
    ticketId: string; repo: string; branch: string; headSha: string;
    treeSha: string; baselineCommit: string; patchSha256: string;
    workerId: string; epochId: number; tokenId: string; reservationId: string;
  }): boolean {
    if (![input.headSha, input.treeSha, input.baselineCommit].every(x => /^[a-f0-9]{40}$/.test(x)) ||
        !/^[a-f0-9]{64}$/.test(input.patchSha256)) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const t = this.db.prepare('SELECT status, branch, assigned_to, diff_patch FROM tickets WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const a = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const lease = this.db.prepare('SELECT * FROM worker_leases WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id = 1')
        .get() as any;
      if (!t || !a || !lease || !sys || sys.kill_switch_active ||
          t.status !== 'READY_FOR_REVIEW' || t.branch !== input.branch ||
          t.assigned_to !== input.workerId ||
          a.baseline_commit !== input.baselineCommit ||
          a.candidate_tree_sha !== input.treeSha ||
          a.patch_sha256 !== input.patchSha256 ||
          a.worker_id !== input.workerId || Number(a.epoch_id) !== input.epochId ||
          Number(sys.epoch_id) !== input.epochId ||
          Number(lease.epoch_id) !== input.epochId ||
          lease.worker_id !== input.workerId || lease.token_id !== input.tokenId ||
          lease.is_revoked || Number(lease.expires_at) <= Date.now() ||
          this.isTokenRevoked(input.tokenId) ||
          !t.diff_patch ||
          crypto.createHash('sha256').update(t.diff_patch).digest('hex') !== input.patchSha256) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const job = this.db.prepare('SELECT * FROM worker_push_jobs WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      if (!job || job.reservation_id !== input.reservationId ||
          job.repo !== input.repo || job.branch !== input.branch ||
          job.baseline_commit !== input.baselineCommit ||
          job.candidate_tree_sha !== input.treeSha ||
          job.patch_sha256 !== input.patchSha256 ||
          job.worker_id !== input.workerId || job.token_id !== input.tokenId ||
          Number(job.epoch_id) !== input.epochId ||
          !['RUNNING', 'NEEDS_RECONCILIATION', 'CONFIRMED'].includes(job.state)) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const previous = this.db.prepare('SELECT * FROM verified_worker_pushes WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      if (previous) {
        const same = previous.repo === input.repo && previous.branch === input.branch &&
          previous.head_sha === input.headSha && previous.tree_sha === input.treeSha &&
          previous.baseline_commit === input.baselineCommit &&
          previous.patch_sha256 === input.patchSha256 &&
          previous.worker_id === input.workerId && Number(previous.epoch_id) === input.epochId;
        this.db.exec('COMMIT');
        return same;
      }
      this.db.prepare(`INSERT INTO verified_worker_pushes
        (ticket_id, repo, branch, head_sha, tree_sha, baseline_commit,
         patch_sha256, worker_id, epoch_id, pushed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.ticketId, input.repo, input.branch, input.headSha,
        input.treeSha, input.baselineCommit, input.patchSha256,
        input.workerId, input.epochId, Date.now()
      );
      this.db.prepare(`UPDATE worker_push_jobs SET state='CONFIRMED',
        last_error=NULL, updated_at=? WHERE ticket_id=? AND reservation_id=?`)
        .run(Date.now(), input.ticketId, input.reservationId);
      this.appendAuditLog({
        actor: input.workerId, action: 'WORKER_BRANCH_PUSH_VERIFIED',
        ticketId: input.ticketId,
        reasoning: 'Scoped worker branch remotely confirmed. No PR created or merge performed.',
        details: { repo: input.repo, branch: input.branch,
          headSha: input.headSha, treeSha: input.treeSha }
      });
      this.db.exec('COMMIT');
      return true;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }

  public getVerifiedWorkerPush(ticketId: string): {
    repo: string; branch: string; headSha: string; treeSha: string;
    baselineCommit: string; patchSha256: string; workerId: string; epochId: number;
  } | null {
    const row = this.db.prepare('SELECT * FROM verified_worker_pushes WHERE ticket_id = ?')
      .get(ticketId) as any;
    return row ? {
      repo: row.repo, branch: row.branch, headSha: row.head_sha,
      treeSha: row.tree_sha, baselineCommit: row.baseline_commit,
      patchSha256: row.patch_sha256, workerId: row.worker_id,
      epochId: Number(row.epoch_id)
    } : null;
  }

  /**
   * Persist PR draft submission only if all attested state and the signed
   * ticket lease still match. This never marks a ticket merged or complete.
   */
  public recordVerifiedDraftPr(input: {
    ticketId: string; repo: string; prNumber: number; branch: string;
    headSha: string; treeSha: string; patchSha256: string;
    epochId: number; workerId: string; tokenId: string;
  }): boolean {
    if (!/^[0-9a-f]{40}$/.test(input.headSha) ||
        !/^[0-9a-f]{40}$/.test(input.treeSha) ||
        !/^[0-9a-f]{64}$/.test(input.patchSha256) ||
        !Number.isSafeInteger(input.prNumber) || input.prNumber < 1) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT status, branch, assigned_to, diff_patch FROM tickets WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const a = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const lease = this.db.prepare('SELECT * FROM worker_leases WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id = 1')
        .get() as any;
      if (!row || !a || !lease || !sys || sys.kill_switch_active ||
          row.status !== 'READY_FOR_REVIEW' || row.branch !== input.branch ||
          row.assigned_to !== input.workerId ||
          a.worker_id !== input.workerId || a.candidate_tree_sha !== input.treeSha ||
          a.patch_sha256 !== input.patchSha256 ||
          Number(a.epoch_id) !== input.epochId || Number(sys.epoch_id) !== input.epochId ||
          Number(lease.epoch_id) !== input.epochId || lease.is_revoked ||
          lease.worker_id !== input.workerId || lease.token_id !== input.tokenId ||
          Number(lease.expires_at) <= Date.now() || this.isTokenRevoked(input.tokenId) ||
          !row.diff_patch ||
          crypto.createHash('sha256').update(row.diff_patch).digest('hex') !== input.patchSha256) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const pushed = this.db.prepare('SELECT * FROM verified_worker_pushes WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      if (!pushed || pushed.repo !== input.repo ||
          pushed.branch !== input.branch || pushed.head_sha !== input.headSha ||
          pushed.tree_sha !== input.treeSha ||
          pushed.patch_sha256 !== input.patchSha256 ||
          pushed.worker_id !== input.workerId ||
          Number(pushed.epoch_id) !== input.epochId) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const existing = this.db.prepare('SELECT * FROM draft_pr_submissions WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      if (existing) {
        const identical = existing.repo === input.repo &&
          existing.pr_number === input.prNumber &&
          existing.branch === input.branch &&
          existing.head_sha === input.headSha &&
          existing.tree_sha === input.treeSha &&
          existing.patch_sha256 === input.patchSha256 &&
          Number(existing.epoch_id) === input.epochId;
        this.db.exec('COMMIT');
        return identical;
      }
      this.db.prepare(`INSERT INTO draft_pr_submissions
        (ticket_id, repo, pr_number, branch, head_sha, tree_sha, patch_sha256, epoch_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.ticketId, input.repo, input.prNumber, input.branch,
        input.headSha, input.treeSha, input.patchSha256, input.epochId, Date.now()
      );
      this.appendAuditLog({
        actor: 'GitHub Draft PR Gatekeeper', action: 'DRAFT_PR_VERIFIED_SUBMITTED',
        ticketId: input.ticketId,
        reasoning: 'Exact tested tree and signed lease confirmed. Human review required; not merged.',
        details: { repo: input.repo, prNumber: input.prNumber, headSha: input.headSha,
          candidateTreeSha: input.treeSha, branch: input.branch }
      });
      this.db.exec('COMMIT');
      return true;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }

  public getDraftPrSubmission(ticketId: string): {
    repo: string; prNumber: number; branch: string; headSha: string; treeSha: string;
  } | null {
    const row = this.db.prepare('SELECT * FROM draft_pr_submissions WHERE ticket_id = ?')
      .get(ticketId) as any;
    return row ? {
      repo: row.repo, prNumber: row.pr_number, branch: row.branch,
      headSha: row.head_sha, treeSha: row.tree_sha
    } : null;
  }

  /**
   * Admin-directed proof verification authorization after human review.
   * This is NOT a worker lease and never authorizes code execution or a push.
   * It is bound to an already registered PR and exact tested/pushed artifact.
   */
  public authorizeGitMergeVerification(ticketId: string, repo: string,
    actor: string = 'Administrator', ttlMs: number = 900000
  ): { success: true; grantId: string; expiresAt: number; prNumber: number; headSha: string } |
     { success: false; error: string } {
    const deny = (error: string): { success: false; error: string } => ({ success: false, error });
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 60000 || ttlMs > 900000) {
      return deny('MERGE_GRANT_INVALID_CONFIGURATION');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const ticket = this.db.prepare('SELECT status, branch, assigned_to, diff_patch FROM tickets WHERE ticket_id=?')
        .get(ticketId) as any;
      const attested = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id=?')
        .get(ticketId) as any;
      const pushed = this.db.prepare('SELECT * FROM verified_worker_pushes WHERE ticket_id=?')
        .get(ticketId) as any;
      const draft = this.db.prepare('SELECT * FROM draft_pr_submissions WHERE ticket_id=?')
        .get(ticketId) as any;
      const original = this.db.prepare('SELECT * FROM worker_push_jobs WHERE ticket_id=?')
        .get(ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id=1').get() as any;
      const previous = this.db.prepare('SELECT consumed_at FROM merge_verification_grants WHERE ticket_id=?')
        .get(ticketId) as any;
      const epoch = Number(sys?.epoch_id);
      const patchSha = ticket?.diff_patch ?
        crypto.createHash('sha256').update(ticket.diff_patch).digest('hex') : null;
      if (!ticket || !attested || !pushed || !draft || !original || !sys ||
          sys.kill_switch_active || previous?.consumed_at != null ||
          ticket.status !== 'READY_FOR_REVIEW' ||
          ticket.branch !== pushed.branch || pushed.branch !== draft.branch ||
          pushed.repo !== repo || draft.repo !== repo ||
          pushed.head_sha !== draft.head_sha ||
          pushed.tree_sha !== draft.tree_sha || pushed.tree_sha !== attested.candidate_tree_sha ||
          pushed.patch_sha256 !== draft.patch_sha256 ||
          pushed.patch_sha256 !== attested.patch_sha256 || pushed.patch_sha256 !== patchSha ||
          ticket.assigned_to !== pushed.worker_id ||
          pushed.worker_id !== attested.worker_id || pushed.worker_id !== original.worker_id ||
          original.state !== 'CONFIRMED' ||
          original.repo !== repo || original.branch !== ticket.branch ||
          original.patch_sha256 !== pushed.patch_sha256 ||
          original.candidate_tree_sha !== pushed.tree_sha ||
          !original.token_id || this.isTokenRevoked(original.token_id) ||
          Number(pushed.epoch_id) !== epoch || Number(attested.epoch_id) !== epoch ||
          Number(draft.epoch_id) !== epoch || Number(original.epoch_id) !== epoch) {
        this.db.exec('ROLLBACK');
        return deny('MERGE_GRANT_UNVERIFIED_PROVENANCE');
      }
      const now = Date.now();
      const grantId = crypto.randomUUID();
      const expiresAt = now + ttlMs;
      this.db.prepare(`INSERT INTO merge_verification_grants
        (ticket_id, grant_id, repo, pr_number, branch, head_sha,
         candidate_tree_sha, patch_sha256, epoch_id, issued_at, expires_at, consumed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(ticket_id) DO UPDATE SET
          grant_id=excluded.grant_id, repo=excluded.repo,
          pr_number=excluded.pr_number, branch=excluded.branch,
          head_sha=excluded.head_sha, candidate_tree_sha=excluded.candidate_tree_sha,
          patch_sha256=excluded.patch_sha256, epoch_id=excluded.epoch_id,
          issued_at=excluded.issued_at, expires_at=excluded.expires_at, consumed_at=NULL`)
        .run(ticketId, grantId, repo, draft.pr_number, ticket.branch,
          pushed.head_sha, pushed.tree_sha, pushed.patch_sha256, epoch, now, expiresAt);
      this.appendAuditLog({
        actor, action: 'MERGE_VERIFICATION_AUTHORIZED', ticketId,
        reasoning: 'Administrator authorized read-only remote merge proof verification; no worker token renewal, merge or push.',
        details: { repo, prNumber: draft.pr_number, headSha: pushed.head_sha,
          candidateTreeSha: pushed.tree_sha, epochId: epoch, expiresAt }
      });
      this.db.exec('COMMIT');
      return { success: true, grantId, expiresAt, prNumber: draft.pr_number, headSha: pushed.head_sha };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public getMergeVerificationGrant(ticketId: string): {
    grantId: string; repo: string; prNumber: number; branch: string;
    headSha: string; treeSha: string; patchSha256: string;
    epochId: number; expiresAt: number; consumedAt: number | null;
  } | null {
    const r = this.db.prepare('SELECT * FROM merge_verification_grants WHERE ticket_id=?')
      .get(ticketId) as any;
    return r ? {
      grantId: r.grant_id, repo: r.repo, prNumber: Number(r.pr_number),
      branch: r.branch, headSha: r.head_sha, treeSha: r.candidate_tree_sha,
      patchSha256: r.patch_sha256, epochId: Number(r.epoch_id),
      expiresAt: Number(r.expires_at), consumedAt: r.consumed_at == null ? null : Number(r.consumed_at)
    } : null;
  }

  /** CAS: no status update unless the matching attestation and live epoch still exist. */
  public recordVerifiedGitMerge(input: {
    ticketId: string; repo: string; prNumber: number; branch: string;
    headSha: string; mergeSha: string; treeSha: string;
    patchSha256: string; epochId: number; grantId: string;
  }): boolean {
    const sha1 = /^[0-9a-f]{40}$/;
    if (![input.headSha, input.mergeSha, input.treeSha].every(x => sha1.test(x)) ||
        !Number.isSafeInteger(input.prNumber) || input.prNumber < 1) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const t = this.db.prepare('SELECT status, diff_patch, branch, logs_json FROM tickets WHERE ticket_id = ?').get(input.ticketId) as any;
      const a = this.db.prepare('SELECT * FROM sandbox_attestations WHERE ticket_id = ?').get(input.ticketId) as any;
      const sys = this.db.prepare('SELECT epoch_id, kill_switch_active FROM system_state WHERE id = 1').get() as any;
      const pushed = this.db.prepare('SELECT * FROM verified_worker_pushes WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const draft = this.db.prepare('SELECT * FROM draft_pr_submissions WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const original = this.db.prepare('SELECT * FROM worker_push_jobs WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      const grant = this.db.prepare('SELECT * FROM merge_verification_grants WHERE ticket_id = ?')
        .get(input.ticketId) as any;
      if (!pushed || pushed.repo !== input.repo ||
          pushed.branch !== input.branch || pushed.head_sha !== input.headSha ||
          pushed.tree_sha !== input.treeSha ||
          pushed.patch_sha256 !== input.patchSha256 ||
          pushed.baseline_commit !== a?.baseline_commit ||
          pushed.worker_id !== a?.worker_id ||
          Number(pushed.epoch_id) !== input.epochId ||
          !draft || draft.repo !== input.repo || draft.pr_number !== input.prNumber ||
          draft.branch !== input.branch || draft.head_sha !== input.headSha ||
          draft.tree_sha !== input.treeSha || draft.patch_sha256 !== input.patchSha256 ||
          Number(draft.epoch_id) !== input.epochId ||
          !original || original.state !== 'CONFIRMED' || original.repo !== input.repo ||
          original.branch !== input.branch || original.worker_id !== pushed.worker_id ||
          original.patch_sha256 !== input.patchSha256 ||
          original.candidate_tree_sha !== input.treeSha ||
          Number(original.epoch_id) !== input.epochId ||
          this.isTokenRevoked(original.token_id) ||
          !grant || grant.grant_id !== input.grantId ||
          grant.repo !== input.repo || grant.pr_number !== input.prNumber ||
          grant.branch !== input.branch || grant.head_sha !== input.headSha ||
          grant.candidate_tree_sha !== input.treeSha ||
          grant.patch_sha256 !== input.patchSha256 ||
          Number(grant.epoch_id) !== input.epochId ||
          grant.consumed_at != null || Number(grant.expires_at) <= Date.now() ||
          !t || !a || !sys || sys.kill_switch_active ||
          t.status !== 'READY_FOR_REVIEW' || t.branch !== input.branch ||
          Number(sys.epoch_id) !== input.epochId || Number(a.epoch_id) !== input.epochId ||
          a.candidate_tree_sha !== input.treeSha || a.patch_sha256 !== input.patchSha256 ||
          !t.diff_patch || crypto.createHash('sha256').update(t.diff_patch).digest('hex') !== input.patchSha256) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const now = Date.now();
      const logs = JSON.parse(t.logs_json || '[]') as any[];
      logs.push({ timestamp: new Date().toLocaleTimeString(), level: 'SUCCESS',
        message: `GitHub PR #${input.prNumber} verified merged at ${input.mergeSha.slice(0, 12)}; tested tree matched.` });
      this.db.prepare(`UPDATE tickets SET status = 'COMMITTED_PUSHED', rollback_commit = ?,
        logs_json = ?, updated_at = ? WHERE ticket_id = ?`).run(input.mergeSha, JSON.stringify(logs), now, input.ticketId);
      this.db.prepare(`INSERT INTO verified_git_merges
        (ticket_id, repo, pr_number, branch, head_sha, merge_sha, tree_sha, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          input.ticketId, input.repo, input.prNumber, input.branch,
          input.headSha, input.mergeSha, input.treeSha, now
      );
      this.db.prepare(`UPDATE merge_verification_grants SET consumed_at=?
        WHERE ticket_id=? AND grant_id=? AND consumed_at IS NULL`)
        .run(now, input.ticketId, input.grantId);
      this.appendAuditLog({
        actor: 'GitHub Merge Gatekeeper', action: 'REMOTE_MERGE_VERIFIED',
        ticketId: input.ticketId, reasoning: 'GitHub merged PR, independent CI, review, file scope and exact tested tree verified.',
        details: { repo: input.repo, prNumber: input.prNumber, headSha: input.headSha,
          mergeSha: input.mergeSha, treeSha: input.treeSha }
      });
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  public seedBaselineIfEmpty(initialNodes: SwarmNode[], initialTickets: Ticket[]): void {
    const projectCount = this.db.prepare('SELECT COUNT(*) as count FROM projects').get() as any;
    if (projectCount.count === 0) {
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO projects (project_id, name, git_repo_url, priority, status, created_at, config_hash)
        VALUES ('PRJ-MATRIMONY-01', 'Matrimony Matchmaking & Bio Sanitizer Engine', 'git@github.com:sutradhar-corp/matrimony-engine.git', 'P0_CRITICAL', 'ACTIVE', ?, 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069')
      `).run(now - 86400000);
    }

    const workerCount = this.db.prepare('SELECT COUNT(*) as count FROM workers').get() as any;
    if (workerCount.count === 0) {
      const now = Date.now();
      for (const node of initialNodes) {
        this.db.prepare(`
          INSERT INTO workers (
            worker_id, name, role, status, domain, mac_address, git_author,
            uptime_seconds, current_ticket_id, last_seen, health_json, is_hybrid_local
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          node.id,
          node.name,
          node.role,
          node.status,
          node.domain,
          node.macAddress,
          node.gitAuthor,
          node.uptimeSeconds,
          node.currentTicketId || null,
          now,
          JSON.stringify(node.health),
          node.isHybridLocal ? 1 : 0
        );
      }
    }

    const ticketCount = this.db.prepare('SELECT COUNT(*) as count FROM tickets').get() as any;
    if (ticketCount.count === 0) {
      const now = Date.now();
      for (const t of initialTickets) {
        this.db.prepare(`
          INSERT INTO tickets (
            ticket_id, project_id, title, description, priority, domain, status,
            assigned_to, retry_count, max_retries, current_tier, branch,
            ed25519_token, diff_patch, test_stdout, test_stderr, rollback_commit,
            llm_used, allowed_files_json, read_only_contracts_json, logs_json,
            created_at, updated_at
          ) VALUES (?, 'PRJ-MATRIMONY-01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          t.id,
          t.title,
          t.description,
          t.priority,
          t.domain,
          t.status,
          t.assignedTo || null,
          t.retryCount,
          t.maxRetries,
          t.currentTier || 1,
          t.branch,
          t.ed25519Token || null,
          t.diffPatch || null,
          t.testStdout || null,
          t.testStderr || null,
          t.rollbackCommit || null,
          t.llmUsed || null,
          JSON.stringify(t.allowedFiles),
          JSON.stringify(t.readOnlyContracts || []),
          JSON.stringify(t.logs || []),
          now - 3600000,
          now
        );

        if (t.parentTicketIds && t.parentTicketIds.length > 0) {
          for (const pid of t.parentTicketIds) {
            this.db.prepare(`
              INSERT OR IGNORE INTO ticket_dependencies (parent_ticket_id, child_ticket_id)
              VALUES (?, ?)
            `).run(pid, t.id);
          }
        }
      }
    }
  }
}

export const clusterDb = new ClusterDatabase();
