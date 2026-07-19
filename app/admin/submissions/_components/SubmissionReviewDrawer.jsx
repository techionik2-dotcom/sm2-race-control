"use client";

import { useEffect, useMemo } from "react";
import LaunchOutlinedIcon from "@mui/icons-material/LaunchOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import SourceOutlinedIcon from "@mui/icons-material/SourceOutlined";

import StatusBadge from "../../../components/Common/StatusBadge";
import { DrawerShell } from "../../fleet/_components/ManagementUi";
import { formatDateTime } from "../../fleet/_components/fleetManagementHelpers";
import { buildSubmissionMonitorRecord, getSubmissionDriverLabel, getSubmissionEventLabel, getSubmissionId, getSubmissionTrackLabel, getSubmissionVehicleLabel } from "./submissionReviewHelpers";
import {
  getSessionDateTimeLabel,
  getSessionEventTrackLabel,
  getSessionLastUpdatedByLabel,
  getSessionNotesSummary,
  getSessionReportHref,
  getSessionRunGroupLabel,
  getSessionSourceAttachment,
  getSessionSourceBody,
  getSessionSourceLabel,
  getSessionSourceLabelHint,
  getSessionSourceSubtext,
  getSessionSourceTone,
} from "./sessionReviewUiHelpers";

const KeyValue = ({ label, value, mono = false }) => (
  <div className="submission-kv-card">
    <p className="submission-kv-label">{label}</p>
    <p className={`submission-kv-value ${mono ? "submission-mono" : ""}`.trim()}>
      {value === null || value === undefined || value === "" || value === "-" ? "Not available" : value}
    </p>
  </div>
);

const formatDisplayDateTime = (value) => {
  const text = formatDateTime(value);
  return text && text !== "-" ? text : "Not available";
};

const TimelineItem = ({ title, note, time, actor, tone = "neutral" }) => (
  <li className={`submission-session-timeline-item tone-${tone}`}>
    <div className="submission-session-timeline-top">
      <div>
        <div className="submission-session-timeline-action">{title}</div>
        <div className="submission-session-timeline-note">{note}</div>
      </div>
      {time ? <span className="submission-session-time-chip">{time}</span> : null}
    </div>
    <div className="submission-session-timeline-meta">{actor || "System"}</div>
  </li>
);

export default function SubmissionReviewDrawer({
  open,
  submission,
  allSubmissions = [],
  focusSection = "overview",
  onClose,
  onExportCurrent = null,
}) {
  const record = useMemo(() => {
    if (!submission) return null;
    return buildSubmissionMonitorRecord(submission, allSubmissions);
  }, [submission, allSubmissions]);

  useEffect(() => {
    if (!open || !record || !focusSection) return undefined;

    const target = document.getElementById(focusSection);
    if (!target) return undefined;

    const timeout = window.setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);

    return () => window.clearTimeout(timeout);
  }, [focusSection, open, record]);

  if (!open || !record) {
    return null;
  }

  const sourceLabel = getSessionSourceLabel(record);
  const sourceTone = getSessionSourceTone(record);
  const sourceHint = getSessionSourceLabelHint(record);
  const sourceSubtext = getSessionSourceSubtext(record);
  const sourceAttachment = getSessionSourceAttachment(record);
  const submissionId = record.submissionId || getSubmissionId(record) || "Not available";
  const eventTrack = getSessionEventTrackLabel(record);
  const reportHref = getSessionReportHref(record);
  const updateHref = getSessionReportHref(record, { edit: true });
  const lastUpdatedBy = getSessionLastUpdatedByLabel(record);
  const notesSummary = getSessionNotesSummary(record);
  const submittedAt =
    (record.submittedAtLabel && record.submittedAtLabel !== "-")
      ? record.submittedAtLabel
      : getSessionDateTimeLabel(record);
  const updatedAt = formatDisplayDateTime(
    record.updatedAt || record.processedAt || record.analysisResult?.reviewed_at || null,
  );

  const historyItems = [
    {
      title: `Submitted via ${sourceLabel}`,
      note:
        sourceLabel === "Voice"
          ? "Driver voice capture entered the review queue."
          : sourceLabel === "OCR"
            ? "OCR capture entered the review queue."
            : "Driver notes entered the review queue.",
      time:
        (record.submittedAtLabel && record.submittedAtLabel !== "-")
          ? record.submittedAtLabel
          : record.dateLabel && record.dateLabel !== "-"
            ? record.dateLabel
            : submittedAt,
      actor: sourceSubtext,
      tone: "accent",
    },
    {
      title:
        sourceLabel === "Voice"
          ? "Voice Processing"
          : sourceLabel === "OCR"
            ? "OCR Processing"
            : "Notes Processing",
      note: record.auditSnippet || "Parser and validation data are available for review.",
      time: record.processedAt ? formatDisplayDateTime(record.processedAt) : "Not available",
      actor: "Parser",
      tone: "info",
    },
    {
      title: "Last Updated",
      note: record.recommendation || "Ready for the next update.",
      time: formatDisplayDateTime(
        record.analysisResult?.reviewed_at ||
          record.analysisResult?.last_edited_at ||
          record.analysisResult?.reviewedAt ||
          record.updatedAt ||
          record.processedAt ||
          null,
      ),
      actor: lastUpdatedBy,
      tone: "neutral",
    },
  ];

  return (
      <DrawerShell
      open
      wide
      onClose={onClose}
      title="Session Details"
      subtitle="Inspect the selected session, review the source payload, and jump to the editable report when needed."
      meta={
        <div className="submission-drawer-meta">
          <StatusBadge label={sourceLabel} tone={sourceTone} title={sourceHint} />
          <span className="submission-session-meta-chip">Submitted {submittedAt || "Not available"}</span>
          <span className="submission-session-meta-chip">Updated {updatedAt || "Not available"}</span>
        </div>
      }
      footer={
        <div className="submission-drawer-actions">
          <a
            className={`fleet-btn fleet-btn-secondary ${!reportHref ? "is-disabled" : ""}`.trim()}
            href={reportHref || undefined}
            aria-disabled={!reportHref}
            onClick={(event) => {
              if (!reportHref) {
                event.preventDefault();
              }
            }}
          >
            <LaunchOutlinedIcon fontSize="inherit" />
            Open Session
          </a>
          <a
            className={`fleet-btn fleet-btn-primary ${!updateHref ? "is-disabled" : ""}`.trim()}
            href={updateHref || undefined}
            aria-disabled={!updateHref}
            onClick={(event) => {
              if (!updateHref) {
                event.preventDefault();
              }
            }}
            >
              <EditOutlinedIcon fontSize="inherit" />
              Update Session
            </a>
          {onExportCurrent ? (
            <button type="button" className="fleet-btn fleet-btn-primary" onClick={onExportCurrent}>
              <DownloadOutlinedIcon fontSize="inherit" />
              Export Excel
            </button>
          ) : null}
        </div>
      }
    >
      <div className="submission-session-drawer">
        <section id="overview" className="submission-session-section">
          <div className="submission-section-heading">
            <span className="submission-section-eyebrow">
              <SourceOutlinedIcon fontSize="inherit" />
              Overview
            </span>
            <h3>{submissionId}</h3>
            <p>Driver-submitted session record ready for quick review or update.</p>
          </div>

          <div className="submission-session-grid submission-detail-grid">
            <KeyValue label="Submission ID" value={submissionId} mono />
            <KeyValue label="Driver" value={getSubmissionDriverLabel(record)} />
            <KeyValue label="Vehicle" value={getSubmissionVehicleLabel(record)} />
            <KeyValue label="Event" value={getSubmissionEventLabel(record)} />
            <KeyValue label="Track" value={getSubmissionTrackLabel(record)} />
            <KeyValue label="Run Group" value={getSessionRunGroupLabel(record)} />
            <KeyValue label="Submitted Via" value={sourceLabel} />
            <KeyValue label="Last Updated By" value={lastUpdatedBy} />
          </div>

          <div className="submission-session-notes-card">
            <div className="submission-session-card-title">
              <NotesOutlinedIcon fontSize="inherit" />
              Notes Summary
            </div>
            <p>{notesSummary}</p>
          </div>
        </section>

        <section id="source-data" className="submission-session-section">
          <div className="submission-section-heading">
            <span className="submission-section-eyebrow">
              <SourceOutlinedIcon fontSize="inherit" />
              Source Data
            </span>
            <h3>Submitted Source</h3>
            <p>The selected session source payload and supporting note trail.</p>
          </div>

          <div className="submission-session-source-card">
            <div className="submission-session-card-title">Source Context</div>
            <div className="submission-session-source-badges">
              <span className="submission-session-meta-chip">{sourceLabel}</span>
              <span className="submission-session-meta-chip">{sourceSubtext}</span>
              {record.confidenceLabel ? (
                <span className="submission-session-meta-chip">Confidence {record.confidenceLabel}</span>
              ) : null}
              {record.voiceAudioDurationLabel && sourceLabel === "Voice" ? (
                <span className="submission-session-meta-chip">Duration {record.voiceAudioDurationLabel}</span>
              ) : null}
              {record.voiceAudioFileName && sourceLabel === "Voice" ? (
                <span className="submission-session-meta-chip">{record.voiceAudioFileName}</span>
              ) : null}
              {record.parserVersion ? (
                <span className="submission-session-meta-chip">{record.parserVersion}</span>
              ) : null}
            </div>
            {sourceAttachment ? (
              <a
                className="fleet-btn fleet-btn-secondary submission-session-source-link"
                href={sourceAttachment.href}
                target="_blank"
                rel="noreferrer"
              >
                <LaunchOutlinedIcon fontSize="inherit" />
                {sourceAttachment.label}
              </a>
            ) : null}
            <pre className="submission-session-source-body">{getSessionSourceBody(record)}</pre>
          </div>
        </section>

        <section id="history" className="submission-session-section">
          <div className="submission-section-heading">
            <span className="submission-section-eyebrow">
              <HistoryOutlinedIcon fontSize="inherit" />
              History
            </span>
            <h3>Session Timeline</h3>
            <p>A concise history of when the session arrived, was processed, and last changed.</p>
          </div>

          <ul className="submission-session-timeline">
            {historyItems.map((item) => (
              <TimelineItem key={`${submissionId}-${item.title}`} {...item} />
            ))}
          </ul>
        </section>
      </div>
    </DrawerShell>
  );
}
