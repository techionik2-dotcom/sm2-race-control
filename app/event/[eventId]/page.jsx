"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DatasetRoundedIcon from "@mui/icons-material/DatasetRounded";
import DocumentScannerRoundedIcon from "@mui/icons-material/DocumentScannerRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import NoteAltRoundedIcon from "@mui/icons-material/NoteAltRounded";
import PendingActionsRoundedIcon from "@mui/icons-material/PendingActionsRounded";
import PinDropRoundedIcon from "@mui/icons-material/PinDropRounded";
import RecordVoiceOverRoundedIcon from "@mui/icons-material/RecordVoiceOverRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ProtectedRoute from "../../components/ProtectedRoute";
import ScreenBackButton from "../../components/Common/ScreenBackButton";
import Loader from "../../components/Common/Loader";
import StatusBadge from "../../components/Common/StatusBadge";
import { getEventById, selectActiveEvent } from "../../utils/eventApi";
import { getRunGroup } from "../../utils/runGroupApi";
import {
  formatEventDateRange,
  getEventLifecycle,
  getEventSubmissionState,
} from "../../utils/eventSchedule";
import "./EventDetail.css";

const deriveEventStatus = (event) => {
  const lifecycle = getEventLifecycle(event);
  const submissionState = getEventSubmissionState(event);

  if (lifecycle.key === "archived") {
    return { label: "Archived", tone: "neutral", note: "Event archived", icon: "archive" };
  }

  if (lifecycle.key === "upcoming") {
    return {
      label: "Upcoming",
      tone: "info",
      note: "Submission notes open when the event starts.",
      icon: "upcoming",
    };
  }

  if (lifecycle.key === "completed") {
    return {
      label: "Completed",
      tone: "neutral",
      note: "Submission notes are closed because the event window has ended.",
      icon: "complete",
    };
  }

  if (submissionState.isOpen) {
    return {
      label: "Active",
      tone: "success",
      note: "Submission notes are open for this event.",
      icon: "active",
    };
  }

  return {
    label: lifecycle.label,
    tone: lifecycle.tone,
    note: "Event schedule is unavailable.",
    icon: "ready",
  };
};

const EVENT_ACTIONS = [
  {
    key: "submit-notes",
    className: "primary",
    iconClassName: "",
    label: "Primary",
    title: "Detailed Submission",
    description: "Open the structured driver note flow for this event.",
    hrefBuilder: (eventId) => `/event/${eventId}/notes?tab=detail`,
    icon: NoteAltRoundedIcon,
  },
  {
    key: "ocr-notes",
    className: "scan",
    iconClassName: "scan",
    label: "OCR Flow",
    title: "OCR Notes",
    description:
      "Upload setup sheets or handwritten notes, extract values, and review before submission.",
    hrefBuilder: (eventId) => `/event/${eventId}/ocr-notes`,
    icon: DocumentScannerRoundedIcon,
    testId: "event-detail-ocr-notes",
  },
  {
    key: "voice-submission",
    className: "tertiary",
    iconClassName: "tertiary",
    label: "Focused Flow",
    title: "Voice Submission",
    description: "Record, transcribe, review, and finalize an OpenAI-backed voice note.",
    hrefBuilder: (eventId) => `/event/${eventId}/voice-submission`,
    icon: RecordVoiceOverRoundedIcon,
    testId: "event-detail-voice-submission",
  },
  {
    key: "view-submissions",
    className: "secondary",
    iconClassName: "secondary",
    label: "Secondary",
    title: "View Submissions",
    description: "Review captured notes, statuses, and sync history.",
    hrefBuilder: (eventId) => `/event/${eventId}/submissions`,
    icon: ReceiptLongRoundedIcon,
  },
];

export default function EventDetail() {
  const router = useRouter();
  const params = useParams();
  const eventId = params?.eventId;

  const [event, setEvent] = useState(null);
  const [runGroup, setRunGroup] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEventData = useCallback(async () => {
    if (!eventId) {
      router.push("/events");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const response = await getEventById(eventId);
      const eventData = response?.event || response?.data || response;

      if (eventData && (eventData.id || eventData._id || eventData.name)) {
        setEvent(eventData);
        selectActiveEvent(eventId).catch((selectError) => {
          console.warn("Failed to set active event:", selectError);
        });
      } else {
        const storedEvents = localStorage.getItem("sm2_events");

        if (storedEvents) {
          const events = JSON.parse(storedEvents);
          const foundEvent = events.find((item) =>
            item.id === parseInt(eventId, 10) ||
            item.id === eventId ||
            item._id === eventId ||
            String(item.id) === String(eventId) ||
            String(item._id) === String(eventId)
          );

          if (foundEvent) {
            setEvent(foundEvent);
          } else {
            setError("Event not found.");
            setEvent(null);
            setRunGroup(null);
          }
        } else {
          setError("Event not found.");
          setEvent(null);
          setRunGroup(null);
        }
      }

      try {
        const response = await getRunGroup(eventId);

        setRunGroup(response && typeof response === "object" ? response : null);
      } catch (runGroupError) {
        console.error("Failed to load run group:", runGroupError);
        setRunGroup(null);
      }
    } catch (fetchError) {
      console.error("Failed to load event:", fetchError);
      setError("Failed to load event. Please try again.");
      setEvent(null);
      setRunGroup(null);
    } finally {
      setIsLoading(false);
    }
  }, [eventId, router]);

  useEffect(() => {
    loadEventData();
  }, [loadEventData]);

  if (isLoading) {
    return (
      <ProtectedRoute requireDriver={true}>
        <Loader
          fullHeight
          label="Loading event workspace"
          sublabel="Fetching the active event and run group..."
        />
      </ProtectedRoute>
    );
  }

  if (error && !event) {
    return (
      <ProtectedRoute requireDriver={true}>
        <div className="event-detail-page">
          <div className="event-detail-orb event-detail-orb-one" />
          <div className="event-detail-orb event-detail-orb-two" />

          <div className="event-detail-shell event-detail-state-shell">
            <div className="event-detail-state-card">
              <div className="event-detail-state-icon error">
                <ErrorOutlineRoundedIcon fontSize="inherit" />
              </div>
              <div className="event-detail-eyebrow">
                <FlagRoundedIcon fontSize="inherit" />
                Driver Operations
              </div>
              <h1 className="event-detail-title">Event unavailable</h1>
              <p className="event-detail-subtitle">{error}</p>
              <div className="event-detail-state-actions">
                <button type="button" className="event-detail-state-button primary" onClick={() => loadEventData()}>
                  Retry Load
                </button>
                <button type="button" className="event-detail-state-button" onClick={() => router.push("/events")}>
                  Back to Events
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (!event) {
    return (
      <ProtectedRoute requireDriver={true}>
        <div className="event-detail-page">
          <div className="event-detail-orb event-detail-orb-one" />
          <div className="event-detail-orb event-detail-orb-two" />

          <div className="event-detail-shell event-detail-state-shell">
            <div className="event-detail-state-card">
              <div className="event-detail-state-icon">
                <DatasetRoundedIcon fontSize="inherit" />
              </div>
              <div className="event-detail-eyebrow">
                <FlagRoundedIcon fontSize="inherit" />
                Driver Operations
              </div>
              <h1 className="event-detail-title">Event not found</h1>
              <p className="event-detail-subtitle">
                This event no longer exists or could not be loaded from the current workspace.
              </p>
              <div className="event-detail-state-actions">
                <button type="button" className="event-detail-state-button primary" onClick={() => loadEventData()}>
                  Reload Event
                </button>
                <button type="button" className="event-detail-state-button" onClick={() => router.push("/events")}>
                  Back to Events
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  const eventTrack = event.track || event.track_name || "-";
  const eventDates = formatEventDateRange(event.startDate || event.start_date, event.endDate || event.end_date);
  const eventStatus = deriveEventStatus(event);
  const submissionState = getEventSubmissionState(event);
  const runGroupValue = runGroup?.normalized || runGroup?.rawText || runGroup?.raw_text || "Not assigned yet";
  const hasRunGroup = Boolean(runGroup?.id && runGroupValue && runGroupValue !== "Not assigned yet");
  const canCaptureNotes = hasRunGroup && submissionState.isOpen;
  const runGroupFooterNote = hasRunGroup
    ? canCaptureNotes
      ? "Ready for note capture"
      : submissionState.isUpcoming
        ? "Opens when the event starts"
        : submissionState.hasEnded
          ? "Capture window closed"
          : "Waiting for event schedule"
    : "Run group missing";
  const accessLabel = canCaptureNotes
    ? "Driver ready"
    : submissionState.isUpcoming
      ? "Opens at start"
      : submissionState.hasEnded
        ? "Closed after event"
        : "Schedule needed";
  const noteBannerCopy = canCaptureNotes
    ? ""
    : submissionState.isUpcoming
      ? "Submission notes will open when the event start date arrives."
      : submissionState.hasEnded
        ? "This event window has ended. View Submissions to review the captured history."
      : "Confirm the event schedule and run group before drivers begin capturing notes.";
  const actionCards = EVENT_ACTIONS.map((action) => ({
    ...action,
    href: action.hrefBuilder(eventId),
  }));

  return (
      <ProtectedRoute requireDriver={true}>
      <div className="event-detail-page">
        <div className="event-detail-orb event-detail-orb-one" />
        <div className="event-detail-orb event-detail-orb-two" />

        <div className="event-detail-shell">
          <header className="event-detail-hero">
            <div className="event-detail-hero-copy">
              <ScreenBackButton fallbackHref="/events" label="Back" />

              <div className="event-detail-eyebrow">
                <FlagRoundedIcon fontSize="inherit" />
                Driver Operations
              </div>
              <h1 className="event-detail-title">{event.name}</h1>
              <p className="event-detail-subtitle">
                Review the active event, confirm your run group, and jump straight into notes or submissions.
              </p>
            </div>

            <div className="event-detail-hero-meta">
              <div className="event-detail-badge-row">
                <StatusBadge label={eventStatus.label} tone={eventStatus.tone} />
                <StatusBadge
                  label={hasRunGroup ? "Run Group Ready" : "Run Group Missing"}
                  tone={hasRunGroup ? "success" : "warning"}
                />
              </div>
              <button type="button" className="event-detail-refresh" onClick={loadEventData} disabled={isLoading}>
                <RefreshRoundedIcon fontSize="inherit" />
                Refresh Event
              </button>
            </div>
          </header>

          <section className="event-detail-summary-grid">
            <article className="event-detail-summary-card track">
              <div className="event-detail-summary-icon">
                <PinDropRoundedIcon fontSize="inherit" />
              </div>
              <div className="event-detail-summary-label">Track</div>
              <div className="event-detail-summary-value">{eventTrack}</div>
              <div className="event-detail-summary-note">Captured from the selected event.</div>
            </article>

            <article className="event-detail-summary-card date">
              <div className="event-detail-summary-icon">
                <CalendarMonthRoundedIcon fontSize="inherit" />
              </div>
              <div className="event-detail-summary-label">Date Range</div>
              <div className="event-detail-summary-value">{eventDates}</div>
              <div className="event-detail-summary-note">Event window visible to drivers.</div>
            </article>

            <article className="event-detail-summary-card status">
              <div className="event-detail-summary-icon">
                {eventStatus.icon === "active" ? (
                  <CheckCircleRoundedIcon fontSize="inherit" />
                ) : (
                  <PendingActionsRoundedIcon fontSize="inherit" />
                )}
              </div>
              <div className="event-detail-summary-label">Status</div>
              <div className="event-detail-summary-value">{eventStatus.label}</div>
              <div className="event-detail-summary-note">{eventStatus.note}</div>
            </article>

            <article className="event-detail-summary-card run-group">
              <div className="event-detail-summary-icon">
                <DatasetRoundedIcon fontSize="inherit" />
              </div>
              <div className="event-detail-summary-label">Run Group</div>
              <div className="event-detail-summary-value">{hasRunGroup ? runGroupValue : "Not Configured"}</div>
              <div className="event-detail-summary-note">
                {hasRunGroup ? "Visible exactly as drivers will see it." : "This event still needs a run group."}
              </div>
            </article>
          </section>

          <section className="event-detail-panels">
            <article className={`event-detail-panel event-detail-run-group-card ${hasRunGroup ? "ready" : "warning"}`}>
              <div className="event-detail-panel-kicker">Your Run Group</div>
              <div className="event-detail-run-group-value">{hasRunGroup ? runGroupValue : "Not Assigned Yet"}</div>
              <p className="event-detail-run-group-copy">
                {hasRunGroup
                  ? "Drivers will see this label on every note submission."
                  : "Ask the owner to configure the event before drivers begin capturing submissions."}
              </p>
              <div className="event-detail-run-group-footer">
                <StatusBadge
                  label={hasRunGroup ? "Configured" : "Not Configured"}
                  tone={hasRunGroup ? "success" : "warning"}
                />
                <span>{runGroupFooterNote}</span>
              </div>
            </article>

            <article className="event-detail-panel event-detail-context-card">
              <div className="event-detail-panel-kicker">Event Summary</div>
              <ul className="event-detail-info-list">
                <li className="event-detail-info-row">
                  <span className="event-detail-info-label">Track</span>
                  <span className="event-detail-info-value">{eventTrack}</span>
                </li>
                <li className="event-detail-info-row">
                  <span className="event-detail-info-label">Date Range</span>
                  <span className="event-detail-info-value">{eventDates}</span>
                </li>
                <li className="event-detail-info-row">
                  <span className="event-detail-info-label">Status</span>
                  <span className="event-detail-info-value">{eventStatus.note}</span>
                </li>
                <li className="event-detail-info-row">
                  <span className="event-detail-info-label">Access</span>
                  <span className="event-detail-info-value">{accessLabel}</span>
                </li>
              </ul>
              {noteBannerCopy ? <div className="event-detail-note-banner">{noteBannerCopy}</div> : null}
            </article>
          </section>

          <section className="event-detail-actions-grid">
            {actionCards.map((action) => {
              const ActionIcon = action.icon;

              return (
                <button
                  key={action.key}
                  type="button"
                  className={`event-detail-action-card ${action.className}`}
                  onClick={() => router.push(action.href)}
                  data-testid={action.testId}
                >
                  <div
                    className={`event-detail-action-icon${action.iconClassName ? ` ${action.iconClassName}` : ""}`}
                  >
                    <ActionIcon fontSize="inherit" />
                  </div>
                  <div className="event-detail-action-copy">
                    <span className="event-detail-action-label">{action.label}</span>
                    <h2>{action.title}</h2>
                    <p>{action.description}</p>
                  </div>
                  <KeyboardArrowRightRoundedIcon className="event-detail-action-arrow" fontSize="inherit" />
                </button>
              );
            })}
          </section>
        </div>
      </div>
    </ProtectedRoute>
  );
}
