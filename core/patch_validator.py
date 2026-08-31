#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - 3-TIER UNIFIED DIFF NORMALIZER & SANITIZER (v5.3)
Sanitizes raw LLM output, validates scope boundaries, and executes 3-tier fallback.
"""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Set, Tuple


@dataclass
class NormalizerResult:
    success: bool
    tier_used: int
    sanitized_diff: str
    modified_files: List[str]
    error_message: Optional[str] = None


class PatchValidator:
    DIFF_FILE_HEADER_REGEX = re.compile(r"^(?:---|\+\+\+)\s+[ab]/(.+)$", re.MULTILINE)

    @staticmethod
    def sanitize_llm_diff(raw_text: str) -> str:
        """
        Strips markdown code fences, prose, and normalizes line endings to UNIX LF.
        """
        text = raw_text.replace("\r\n", "\n").replace("\r", "\n")

        if "```" in text:
            fence_match = re.search(r"```(?:diff|patch)?\n(.*?)\n```", text, re.DOTALL)
            if fence_match:
                text = fence_match.group(1)
            else:
                lines = [line for line in text.splitlines() if not line.strip().startswith("```")]
                text = "\n".join(lines)

        lines = text.split("\n")
        start_idx = -1
        for i, line in enumerate(lines):
            if line.startswith("diff --git") or line.startswith("--- ") or line.startswith("Index: "):
                start_idx = i
                break

        if start_idx != -1:
            lines = lines[start_idx:]

        cleaned_lines = []
        for line in lines:
            if line.startswith(("diff --git", "--- ", "+++ ", "@@ ", "index ", "new file mode", "deleted file mode", "similarity index", "rename from", "rename to", " ", "+", "-")):
                cleaned_lines.append(line)
            elif not line.strip():
                cleaned_lines.append("")
            else:
                if cleaned_lines and any(l.startswith("@@ ") for l in cleaned_lines):
                    break

        sanitized = "\n".join(cleaned_lines).strip() + "\n"
        return sanitized

    @staticmethod
    def extract_modified_files(diff_text: str) -> Set[str]:
        """
        Extracts clean target file paths from the diff headers.
        """
        files = set()
        for line in diff_text.splitlines():
            if line.startswith("+++ b/"):
                file_path = line[6:].strip()
                if file_path != "/dev/null":
                    files.add(os.path.normpath(file_path))
            elif line.startswith("--- a/"):
                file_path = line[6:].strip()
                if file_path != "/dev/null":
                    files.add(os.path.normpath(file_path))
        return files

    @staticmethod
    def validate_whitelist_boundaries(
        modified_files: Set[str],
        allowed_files: List[str],
        read_only_contracts: List[str],
    ) -> Tuple[bool, Optional[str]]:
        """
        Verifies no path traversal exists and all modified files are explicitly whitelisted.
        """
        allowed_set = {os.path.normpath(f.strip()) for f in allowed_files if f.strip()}
        readonly_set = {os.path.normpath(f.strip()) for f in read_only_contracts if f.strip()}

        for file_path in modified_files:
            if file_path.startswith("..") or os.path.isabs(file_path):
                return False, f"Security Violation: Path traversal detected '{file_path}'"

            if file_path in readonly_set:
                return False, f"Domain Violation: '{file_path}' is protected by read_only_contracts."

            if file_path not in allowed_set:
                return False, f"Blast Radius Violation: '{file_path}' is outside allowed_files whitelist: {sorted(list(allowed_set))}"

        return True, None

    @classmethod
    def apply_patch_with_fallback(
        cls,
        workspace_path: str,
        raw_diff: str,
        allowed_files: List[str],
        read_only_contracts: List[str],
    ) -> NormalizerResult:
        """
        Applies patch using 3-tier fallback hierarchy after strict sanitization and whitelist verification.
        """
        sanitized = cls.sanitize_llm_diff(raw_diff)
        if not sanitized.strip():
            return NormalizerResult(
                success=False,
                tier_used=0,
                sanitized_diff="",
                modified_files=[],
                error_message="Diff sanitization resulted in empty patch content.",
            )

        mod_files = cls.extract_modified_files(sanitized)
        if not mod_files:
            return NormalizerResult(
                success=False,
                tier_used=0,
                sanitized_diff=sanitized,
                modified_files=[],
                error_message="No valid unified diff file headers found (missing '--- a/' or '+++ b/').",
            )

        valid, err = cls.validate_whitelist_boundaries(mod_files, allowed_files, read_only_contracts)
        if not valid:
            return NormalizerResult(
                success=False,
                tier_used=0,
                sanitized_diff=sanitized,
                modified_files=list(mod_files),
                error_message=err,
            )

        patch_file = Path(workspace_path) / ".sutradhar_incoming.patch"
        try:
            patch_file.write_text(sanitized, encoding="utf-8")

            # Tier 1: Strict Check
            t1 = subprocess.run(
                ["git", "apply", "--check", str(patch_file.name)],
                cwd=workspace_path,
                capture_output=True,
                text=True,
            )
            if t1.returncode == 0:
                subprocess.run(["git", "apply", str(patch_file.name)], cwd=workspace_path, check=True)
                return NormalizerResult(
                    success=True, tier_used=1, sanitized_diff=sanitized, modified_files=list(mod_files)
                )

            # Tier 2: Whitespace-tolerant check
            t2 = subprocess.run(
                ["git", "apply", "--ignore-whitespace", "--ignore-space-change", "--check", str(patch_file.name)],
                cwd=workspace_path,
                capture_output=True,
                text=True,
            )
            if t2.returncode == 0:
                subprocess.run(
                    ["git", "apply", "--ignore-whitespace", "--ignore-space-change", str(patch_file.name)],
                    cwd=workspace_path,
                    check=True,
                )
                return NormalizerResult(
                    success=True, tier_used=2, sanitized_diff=sanitized, modified_files=list(mod_files)
                )

            # Tier 3: 3-Way Merge fallback
            t3 = subprocess.run(
                ["git", "apply", "--3way", str(patch_file.name)],
                cwd=workspace_path,
                capture_output=True,
                text=True,
            )
            if t3.returncode == 0:
                return NormalizerResult(
                    success=True, tier_used=3, sanitized_diff=sanitized, modified_files=list(mod_files)
                )

            combined_err = f"Tier 1 Err: {t1.stderr.strip()} | Tier 2 Err: {t2.stderr.strip()} | Tier 3 Err: {t3.stderr.strip()}"
            return NormalizerResult(
                success=False,
                tier_used=3,
                sanitized_diff=sanitized,
                modified_files=list(mod_files),
                error_message=f"3-Tier Normalizer failed: {combined_err}",
            )

        finally:
            if patch_file.exists():
                patch_file.unlink(missing_ok=True)
