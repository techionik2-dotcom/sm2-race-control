"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import TextSnippetOutlinedIcon from "@mui/icons-material/TextSnippetOutlined";

import StatusBadge from "../../../../components/Common/StatusBadge";
import { generateUUID } from "../../../../utils/uuid";
import {
  archiveVoiceSession,
  buildVoiceNoteTranscript,
  createVoiceSession,
  getVoiceSession,
  normalizeVoiceSession,
  retryVoiceTranscription,
  saveVoiceTranscript,
  transcribeVoiceSession,
  uploadVoiceAudio,
} from "../../../../utils/voiceNotesApi";

const POLL_INTERVAL_MS = 1800;
const POLL_ATTEMPT_LIMIT = 60;
const POLL_ERROR_LIMIT = 3;

const STATE_COPY = {
  idle: {
    label: "Ready",
    tone: "neutral",
    title: "Ready to record",
    message: "Record a short voice note and the transcript will be prepared for review.",
  },
  recording: {
    label: "Recording",
    tone: "accent",
    title: "Recording in progress",
    message: "Speak naturally. Stop when you are finished.",
  },
  uploading: {
    label: "Uploading",
    tone: "info",
    title: "Uploading audio",
    message: "Sending the audio to the backend so it can be stored and transcribed.",
  },
  transcribing: {
    label: "Transcribing",
    tone: "warning",
    title: "Transcription in progress",
    message: "OpenAI is converting the recording into text.",
  },
  ready: {
    label: "Ready for review",
    tone: "success",
    title: "Transcript ready",
    message: "Review and edit the transcript before it is saved into the note.",
  },
  confirmed: {
    label: "Confirmed",
    tone: "success",
    title: "Transcript confirmed",
    message: "The transcript is confirmed and ready to be submitted with the note.",
  },
  failed: {
    label: "Failed",
    tone: "danger",
    title: "Voice capture failed",
    message: "The voice note could not be processed. You can retry transcription or re-record.",
  },
  denied: {
    label: "Permission denied",
    tone: "danger",
    title: "Microphone permission denied",
    message: "Allow microphone access in your browser settings and try again.",
  },
  unsupported: {
    label: "Unsupported",
    tone: "danger",
    title: "Voice capture unsupported",
    message: "This browser cannot capture audio with the built-in recorder.",
  },
  archived: {
    label: "Archived",
    tone: "neutral",
    title: "Archived",
    message: "This voice note has been archived.",
  },
  closed: {
    label: "Event closed",
    tone: "neutral",
    title: "Voice submission closed",
    message: "This event is closed, so voice actions are disabled.",
  },
};

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
];

const MUTATING_STATUSES = new Set(["recording", "uploading", "transcribing"]);
const PENDING_SERVER_STATUSES = new Set(["PENDING_TRANSCRIPTION", "TRANSCRIBING"]);
const READ_ONLY_SERVER_STATUSES = new Set(["ARCHIVED", "SUBMITTED"]);

const normalizeText = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

const formatDuration = (durationMs) => {
  const totalSeconds = Math.max(0, Math.round((durationMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const pickRecorderMimeType = () => {
  if (typeof window === "undefined" || !window.MediaRecorder?.isTypeSupported) {
    return "";
  }

  return PREFERRED_MIME_TYPES.find((mimeType) => window.MediaRecorder.isTypeSupported(mimeType)) || "";
};

const makeAudioFile = (blob, mimeType) => {
  const extension =
    mimeType === "audio/mp4" || mimeType === "audio/m4a"
      ? "m4a"
      : mimeType === "audio/ogg" || mimeType === "audio/ogg;codecs=opus"
        ? "ogg"
        : "webm";
  return new File([blob], `voice-note-${Date.now()}.${extension}`, {
    type: mimeType || blob.type || "audio/webm",
  });
};

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
    console.warn("Voice note snapshot could not be parsed:", error);
    return null;
  }
};

const getServerStatus = (voiceSession) => String(voiceSession?.status || "").trim().toUpperCase();

const isPendingServerStatus = (voiceSession) => PENDING_SERVER_STATUSES.has(getServerStatus(voiceSession));

const isRecoverableServerStatus = (voiceSession) => !READ_ONLY_SERVER_STATUSES.has(getServerStatus(voiceSession));

const statusFromSession = (voiceSession) => {
  const serverStatus = getServerStatus(voiceSession);
  if (serverStatus === "TRANSCRIPTION_FAILED") {
    return "failed";
  }
  if (serverStatus === "ARCHIVED") {
    return "archived";
  }
  if (serverStatus === "CONFIRMED" || voiceSession?.validationStatus === "VALIDATED") {
    return "confirmed";
  }
  if (serverStatus === "PENDING_REVIEW") {
    return "ready";
  }
  if (serverStatus === "UPLOADED") {
    return "uploading";
  }
  if (PENDING_SERVER_STATUSES.has(serverStatus)) {
    return "transcribing";
  }
  return "idle";
};

export default function VoiceNoteComposer({
  eventId,
  runGroupId,
  eventOpen = true,
  disabled = false,
  rawText = "",
  onRawTextChange,
  onVoiceSessionChange,
  onVoiceStateChange,
  onTranscriptApplied,
  className = "",
  storageKey = "",
  initialVoiceSessionId = null,
}) {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(STATE_COPY.idle.message);
  const [session, setSession] = useState(null);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [isSupported, setIsSupported] = useState(true);
  const [isSecureContext, setIsSecureContext] = useState(true);
  const [error, setError] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const mountedRef = useRef(false);
  const pollTimerRef = useRef(null);
  const durationTimerRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const currentSessionIdRef = useRef(null);
  const clientSessionIdRef = useRef(null);
  const userEditedTranscriptRef = useRef(false);
  const transcriptRef = useRef("");
  const pollAttemptCountRef = useRef(0);
  const pollErrorCountRef = useRef(0);

  const visibleStatus = !eventOpen ? "closed" : status;
  const stateMeta = useMemo(() => STATE_COPY[visibleStatus] || STATE_COPY.idle, [visibleStatus]);
  const isBusy = MUTATING_STATUSES.has(status);
  const isTranscriptReady =
    Boolean(session?.id) &&
    ["ready", "confirmed"].includes(status) &&
    Boolean(buildVoiceNoteTranscript(session) || transcriptDraft);

  const clearPersistedSnapshot = () => {
    if (!storageKey || typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(storageKey);
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollAttemptCountRef.current = 0;
    pollErrorCountRef.current = 0;
  };

  const clearTimers = () => {
    stopPolling();
    if (durationTimerRef.current) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  };

  const cleanupRecorder = () => {
    clearTimers();

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      try {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (cleanupError) {
        console.warn("Voice recorder cleanup skipped:", cleanupError);
      }
    }

    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  const publishState = (nextStatus, nextMessage, nextError = "") => {
    setStatus(nextStatus);
    setMessage(nextMessage);
    setError(nextError);
  };

  const publishSession = (nextSession) => {
    const normalized = normalizeVoiceSession(nextSession);
    setSession(normalized);
    currentSessionIdRef.current = normalized?.id || null;
    clientSessionIdRef.current = normalized?.clientSessionId || clientSessionIdRef.current || null;

    if (typeof onVoiceSessionChange === "function") {
      onVoiceSessionChange(normalized);
    }

    return normalized;
  };

  const applyTranscriptToNote = (transcript, mode = "replace") => {
    const cleanedTranscript = normalizeText(transcript);
    if (!cleanedTranscript || typeof onRawTextChange !== "function") {
      return;
    }

    if (mode === "append") {
      onRawTextChange((currentValue = "") => {
        const currentText = normalizeText(currentValue);
        return currentText ? `${currentText} ${cleanedTranscript}` : cleanedTranscript;
      });
    } else {
      onRawTextChange(cleanedTranscript);
    }

    if (typeof onTranscriptApplied === "function") {
      onTranscriptApplied(cleanedTranscript);
    }
  };

  const syncTranscriptDraft = (nextTranscript, { allowAutoApply = false, markEdited = false } = {}) => {
    const cleanedTranscript = normalizeText(nextTranscript);
    transcriptRef.current = cleanedTranscript;
    setTranscriptDraft(cleanedTranscript);

    if (markEdited) {
      userEditedTranscriptRef.current = true;
    }

    if (allowAutoApply && cleanedTranscript && !normalizeText(rawText)) {
      applyTranscriptToNote(cleanedTranscript, "replace");
    }
  };

  const persistSnapshot = (nextSessionId = currentSessionIdRef.current) => {
    if (!storageKey || typeof window === "undefined") {
      return;
    }

    const cleanedSessionId = normalizeText(nextSessionId);
    const cleanedTranscript = normalizeText(transcriptRef.current || transcriptDraft);

    if (!cleanedSessionId && !cleanedTranscript) {
      clearPersistedSnapshot();
      return;
    }

    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        sessionId: cleanedSessionId || null,
        clientSessionId: normalizeText(clientSessionIdRef.current) || null,
        transcriptDraft: cleanedTranscript || "",
      }),
    );
  };

  const publishRecoveredSession = (latestSession, storedTranscript = "") => {
    const normalized = publishSession(latestSession);
    const sessionTranscript = buildVoiceNoteTranscript(normalized);
    const draftTranscript = normalizeText(storedTranscript) || sessionTranscript;

    if (draftTranscript) {
      syncTranscriptDraft(draftTranscript, {
        allowAutoApply: !normalizeText(rawText),
        markEdited: Boolean(normalizeText(storedTranscript) && normalizeText(storedTranscript) !== normalizeText(sessionTranscript)),
      });
    }

    if (getServerStatus(normalized) === "SUBMITTED") {
      clearPersistedSnapshot();
      publishState("confirmed", "This voice submission has already been finalized.");
      return normalized;
    }

    if (getServerStatus(normalized) === "ARCHIVED") {
      clearPersistedSnapshot();
      publishState("archived", normalized.validationMessage || STATE_COPY.archived.message);
      return normalized;
    }

    if (getServerStatus(normalized) === "TRANSCRIPTION_FAILED") {
      publishState(
        "failed",
        normalized.lastErrorMessage || normalized.validationMessage || STATE_COPY.failed.message,
        normalized.lastErrorMessage || normalized.validationMessage || STATE_COPY.failed.message,
      );
      return normalized;
    }

    if (isPendingServerStatus(normalized)) {
      publishState("transcribing", STATE_COPY.transcribing.message);
      return normalized;
    }

    if (getServerStatus(normalized) === "UPLOADED") {
      publishState("ready", "Audio is stored. Start or retry transcription to continue.");
      return normalized;
    }

    publishState(
      statusFromSession(normalized),
      normalized.validationMessage ||
        (statusFromSession(normalized) === "confirmed"
          ? STATE_COPY.confirmed.message
          : STATE_COPY.ready.message),
    );
    return normalized;
  };

  const refreshSessionStatus = async (voiceSessionId) => {
    const sessionId = normalizeText(voiceSessionId || currentSessionIdRef.current);
    if (!sessionId) {
      publishState("failed", "Voice session is missing.", "Voice session is missing.");
      throw new Error("Voice session is missing.");
    }

    const latest = await getVoiceSession(sessionId);
    const normalized = publishRecoveredSession(latest);

    if (isPendingServerStatus(normalized)) {
      return normalized;
    }

    persistSnapshot(normalized.id);
    return normalized;
  };

  const startPolling = (voiceSessionId) => {
    const sessionId = normalizeText(voiceSessionId);
    if (!sessionId) {
      return;
    }

    stopPolling();
    pollAttemptCountRef.current = 0;
    pollErrorCountRef.current = 0;

    pollTimerRef.current = window.setInterval(async () => {
      if (!mountedRef.current) {
        return;
      }

      pollAttemptCountRef.current += 1;
      if (pollAttemptCountRef.current > POLL_ATTEMPT_LIMIT) {
        stopPolling();
        publishState(
          "failed",
          "Transcription status took too long to refresh. Use Refresh Status to continue.",
          "Polling timed out before the final transcription state was confirmed.",
        );
        return;
      }

      try {
        const latest = await getVoiceSession(sessionId);
        pollErrorCountRef.current = 0;
        const normalized = publishRecoveredSession(latest);
        persistSnapshot(normalized.id);

        if (!isPendingServerStatus(normalized)) {
          stopPolling();
        }
      } catch (pollError) {
        pollErrorCountRef.current += 1;
        if (pollErrorCountRef.current >= POLL_ERROR_LIMIT) {
          stopPolling();
          publishState(
            "failed",
            "Unable to refresh transcription status. Use Refresh Status to continue.",
            pollError?.message || "Polling failed repeatedly.",
          );
        }
      }
    }, POLL_INTERVAL_MS);
  };

  const uploadAndTranscribe = async (audioBlob, mimeType, durationMs) => {
    const voiceSessionId = normalizeText(currentSessionIdRef.current);
    if (!voiceSessionId) {
      throw new Error("Voice session is missing.");
    }

    publishState("uploading", STATE_COPY.uploading.message);
    const file = makeAudioFile(audioBlob, mimeType);
    const uploadedSession = await uploadVoiceAudio({
      voiceSessionId,
      audioFile: file,
      audioDurationMs: durationMs,
    });
    publishSession(uploadedSession);
    persistSnapshot(uploadedSession.id);

    publishState("transcribing", STATE_COPY.transcribing.message);
    const queuedSession = await transcribeVoiceSession(voiceSessionId);
    publishSession(queuedSession);
    persistSnapshot(queuedSession.id);
    startPolling(voiceSessionId);
    return queuedSession;
  };

  const startRecording = async () => {
    if (disabled) {
      return;
    }

    if (!eventOpen) {
      publishState("failed", STATE_COPY.closed.message, "This event is closed for new voice activity.");
      return;
    }

    if (!normalizeText(runGroupId)) {
      publishState(
        "failed",
        "Voice submission cannot start because the run group is not configured correctly.",
        "Invalid or missing run group for this event.",
      );
      return;
    }

    if (!isSupported) {
      publishState("unsupported", STATE_COPY.unsupported.message, STATE_COPY.unsupported.message);
      return;
    }

    if (!isSecureContext) {
      publishState(
        "failed",
        "Microphone access requires a secure context.",
        "Microphone access requires HTTPS or localhost.",
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      publishState("unsupported", STATE_COPY.unsupported.message, STATE_COPY.unsupported.message);
      return;
    }

    cleanupRecorder();
    chunksRef.current = [];
    setRecordingElapsedMs(0);
    setError("");
    setMessage(STATE_COPY.recording.message);
    userEditedTranscriptRef.current = false;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (captureError) {
      const errorName = captureError?.name || "";
      if (errorName === "NotAllowedError" || errorName === "SecurityError") {
        publishState("denied", STATE_COPY.denied.message, STATE_COPY.denied.message);
      } else {
        publishState(
          "failed",
          "Unable to access the microphone.",
          captureError?.message || "Unable to access the microphone.",
        );
      }
      cleanupRecorder();
      return;
    }

    try {
      const newClientSessionId = generateUUID();
      clientSessionIdRef.current = newClientSessionId;

      const sessionPayload = await createVoiceSession({
        eventId,
        runGroupId,
        clientSessionId: newClientSessionId,
      });
      const normalizedSession = publishSession(sessionPayload);
      if (!normalizedSession?.id) {
        throw new Error("Voice session could not be created.");
      }
      currentSessionIdRef.current = normalizedSession.id;
      persistSnapshot(normalizedSession.id);
    } catch (sessionError) {
      publishState(
        "failed",
        sessionError?.message || "Unable to create a voice session for this recording.",
        sessionError?.message || "Unable to create a voice session.",
      );
      cleanupRecorder();
      return;
    }

    try {
      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        const errorMessage = event?.error?.message || "Voice capture failed.";
        publishState("failed", errorMessage, errorMessage);
        cleanupRecorder();
      };

      recorder.onstart = () => {
        recordingStartedAtRef.current = Date.now();
        durationTimerRef.current = window.setInterval(() => {
          if (!recordingStartedAtRef.current) {
            return;
          }
          setRecordingElapsedMs(Date.now() - recordingStartedAtRef.current);
        }, 250);

        publishState("recording", STATE_COPY.recording.message);
      };

      recorder.onstop = async () => {
        const finalDurationMs = recordingStartedAtRef.current
          ? Math.max(0, Date.now() - recordingStartedAtRef.current)
          : recordingElapsedMs;

        setRecordingElapsedMs(finalDurationMs);
        if (durationTimerRef.current) {
          window.clearInterval(durationTimerRef.current);
          durationTimerRef.current = null;
        }
        recordingStartedAtRef.current = null;

        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: recordedMimeType });
        chunksRef.current = [];
        cleanupRecorder();

        if (!audioBlob.size) {
          publishState("failed", "No voice was captured. Please re-record.", "No voice was captured.");
          return;
        }

        try {
          await uploadAndTranscribe(audioBlob, recordedMimeType, finalDurationMs);
        } catch (uploadError) {
          publishState(
            "failed",
            uploadError?.message || "Voice audio upload failed.",
            uploadError?.message || "Voice audio upload failed.",
          );
        }
      };

      recorder.start();
    } catch (recorderError) {
      publishState(
        "failed",
        recorderError?.message || "Voice capture could not start.",
        recorderError?.message || "Voice capture could not start.",
      );
      cleanupRecorder();
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }

    try {
      recorder.stop();
    } catch (stopError) {
      publishState(
        "failed",
        "Voice capture could not be stopped cleanly.",
        stopError?.message || "Voice capture could not be stopped cleanly.",
      );
      cleanupRecorder();
    }
  };

  const handleConfirmTranscript = async () => {
    if (disabled || !eventOpen || !session?.id) {
      return;
    }

    const transcript = normalizeText(
      transcriptDraft || session.transcriptEditedText || session.transcriptText,
    );
    if (!transcript) {
      publishState("failed", "Transcript cannot be empty.", "Transcript cannot be empty.");
      return;
    }

    try {
      const updatedSession = await saveVoiceTranscript(session.id, {
        transcript_edited_text: transcript,
        status: "CONFIRMED",
        validation_status: "VALIDATED",
      });
      const normalized = publishSession(updatedSession);
      syncTranscriptDraft(transcript, { allowAutoApply: false, markEdited: true });
      persistSnapshot(normalized.id);
      publishState("confirmed", normalized.validationMessage || STATE_COPY.confirmed.message);
    } catch (saveError) {
      publishState(
        "failed",
        saveError?.message || "Unable to save the transcript.",
        saveError?.message || "Unable to save the transcript.",
      );
    }
  };

  const handleRetry = async () => {
    if (disabled || !eventOpen || !session?.id) {
      return;
    }

    try {
      publishState("transcribing", STATE_COPY.transcribing.message);
      const updatedSession = await retryVoiceTranscription(session.id);
      const normalized = publishSession(updatedSession);
      persistSnapshot(normalized.id);
      startPolling(normalized.id);
    } catch (retryError) {
      publishState(
        "failed",
        retryError?.message || "Unable to retry transcription.",
        retryError?.message || "Unable to retry transcription.",
      );
    }
  };

  const handleDiscard = async () => {
    if (disabled) {
      return;
    }

    if (session?.id) {
      try {
        await archiveVoiceSession(session.id);
      } catch (archiveError) {
        publishState(
          "failed",
          archiveError?.message || "Unable to archive this voice session.",
          archiveError?.message || "Unable to archive this voice session.",
        );
        return;
      }
    }

    cleanupRecorder();
    publishSession(null);
    setTranscriptDraft("");
    setRecordingElapsedMs(0);
    currentSessionIdRef.current = null;
    clientSessionIdRef.current = null;
    userEditedTranscriptRef.current = false;
    transcriptRef.current = "";
    clearPersistedSnapshot();
    publishState("idle", STATE_COPY.idle.message);
  };

  const handleRefreshStatus = async () => {
    try {
      const normalized = await refreshSessionStatus();
      if (isPendingServerStatus(normalized)) {
        startPolling(normalized.id);
      }
    } catch (refreshError) {
      publishState(
        "failed",
        refreshError?.message || "Unable to refresh the voice session.",
        refreshError?.message || "Unable to refresh the voice session.",
      );
    }
  };

  const handleTranscriptChange = (value) => {
    syncTranscriptDraft(value, { allowAutoApply: false, markEdited: true });
    persistSnapshot();
  };

  const handleApplyReplace = () => {
    applyTranscriptToNote(transcriptDraft, "replace");
  };

  const handleApplyAppend = () => {
    applyTranscriptToNote(transcriptDraft, "append");
  };

  useEffect(() => {
    mountedRef.current = true;
    setIsSupported(
      Boolean(typeof window !== "undefined" && window.MediaRecorder && navigator?.mediaDevices?.getUserMedia),
    );
    setIsSecureContext(Boolean(typeof window === "undefined" ? true : window.isSecureContext));

    const recoverVoiceSession = async () => {
      const snapshot = parseStoredSnapshot(storageKey);
      const storedSessionId = normalizeText(snapshot?.sessionId || initialVoiceSessionId);
      const storedTranscript = normalizeText(snapshot?.transcriptDraft);

      if (storedTranscript) {
        transcriptRef.current = storedTranscript;
        setTranscriptDraft(storedTranscript);
      }

      if (!storedSessionId) {
        return;
      }

      try {
        const recoveredSession = await getVoiceSession(storedSessionId);
        const normalized = publishRecoveredSession(recoveredSession, storedTranscript);
        if (!normalized || !isRecoverableServerStatus(normalized)) {
          clearPersistedSnapshot();
          return;
        }

        persistSnapshot(normalized.id);
        if (isPendingServerStatus(normalized)) {
          startPolling(normalized.id);
        }
      } catch (recoveryError) {
        clearPersistedSnapshot();
        publishState(
          "failed",
          "Unable to recover the previous voice session.",
          recoveryError?.message || "Unable to recover the previous voice session.",
        );
      }
    };

    recoverVoiceSession();

    return () => {
      mountedRef.current = false;
      cleanupRecorder();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    persistSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, transcriptDraft]);

  useEffect(() => {
    if (typeof onVoiceStateChange === "function") {
      onVoiceStateChange({
        status,
        visibleStatus,
        isBlocking: isBusy,
        isTranscriptReady,
        isEventClosed: !eventOpen,
        sessionId: session?.id || currentSessionIdRef.current || null,
        transcript: transcriptDraft,
        validationStatus: session?.validationStatus || null,
        hasError: ["failed", "denied", "unsupported"].includes(status),
      });
    }
  }, [eventOpen, isBusy, isTranscriptReady, onVoiceStateChange, session?.id, session?.validationStatus, status, transcriptDraft, visibleStatus]);

  const transcriptConfidence =
    session?.transcriptConfidence !== null && session?.transcriptConfidence !== undefined
      ? `${Math.round((session.transcriptConfidence <= 1 ? session.transcriptConfidence * 100 : session.transcriptConfidence) * 10) / 10}%`
      : null;
  const confidenceLabel =
    transcriptConfidence && transcriptConfidence !== "0%"
      ? `Confidence ${transcriptConfidence}`
      : "Confidence unavailable";
  const sessionLabel = session?.id ? `Session ${String(session.id).slice(0, 8)}` : "No active session";

  return (
    <section className={`voice-note-composer ${className}`.trim()} data-testid="voice-note-composer">
      <div className="voice-note-header">
        <div>
          <p className="voice-note-eyebrow">Voice Submission</p>
          <h4>Capture a driver note with audio and transcript review</h4>
          <p className="voice-note-copy">
            Record a short voice note, let OpenAI convert it to text, then review or edit the transcript before it is submitted.
          </p>
        </div>

        <StatusBadge label={stateMeta.label} tone={stateMeta.tone || "neutral"} title={stateMeta.title} />
      </div>

      <div className={`voice-note-status voice-note-status-${stateMeta.tone || "neutral"}`}>
        <div className="voice-note-status-title">
          <CloudUploadOutlinedIcon fontSize="inherit" />
          {stateMeta.title}
        </div>
        <p>{message || stateMeta.message}</p>
      </div>

      {error ? (
        <div className="voice-note-error" data-testid="voice-note-error">
          <ErrorOutlineOutlinedIcon fontSize="inherit" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="voice-note-controls">
        <button
          type="button"
          className="btn btn-primary"
          onClick={status === "recording" ? stopRecording : startRecording}
          disabled={disabled || !eventOpen || ["uploading", "transcribing", "confirmed", "archived", "unsupported"].includes(status)}
          data-testid="voice-note-record-toggle"
        >
          {status === "recording" ? <StopRoundedIcon fontSize="inherit" /> : <MicRoundedIcon fontSize="inherit" />}
          {status === "recording" ? "Stop Recording" : "Start Recording"}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleRetry}
          disabled={disabled || !eventOpen || !session?.id || isBusy || !session?.audioStorageKey}
          data-testid="voice-note-retry"
        >
          <ReplayRoundedIcon fontSize="inherit" />
          Retry Transcription
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleRefreshStatus}
          disabled={!session?.id}
          data-testid="voice-note-refresh"
        >
          <RefreshRoundedIcon fontSize="inherit" />
          Refresh Status
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleDiscard}
          disabled={disabled || (!session?.id && !transcriptDraft)}
          data-testid="voice-note-discard"
        >
          <DeleteOutlineOutlinedIcon fontSize="inherit" />
          Discard
        </button>
      </div>

      <div className="voice-note-meta-row">
        <StatusBadge label={sessionLabel} tone={session?.id ? "info" : "neutral"} />
        <StatusBadge
          label={confidenceLabel}
          tone={
            stateMeta.tone === "success"
              ? "success"
              : stateMeta.tone === "warning"
                ? "warning"
                : "neutral"
          }
        />
        {recordingElapsedMs ? <StatusBadge label={formatDuration(recordingElapsedMs)} tone="neutral" /> : null}
      </div>

      <div className="voice-note-transcript-card">
        <div className="voice-note-transcript-head">
          <div>
            <div className="voice-note-transcript-title">
              <TextSnippetOutlinedIcon fontSize="inherit" />
              Transcript Preview
            </div>
            <p className="voice-note-transcript-copy">
              Edit the transcript if OpenAI missed anything, then apply it to the note field.
            </p>
          </div>

          <div className="voice-note-transcript-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleApplyReplace}
              disabled={disabled || !eventOpen || !normalizeText(transcriptDraft)}
              data-testid="voice-note-replace"
            >
              <EditOutlinedIcon fontSize="inherit" />
              Replace Note
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleApplyAppend}
              disabled={disabled || !eventOpen || !normalizeText(transcriptDraft)}
              data-testid="voice-note-append"
            >
              <CloudUploadOutlinedIcon fontSize="inherit" />
              Append Note
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmTranscript}
              disabled={disabled || !eventOpen || !normalizeText(transcriptDraft)}
              data-testid="voice-note-save"
            >
              <SaveOutlinedIcon fontSize="inherit" />
              Save Transcript
            </button>
          </div>
        </div>

        <textarea
          className="voice-note-textarea"
          rows={5}
          value={transcriptDraft}
          onChange={(event) => handleTranscriptChange(event.target.value)}
          placeholder="The transcript will appear here after recording."
          disabled={disabled || ["uploading", "transcribing", "unsupported", "denied", "archived"].includes(status)}
          data-testid="voice-note-transcript"
        />

        <div className="voice-note-transcript-footer">
          <span>{normalizeText(transcriptDraft) ? `${normalizeText(transcriptDraft).split(" ").length} words` : "Waiting for transcript"}</span>
          <span>{session?.audioFileName || "No audio file stored yet"}</span>
        </div>
      </div>
    </section>
  );
}
