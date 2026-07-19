"use client";

import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import StatusBadge from "../../../components/Common/StatusBadge";
import { formatDateTime } from "../../fleet/_components/fleetManagementHelpers";

const formatListSection = (title, items) => {
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return [
    title,
    normalizedItems.length ? normalizedItems.map((item) => `- ${item}`).join("\n") : "- None listed.",
  ].join("\n");
};

export const buildAiSummaryCopyText = (summary) => {
  if (!summary) {
    return "";
  }

  return [
    "AI Summary",
    summary.generatedAt ? `Generated: ${formatDateTime(summary.generatedAt)}` : null,
    "",
    "Session Summary",
    summary.summary || "No session summary available.",
    "",
    formatListSection("Key Observations", summary.keyObservations),
    "",
    formatListSection("Needs Review", summary.needsReview),
    "",
    formatListSection("Recommended Actions", summary.recommendedActions),
  ]
    .filter((line) => line !== null)
    .join("\n")
    .trim();
};

const SummarySection = ({ title, children }) => (
  <section className="submission-ai-summary-section">
    <h3>{title}</h3>
    {children}
  </section>
);

const SummaryList = ({ items, emptyText }) => {
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!normalizedItems.length) {
    return <p className="submission-ai-summary-muted">{emptyText}</p>;
  }

  return (
    <ul className="submission-ai-summary-list">
      {normalizedItems.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
};

export default function AiSessionSummaryModal({
  open,
  onClose,
  submissionLabel,
  summary,
  history = [],
  isLoading = false,
  error = "",
  onRegenerate,
  onSaveToNotes,
  isSavingToNotes = false,
}) {
  const previousSummaries = history.slice(1);
  const canUseSummary = Boolean(summary) && !isLoading;

  const handleCopy = async () => {
    const copyText = buildAiSummaryCopyText(summary);
    if (!copyText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyText);
      toast.success("Summary copied.");
    } catch {
      toast.error("Could not copy summary.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose?.() : null)}>
      <DialogContent
        className="submission-ai-summary-dialog"
        overlayClassName="submission-ai-summary-overlay"
        showCloseButton={false}
      >
        <div className="submission-ai-summary-shell">
          <header className="submission-ai-summary-header">
            <div className="submission-ai-summary-kicker">
              <span className="submission-ai-summary-icon">
                <AutoAwesomeOutlinedIcon fontSize="inherit" />
              </span>
              <span>AI Summary</span>
            </div>
            <div className="submission-ai-summary-title-row">
              <div>
                <DialogTitle className="submission-ai-summary-title">
                  Session AI Summary
                </DialogTitle>
                <DialogDescription className="submission-ai-summary-description">
                  Generated for {submissionLabel || "the current session"} only.
                </DialogDescription>
              </div>
              <button
                type="button"
                className="submission-ai-summary-close"
                onClick={onClose}
                aria-label="Close AI summary"
              >
                <CloseOutlinedIcon fontSize="inherit" />
              </button>
            </div>
          </header>

          <div className="submission-ai-summary-body">
            {isLoading ? (
              <div className="submission-ai-summary-loading">
                <span className="submission-ai-summary-loader" />
                <strong>Generating session summary...</strong>
                <p>Reviewing submitted setup data, notes, source text, and validation issues.</p>
              </div>
            ) : null}

            {!isLoading && error ? (
              <div className="submission-ai-summary-error">
                {error || "Could not generate AI summary. Please try again."}
              </div>
            ) : null}

            {!isLoading && summary ? (
              <div className="submission-ai-summary-content">
                <div className="submission-ai-summary-meta">
                  {summary.generatedAt ? (
                    <StatusBadge
                      label={`Generated ${formatDateTime(summary.generatedAt)}`}
                      tone="success"
                    />
                  ) : null}
                  {summary.generatedBy ? (
                    <StatusBadge label={`By ${summary.generatedBy}`} tone="neutral" />
                  ) : null}
                </div>

                <SummarySection title="Session Summary">
                  <p>{summary.summary || "No session summary returned."}</p>
                </SummarySection>

                <SummarySection title="Key Observations">
                  <SummaryList
                    items={summary.keyObservations}
                    emptyText="No key observations returned."
                  />
                </SummarySection>

                <SummarySection title="Needs Review">
                  <SummaryList
                    items={summary.needsReview}
                    emptyText="No review items returned."
                  />
                </SummarySection>

                <SummarySection title="Recommended Actions">
                  <SummaryList
                    items={summary.recommendedActions}
                    emptyText="No recommended actions returned."
                  />
                </SummarySection>

                {previousSummaries.length ? (
                  <section className="submission-ai-summary-history">
                    <div className="submission-ai-summary-history-heading">
                      <h3>Summary History</h3>
                      <span>{history.length} generated</span>
                    </div>
                    <div className="submission-ai-summary-history-list">
                      {previousSummaries.slice(0, 4).map((item, index) => (
                        <article
                          key={item.summaryId || `${item.generatedAt}-${index}`}
                          className="submission-ai-summary-history-item"
                        >
                          <div>
                            <strong>{formatDateTime(item.generatedAt) || "Previous summary"}</strong>
                            <p>{item.summary}</p>
                          </div>
                          {item.generatedBy ? <span>{item.generatedBy}</span> : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer className="submission-ai-summary-footer">
            <button
              type="button"
              className="fleet-btn fleet-btn-secondary"
              onClick={handleCopy}
              disabled={!canUseSummary}
            >
              <ContentCopyOutlinedIcon fontSize="inherit" />
              Copy Summary
            </button>
            <button
              type="button"
              className="fleet-btn fleet-btn-secondary"
              onClick={onRegenerate}
              disabled={isLoading}
            >
              <RefreshOutlinedIcon fontSize="inherit" />
              {isLoading ? "Generating..." : "Regenerate"}
            </button>
            <button
              type="button"
              className="fleet-btn fleet-btn-primary"
              onClick={() => onSaveToNotes?.(buildAiSummaryCopyText(summary))}
              disabled={!canUseSummary || isSavingToNotes}
            >
              <StickyNote2OutlinedIcon fontSize="inherit" />
              {isSavingToNotes ? "Saving..." : "Save to Notes"}
            </button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
