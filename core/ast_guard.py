#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - AST STATIC BOUNDARY & SIGNATURE GUARD (v5.3)
Protects shared interfaces and validates zero-breaking-change backwards compatibility.
"""
from __future__ import annotations

import ast
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class MethodSignature:
    name: str
    args: List[str]
    return_type: Optional[str]
    visibility: str


class ASTBoundaryGuard:
    @staticmethod
    def inspect_python_signatures(file_content: str) -> Dict[str, MethodSignature]:
        tree = ast.parse(file_content)
        signatures = {}

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name.startswith("_"):
                    continue
                args = [arg.arg for arg in node.args.args]
                ret_type = ast.unparse(node.returns) if node.returns else None
                signatures[node.name] = MethodSignature(
                    name=node.name,
                    args=args,
                    return_type=ret_type,
                    visibility="public",
                )
        return signatures

    @staticmethod
    def inspect_php_signatures(file_content: str) -> Dict[str, MethodSignature]:
        signatures = {}
        pattern = re.compile(
            r"public\s+function\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*:\s*([a-zA-Z0-9_\\?]+))?\s*;",
            re.MULTILINE | re.DOTALL,
        )

        for match in pattern.finditer(file_content):
            method_name = match.group(1)
            raw_args = match.group(2).strip()
            return_type = match.group(3)

            args = []
            if raw_args:
                for arg in raw_args.split(","):
                    args.append(arg.strip())

            signatures[method_name] = MethodSignature(
                name=method_name,
                args=args,
                return_type=return_type,
                visibility="public",
            )
        return signatures

    @classmethod
    def verify_interface_compatibility(
        cls,
        original_content: str,
        modified_content: str,
        file_path: str,
    ) -> Tuple[bool, Optional[str]]:
        if file_path.endswith(".py"):
            orig_sigs = cls.inspect_python_signatures(original_content)
            mod_sigs = cls.inspect_python_signatures(modified_content)
        elif file_path.endswith(".php"):
            orig_sigs = cls.inspect_php_signatures(original_content)
            mod_sigs = cls.inspect_php_signatures(modified_content)
        else:
            return True, None

        for name, orig_sig in orig_sigs.items():
            if name not in mod_sigs:
                return False, f"AST Breaking Change: Public method '{name}' was deleted from interface."

            mod_sig = mod_sigs[name]
            if len(orig_sig.args) != len(mod_sig.args):
                return False, f"AST Breaking Change: Method '{name}' parameter count changed ({len(orig_sig.args)} -> {len(mod_sig.args)})."

            if orig_sig.return_type and orig_sig.return_type != mod_sig.return_type:
                return False, f"AST Breaking Change: Method '{name}' return type modified ('{orig_sig.return_type}' -> '{mod_sig.return_type}')."

        return True, None
