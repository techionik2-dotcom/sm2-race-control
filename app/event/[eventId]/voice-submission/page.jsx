"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import GraphicEqRoundedIcon from "@mui/icons-material/GraphicEqRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import NoteAltRoundedIcon from "@mui/icons-material/NoteAltRounded";
import PendingActionsRoundedIcon from "@mui/icons-material/PendingActionsRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";

import Loader from "../../../components/Common/Loader";
import ScreenBackButton from "../../../components/Common/ScreenBackButton";
import StatusBadge from "../../../components/Common/StatusBadge";
import ProtectedRoute from "../../../components/ProtectedRoute";
import AppSelect from "@/components/ui/app-select";
import { getEventById, selectActiveEvent } from "../../../utils/eventApi";
import { getEventSubmissionState } from "../../../utils/eventSchedule";
import { getDrivers, getVehicles } from "../../../utils/fleetApi";
import { getRunGroup } from "../../../utils/runGroupApi";
import { buildSubmissionPayload } from "../../../utils/submissionApi";
import { DRIVER_OPTIONS, VEHICLE_OPTIONS } from "../../../utils/staticOptions";
import {
  buildVoiceNoteTranscript,
  finalizeVoiceSubmission,
  normalizeVoiceSession,
} from "../../../utils/voiceNotesApi";
import VoiceNoteComposer from "../notes/_components/VoiceNoteComposer";
import "../notes/NotesSubmission.css";
import "./VoiceSubmission.css";

const SESSION_TYPE_OPTIONS = [
  { id: "Practice", label: "Practice" },
  { id: "Qualifying", label: "Qualifying" },
  { id: "Race", label: "Race" },
  { id: "Warmup", label: "Warmup" },
  { id: "Test", label: "Test" },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const GENERATED_SESSION_ID_PATTERN = /^\d{8}-\d{4}-[A-Z0-9]+-S\d+$/;
const LEGACY_SESSION_ID_PATTERN =
  /^[A-Z0-9]+-\d{8}-\d{4}-[A-Z0-9]+-\d+-[A-Z0-9]+-[A-Z0-9][A-Z0-9-]*$/;

const parseStoredSnapshot = (storageKey) => {
  if (!storageKey || typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("Voice submission snapshot could not be parsed:", error);
    return null;
  }
};

const getCurrentLocalDateValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getCurrentLocalTimeValue = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const normalizeText = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

const isValidDateValue = (value) => {
  const cleaned = String(value || "").trim();
  if (!DATE_PATTERN.test(cleaned)) {
    return false;
  }

  const [year, month, day] = cleaned.split("-").map((part) => Number(part));
  if (![year, month, day].every((part) => Number.isInteger(part))) {
    return false;
  }

  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
};

const isValidTimeValue = (value) => TIME_PATTERN.test(String(value || "").trim());

const isValidSessionId = (value) => {
  const cleaned = String(value || "").trim().toUpperCase();
  return GENERATED_SESSION_ID_PATTERN.test(cleaned) || LEGACY_SESSION_ID_PATTERN.test(cleaned);
};

const normalizeSessionDriverSegment = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const buildGeneratedSessionId = (date, time, driverId, sessionNumber) => {
  const normalizedDate = String(date || "").trim();
  const normalizedTime = String(time || "").trim();
  const normalizedDriverId = normalizeSessionDriverSegment(driverId);
  const normalizedSessionNumber = String(sessionNumber ?? "").trim();

  if (
    !isValidDateValue(normalizedDate) ||
    !isValidTimeValue(normalizedTime) ||
    !normalizedDriverId ||
    !/^\d+$/.test(normalizedSessionNumber)
  ) {
    return "";
  }

  return `${normalizedDate.replace(/-/g, "")}-${normalizedTime.replace(":", "")}-${normalizedDriverId}-S${normalizedSessionNumber}`;
};

const createVoiceFormState = () => ({
  date: getCurrentLocalDateValue(),
  time: getCurrentLocalTimeValue(),
  session_id: "",
  track: "",
  driver_id: "",
  vehicle_id: "",
  session_type: "Practice",
  session_number: 1,
  duration_min: 30,
  tire_set: "",
  wheelbase_mm: "",
});

const buildDriverOption = (driver) => ({
  id: String(driver.driverCode || driver.id || "").trim(),
  label:
    driver.fullName ||
    driver.driverName ||
    driver.displayName ||
    driver.driverCode ||
    driver.id ||
    "Unknown driver",
});

const buildVehicleOption = (vehicle) => ({
  id: String(vehicle.vehicleCode || vehicle.id || "").trim(),
  driverId: String(vehicle.driverId || "").trim(),
  label:
    vehicle.vehicleCode ||
    vehicle.registrationNumber ||
    vehicle.make ||
    vehicle.model ||
    vehicle.id ||
    "Unknown vehicle",
});

const validateVoiceSubmissionFields = ({
  formState,
  trackValue,
  runGroupId,
  driverOptions,
  vehicleOptions,
}) => {
  const errors = {};
  const validDriverIds = new Set(
    (driverOptions || [])
      .map((driver) => String(driver?.id || "").trim())
      .filter(Boolean),
  );
  const validVehicleIds = new Set(
    (vehicleOptions || [])
      .map((vehicle) => String(vehicle?.id || "").trim())
      .filter(Boolean),
  );

  if (!isValidDateValue(formState.date)) {
    errors.date = "Please enter a valid date.";
  }

  if (!isValidTimeValue(formState.time)) {
    errors.time = "Please enter a valid time.";
  }

  if (!String(formState.session_type || "").trim()) {
    errors.session_type = "Session type is required.";
  }

  const sessionNumberValue = String(formState.session_number ?? "").trim();
  if (!sessionNumberValue) {
    errors.session_number = "Session number is required.";
  } else {
    const parsedSessionNumber = Number(sessionNumberValue);
    if (!Number.isInteger(parsedSessionNumber) || parsedSessionNumber <= 0) {
      errors.session_number = "Session number must be a whole number greater than 0.";
    }
  }

  if (!isValidSessionId(formState.session_id)) {
    errors.session_id = "Session ID must use the generated format or a legacy session reference.";
  }

  if (!String(trackValue || "").trim()) {
    errors.track = "Track is required.";
  }

  if (!String(runGroupId || "").trim()) {
    errors.run_group = "Run group is required before a voice submission can start.";
  }

  const driverId = String(formState.driver_id || "").trim();
  if (!driverId || !validDriverIds.has(driverId)) {
    errors.driver_id = "Please select a driver.";
  }

  const vehicleId = String(formState.vehicle_id || "").trim();
  if (!vehicleId || !validVehicleIds.has(vehicleId)) {
    errors.vehicle_id = "Please select a vehicle.";
  }

  return errors;
};

const getSubmissionFailureMessage = (errorLike) => {
  const code = String(errorLike?.code || "").trim().toUpperCase();
  const message = String(errorLike?.message || errorLike?.error || "").trim();

  if (code === "SUBMISSION_ALREADY_EXISTS") {
    return "This Session ID already exists. Use a new Session ID or regenerate it before submitting.";
  }

  if (code === "SUBMISSION_DUPLICATE") {
    return "A matching submission already exists for this event, driver, vehicle, date, time, and session number.";
  }

  if (code === "SUBMISSION_SAVE_FAILED") {
    return "The backend could not save this submission. Please try once more.";
  }

  return message || "Voice submission failed. Please try again.";
};

const getSubmissionSuccessState = (submission) => {
  const structuredStatus = String(submission?.structuredIngestStatus || "").trim().toLowerCase();
  const structuredWarnings = Array.isArray(submission?.structuredIngestWarnings)
    ? submission.structuredIngestWarnings
    : [];

  if (structuredStatus === "saved_with_warnings" && structuredWarnings.length) {
    return {
      message:
        "Voice submission saved. Some structured fields could not be normalized, so review the warnings below.",
      warnings: structuredWarnings,
    };
  }

  if (structuredStatus === "skipped" && structuredWarnings.length) {
    return {
      message:
        "Voice submission saved, but structured normalization was skipped for some fields. Review the warnings below.",
      warnings: structuredWarnings,
    };
  }

  return {
    message: "Voice submission saved successfully.",
    warnings: [],
  };
};

const buildVoicePayloadData = ({ formState, runGroupLabel }) => ({
  date: formState.date,
  time: formState.time,
  session_id: formState.session_id,
  track: formState.track,
  run_group: runGroupLabel,
  driver_id: formState.driver_id,
  vehicle_id: formState.vehicle_id,
  session_type: formState.session_type,
  session_number: Number(formState.session_number),
  duration_min: Number(formState.duration_min) || null,
  tire_set: normalizeText(formState.tire_set) || null,
  wheelbase_mm: normalizeText(formState.wheelbase_mm) || null,
});

const formatConfidenceLabel = (confidenceValue) => {
  if (confidenceValue === null || confidenceValue === undefined) {
    return "Pending";
  }

  const normalizedValue =
    Number(confidenceValue) <= 1 ? Number(confidenceValue) * 100 : Number(confidenceValue);

  if (!Number.isFinite(normalizedValue)) {
    return "Pending";
  }

  return `${Math.round(normalizedValue * 10) / 10}%`;
};

const getVoiceStatusMeta = (voiceSession, voiceState) => {
  const visibleStatus = String(voiceState?.visibleStatus || voiceState?.status || "idle").trim().toLowerCase();
  const transcript = buildVoiceNoteTranscript(voiceSession);

  if (visibleStatus === "confirmed") {
    return { label: "Confirmed", tone: "success" };
  }

  if (visibleStatus === "ready" && transcript) {
    return { label: "Ready for review", tone: "success" };
  }

  if (visibleStatus === "transcribing" || visibleStatus === "uploading") {
    return { label: "Processing", tone: "warning" };
  }

  if (visibleStatus === "recording") {
    return { label: "Recording", tone: "accent" };
  }

  if (visibleStatus === "failed" || visibleStatus === "denied" || visibleStatus === "unsupported") {
    return { label: "Action needed", tone: "danger" };
  }

  if (visibleStatus === "closed") {
    return { label: "Event closed", tone: "neutral" };
  }

  return { label: "Ready", tone: "neutral" };
};

const getTranscriptStateLabel = ({ transcriptWordCount, voiceState, alreadyFinalized }) => {
  const normalizedStatus = String(voiceState?.status || "").trim().toLowerCase();

  if (alreadyFinalized) {
    return "Linked";
  }

  if (normalizedStatus === "confirmed") {
    return "Confirmed";
  }

  if (transcriptWordCount) {
    return "Ready";
  }

  if (voiceState?.isBlocking) {
    return "Processing";
  }

  return "Pending";
};

export default function VoiceSubmissionPage() {
  const router = useRouter();
  const params = useParams();
  const eventId = params?.eventId;

  const formStorageKey = useMemo(
    () => (eventId ? `sm2.voiceSubmission.form.${eventId}` : ""),
    [eventId],
  );
  const sessionStorageKey = useMemo(
    () => (eventId ? `sm2.voiceSubmission.session.${eventId}` : ""),
    [eventId],
  );
  const recoveredSessionSnapshot = useMemo(
    () => parseStoredSnapshot(sessionStorageKey),
    [sessionStorageKey],
  );

  const [event, setEvent] = useState(null);
  const [runGroup, setRunGroup] = useState(null);
  const [driverOptions, setDriverOptions] = useState([]);
  const [vehicleOptions, setVehicleOptions] = useState([]);
  const [formState, setFormState] = useState(createVoiceFormState);
  const [sessionIdMode, setSessionIdMode] = useState("auto");
  const [rawText, setRawText] = useState("");
  const [voiceSession, setVoiceSession] = useState(null);
  const [voiceState, setVoiceState] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [successWarnings, setSuccessWarnings] = useState([]);
  const [submittedSubmission, setSubmittedSubmission] = useState(null);
  const [composerResetKey, setComposerResetKey] = useState(0);

  const submissionState = useMemo(() => getEventSubmissionState(event), [event]);
  const runGroupLabel = runGroup?.normalized || runGroup?.rawText || runGroup?.raw_text || "";
  const trackLabel = event?.track || event?.track_name || event?.trackName || "";
  const requiresExplicitReview = voiceSession?.validationStatus === "REVIEW_REQUIRED";
  const alreadyFinalized = Boolean(
    submittedSubmission?.id ||
      submittedSubmission?.submissionId ||
      voiceSession?.submissionId ||
      voiceSession?.submittedAt,
  );
  const voiceStatusMeta = getVoiceStatusMeta(voiceSession, voiceState);
  const transcriptText = normalizeText(voiceState?.transcript || buildVoiceNoteTranscript(voiceSession));
  const transcriptWordCount =
    voiceSession?.transcriptWordCount ||
    (transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0);
  const confidenceLabel = formatConfidenceLabel(voiceSession?.transcriptConfidence);
  const isFormReadOnly = isSubmitting || alreadyFinalized;
  const canFinalize =
    Boolean(runGroup?.id) &&
    submissionState.isOpen &&
    Boolean(voiceSession?.id) &&
    !alreadyFinalized &&
    !voiceState?.isBlocking &&
    ["ready", "confirmed"].includes(String(voiceState?.status || "").trim().toLowerCase()) &&
    (!requiresExplicitReview || String(voiceState?.status || "").trim().toLowerCase() === "confirmed") &&
    !isSubmitting;
  const sessionStateLabel = alreadyFinalized
    ? "Linked"
    : voiceSession?.id
      ? "Active"
      : recoveredSessionSnapshot?.sessionId
        ? "Recovered"
        : "Not started";
  const transcriptStateLabel = getTranscriptStateLabel({
    transcriptWordCount,
    voiceState,
    alreadyFinalized,
  });
  const shouldShowFinalNote = Boolean(alreadyFinalized || transcriptWordCount || normalizeText(rawText));
  const statusSummaryNote = !submissionState.isOpen
    ? "This event is closed for new voice submissions."
    : requiresExplicitReview
      ? "Low-confidence transcript detected. Review it carefully and save before finalizing."
      : voiceState?.isBlocking
        ? "The backend is processing the current recording."
        : alreadyFinalized
          ? "This voice session is already linked to a finalized submission."
          : voiceSession?.id
            ? "The active backend voice session will be reused through transcription and finalize."
            : "Start recording to create the backend voice session.";
  const vehiclesForDriver = useMemo(() => {
    const selectedDriverId = String(formState.driver_id || "").trim();
    if (!selectedDriverId) {
      return vehicleOptions;
    }

    return vehicleOptions.filter((vehicle) => !vehicle.driverId || vehicle.driverId === selectedDriverId);
  }, [formState.driver_id, vehicleOptions]);

  useEffect(() => {
    const storedSnapshot = parseStoredSnapshot(formStorageKey);
    if (!storedSnapshot) {
      return;
    }

    if (storedSnapshot.formState && typeof storedSnapshot.formState === "object") {
      setFormState((current) => ({
        ...current,
        ...storedSnapshot.formState,
      }));
    }

    if (typeof storedSnapshot.rawText === "string") {
      setRawText(storedSnapshot.rawText);
    }

    if (storedSnapshot.sessionIdMode === "manual") {
      setSessionIdMode("manual");
    }
  }, [formStorageKey]);

  useEffect(() => {
    if (!formStorageKey || typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      formStorageKey,
      JSON.stringify({
        formState,
        rawText,
        sessionIdMode,
      }),
    );
  }, [formState, formStorageKey, rawText, sessionIdMode]);

  useEffect(() => {
    if (!eventId) {
      router.push("/events");
      return;
    }

    let active = true;

    const loadVoiceSubmissionContext = async () => {
      try {
        setIsLoading(true);
        setError("");

        const [eventResult, runGroupResult, driversResult, vehiclesResult] = await Promise.allSettled([
          getEventById(eventId),
          getRunGroup(eventId),
          getDrivers(),
          getVehicles(),
        ]);

        if (!active) {
          return;
        }

        if (eventResult.status !== "fulfilled") {
          throw eventResult.reason;
        }

        const eventResponse = eventResult.value;
        const eventData = eventResponse?.event || eventResponse?.data || eventResponse;
        setEvent(eventData || null);
        setRunGroup(runGroupResult.status === "fulfilled" ? runGroupResult.value || null : null);
        setDriverOptions(
          driversResult.status === "fulfilled"
            ? (driversResult.value?.drivers || [])
                .filter((driver) => driver?.isActive !== false)
                .map(buildDriverOption)
            : DRIVER_OPTIONS,
        );
        setVehicleOptions(
          vehiclesResult.status === "fulfilled"
            ? (vehiclesResult.value?.vehicles || [])
                .filter((vehicle) => vehicle?.isActive !== false)
                .map(buildVehicleOption)
            : VEHICLE_OPTIONS,
        );
        selectActiveEvent(eventId).catch((selectError) => {
          console.warn("Failed to set active event:", selectError);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }
        console.error("Voice submission context failed to load:", loadError);
        setError(loadError?.message || "Unable to load the voice submission workspace.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    loadVoiceSubmissionContext();

    return () => {
      active = false;
    };
  }, [eventId, router]);

  useEffect(() => {
    if (!trackLabel) {
      return;
    }

    setFormState((current) => {
      if (normalizeText(current.track) === normalizeText(trackLabel)) {
        return current;
      }
      return {
        ...current,
        track: trackLabel,
      };
    });
  }, [trackLabel]);

  useEffect(() => {
    if (sessionIdMode !== "auto") {
      return;
    }

    const nextSessionId = buildGeneratedSessionId(
      formState.date,
      formState.time,
      formState.driver_id,
      formState.session_number,
    );

    setFormState((current) => {
      if (current.session_id === nextSessionId) {
        return current;
      }
      return {
        ...current,
        session_id: nextSessionId,
      };
    });
  }, [formState.date, formState.driver_id, formState.session_number, formState.time, sessionIdMode]);

  useEffect(() => {
    if (!formState.driver_id) {
      return;
    }

    const currentVehicleExists = vehiclesForDriver.some((vehicle) => vehicle.id === formState.vehicle_id);
    if (currentVehicleExists) {
      return;
    }

    setFormState((current) => ({
      ...current,
      vehicle_id: "",
    }));
  }, [formState.driver_id, formState.vehicle_id, vehiclesForDriver]);

  const clearStoredDrafts = () => {
    if (typeof window === "undefined") {
      return;
    }
    if (formStorageKey) {
      window.sessionStorage.removeItem(formStorageKey);
    }
    if (sessionStorageKey) {
      window.sessionStorage.removeItem(sessionStorageKey);
    }
  };

  const updateFormField = (field, value, options = {}) => {
    const { preserveSessionIdMode = false } = options;

    setFormState((current) => ({
      ...current,
      [field]: value,
    }));

    if (field === "session_id" && !preserveSessionIdMode) {
      setSessionIdMode("manual");
    }

    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const nextErrors = { ...current };
      delete nextErrors[field];
      return nextErrors;
    });
  };

  const handleUseGeneratedSessionId = () => {
    setSessionIdMode("auto");
    updateFormField(
      "session_id",
      buildGeneratedSessionId(
        formState.date,
        formState.time,
        formState.driver_id,
        formState.session_number,
      ),
      { preserveSessionIdMode: true },
    );
  };

  const resetForNextVoiceNote = () => {
    clearStoredDrafts();
    setSubmittedSubmission(null);
    setVoiceSession(null);
    setVoiceState(null);
    setRawText("");
    setFormState({
      ...createVoiceFormState(),
      track: trackLabel,
    });
    setComposerResetKey((current) => current + 1);
    setSessionIdMode("auto");
    setError("");
    setSuccessMessage("");
    setSuccessWarnings([]);
    setFieldErrors({});
  };

  const handleFinalize = async () => {
    setError("");
    setSuccessMessage("");
    setSuccessWarnings([]);

    if (!submissionState.isOpen) {
      setError("This event is closed. Voice submissions are disabled.");
      return;
    }

    if (!runGroup?.id) {
      setError("The backend run group is not configured for this event.");
      return;
    }

    if (!voiceSession?.id) {
      setError("Record a voice note first so a voice session can be created.");
      return;
    }

    if (alreadyFinalized) {
      setError("This voice session has already been finalized into a standard submission.");
      return;
    }

    if (voiceState?.isBlocking) {
      setError("Voice recording is still processing. Wait for the transcript to finish before finalizing.");
      return;
    }

    if (requiresExplicitReview && String(voiceState?.status || "").trim().toLowerCase() !== "confirmed") {
      setError("This transcript requires explicit review. Save the reviewed transcript before finalizing.");
      return;
    }

    const nextErrors = validateVoiceSubmissionFields({
      formState,
      trackValue: trackLabel,
      runGroupId: runGroup.id,
      driverOptions,
      vehicleOptions: vehiclesForDriver,
    });

    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      setError("Please fix the highlighted fields before finalizing the voice submission.");
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const payloadData = buildVoicePayloadData({
        formState,
        runGroupLabel,
      });

      const payload = await buildSubmissionPayload({
        event_id: eventId,
        run_group_id: runGroup.id,
        voice_session_id: voiceSession.id,
        driver_id: formState.driver_id,
        vehicle_id: formState.vehicle_id,
        raw_text: normalizeText(rawText) || undefined,
        payload: {
          data: payloadData,
        },
        analysis_result: {
          submission_mode: "quick",
          source_type: "voice",
          raw_input_mode: "voice",
          has_voice_notes: true,
          voice_input_used: true,
          confidence: voiceSession?.transcriptConfidence ?? undefined,
        },
      });

      const response = await finalizeVoiceSubmission({
        voiceSessionId: voiceSession.id,
        submissionData: payload,
      });

      if (!response.success) {
        throw response;
      }

      const nextSubmission = response.submission;
      const successState = getSubmissionSuccessState(nextSubmission);

      setSubmittedSubmission(nextSubmission);
      setVoiceSession(
        normalizeVoiceSession(nextSubmission?.voiceSession || nextSubmission?.voice_session || voiceSession),
      );
      setVoiceState((current) => ({
        ...current,
        status: "confirmed",
        visibleStatus: "confirmed",
      }));
      setSuccessMessage(successState.message);
      setSuccessWarnings(successState.warnings);
      clearStoredDrafts();
    } catch (submitError) {
      console.error("Voice finalize failed:", submitError);
      setError(getSubmissionFailureMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <ProtectedRoute requireDriver={true}>
        <Loader
          fullHeight
          label="Loading voice submission"
          sublabel="Preparing event context, run group, and voice workflow..."
        />
      </ProtectedRoute>
    );
  }

  if (!event) {
    return (
      <ProtectedRoute requireDriver={true}>
        <div className="voice-submission-page">
          <div className="voice-submission-shell">
            <div className="voice-submission-state-card">
              <h1>Voice submission unavailable</h1>
              <p>{error || "The selected event could not be loaded."}</p>
              <div className="voice-submission-state-actions">
                <button type="button" className="btn btn-secondary" onClick={() => router.push("/events")}>
                  Back to Events
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
      <ProtectedRoute requireDriver={true}>
      <div className="voice-submission-page">
        <div className="voice-submission-shell">
          <div className="voice-submission-topbar">
            <ScreenBackButton fallbackHref={`/event/${eventId}`} label="Back" />

            <div className="voice-submission-topbar-meta">
              <StatusBadge
                label={submissionState.isOpen ? "Event Open" : "Event Closed"}
                tone={submissionState.isOpen ? "success" : "neutral"}
              />
              <StatusBadge label={runGroupLabel || "Run Group Missing"} tone={runGroupLabel ? "accent" : "warning"} />
              <StatusBadge label={voiceStatusMeta.label} tone={voiceStatusMeta.tone} />
            </div>
          </div>

          <section className="voice-submission-context-strip">
            <div className="voice-submission-context-item">
              <span>Event</span>
              <strong>{event.name || "Unavailable"}</strong>
            </div>
            <div className="voice-submission-context-item">
              <span>Track</span>
              <strong>{trackLabel || "Unavailable"}</strong>
            </div>
            <div className="voice-submission-context-item">
              <span>Run Group</span>
              <strong>{runGroupLabel || "Not Configured"}</strong>
            </div>
            <div className="voice-submission-context-item">
              <span>Date</span>
              <strong>{formState.date || "Auto"}</strong>
            </div>
            <div className="voice-submission-context-item">
              <span>Time</span>
              <strong>{formState.time || "Auto"}</strong>
            </div>
          </section>

          {!submissionState.isOpen ? (
            <div className="voice-submission-banner neutral">
              <PendingActionsRoundedIcon fontSize="inherit" />
              <span>This event is closed, so voice actions are disabled. You can still inspect any recovered session state.</span>
            </div>
          ) : null}

          {!runGroup?.id ? (
            <div className="voice-submission-banner warning">
              <PendingActionsRoundedIcon fontSize="inherit" />
              <span>
                This event does not currently expose a valid backend run-group UUID. Voice session creation is blocked until the run group is fixed.
              </span>
            </div>
          ) : null}

          {requiresExplicitReview ? (
            <div className="voice-submission-banner warning">
              <PendingActionsRoundedIcon fontSize="inherit" />
              <span>
                OpenAI marked this transcript as low confidence. Review the transcript carefully and click <strong>Save Transcript</strong> before finalizing.
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="voice-submission-banner danger" data-testid="voice-submission-error">
              <PendingActionsRoundedIcon fontSize="inherit" />
              <span>{error}</span>
            </div>
          ) : null}

          {successMessage ? (
            <div className="voice-submission-banner success" data-testid="voice-submission-success">
              <CheckCircleRoundedIcon fontSize="inherit" />
              <span>{successMessage}</span>
            </div>
          ) : null}

          {alreadyFinalized && !submittedSubmission ? (
            <div className="voice-submission-banner success">
              <CheckCircleRoundedIcon fontSize="inherit" />
              <span>
                This recovered voice session is already linked to a finalized submission and is now read only.
              </span>
            </div>
          ) : null}

          <section className="voice-submission-main-grid">
            <div className="voice-submission-panel voice-submission-panel-compact">
              <div className="voice-submission-panel-head">
                <div>
                  <p className="voice-submission-panel-eyebrow">Required Details</p>
                  <h2>Only the essentials before recording</h2>
                </div>
                <StatusBadge
                  label={submissionState.isOpen ? "Driver Ready" : "Read Only"}
                  tone={submissionState.isOpen ? "success" : "neutral"}
                />
              </div>

              <div className="voice-submission-form-grid voice-submission-form-grid-minimal">
                <div className="voice-submission-field">
                  <label id="voice-driver-label" htmlFor="voice-driver">Driver</label>
                  <AppSelect
                    id="voice-driver"
                    testId="voice-submission-driver"
                    triggerClassName="select"
                    value={formState.driver_id}
                    onValueChange={(value) => updateFormField("driver_id", value)}
                    options={driverOptions.map((driver) => ({
                      value: driver.id,
                      label: driver.label,
                    }))}
                    placeholder="Select Driver"
                    disabled={isFormReadOnly}
                    invalid={Boolean(fieldErrors.driver_id)}
                    ariaLabelledby="voice-driver-label"
                  />
                  {fieldErrors.driver_id ? <p className="voice-submission-field-error">{fieldErrors.driver_id}</p> : null}
                </div>

                <div className="voice-submission-field">
                  <label id="voice-vehicle-label" htmlFor="voice-vehicle">Vehicle</label>
                  <AppSelect
                    id="voice-vehicle"
                    testId="voice-submission-vehicle"
                    triggerClassName="select"
                    value={formState.vehicle_id}
                    onValueChange={(value) => updateFormField("vehicle_id", value)}
                    options={vehiclesForDriver.map((vehicle) => ({
                      value: vehicle.id,
                      label: vehicle.label,
                    }))}
                    placeholder="Select Vehicle"
                    disabled={isFormReadOnly}
                    invalid={Boolean(fieldErrors.vehicle_id)}
                    ariaLabelledby="voice-vehicle-label"
                    emptyMessage="No vehicles assigned to this driver"
                  />
                  {fieldErrors.vehicle_id ? <p className="voice-submission-field-error">{fieldErrors.vehicle_id}</p> : null}
                </div>

                <div className="voice-submission-field voice-submission-field-wide">
                  <label htmlFor="voice-session-id">Session ID</label>
                  <div className="voice-submission-inline-field">
                    <input
                      id="voice-session-id"
                      data-testid="voice-submission-session-id"
                      className={`input ${fieldErrors.session_id ? "input-error" : ""}`}
                      type="text"
                      value={formState.session_id}
                      readOnly
                      disabled={isFormReadOnly}
                    />
                    <button type="button" className="btn btn-secondary" onClick={handleUseGeneratedSessionId} disabled={isFormReadOnly}>
                      Regenerate ID
                    </button>
                  </div>
                  {fieldErrors.session_id ? <p className="voice-submission-field-error">{fieldErrors.session_id}</p> : null}
                  <p className="voice-submission-field-hint">
                    Auto-generated from the current date, time, driver, and session number.
                  </p>
                </div>
              </div>

              <details className="voice-submission-advanced-details">
                <summary>Advanced details</summary>
                <p className="voice-submission-advanced-copy">
                  Most voice notes do not need this metadata. Open it only when you need to adjust the default submission context.
                </p>

                <div className="voice-submission-form-grid voice-submission-form-grid-advanced">
                  <div className="voice-submission-field">
                    <label htmlFor="voice-date">Date</label>
                    <input
                      id="voice-date"
                      data-testid="voice-submission-date"
                      className={`input ${fieldErrors.date ? "input-error" : ""}`}
                      type="date"
                      value={formState.date}
                      onChange={(event) => updateFormField("date", event.target.value)}
                      disabled={isFormReadOnly}
                    />
                    {fieldErrors.date ? <p className="voice-submission-field-error">{fieldErrors.date}</p> : null}
                  </div>

                  <div className="voice-submission-field">
                    <label htmlFor="voice-time">Time</label>
                    <input
                      id="voice-time"
                      data-testid="voice-submission-time"
                      className={`input ${fieldErrors.time ? "input-error" : ""}`}
                      type="time"
                      value={formState.time}
                      onChange={(event) => updateFormField("time", event.target.value)}
                      disabled={isFormReadOnly}
                    />
                    {fieldErrors.time ? <p className="voice-submission-field-error">{fieldErrors.time}</p> : null}
                  </div>

                  <div className="voice-submission-field voice-submission-field-wide">
                    <label htmlFor="voice-session-id-manual">Session ID Override</label>
                    <div className="voice-submission-inline-field">
                      <input
                        id="voice-session-id-manual"
                        className={`input ${fieldErrors.session_id ? "input-error" : ""}`}
                        type="text"
                        value={formState.session_id}
                        onChange={(event) => updateFormField("session_id", event.target.value.toUpperCase())}
                        disabled={isFormReadOnly}
                      />
                      <button type="button" className="btn btn-secondary" onClick={handleUseGeneratedSessionId} disabled={isFormReadOnly}>
                        Use Auto ID
                      </button>
                    </div>
                  </div>

                  <div className="voice-submission-field">
                    <label id="voice-session-type-label" htmlFor="voice-session-type">Session Type</label>
                    <AppSelect
                      id="voice-session-type"
                      testId="voice-submission-session-type"
                      triggerClassName="select"
                      value={formState.session_type}
                      onValueChange={(value) => updateFormField("session_type", value)}
                      options={SESSION_TYPE_OPTIONS.map((option) => ({
                        value: option.id,
                        label: option.label,
                      }))}
                      placeholder="Select session type"
                      disabled={isFormReadOnly}
                      invalid={Boolean(fieldErrors.session_type)}
                      ariaLabelledby="voice-session-type-label"
                    />
                    {fieldErrors.session_type ? <p className="voice-submission-field-error">{fieldErrors.session_type}</p> : null}
                  </div>

                  <div className="voice-submission-field">
                    <label htmlFor="voice-session-number">Session #</label>
                    <input
                      id="voice-session-number"
                      data-testid="voice-submission-session-number"
                      className={`input ${fieldErrors.session_number ? "input-error" : ""}`}
                      type="number"
                      min="1"
                      step="1"
                      value={formState.session_number}
                      onChange={(event) => updateFormField("session_number", event.target.value)}
                      disabled={isFormReadOnly}
                    />
                    {fieldErrors.session_number ? <p className="voice-submission-field-error">{fieldErrors.session_number}</p> : null}
                  </div>

                  <div className="voice-submission-field">
                    <label htmlFor="voice-duration">Duration (minutes)</label>
                    <input
                      id="voice-duration"
                      className="input"
                      type="number"
                      min="1"
                      step="1"
                      value={formState.duration_min}
                      onChange={(event) => updateFormField("duration_min", event.target.value)}
                      disabled={isFormReadOnly}
                    />
                  </div>

                  <div className="voice-submission-field">
                    <label htmlFor="voice-tire-set">Tire Set</label>
                    <input
                      id="voice-tire-set"
                      className="input"
                      type="text"
                      value={formState.tire_set}
                      onChange={(event) => updateFormField("tire_set", event.target.value)}
                      disabled={isFormReadOnly}
                    />
                  </div>

                  <div className="voice-submission-field">
                    <label htmlFor="voice-wheelbase">Wheelbase (mm)</label>
                    <input
                      id="voice-wheelbase"
                      className="input"
                      type="number"
                      step="1"
                      value={formState.wheelbase_mm}
                      onChange={(event) => updateFormField("wheelbase_mm", event.target.value)}
                      disabled={isFormReadOnly}
                    />
                  </div>
                </div>
              </details>
            </div>

            <section className="voice-submission-status-strip">
              <div className="voice-submission-status-item">
                <span>Status</span>
                <strong>{voiceStatusMeta.label}</strong>
              </div>
              <div className="voice-submission-status-item">
                <span>Session</span>
                <strong>{sessionStateLabel}</strong>
              </div>
              <div className="voice-submission-status-item">
                <span>Transcript</span>
                <strong>{transcriptStateLabel}</strong>
              </div>
              <div className="voice-submission-status-item">
                <span>Confidence</span>
                <strong>{voiceSession?.transcriptConfidence !== null && voiceSession?.transcriptConfidence !== undefined ? confidenceLabel : "Pending"}</strong>
              </div>
            </section>

            <p className="voice-submission-status-note">{statusSummaryNote}</p>

            <VoiceNoteComposer
              key={`voice-submission-composer-${composerResetKey}`}
              eventId={eventId}
              runGroupId={runGroup?.id || ""}
              eventOpen={submissionState.isOpen}
              disabled={isFormReadOnly}
              rawText={rawText}
              onRawTextChange={setRawText}
              onVoiceSessionChange={(nextSession) => {
                setVoiceSession(nextSession);
              }}
              onVoiceStateChange={setVoiceState}
              onTranscriptApplied={() => {
                setError("");
              }}
              className="voice-submission-composer"
              storageKey={sessionStorageKey}
              initialVoiceSessionId={recoveredSessionSnapshot?.sessionId || null}
            />

            {shouldShowFinalNote ? (
              <div className="voice-submission-panel voice-submission-final-note-panel">
                <div className="voice-submission-panel-head">
                  <div>
                    <p className="voice-submission-panel-eyebrow">Final Note</p>
                    <h2>Submission content</h2>
                  </div>
                  <StatusBadge
                    label={rawText ? `${rawText.trim().split(/\s+/).filter(Boolean).length} words` : "No note content"}
                    tone={rawText ? "info" : "neutral"}
                  />
                </div>

                <p className="voice-submission-note-copy">
                  The reviewed transcript lands here before finalize. It will still be written into the normal submission pipeline as <code>raw_text</code>.
                </p>

                <textarea
                  data-testid="voice-submission-raw-text"
                  className="textarea voice-submission-note-textarea"
                  rows={4}
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                  disabled={isFormReadOnly}
                  placeholder="The reviewed transcript will appear here after you apply it."
                />
              </div>
            ) : null}
          </section>

          {successWarnings.length ? (
            <div className="voice-submission-warning-list">
              <h3>Structured warnings</h3>
              <ul>
                {successWarnings.map((warning, index) => (
                  <li key={`${warning.code || "voice-warning"}-${index}`}>
                    {warning.field ? `${warning.field}: ` : ""}
                    {warning.message || "Structured normalization completed with a warning."}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <footer className="voice-submission-footer">
            <div className="voice-submission-footer-copy">
              <h3>Finalize voice submission</h3>
              <p>
                Finalize only after the transcript is accurate. The backend will preserve the voice session, audio, attempts, and linked submission record.
              </p>
            </div>

            <div className="voice-submission-footer-actions">
              <button type="button" className="btn btn-secondary" onClick={() => router.push(`/event/${eventId}`)} disabled={isSubmitting}>
                Back to Event
              </button>
              <button
                type="button"
                className="btn btn-primary btn-large"
                onClick={handleFinalize}
                disabled={!canFinalize}
                data-testid="voice-submission-finalize"
              >
                {isSubmitting
                  ? "Finalizing..."
                  : alreadyFinalized
                    ? "Already Finalized"
                    : "Finalize Voice Submission"}
              </button>
            </div>
          </footer>

          {submittedSubmission ? (
            <section className="voice-submission-success-panel">
              <div className="voice-submission-success-copy">
                <div className="voice-submission-eyebrow">
                  <CheckCircleRoundedIcon fontSize="inherit" />
                  Submission Linked
                </div>
                <h2>Voice session finalized into the standard submission pipeline</h2>
                <p>
                  Submission <strong>{submittedSubmission.submissionId || submittedSubmission.submission_ref}</strong> now carries the linked <code>voice_session_id</code> and stays visible in the owner review screens with protected audio playback.
                </p>
              </div>
              <div className="voice-submission-success-actions">
                <button
                  type="button"
                  className="voice-submission-link-card"
                  onClick={() => router.push(`/event/${eventId}/submissions`)}
                >
                  <div className="voice-submission-link-icon">
                    <GraphicEqRoundedIcon fontSize="inherit" />
                  </div>
                  <div className="voice-submission-link-copy">
                    <span>History</span>
                    <strong>Open Submissions</strong>
                  </div>
                  <KeyboardArrowRightRoundedIcon fontSize="inherit" />
                </button>

                <button
                  type="button"
                  className="voice-submission-link-card"
                  onClick={() => router.push(`/event/${eventId}`)}
                >
                  <div className="voice-submission-link-icon accent">
                    <NoteAltRoundedIcon fontSize="inherit" />
                  </div>
                  <div className="voice-submission-link-copy">
                    <span>Workspace</span>
                    <strong>Return to Event</strong>
                  </div>
                  <KeyboardArrowRightRoundedIcon fontSize="inherit" />
                </button>

                <button
                  type="button"
                  className="voice-submission-link-card"
                  onClick={resetForNextVoiceNote}
                >
                  <div className="voice-submission-link-icon neutral">
                    <ReplayRoundedIcon fontSize="inherit" />
                  </div>
                  <div className="voice-submission-link-copy">
                    <span>Next</span>
                    <strong>Start Another Voice Note</strong>
                  </div>
                  <KeyboardArrowRightRoundedIcon fontSize="inherit" />
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </ProtectedRoute>
  );
}
