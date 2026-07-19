from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import ConfigDict, Field

from app.schemas.common import ORMModel
from app.schemas.submission import SubmissionRead


class SubmissionAiSummaryEntry(ORMModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    summary_id: str | None = Field(default=None, alias="summaryId")
    generated_at: datetime = Field(alias="generatedAt")
    summary: str
    key_observations: list[str] = Field(default_factory=list, alias="keyObservations")
    needs_review: list[str] = Field(default_factory=list, alias="needsReview")
    recommended_actions: list[str] = Field(default_factory=list, alias="recommendedActions")
    generated_by: str | None = Field(default=None, alias="generatedBy")
    model: str | None = None


class SubmissionAiSummaryResponse(SubmissionAiSummaryEntry):
    submission_id: UUID = Field(alias="submissionId")
    submission_ref: str = Field(alias="submissionRef")
    summary_history: list[SubmissionAiSummaryEntry] = Field(
        default_factory=list,
        alias="summaryHistory",
    )
    submission: SubmissionRead | None = None
