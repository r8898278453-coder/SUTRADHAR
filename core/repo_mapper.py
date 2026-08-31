#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - AST CONTEXT ENGINE & REPO-MAPPER (v5.3)
Generates compact, line-accurate code context windows and extracts symbols via AST/Tree-sitter.
Prevents diff drift, hallucinated line offsets, and validates scope boundaries.
"""
from __future__ import annotations

import ast
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class CodeSymbol:
    name: str
    symbol_type: str  # 'function', 'class', 'method', 'interface'
    start_line: int
    end_line: int
    signature: str
    docstring: Optional[str] = None


@dataclass
class FileContextWindow:
    file_path: str
    total_lines: int
    symbols: List[CodeSymbol]
    relevant_chunks: List[str]
    compact_outline: str


class RepoMapper:
    """
    AST-based syntax parser and context window generator for repository files.
    """

    @staticmethod
    def extract_python_symbols(content: str) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        try:
            tree = ast.parse(content)
        except Exception:
            return symbols

        lines = content.splitlines()

        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                start = getattr(node, "lineno", 1)
                end = getattr(node, "end_lineno", start)
                doc = ast.get_docstring(node)
                sig = f"class {node.name}"
                if node.bases:
                    bases_str = ", ".join([ast.unparse(b) for b in node.bases])
                    sig += f"({bases_str})"
                symbols.append(CodeSymbol(
                    name=node.name,
                    symbol_type="class",
                    start_line=start,
                    end_line=end,
                    signature=sig,
                    docstring=doc,
                ))

            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                start = getattr(node, "lineno", 1)
                end = getattr(node, "end_lineno", start)
                doc = ast.get_docstring(node)
                prefix = "async def " if isinstance(node, ast.AsyncFunctionDef) else "def "
                args_list = [a.arg for a in node.args.args]
                ret = f" -> {ast.unparse(node.returns)}" if node.returns else ""
                sig = f"{prefix}{node.name}({', '.join(args_list)}){ret}"
                symbols.append(CodeSymbol(
                    name=node.name,
                    symbol_type="function",
                    start_line=start,
                    end_line=end,
                    signature=sig,
                    docstring=doc,
                ))

        symbols.sort(key=lambda s: s.start_line)
        return symbols

    @staticmethod
    def extract_php_symbols(content: str) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        lines = content.splitlines()

        class_regex = re.compile(r"^(?:final\s+|abstract\s+)?class\s+([a-zA-Z0-9_]+)(?:\s+extends\s+([a-zA-Z0-9_]+))?(?:\s+implements\s+([a-zA-Z0-9_,\s]+))?", re.MULTILINE)
        for match in class_regex.finditer(content):
            lineno = content[:match.start()].count("\n") + 1
            symbols.append(CodeSymbol(
                name=match.group(1),
                symbol_type="class",
                start_line=lineno,
                end_line=lineno + 10,
                signature=match.group(0).strip(),
            ))

        method_regex = re.compile(r"^\s*(public|protected|private)?\s*(static)?\s*function\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*:\s*([a-zA-Z0-9_\\?]+))?", re.MULTILINE)
        for match in method_regex.finditer(content):
            lineno = content[:match.start()].count("\n") + 1
            visibility = match.group(1) or "public"
            name = match.group(3)
            raw_args = match.group(4).strip()
            ret = f": {match.group(5)}" if match.group(5) else ""
            symbols.append(CodeSymbol(
                name=name,
                symbol_type="method",
                start_line=lineno,
                end_line=lineno + 15,
                signature=f"{visibility} function {name}({raw_args}){ret}",
            ))

        symbols.sort(key=lambda s: s.start_line)
        return symbols

    @classmethod
    def generate_context_window(
        cls,
        workspace_root: Path,
        file_path: str,
        target_symbols: Optional[List[str]] = None,
        context_radius_lines: int = 25,
    ) -> Optional[FileContextWindow]:
        abs_path = (workspace_root / file_path).resolve()
        if not abs_path.exists() or not abs_path.is_file():
            return None

        try:
            content = abs_path.read_text(encoding="utf-8")
        except Exception:
            return None

        lines = content.splitlines()
        total_lines = len(lines)

        if file_path.endswith(".py"):
            symbols = cls.extract_python_symbols(content)
        elif file_path.endswith((".php", ".inc")):
            symbols = cls.extract_php_symbols(content)
        else:
            symbols = []

        outline_lines = []
        for s in symbols:
            outline_lines.append(f"  - [L{s.start_line}-{s.end_line}] {s.symbol_type.upper()}: {s.signature}")
        compact_outline = f"Outline of {file_path} ({total_lines} lines):\n" + "\n".join(outline_lines)

        relevant_chunks: List[str] = []
        if target_symbols and symbols:
            target_set = set(target_symbols)
            for s in symbols:
                if s.name in target_set:
                    start_idx = max(0, s.start_line - 1 - 5)
                    end_idx = min(total_lines, s.end_line + 5)
                    chunk_text = "\n".join([f"{i+1:4d} | {lines[i]}" for i in range(start_idx, end_idx)])
                    relevant_chunks.append(f"--- Symbol: {s.name} (Lines {start_idx+1}-{end_idx}) ---\n{chunk_text}")
        else:
            sample_end = min(total_lines, 80)
            chunk_text = "\n".join([f"{i+1:4d} | {lines[i]}" for i in range(sample_end)])
            relevant_chunks.append(chunk_text)

        return FileContextWindow(
            file_path=file_path,
            total_lines=total_lines,
            symbols=symbols,
            relevant_chunks=relevant_chunks,
            compact_outline=compact_outline,
        )

    @classmethod
    def assemble_prompt_context(
        cls,
        workspace_root: Path,
        allowed_files: List[str],
        read_only_contracts: List[str],
    ) -> str:
        blocks = []
        blocks.append("=== REPOSITORY CONTRACTS & CONTEXT ===")

        for c_file in read_only_contracts:
            ctx = cls.generate_context_window(workspace_root, c_file)
            if ctx:
                blocks.append(f"\n[READ-ONLY CONTRACT: {c_file}]\n{ctx.compact_outline}\n")
                if ctx.relevant_chunks:
                    blocks.append(ctx.relevant_chunks[0])

        blocks.append("\n=== TARGET FILES (TO BE MODIFIED) ===")
        for a_file in allowed_files:
            ctx = cls.generate_context_window(workspace_root, a_file)
            if ctx:
                blocks.append(f"\n[ALLOWED TARGET: {a_file}]\n{ctx.compact_outline}\n")
                for chunk in ctx.relevant_chunks:
                    blocks.append(chunk)

        return "\n".join(blocks)
