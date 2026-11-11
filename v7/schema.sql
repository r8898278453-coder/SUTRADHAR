-- SUTRADHAR v7.0. All tables use the server's MySQL/InnoDB clock.
-- Apply with an explicit operator-controlled migration, never on an anonymous request.
CREATE TABLE IF NOT EXISTS v7_schema_versions (
  version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_cluster (
  singleton TINYINT PRIMARY KEY, epoch BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bootstrapped_at DATETIME(3), master_agent_id VARCHAR(100),
  elected_at DATETIME(3), lease_until DATETIME(3), phase VARCHAR(32) NOT NULL DEFAULT 'NO_MASTER',
  backup1 VARCHAR(100), backup2 VARCHAR(100), paused TINYINT(1) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_nodes (
  node_id VARCHAR(100) PRIMARY KEY, public_key_pem TEXT NOT NULL,
  display_name VARCHAR(150) NOT NULL, general_location VARCHAR(150),
  state ENUM('PENDING','APPROVED','REVOKED') NOT NULL DEFAULT 'PENDING',
  boot_id VARCHAR(100), last_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_seen DATETIME(3), created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_state_seen(state,last_seen)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_agents (
  agent_id VARCHAR(100) PRIMARY KEY, node_id VARCHAR(100) NOT NULL,
  state ENUM('PENDING','APPROVED','REVOKED') NOT NULL DEFAULT 'PENDING',
  master_eligible TINYINT(1) NOT NULL DEFAULT 0,
  qa_eligible TINYINT(1) NOT NULL DEFAULT 0,
  last_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_seen DATETIME(3), status VARCHAR(40) NOT NULL DEFAULT 'IDLE',
  capability_json JSON, active_ticket VARCHAR(100),
  FOREIGN KEY (node_id) REFERENCES v7_nodes(node_id),
  INDEX idx_agent_active(state,master_eligible,last_seen)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_arrivals (
  arrival_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(100) NOT NULL UNIQUE,
  accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (agent_id) REFERENCES v7_agents(agent_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_nonces (
  node_id VARCHAR(100) NOT NULL, nonce VARCHAR(100) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (node_id,nonce), FOREIGN KEY (node_id) REFERENCES v7_nodes(node_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_events (
  event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(90) NOT NULL, actor VARCHAR(100) NOT NULL,
  epoch BIGINT UNSIGNED NOT NULL, resource_id VARCHAR(110),
  payload_json JSON, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_event_time(created_at), INDEX idx_event_epoch(epoch)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_commands (
  actor VARCHAR(110) NOT NULL, request_id VARCHAR(100) NOT NULL,
  operation VARCHAR(100) NOT NULL, response_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (actor,request_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_projects (
  project_id VARCHAR(100) PRIMARY KEY, display_name VARCHAR(170) NOT NULL,
  repository VARCHAR(190) NOT NULL, base_branch VARCHAR(80) NOT NULL DEFAULT 'main',
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_repository_base(repository,base_branch)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_project_agents (
  project_id VARCHAR(100) NOT NULL, agent_id VARCHAR(100) NOT NULL,
  can_develop TINYINT(1) NOT NULL DEFAULT 0,
  can_qa TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY(project_id,agent_id),
  FOREIGN KEY (project_id) REFERENCES v7_projects(project_id),
  FOREIGN KEY (agent_id) REFERENCES v7_agents(agent_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_tickets (
  ticket_id VARCHAR(100) PRIMARY KEY, project_id VARCHAR(100) NOT NULL,
  creator_agent_id VARCHAR(100) NOT NULL, fingerprint CHAR(64) NOT NULL, created_epoch BIGINT UNSIGNED NOT NULL,
  title VARCHAR(220) NOT NULL, description TEXT NOT NULL,
  baseline_sha CHAR(40) NOT NULL, branch_name VARCHAR(120) NOT NULL,
  risk ENUM('LOW','MEDIUM','HIGH','CORE') NOT NULL,
  scopes_json JSON NOT NULL, criteria_json JSON NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  worker_agent_id VARCHAR(100), candidate_head_sha CHAR(40), candidate_tree_sha CHAR(40),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (project_id) REFERENCES v7_projects(project_id),
  UNIQUE KEY uniq_project_intent(project_id,fingerprint),
  INDEX idx_ticket_status(project_id,status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_dependencies (
  ticket_id VARCHAR(100) NOT NULL, dependency_id VARCHAR(100) NOT NULL,
  PRIMARY KEY(ticket_id,dependency_id),
  FOREIGN KEY (ticket_id) REFERENCES v7_tickets(ticket_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_leases (
  ticket_id VARCHAR(100) PRIMARY KEY, agent_id VARCHAR(100) NOT NULL,
  epoch BIGINT UNSIGNED NOT NULL, lease_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL, revoked TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (ticket_id) REFERENCES v7_tickets(ticket_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_reservations (
  project_id VARCHAR(100) NOT NULL, scope VARCHAR(500) NOT NULL,
  ticket_id VARCHAR(100) NOT NULL, PRIMARY KEY(project_id,scope),
  FOREIGN KEY (ticket_id) REFERENCES v7_tickets(ticket_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_checkpoints (
  checkpoint_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id VARCHAR(100) NOT NULL, generation INT UNSIGNED NOT NULL,
  agent_id VARCHAR(100) NOT NULL, epoch BIGINT UNSIGNED NOT NULL,
  summary TEXT NOT NULL, next_action VARCHAR(500) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_ticket_generation(ticket_id,generation),
  FOREIGN KEY (ticket_id) REFERENCES v7_tickets(ticket_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_qa_receipts (
  receipt_id CHAR(36) PRIMARY KEY, ticket_id VARCHAR(100) NOT NULL,
  agent_id VARCHAR(100) NOT NULL, head_sha CHAR(40) NOT NULL,
  tree_sha CHAR(40) NOT NULL, passed TINYINT(1) NOT NULL,
  evidence_sha256 CHAR(64) NOT NULL, evidence_ref VARCHAR(450) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (ticket_id) REFERENCES v7_tickets(ticket_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_approvals (
  proposal_id VARCHAR(100) PRIMARY KEY, ticket_id VARCHAR(100) NOT NULL,
  kind VARCHAR(50) NOT NULL, justification TEXT NOT NULL,
  state ENUM('PENDING','APPROVED','DENIED') NOT NULL DEFAULT 'PENDING',
  resolved_at DATETIME(3), created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_git_jobs (
  ticket_id VARCHAR(100) PRIMARY KEY, agent_id VARCHAR(100) NOT NULL,
  epoch BIGINT UNSIGNED NOT NULL,
  state ENUM('RUNNING','NEEDS_RECONCILIATION','CONFIRMED') NOT NULL DEFAULT 'RUNNING',
  request_id VARCHAR(100) NOT NULL, remote_head_sha CHAR(40),
  remote_tree_sha CHAR(40), changed_files_json JSON,
  pr_number BIGINT UNSIGNED, pr_url VARCHAR(400),
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  verified_at DATETIME(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (ticket_id) REFERENCES v7_tickets(ticket_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_git_receipts (
  ticket_id VARCHAR(100) PRIMARY KEY, receipt_json JSON NOT NULL,
  verified_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (ticket_id) REFERENCES v7_tickets(ticket_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_legacy_imports (
  source_table VARCHAR(80) NOT NULL, source_id VARCHAR(120) NOT NULL,
  source_sha256 CHAR(64) NOT NULL, safe_payload JSON NOT NULL,
  migrated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(source_table,source_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS v7_migration_audit (
  migration_id VARCHAR(100) PRIMARY KEY, source_sha256 CHAR(64) NOT NULL,
  record_counts JSON NOT NULL, destination_counts JSON NOT NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
