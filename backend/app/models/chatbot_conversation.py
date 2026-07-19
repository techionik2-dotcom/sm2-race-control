from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class ChatbotConversation(Base, TimestampMixin):
    __tablename__ = "chatbot_conversations"
    __table_args__ = (
        UniqueConstraint("user_id", "conversation_id", name="uq_chatbot_conversations_user_id_conversation_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    last_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_intent: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_response_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_response_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    memory: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
