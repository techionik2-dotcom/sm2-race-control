"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ProtectedRoute from "../../../components/ProtectedRoute";
import Loader from "../../../components/Common/Loader";
import { getOcrDraftsByEvent, getSubmissionsByEvent } from "../../../utils/submissionApi";
import SubmissionsTable from "../../../components/Submissions/SubmissionTable";
import SubmissionDrawer from "../../../components/Submissions/SubmissionDrawer";
import "./SubmissionsHistory.css";

const formatDraftDateTime = (value) => {
  if (!value) return "Recently staged";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently staged";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

const formatDraftConfidence = (value) => {
  if (value === null || value === undefined) return "Pending";
  const percent = value <= 1 ? value * 100 : value;
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
};

const buildReviewHref = (eventId, draft) => {
  const params = new URLSearchParams();
  if (draft?.correlationId) {
    params.set("correlation_id", draft.correlationId);
  }
  if (draft?.submissionRef) {
    params.set("submission_ref", draft.submissionRef);
  }
  const query = params.toString();
  return `/event/${eventId}/ocr-review${query ? `?${query}` : ""}`;
};

export default function SubmissionsPage() {
  const router = useRouter();
  const params = useParams();
  const routeEventId = params?.eventId;

  const [submissions, setSubmissions] = useState([]);
  const [ocrDrafts, setOcrDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const refreshData = useCallback(
    async ({ showSpinner = true } = {}) => {
      if (!routeEventId) {
        router.push("/events");
        return;
      }

      try {
        if (showSpinner) {
          setLoading(true);
        }

        setPageError("");

        const [submissionResponse, draftResponse] = await Promise.all([
          getSubmissionsByEvent(routeEventId),
          getOcrDraftsByEvent(routeEventId),
        ]);
        const list =
          submissionResponse?.submissions || submissionResponse?.data || submissionResponse || [];
        setSubmissions(Array.isArray(list) ? list : []);
        setOcrDrafts(Array.isArray(draftResponse) ? draftResponse : []);
      } catch (error) {
        console.error("Failed to load submissions", error);
        setSubmissions([]);
        setOcrDrafts([]);
        setPageError("Failed to load submissions. Please refresh and try again.");
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    [routeEventId, router],
  );

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  if (loading && submissions.length === 0) {
    return (
      <ProtectedRoute requireDriver={false}>
        <Loader
          fullHeight
          label="Loading submissions"
          sublabel="Fetching notes for the selected event..."
        />
      </ProtectedRoute>
    );
  }

  return (
      <ProtectedRoute requireDriver={false}>
      <div className="submissions-history-page">
        <div className="submissions-history-orb submissions-history-orb-one" />
        <div className="submissions-history-orb submissions-history-orb-two" />

        <div className="submissions-history-shell submissions-notes-shell">
          <header className="submissions-notes-header">
            <div>
              <p className="submissions-table-eyebrow">Submission Notes</p>
              <h1 className="submissions-notes-title">Notes Feed</h1>
              <p className="submissions-notes-subtitle">
                Only the submission notes for the selected event and run group
                are shown here.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary submissions-notes-refresh"
              onClick={() => refreshData({ showSpinner: true })}
              disabled={loading}
            >
              <RefreshRoundedIcon fontSize="inherit" />
              Refresh
            </button>
          </header>

          {pageError ? (
            <div className="page-banner error submissions-notes-banner">
              <strong>Error.</strong>
              <span>{pageError}</span>
            </div>
          ) : null}

          <section className="submissions-ocr-stage-panel">
            <div className="submissions-ocr-stage-header">
              <div>
                <p className="submissions-table-eyebrow">OCR Staging</p>
                <h2 className="submissions-ocr-stage-title">Pending OCR Drafts</h2>
                <p className="submissions-ocr-stage-subtitle">
                  Make.com OCR callbacks are staged first. Open any staged draft to review and submit it into the
                  final notes feed.
                </p>
              </div>
              <span className="submissions-ocr-stage-count">
                {ocrDrafts.length} draft{ocrDrafts.length === 1 ? "" : "s"}
              </span>
            </div>

            {ocrDrafts.length ? (
              <div className="submissions-ocr-stage-list">
                {ocrDrafts.map((draft) => (
                  <article
                    key={draft.submissionInputId || draft.correlationId || draft.submissionRef}
                    className="submissions-ocr-stage-card"
                  >
                    <div className="submissions-ocr-stage-meta">
                      <span>{formatDraftDateTime(draft.createdAt)}</span>
                      <span>{draft.templateType || draft.documentType || "OCR draft"}</span>
                      <span>{draft.track || "Track pending"}</span>
                    </div>
                    <div className="submissions-ocr-stage-main">
                      <div>
                        <h3>{draft.submissionRef || draft.correlationId || "Staged OCR draft"}</h3>
                        <p>
                          {(draft.validationMessage || "Ready for manual review.").trim()}
                        </p>
                      </div>
                      <div className="submissions-ocr-stage-badges">
                        <span className="submissions-ocr-stage-pill">
                          Review {draft.reviewStatus || "PENDING"}
                        </span>
                        <span className="submissions-ocr-stage-pill">
                          Confidence {formatDraftConfidence(draft.confidence)}
                        </span>
                        <span className="submissions-ocr-stage-pill">
                          {draft.normalized ? "Mapped" : "Raw only"}
                        </span>
                      </div>
                    </div>
                    <div className="submissions-ocr-stage-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => router.push(buildReviewHref(routeEventId, draft))}
                      >
                        Resume Review
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="submissions-ocr-stage-empty">
                No staged OCR drafts are waiting for review for this event right now.
              </div>
            )}
          </section>

          <SubmissionsTable
            submissions={submissions}
            loading={loading}
            onView={(id) => setSelectedId(id)}
          />
        </div>

        <SubmissionDrawer
          open={Boolean(selectedId)}
          submissionId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
