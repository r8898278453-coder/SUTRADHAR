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

import subprocess
import tempfile
import uuid

try:
    from cryptography.hazmat.primitives.asymmetric import ed25519
    from cryptography.hazmat.primitives import serialization
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False


@dataclass(frozen=True)
class LeasePayload:
    token_id: str
    ticket_id: str
    worker_id: str
    epoch_id: int
    expiry_timestamp: int
    files_hash: str

    def to_canonical_bytes(self) -> bytes:
        data = {
            "epoch_id": self.epoch_id,
            "expiry_timestamp": self.expiry_timestamp,
            "files_hash": self.files_hash,
            "ticket_id": self.ticket_id,
            "token_id": self.token_id,
            "worker_id": self.worker_id,
        }
        return json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")

    @classmethod
    def from_canonical_bytes(cls, raw: bytes) -> LeasePayload:
        data = json.loads(raw.decode("utf-8"))
        return cls(
            token_id=data.get("token_id") or data.get("tokenId") or "",
            ticket_id=data.get("ticket_id") or data.get("ticketId") or "",
            worker_id=data.get("worker_id") or data.get("workerId") or "",
            epoch_id=int(data.get("epoch_id") or data.get("epochId") or 1),
            expiry_timestamp=int(data.get("expiry_timestamp") or data.get("expiryTimestamp") or 0),
            files_hash=data.get("files_hash") or data.get("filesHash") or "",
        )


def _safe_b64decode(s: str) -> bytes:
    # Normalize urlsafe and padding
    padded = s + "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


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
        token_id: Optional[str] = None,
    ) -> str:
        expiry = int(time.time()) + ttl_seconds
        payload = LeasePayload(
            token_id=token_id or f"tok_{uuid.uuid4().hex[:12]}",
            ticket_id=ticket_id,
            worker_id=worker_id,
            epoch_id=epoch_id,
            expiry_timestamp=expiry,
            files_hash=CryptoSigner.calculate_files_hash(allowed_files),
        )

        canonical_bytes = payload.to_canonical_bytes()

        if HAS_CRYPTOGRAPHY:
            with open(private_key_path, "rb") as f:
                private_key = serialization.load_pem_private_key(f.read(), password=None)
            if not isinstance(private_key, ed25519.Ed25519PrivateKey):
                raise TypeError("Only Ed25519 keys are permitted for lease signing.")
            signature = private_key.sign(canonical_bytes)
        else:
            # Fallback to OpenSSL CLI
            with tempfile.NamedTemporaryFile("wb", delete=False) as f_msg, \
                 tempfile.NamedTemporaryFile("wb", delete=False) as f_sig:
                f_msg.write(canonical_bytes)
                f_msg.flush()
                msg_path, sig_path = f_msg.name, f_sig.name
            try:
                res = subprocess.run([
                    "openssl", "pkeyutl", "-sign", "-inkey", private_key_path,
                    "-rawin", "-in", msg_path, "-out", sig_path
                ], capture_output=True, text=True)
                if res.returncode != 0:
                    raise RuntimeError(f"OpenSSL signing failed: {res.stderr}")
                with open(sig_path, "rb") as sf:
                    signature = sf.read()
            finally:
                if os.path.exists(msg_path): os.unlink(msg_path)
                if os.path.exists(sig_path): os.unlink(sig_path)

        payload_b64 = base64.urlsafe_b64encode(canonical_bytes).decode("ascii").rstrip("=")
        sig_b64 = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")

        return f"SEC-{payload_b64}.{sig_b64}"

    @staticmethod
    def verify_token_header(
        token_str: str,
        expected_ticket_id: str,
        public_key_path: str,
        expected_epoch_id: Optional[int] = None,
        expected_files: Optional[list[str]] = None,
        revoked_token_ids: Optional[set[str]] = None,
    ) -> Tuple[bool, str, Optional[LeasePayload]]:
        try:
            if not token_str.startswith("SEC-"):
                return False, "Malformed token header prefix (must start with SEC-)", None

            raw_token = token_str[4:].strip()
            parts = raw_token.split(".")
            if len(parts) != 2:
                return False, "Token format invalid: expected <payload_b64>.<signature_b64>", None

            payload_bytes = _safe_b64decode(parts[0])
            signature_bytes = _safe_b64decode(parts[1])

            if not os.path.exists(public_key_path):
                return False, f"Master public key file not found at {public_key_path}", None

            # 1. Cryptographic Signature Verification
            if HAS_CRYPTOGRAPHY:
                with open(public_key_path, "rb") as f:
                    public_key_data = f.read()
                public_key = serialization.load_pem_public_key(public_key_data)
                if not isinstance(public_key, ed25519.Ed25519PublicKey):
                    return False, "Public key must be Ed25519", None
                try:
                    public_key.verify(signature_bytes, payload_bytes)
                except Exception as ex:
                    return False, f"Ed25519 cryptographic signature mismatch: {ex}", None
            else:
                # OpenSSL verify fallback
                with tempfile.NamedTemporaryFile("wb", delete=False) as f_msg, \
                     tempfile.NamedTemporaryFile("wb", delete=False) as f_sig:
                    f_msg.write(payload_bytes)
                    f_sig.write(signature_bytes)
                    f_msg.flush()
                    f_sig.flush()
                    msg_path, sig_path = f_msg.name, f_sig.name
                try:
                    res = subprocess.run([
                        "openssl", "pkeyutl", "-verify", "-pubin", "-inkey", public_key_path,
                        "-rawin", "-in", msg_path, "-sigfile", sig_path
                    ], capture_output=True, text=True)
                    if res.returncode != 0:
                        return False, f"Ed25519 signature invalid: {res.stderr.strip()}", None
                finally:
                    if os.path.exists(msg_path): os.unlink(msg_path)
                    if os.path.exists(sig_path): os.unlink(sig_path)

            payload = LeasePayload.from_canonical_bytes(payload_bytes)

            # 2. Verify Revocation
            if revoked_token_ids and payload.token_id in revoked_token_ids:
                return False, f"Token {payload.token_id} has been revoked", payload

            # 3. Verify Target Ticket ID match
            if payload.ticket_id != expected_ticket_id:
                return False, f"Ticket mismatch: token issued for {payload.ticket_id}, target branch is {expected_ticket_id}", payload

            # 4. Verify Expiration TTL (expiry_timestamp in seconds or ms)
            now = int(time.time())
            exp = payload.expiry_timestamp
            # If timestamp in ms, convert to seconds
            if exp > 100000000000:
                exp = int(exp / 1000)
            if now > exp:
                return False, f"Lease expired at timestamp {exp} (current time: {now})", payload

            # 5. Verify Epoch (if provided)
            if expected_epoch_id is not None and payload.epoch_id != expected_epoch_id:
                return False, f"Stale Epoch: token from Epoch #{payload.epoch_id}, cluster is on #{expected_epoch_id}", payload

            # 6. Verify Files Hash (if provided)
            if expected_files is not None:
                expected_hash = CryptoSigner.calculate_files_hash(expected_files)
                if payload.files_hash != expected_hash:
                    return False, f"Files hash mismatch: expected {expected_hash}, token has {payload.files_hash}", payload

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
