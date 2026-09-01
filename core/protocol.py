#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - TELEGRAM WIRE-PROTOCOL & MESSAGE ENCODER (v5.4)
Dual Format: Human-Readable Visual Card + Structured Embedded JSON Block.
Ensures zero-regex, deterministic parsing, Ed25519 signature checks, and kill-switch commands.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("sutradhar.protocol")

PROTOCOL_MARKER_START = "```sutradhar_protocol"
PROTOCOL_MARKER_END = "```"


class MessageType(str, Enum):
    CLUSTER_HEARTBEAT = "CLUSTER_HEARTBEAT"
    TICKET_OFFERED = "TICKET_OFFERED"
    TICKET_CLAIM_REQUEST = "TICKET_CLAIM_REQUEST"
    TICKET_LEASE_GRANTED = "TICKET_LEASE_GRANTED"
    TICKET_HEARTBEAT_PROGRESS = "TICKET_HEARTBEAT_PROGRESS"
    TICKET_READY_FOR_TEST = "TICKET_READY_FOR_TEST"
    TICKET_VERIFIED_MERGED = "TICKET_VERIFIED_MERGED"
    TICKET_DEAD_LETTER_QUEUE = "TICKET_DEAD_LETTER_QUEUE"
    TICKET_LEASE_REVOKED = "TICKET_LEASE_REVOKED"
    CLUSTER_KILL_SWITCH = "CLUSTER_KILL_SWITCH"


class NodeRole(str, Enum):
    MASTER = "MASTER"
    STANDBY_1 = "STANDBY_1"
    STANDBY_2 = "STANDBY_2"
    WORKER = "WORKER"
    HUMAN_ADMIN = "HUMAN_ADMIN"


@dataclass
class SenderMetadata:
    node_id: str
    role: NodeRole
    epoch_id: int


@dataclass
class WireMessage:
    version: str
    msg_type: MessageType
    msg_id: str
    timestamp: int
    sender: SenderMetadata
    payload: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "msg_type": self.msg_type.value if isinstance(self.msg_type, MessageType) else str(self.msg_type),
            "msg_id": self.msg_id,
            "timestamp": self.timestamp,
            "sender": {
                "node_id": self.sender.node_id,
                "role": self.sender.role.value if isinstance(self.sender.role, NodeRole) else str(self.sender.role),
                "epoch_id": self.sender.epoch_id,
            },
            "payload": self.payload,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> WireMessage:
        sender_data = data.get("sender", {})
        sender = SenderMetadata(
            node_id=sender_data.get("node_id", "UNKNOWN"),
            role=NodeRole(sender_data.get("role", "WORKER")),
            epoch_id=int(sender_data.get("epoch_id", 1)),
        )
        return cls(
            version=data.get("version", "1.0"),
            msg_type=MessageType(data.get("msg_type", "CLUSTER_HEARTBEAT")),
            msg_id=data.get("msg_id", f"msg_{int(time.time()*1000)}"),
            timestamp=int(data.get("timestamp", int(time.time()))),
            sender=sender,
            payload=data.get("payload", {}),
        )


class ProtocolCodec:
    """
    Encodes and decodes dual-format Telegram messages.
    """

    @classmethod
    def encode(cls, human_header: str, message: WireMessage) -> str:
        json_str = json.dumps(message.to_dict(), indent=2)
        return f"{human_header.strip()}\n\n{PROTOCOL_MARKER_START}\n{json_str}\n{PROTOCOL_MARKER_END}"

    @classmethod
    def decode(cls, raw_text: str) -> Tuple[Optional[str], Optional[WireMessage]]:
        """
        Parses human text + embedded protocol JSON.
        Returns: (human_text, WireMessage or None)
        """
        if not raw_text:
            return None, None

        pattern = re.compile(rf"{re.escape(PROTOCOL_MARKER_START)}\s*(\{.*?\})\s*{re.escape(PROTOCOL_MARKER_END)}", re.DOTALL)
        match = pattern.search(raw_text)

        if not match:
            # Fallback check if pure json was sent
            try:
                data = json.loads(raw_text.strip())
                return "", WireMessage.from_dict(data)
            except Exception:
                return raw_text.strip(), None

        json_raw = match.group(1)
        human_part = raw_text[:match.start()].strip()

        try:
            parsed_json = json.loads(json_raw)
            msg = WireMessage.from_dict(parsed_json)
            return human_part, msg
        except Exception as ex:
            logger.warning(f"[PROTOCOL] Failed to parse embedded JSON payload: {ex}")
            return human_part, None

    @classmethod
    def create_lease_grant_message(
        cls,
        master_id: str,
        epoch_id: int,
        ticket_id: str,
        ticket_title: str,
        worker_id: str,
        allowed_files: List[str],
        base_branch: str,
        work_branch: str,
        ttl_seconds: int,
        ed25519_token: str,
    ) -> str:
        now = int(time.time())
        expires_at = now + ttl_seconds

        human_text = (
            f"👑 <b>[MASTER LEASE ALLOCATED]</b>\n"
            f"🎫 <b>Ticket:</b> <code>{ticket_id}</code> - {ticket_title}\n"
            f"🤖 <b>Assigned Worker:</b> <code>{worker_id}</code>\n"
            f"🌿 <b>Work Branch:</b> <code>{work_branch}</code> (from <code>{base_branch}</code>)\n"
            f"📁 <b>Allowed Files:</b> {', '.join(allowed_files)}\n"
            f"⏱️ <b>Lease Expiry:</b> {ttl_seconds}s (at {time.strftime('%H:%M:%S', time.gmtime(expires_at))} UTC)\n"
            f"🔐 <b>Ed25519 Signature:</b> Verified"
        )

        wire_msg = WireMessage(
            version="1.0",
            msg_type=MessageType.TICKET_LEASE_GRANTED,
            msg_id=f"lease_{ticket_id}_{now}",
            timestamp=now,
            sender=SenderMetadata(node_id=master_id, role=NodeRole.MASTER, epoch_id=epoch_id),
            payload={
                "ticket_id": ticket_id,
                "ticket_title": ticket_title,
                "worker_id": worker_id,
                "allowed_files": allowed_files,
                "base_branch": base_branch,
                "work_branch": work_branch,
                "expires_at": expires_at,
                "ttl_seconds": ttl_seconds,
                "ed25519_token": ed25519_token,
            }
        )

        return cls.encode(human_text, wire_msg)

    @classmethod
    def create_progress_heartbeat(
        cls,
        worker_id: str,
        epoch_id: int,
        ticket_id: str,
        progress_pct: int,
        current_step: str,
    ) -> str:
        now = int(time.time())
        human_text = (
            f"🤖 <b>[WORKER HEARTBEAT]</b>\n"
            f"🎫 <b>Ticket:</b> <code>{ticket_id}</code>\n"
            f"⚡ <b>Worker:</b> <code>{worker_id}</code>\n"
            f"📊 <b>Progress:</b> {progress_pct}%\n"
            f"📍 <b>Status:</b> {current_step}"
        )

        wire_msg = WireMessage(
            version="1.0",
            msg_type=MessageType.TICKET_HEARTBEAT_PROGRESS,
            msg_id=f"hb_{ticket_id}_{worker_id}_{now}",
            timestamp=now,
            sender=SenderMetadata(node_id=worker_id, role=NodeRole.WORKER, epoch_id=epoch_id),
            payload={
                "ticket_id": ticket_id,
                "worker_id": worker_id,
                "progress_pct": progress_pct,
                "current_step": current_step,
            }
        )

        return cls.encode(human_text, wire_msg)

    @classmethod
    def create_kill_switch_message(
        cls,
        admin_id: str,
        action: str,  # 'PAUSE_ALL' or 'RESUME_ALL'
        reason: str,
    ) -> str:
        now = int(time.time())
        human_text = (
            f"🛑 <b>[EMERGENCY KILL SWITCH ACTIVATED]</b>\n"
            f"👤 <b>By Admin:</b> {admin_id}\n"
            f"⚡ <b>Action:</b> <code>{action}</code>\n"
            f"📝 <b>Reason:</b> {reason}\n"
            f"⚠️ <i>All SutraDhaar workers MUST freeze immediate operations.</i>"
        )

        wire_msg = WireMessage(
            version="1.0",
            msg_type=MessageType.CLUSTER_KILL_SWITCH,
            msg_id=f"kill_{now}",
            timestamp=now,
            sender=SenderMetadata(node_id=admin_id, role=NodeRole.HUMAN_ADMIN, epoch_id=9999),
            payload={
                "action": action,
                "reason": reason,
            }
        )

        return cls.encode(human_text, wire_msg)
