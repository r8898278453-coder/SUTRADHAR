#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - CRYPTOGRAPHIC LEASE SIGNER & VERIFIER (v5.3)
Provides asymmetric Ed25519 signing and verification with zero-trust validation.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from typing import Optional, Tuple

try:
    from cryptography.hazmat.primitives.asymmetric import ed25519
    from cryptography.hazmat.primitives import serialization
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False


@dataclass(frozen=True)
class LeasePayload:
    ticket_id: str
    worker_id: str
    epoch_id: int
    expiry_timestamp: int
    files_hash: str

    def to_canonical_bytes(self) -> bytes:
        data = {
            "ticket_id": self.ticket_id,
            "worker_id": self.worker_id,
            "epoch_id": self.epoch_id,
            "expiry_timestamp": self.expiry_timestamp,
            "files_hash": self.files_hash,
        }
        return json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @classmethod
    def from_canonical_bytes(cls, raw: bytes) -> LeasePayload:
        data = json.loads(raw.decode("utf-8"))
        return cls(
            ticket_id=data["ticket_id"],
            worker_id=data["worker_id"],
            epoch_id=int(data["epoch_id"]),
            expiry_timestamp=int(data["expiry_timestamp"]),
            files_hash=data["files_hash"],
        )


class CryptoSigner:
    @staticmethod
    def calculate_files_hash(allowed_files: list[str]) -> str:
        sorted_files = sorted([f.strip() for f in allowed_files if f.strip()])
        return hashlib.sha256(",".join(sorted_files).encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def sign_lease(
        ticket_id: str,
        worker_id: str,
        epoch_id: int,
        allowed_files: list[str],
        ttl_seconds: int,
        private_key_path: str,
    ) -> str:
        if not HAS_CRYPTOGRAPHY:
            raise RuntimeError("cryptography library required for master node lease signing.")

        with open(private_key_path, "rb") as f:
            private_key = serialization.load_pem_private_key(f.read(), password=None)

        if not isinstance(private_key, ed25519.Ed25519PrivateKey):
            raise TypeError("Only Ed25519 keys are permitted for lease signing.")

        expiry = int(time.time()) + ttl_seconds
        payload = LeasePayload(
            ticket_id=ticket_id,
            worker_id=worker_id,
            epoch_id=epoch_id,
            expiry_timestamp=expiry,
            files_hash=CryptoSigner.calculate_files_hash(allowed_files),
        )

        canonical_bytes = payload.to_canonical_bytes()
        signature = private_key.sign(canonical_bytes)

        payload_b64 = base64.urlsafe_b64encode(canonical_bytes).decode("ascii")
        sig_b64 = base64.urlsafe_b64encode(signature).decode("ascii")

        return f"SEC-{payload_b64}.{sig_b64}"

    @staticmethod
    def verify_token_header(
        token_str: str,
        expected_ticket_id: str,
        public_key_path: str,
        expected_epoch_id: Optional[int] = None,
    ) -> Tuple[bool, str, Optional[LeasePayload]]:
        try:
            if not token_str.startswith("SEC-"):
                return False, "Malformed token header prefix (must start with SEC-)", None

            raw_token = token_str[4:]
            parts = raw_token.split(".")
            if len(parts) != 2:
                return False, "Token format invalid: expected <payload_b64>.<signature_b64>", None

            payload_bytes = base64.urlsafe_b64decode(parts[0].encode("ascii"))
            signature_bytes = base64.urlsafe_b64decode(parts[1].encode("ascii"))

            # Load public key
            with open(public_key_path, "rb") as f:
                public_key_data = f.read()

            if HAS_CRYPTOGRAPHY:
                public_key = serialization.load_pem_public_key(public_key_data)
                if not isinstance(public_key, ed25519.Ed25519PublicKey):
                    return False, "Public key must be Ed25519", None
                try:
                    public_key.verify(signature_bytes, payload_bytes)
                except Exception as ex:
                    return False, f"Ed25519 cryptographic signature mismatch: {ex}", None
            else:
                return False, "Server lacks cryptographic verification module.", None

            payload = LeasePayload.from_canonical_bytes(payload_bytes)

            # 1. Verify Target Ticket ID match
            if payload.ticket_id != expected_ticket_id:
                return False, f"Ticket mismatch: token issued for {payload.ticket_id}, target branch is {expected_ticket_id}", payload

            # 2. Verify Expiration TTL
            now = int(time.time())
            if now > payload.expiry_timestamp:
                return False, f"Lease expired at timestamp {payload.expiry_timestamp} (current time: {now})", payload

            # 3. Verify Epoch (if provided)
            if expected_epoch_id is not None and payload.epoch_id != expected_epoch_id:
                return False, f"Stale Epoch: token from Epoch #{payload.epoch_id}, cluster is on #{expected_epoch_id}", payload

            return True, "Valid cryptographic lease token", payload

        except Exception as e:
            return False, f"Token verification error: {str(e)}", None


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: verify_commit.py <TICKET_ID> <COMMIT_SHA>\n")
        sys.exit(1)

    tkt_id = sys.argv[1]
    commit_sha = sys.argv[2]
    commit_message = sys.stdin.read()

    pubkey_path = os.environ.get("SUTRADHAR_PUBKEY_PATH", "/opt/sutradhar/secrets/master_public_key.pub")
    
    token = None
    for line in commit_message.splitlines():
        line_clean = line.strip()
        if line_clean.startswith("Security-Token: SEC-") or line_clean.startswith("SEC-"):
            token = line_clean.replace("Security-Token: ", "").strip()
            break

    if not token:
        sys.stderr.write(f"[ERROR] Commit {commit_sha} does not contain required 'Security-Token: SEC-...' header.\n")
        sys.exit(1)

    valid, reason, _ = CryptoSigner.verify_token_header(token, tkt_id, pubkey_path)
    if not valid:
        sys.stderr.write(f"[ERROR] Commit {commit_sha} lease verification failed: {reason}\n")
        sys.exit(1)

    sys.exit(0)
