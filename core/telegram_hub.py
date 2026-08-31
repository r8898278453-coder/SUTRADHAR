#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - TELEGRAM LIVE CARD & EVENT HUB (v5.3)
Asynchronous, non-blocking pinned card updater with strict flood control handling.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

try:
    from aiogram import Bot, Dispatcher
    from aiogram.exceptions import TelegramBadRequest, TelegramRetryAfter
    from aiogram.types import InlineKeyboardMarkup
    HAS_AIOGRAM = True
except ImportError:
    HAS_AIOGRAM = False

logger = logging.getLogger("sutradhar.telegram")


class TelegramHub:
    def __init__(self, bot_token: str, chat_id: int, pinned_message_id: Optional[int] = None):
        if not HAS_AIOGRAM:
            logger.warning("[TELEGRAM] aiogram library not found.")
            self.bot = None
        else:
            self.bot = Bot(token=bot_token)
            self.dp = Dispatcher()
        self.chat_id = chat_id
        self.pinned_message_id = pinned_message_id
        self._last_rendered_text: Optional[str] = None
        self._update_lock = asyncio.Lock()

    async def update_live_card(self, card_text: str, reply_markup=None) -> bool:
        if not self.bot:
            return False

        async with self._update_lock:
            if card_text == self._last_rendered_text and self.pinned_message_id is not None:
                return True

            if not self.pinned_message_id:
                try:
                    msg = await self.bot.send_message(
                        chat_id=self.chat_id,
                        text=card_text,
                        parse_mode=None,
                        reply_markup=reply_markup,
                    )
                    self.pinned_message_id = msg.message_id
                    await self.bot.pin_chat_message(chat_id=self.chat_id, message_id=self.pinned_message_id)
                    self._last_rendered_text = card_text
                    return True
                except Exception as e:
                    logger.error(f"[TELEGRAM] Failed to pin initial status message: {e}")
                    return False

            retries = 3
            while retries > 0:
                try:
                    await self.bot.edit_message_text(
                        chat_id=self.chat_id,
                        message_id=self.pinned_message_id,
                        text=card_text,
                        parse_mode=None,
                        reply_markup=reply_markup,
                    )
                    self._last_rendered_text = card_text
                    return True

                except TelegramBadRequest as ex:
                    if "message is not modified" in str(ex).lower():
                        self._last_rendered_text = card_text
                        return True
                    logger.warning(f"[TELEGRAM] Bad request during edit: {ex}")
                    return False

                except TelegramRetryAfter as ex:
                    logger.warning(f"[TELEGRAM] Flood limit reached. Sleeping {ex.retry_after}s...")
                    await asyncio.sleep(ex.retry_after + 0.5)
                    retries -= 1

                except Exception as ex:
                    logger.error(f"[TELEGRAM] Unexpected error updating pinned card: {ex}")
                    return False

            return False

    async def send_direct_alert(self, title: str, body: str, is_p0: bool = False) -> None:
        if not self.bot:
            return
        prefix = "🚨 [URGENT P0]" if is_p0 else "⚠️ [CLUSTER ALERT]"
        text = f"{prefix}\n<b>{title}</b>\n\n<code>{body}</code>"
        try:
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=text,
                parse_mode="HTML",
                disable_notification=False,
            )
        except Exception as e:
            logger.error(f"[TELEGRAM] Failed to send direct alert: {e}")

    async def close(self) -> None:
        if self.bot and hasattr(self.bot, "session"):
            await self.bot.session.close()
