"""add chatbot conversation memory

Revision ID: 0019_chatbot_conversations
Revises: 0018_logs_status
Create Date: 2026-04-30 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0019_chatbot_conversations"
down_revision = "0018_logs_status"
branch_labels = None
depends_on = None

SCHEMA = "sm2racing"


def upgrade() -> None:
    op.create_table(
        "chatbot_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", sa.String(length=64), nullable=False),
        sa.Column("last_query", sa.Text(), nullable=True),
        sa.Column("last_intent", sa.String(length=64), nullable=True),
        sa.Column("last_response_kind", sa.String(length=32), nullable=True),
        sa.Column("last_response_status", sa.String(length=32), nullable=True),
        sa.Column("memory", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], [f"{SCHEMA}.users.id"]),
        sa.UniqueConstraint("user_id", "conversation_id", name="uq_chatbot_conversations_user_id_conversation_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chatbot_conversations_user_id",
        "chatbot_conversations",
        ["user_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chatbot_conversations_conversation_id",
        "chatbot_conversations",
        ["conversation_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_chatbot_conversations_conversation_id", table_name="chatbot_conversations", schema=SCHEMA)
    op.drop_index("ix_chatbot_conversations_user_id", table_name="chatbot_conversations", schema=SCHEMA)
    op.drop_table("chatbot_conversations", schema=SCHEMA)
