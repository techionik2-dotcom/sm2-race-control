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
import Loader from "../../components/Common/Loader";
import { getEventById, selectActiveEvent } from "../../utils/eventApi";
import { getRunGroup } from "../../utils/runGroupApi";
import {
  formatEventDate,
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
    title: "Detailed Submission",
    description: "Open the structured driver note flow for this event.",
    hrefBuilder: (eventId) => `/event/${eventId}/notes?tab=detail`,
    icon: NoteAltRoundedIcon,
  },
  {
    key: "ocr-notes",
    className: "scan",
    iconClassName: "scan",
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
    title: "Voice Submission",
    description: "Record, transcribe, review, and finalize a voice note.",
    hrefBuilder: (eventId) => `/event/${eventId}/voice-submission`,
    icon: RecordVoiceOverRoundedIcon,
    testId: "event-detail-voice-submission",
  },
  {
    key: "view-submissions",
    className: "secondary",
    iconClassName: "secondary",
    title: "View Submissions",
    description: "Review captured notes, statuses, and sync history.",
    hrefBuilder: (eventId) => `/event/${eventId}/submissions`,
    icon: ReceiptLongRoundedIcon,
  },
];

const normalizeVisibleEventName = (value) =>
  String(value || "Active Event")
    .replace(/\s+[\u2014\u2013-]\s+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const formatEventDateRangeForDashboard = (startDate, endDate) => {
  const start = formatEventDate(startDate);
  const end = formatEventDate(endDate);

  if (start === "-" && end === "-") return "Not scheduled";
  if (start === "-") return end;
  if (end === "-") return start;
  if (start === end) return start;
  return `${start} to ${end}`;
};

const SummaryCard = ({ tone, icon: Icon, label, value, description }) => (
  <article className={`event-detail-summary-card ${tone}`}>
    <div className="event-detail-summary-icon" aria-hidden="true">
      <Icon fontSize="inherit" />
    </div>
    <div className="event-detail-summary-copy">
      <div className="event-detail-summary-label">{label}</div>
      <div className="event-detail-summary-value">{value}</div>
      <div className="event-detail-summary-note">{description}</div>
    </div>
  </article>
);

const ConfiguredPill = ({ configured }) => (
  <span className={`event-detail-configured-pill ${configured ? "ready" : "warning"}`}>
    <CheckCircleRoundedIcon fontSize="inherit" />
    {configured ? "CONFIGURED" : "NEEDS SETUP"}
  </span>
);

const EventSummaryRow = ({ label, value }) => (
  <li className="event-detail-info-row">
    <span className="event-detail-info-label">{label}</span>
    <span className="event-detail-info-value">{value}</span>
  </li>
);

const ActionCard = ({ action, onSelect }) => {
  const ActionIcon = action.icon;

  return (
    <button
      type="button"
      className={`event-detail-action-card ${action.className}`}
      onClick={onSelect}
      data-testid={action.testId}
      aria-label={action.title}
    >
      <div
        className={`event-detail-action-icon${action.iconClassName ? ` ${action.iconClassName}` : ""}`}
        aria-hidden="true"
      >
        <ActionIcon fontSize="inherit" />
      </div>
      <div className="event-detail-action-copy">
        <h2>{action.title}</h2>
        <p>{action.description}</p>
      </div>
      <KeyboardArrowRightRoundedIcon className="event-detail-action-arrow" fontSize="inherit" aria-hidden="true" />
    </button>
  );
};

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

  const eventTitle = normalizeVisibleEventName(event.name);
  const eventTrack = event.track || event.track_name || "Track not set";
  const eventDates = formatEventDateRangeForDashboard(
    event.startDate || event.start_date,
    event.endDate || event.end_date,
  );
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
  const summaryCards = [
    {
      tone: "track",
      icon: PinDropRoundedIcon,
      label: "TRACK",
      value: eventTrack,
      description: "Captured from the selected event.",
    },
    {
      tone: "date",
      icon: CalendarMonthRoundedIcon,
      label: "DATE RANGE",
      value: eventDates,
      description: "Event window visible to drivers.",
    },
    {
      tone: "status",
      icon: eventStatus.icon === "active" ? CheckCircleRoundedIcon : PendingActionsRoundedIcon,
      label: "STATUS",
      value: eventStatus.label,
      description: eventStatus.note,
    },
    {
      tone: "run-group",
      icon: DatasetRoundedIcon,
      label: "RUN GROUP",
      value: hasRunGroup ? runGroupValue : "Not Configured",
      description: hasRunGroup ? "Visible exactly as drivers will see it." : "This event still needs a run group.",
    },
  ];

  return (
    <ProtectedRoute requireDriver={true}>
      <div className="event-detail-page">
        <div className="event-detail-shell">
          <header className="event-detail-hero">
            <div className="event-detail-hero-copy">
              <p className="event-detail-eyebrow">ACTIVE EVENT</p>
              <h1 className="event-detail-title">{eventTitle}</h1>
              <p className="event-detail-subtitle">
                Review the active event, confirm your run group, and jump straight into notes or submissions.
              </p>
            </div>

            <div className="event-detail-hero-meta">
              <button type="button" className="event-detail-refresh" onClick={loadEventData} disabled={isLoading}>
                <RefreshRoundedIcon fontSize="inherit" />
                Refresh Event
              </button>
            </div>
          </header>

          <section className="event-detail-summary-grid">
            {summaryCards.map((card) => (
              <SummaryCard key={card.label} {...card} />
            ))}
          </section>

          <section className="event-detail-panels">
            <article className={`event-detail-panel event-detail-run-group-card ${hasRunGroup ? "ready" : "warning"}`}>
              <div className="event-detail-panel-kicker">YOUR RUN GROUP</div>
              <div className="event-detail-run-group-layout">
                <div className="event-detail-run-group-badge">{hasRunGroup ? runGroupValue : "SET"}</div>
                <div className="event-detail-run-group-copy">
                  <p>
                    {hasRunGroup
                      ? "Drivers will see this label on every note submission."
                      : "Ask the owner to configure the event before drivers begin capturing submissions."}
                  </p>
                  <ConfiguredPill configured={hasRunGroup} />
                </div>
                <div className="event-detail-run-group-ready">
                  <FlagRoundedIcon fontSize="inherit" aria-hidden="true" />
                  <span>{runGroupFooterNote}</span>
                </div>
              </div>
            </article>

            <article className="event-detail-panel event-detail-context-card">
              <div className="event-detail-panel-kicker">EVENT SUMMARY</div>
              <ul className="event-detail-info-list">
                <EventSummaryRow label="TRACK" value={eventTrack} />
                <EventSummaryRow label="DATE RANGE" value={eventDates} />
                <EventSummaryRow label="STATUS" value={eventStatus.note} />
                <EventSummaryRow label="ACCESS" value={accessLabel} />
              </ul>
              {noteBannerCopy ? <div className="event-detail-note-banner">{noteBannerCopy}</div> : null}
            </article>
          </section>

          <section className="event-detail-actions-grid">
            {actionCards.map((action) => (
              <ActionCard key={action.key} action={action} onSelect={() => router.push(action.href)} />
            ))}
          </section>
        </div>
      </div>
    </ProtectedRoute>
  );
}
