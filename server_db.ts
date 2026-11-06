import * as path from 'path';
import * as fs from 'fs';
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
    `);

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
        // Reset ticket to PENDING
        const ticketRow = this.db.prepare('SELECT logs_json FROM tickets WHERE ticket_id = ?').get(lease.ticket_id) as any;
        let logs = ticketRow?.logs_json ? JSON.parse(ticketRow.logs_json) : [];
        logs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: 'WARN',
          message: `[WATCHDOG AUTO-RECOVERY] Worker ${lease.worker_id} went unresponsive (>90s silence). Lease auto-revoked and recycled.`
        });

        this.db.prepare(`
          UPDATE tickets
          SET status = 'PENDING', assigned_to = NULL, logs_json = ?, updated_at = ?
          WHERE ticket_id = ? AND status != 'COMMITTED_PUSHED'
        `).run(JSON.stringify(logs), now, lease.ticket_id);

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
    const logId = `LOG-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
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

    const ticketRow = this.db.prepare('SELECT logs_json FROM tickets WHERE ticket_id = ?').get(ticketId) as any;
    let logs = ticketRow?.logs_json ? JSON.parse(ticketRow.logs_json) : [];
    logs.push({
      timestamp: new Date().toLocaleTimeString(),
      level: 'WARN',
      message: `[WATCHDOG REVOCATION] Lease revoked: ${reason}. Ticket reset to PENDING.`
    });

    this.db.prepare(`
      UPDATE tickets
      SET status = 'PENDING', assigned_to = NULL, logs_json = ?, updated_at = ?
      WHERE ticket_id = ?
    `).run(JSON.stringify(logs), now, ticketId);

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
    const id = attempt.attemptId || `ATT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
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
