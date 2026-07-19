from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.database import get_db
from app.core.enums import UserRole
from app.models.user import User
from app.schemas.submission_ai_summary import SubmissionAiSummaryResponse
from app.services.submission_ai_summary_service import generate_submission_ai_summary


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/submissions")


@router.post(
    "/{submission_id}/ai-summary",
    response_model=SubmissionAiSummaryResponse,
    response_model_exclude_none=True,
)
def create_submission_ai_summary(
    submission_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> SubmissionAiSummaryResponse:
    logger.info(
        "Admin AI summary requested: submission_id=%s user_id=%s",
        submission_id,
        current_user.id,
    )
    return generate_submission_ai_summary(db, submission_id, current_user)
