#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - CONTEXT-PRESERVING LLM CASCADE ROUTER (v5.3)
Leaky-bucket rate-limited router cascading across Gemini Pro and OpenRouter free models.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

logger = logging.getLogger("sutradhar.llm")


@dataclass
class LLMResponse:
    success: bool
    diff_content: str
    provider_used: str
    model_used: str
    latency_seconds: float
    error: Optional[str] = None


class TokenBucketLimiter:
    def __init__(self, max_rpm: float = 10.0):
        self.capacity = max_rpm
        self.tokens = max_rpm
        self.fill_rate = max_rpm / 60.0  # tokens per second
        self.last_update = time.time()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.time()
                elapsed = now - self.last_update
                self.tokens = min(self.capacity, self.tokens + elapsed * self.fill_rate)
                self.last_update = now

                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    return

                wait_time = (1.0 - self.tokens) / self.fill_rate
                await asyncio.sleep(max(0.1, wait_time))


class LLMRouter:
    CASCADE_TIERS = [
        {"provider": "gemini", "model": "gemini-3.7-flash", "env_key": "GEMINI_API_KEY"},
        {"provider": "openrouter", "model": "deepseek/deepseek-r1:free", "env_key": "OPENROUTER_API_KEY"},
        {"provider": "openrouter", "model": "qwen/qwen-2.5-coder-32b-instruct:free", "env_key": "OPENROUTER_API_KEY"},
        {"provider": "openrouter", "model": "meta-llama/llama-3.3-70b-instruct:free", "env_key": "OPENROUTER_API_KEY"},
        {"provider": "openrouter", "model": "google/gemini-flash-1.5-8b:free", "env_key": "OPENROUTER_API_KEY"},
    ]

    def __init__(self, limiter: Optional[TokenBucketLimiter] = None):
        self.limiter = limiter or TokenBucketLimiter(max_rpm=10.0)

    def _build_system_prompt(self, allowed_files: List[str]) -> str:
        files_str = "\n".join([f"- {f}" for f in allowed_files])
        return (
            "You are an autonomous senior engineer in the Sutradhar Swarm.\n"
            "STRICT RULES:\n"
            "1. Output ONLY a valid unified diff (diff --git format).\n"
            "2. Modify ONLY files within the allowed_files whitelist:\n"
            f"{files_str}\n"
            "3. Do NOT include markdown ```diff fences, conversational text, or commentary.\n"
            "4. Start immediately with 'diff --git a/... b/...'."
        )

    def _construct_messages(
        self,
        prompt: str,
        allowed_files: List[str],
        debugging_history: List[Dict[str, str]],
        prior_diff: Optional[str] = None,
        prior_stderr: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        messages = [{"role": "system", "content": self._build_system_prompt(allowed_files)}]
        messages.append({"role": "user", "content": f"Task Specification:\n{prompt}"})

        for turn in debugging_history:
            messages.append(turn)

        if prior_stderr and prior_diff:
            feedback = (
                f"Your prior diff failed execution.\n"
                f"PRIOR DIFF:\n{prior_diff}\n\n"
                f"CAPTURED STACKTRACE / STDERR:\n{prior_stderr}\n\n"
                f"Fix the error completely. Output the full corrected unified diff."
            )
            messages.append({"role": "user", "content": feedback})

        return messages

    def synthesize_patch(
        self,
        ticket_id: str,
        prompt: str,
        allowed_files: List[str],
        debugging_history: List[Dict[str, str]],
        retry_count: int = 0,
        prior_diff: Optional[str] = None,
        prior_stderr: Optional[str] = None,
    ) -> LLMResponse:
        return asyncio.run(
            self.synthesize_patch_async(
                ticket_id=ticket_id,
                prompt=prompt,
                allowed_files=allowed_files,
                debugging_history=debugging_history,
                retry_count=retry_count,
                prior_diff=prior_diff,
                prior_stderr=prior_stderr,
            )
        )

    async def synthesize_patch_async(
        self,
        ticket_id: str,
        prompt: str,
        allowed_files: List[str],
        debugging_history: List[Dict[str, str]],
        retry_count: int = 0,
        prior_diff: Optional[str] = None,
        prior_stderr: Optional[str] = None,
    ) -> LLMResponse:
        if not HAS_HTTPX:
            return LLMResponse(
                success=False,
                diff_content="",
                provider_used="NONE",
                model_used="NONE",
                latency_seconds=0.0,
                error="httpx library not installed",
            )

        messages = self._construct_messages(prompt, allowed_files, debugging_history, prior_diff, prior_stderr)

        for tier in self.CASCADE_TIERS:
            api_key = os.environ.get(tier["env_key"])
            if not api_key:
                continue

            await self.limiter.acquire()
            t0 = time.time()

            try:
                if tier["provider"] == "gemini":
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{tier['model']}:generateContent?key={api_key}"
                    contents = []
                    for m in messages:
                        contents.append({
                            "role": "user" if m["role"] in ["user", "system"] else "model",
                            "parts": [{"text": m["content"]}]
                        })
                    
                    async with httpx.AsyncClient(timeout=45.0) as client:
                        resp = await client.post(url, json={"contents": contents})
                        if resp.status_code == 200:
                            data = resp.json()
                            diff_text = data["candidates"][0]["content"]["parts"][0]["text"]
                            return LLMResponse(
                                success=True,
                                diff_content=diff_text,
                                provider_used=tier["provider"],
                                model_used=tier["model"],
                                latency_seconds=time.time() - t0,
                            )
                else:
                    async with httpx.AsyncClient(timeout=45.0) as client:
                        resp = await client.post(
                            "https://openrouter.ai/api/v1/chat/completions",
                            headers={"Authorization": f"Bearer {api_key}"},
                            json={"model": tier["model"], "messages": messages, "temperature": 0.2},
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            diff_text = data["choices"][0]["message"]["content"]
                            return LLMResponse(
                                success=True,
                                diff_content=diff_text,
                                provider_used=tier["provider"],
                                model_used=tier["model"],
                                latency_seconds=time.time() - t0,
                            )

            except Exception as ex:
                logger.warning(f"[CASCADE] Tier {tier['model']} failed: {ex}. Falling to next tier...")
                continue

        return LLMResponse(
            success=False,
            diff_content="",
            provider_used="NONE",
            model_used="NONE",
            latency_seconds=0.0,
            error="All LLM cascade tiers exhausted without successful response.",
        )
