from __future__ import annotations

import logging
import time as time_module
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_session_local
from app.core.enums import SubmissionStatus
from app.models.submission import Submission
from app.services.make_webhook_service import MakeWebhookDeliveryError, send_submission_to_make


settings = get_settings()
DB_SCHEMA = settings.database_schema
MAX_DELIVERY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = (1, 2, 4)
logger = logging.getLogger(__name__)


def _table(name: str) -> str:
    return f"{DB_SCHEMA}.{name}"


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _outbox_identity(submission: Submission) -> tuple[str, str]:
    correlation_id = _clean_text(getattr(submission, "correlation_id", None)) or submission.submission_ref
    return correlation_id, submission.submission_ref


def _fetch_outbox(db: Session, submission_id: UUID) -> dict[str, Any] | None:
    return (
        db.execute(
            text(
                f"""
                SELECT *
                FROM {_table("submission_delivery_outbox")}
                WHERE submission_id = :submission_id
                """
            ),
            {"submission_id": submission_id},
        )
        .mappings()
        .first()
    )


def enqueue_submission_delivery(
    db: Session,
    submission: Submission,
    *,
    submission_input_id: int | None = None,
) -> str | None:
    if not settings.make_webhook_url:
        return None

    correlation_id, submission_ref = _outbox_identity(submission)
    db.execute(
        text(
            f"""
            INSERT INTO {_table("submission_delivery_outbox")} (
                id,
                submission_id,
                submission_ref,
                correlation_id,
                submission_input_id,
                delivery_status,
                attempt_count,
                next_attempt_at,
                created_at,
                updated_at
            ) VALUES (
                :id,
                :submission_id,
                :submission_ref,
                :correlation_id,
                :submission_input_id,
                'PENDING',
                0,
                now(),
                now(),
                now()
            )
            ON CONFLICT (submission_id) DO UPDATE
            SET submission_ref = EXCLUDED.submission_ref,
                correlation_id = EXCLUDED.correlation_id,
                submission_input_id = COALESCE(EXCLUDED.submission_input_id, {_table("submission_delivery_outbox")}.submission_input_id),
                delivery_status = 'PENDING',
                attempt_count = 0,
                last_attempt_at = NULL,
                next_attempt_at = now(),
                last_error_code = NULL,
                last_error_message = NULL,
                delivered_at = NULL,
                updated_at = now()
            """
        ),
        {
            "id": submission.id,
            "submission_id": submission.id,
            "submission_ref": submission_ref,
            "correlation_id": correlation_id,
            "submission_input_id": submission_input_id,
        },
    )
    return correlation_id


def _mark_outbox_status(
    db: Session,
    *,
    submission_id: UUID,
    delivery_status: str,
    attempt_count: int,
    last_attempt_at: datetime | None = None,
    next_attempt_at: datetime | None = None,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
    delivered_at: datetime | None = None,
) -> None:
    db.execute(
        text(
            f"""
            UPDATE {_table("submission_delivery_outbox")}
            SET delivery_status = :delivery_status,
                attempt_count = :attempt_count,
                last_attempt_at = :last_attempt_at,
                next_attempt_at = :next_attempt_at,
                last_error_code = :last_error_code,
                last_error_message = :last_error_message,
                delivered_at = :delivered_at,
                updated_at = now()
            WHERE submission_id = :submission_id
            """
        ),
        {
            "submission_id": submission_id,
            "delivery_status": delivery_status,
            "attempt_count": attempt_count,
            "last_attempt_at": last_attempt_at,
            "next_attempt_at": next_attempt_at,
            "last_error_code": last_error_code,
            "last_error_message": last_error_message,
            "delivered_at": delivered_at,
        },
    )


def _delivery_error_message(exc: MakeWebhookDeliveryError) -> str:
    return f"[{exc.code}] {exc}"


def process_submission_delivery(
    db: Session,
    submission_id: UUID,
    *,
    submission_input_id: int | None = None,
    max_attempts: int = MAX_DELIVERY_ATTEMPTS,
) -> Submission | None:
    submission = db.get(Submission, submission_id)
    if submission is None:
        return None

    outbox = _fetch_outbox(db, submission_id)
    if outbox is None and settings.make_webhook_url:
        enqueue_submission_delivery(
            db,
            submission,
            submission_input_id=submission_input_id,
        )
        db.flush()
        outbox = _fetch_outbox(db, submission_id)

    if not settings.make_webhook_url:
        submission.status = SubmissionStatus.SENT
        submission.error_message = None
        _mark_outbox_status(
            db,
            submission_id=submission_id,
            delivery_status="DELIVERED",
            attempt_count=int(outbox["attempt_count"]) if outbox else 0,
            delivered_at=datetime.now(timezone.utc),
        )
        db.commit()
        db.refresh(submission)
        return submission

    attempts = int(outbox["attempt_count"]) if outbox else 0
    submission_input_value = submission_input_id or (int(outbox["submission_input_id"]) if outbox and outbox["submission_input_id"] else None)

    for attempt_number in range(attempts + 1, max_attempts + 1):
        attempt_started_at = datetime.now(timezone.utc)
        _mark_outbox_status(
            db,
            submission_id=submission_id,
            delivery_status="DELIVERING",
            attempt_count=attempt_number - 1,
            last_attempt_at=attempt_started_at,
            next_attempt_at=attempt_started_at,
        )
        db.commit()

        try:
            send_submission_to_make(submission, submission_input_id=submission_input_value)
            submission.status = SubmissionStatus.SENT
            submission.error_message = None
            _mark_outbox_status(
                db,
                submission_id=submission_id,
                delivery_status="DELIVERED",
                attempt_count=attempt_number,
                last_attempt_at=attempt_started_at,
                next_attempt_at=None,
                delivered_at=datetime.now(timezone.utc),
            )
            db.commit()
            db.refresh(submission)
            return submission
        except MakeWebhookDeliveryError as exc:
            retryable = exc.retryable and attempt_number < max_attempts
            next_attempt_at = (
                datetime.now(timezone.utc)
                + timedelta(seconds=RETRY_BACKOFF_SECONDS[min(attempt_number - 1, len(RETRY_BACKOFF_SECONDS) - 1)])
                if retryable
                else None
            )
            _mark_outbox_status(
                db,
                submission_id=submission_id,
                delivery_status="RETRYING" if retryable else "FAILED",
                attempt_count=attempt_number,
                last_attempt_at=datetime.now(timezone.utc),
                next_attempt_at=next_attempt_at,
                last_error_code=exc.code,
                last_error_message=str(exc),
            )
            if retryable:
                db.commit()
                time_module.sleep(
                    RETRY_BACKOFF_SECONDS[min(attempt_number - 1, len(RETRY_BACKOFF_SECONDS) - 1)]
                )
                continue

            submission.status = SubmissionStatus.FAILED
            submission.error_message = _delivery_error_message(exc)
            db.commit()
            db.refresh(submission)
            return submission

    submission.status = SubmissionStatus.FAILED
    submission.error_message = "MAKE_WEBHOOK_RETRY_EXHAUSTED"
    db.commit()
    db.refresh(submission)
    return submission


def process_submission_delivery_task(
    submission_id: UUID,
    *,
    submission_input_id: int | None = None,
) -> None:
    session_local = get_session_local()
    db = session_local()
    try:
        process_submission_delivery(
            db,
            submission_id,
            submission_input_id=submission_input_id,
        )
    except Exception:  # pragma: no cover - defensive background delivery guard
        logger.exception("Submission delivery task failed", extra={"submission_id": str(submission_id)})
    finally:
        db.close()
