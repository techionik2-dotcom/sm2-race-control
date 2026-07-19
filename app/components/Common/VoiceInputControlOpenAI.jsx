"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import StatusBadge from "./StatusBadge";
import { transcribeVoiceInputAudio } from "../../utils/voiceInputApi";

const VOICE_COPY_PRESETS = {
  notes: {
    eyebrow: "Voice Input",
    idleMessage: "Record a short voice note and the transcript will be inserted for review.",
    listeningMessage: "Speak naturally. The mic will capture your note.",
    processingMessage: "Transcribing voice input...",
    successMessage: "Voice note added to raw text.",
    errorMessage: "Could not capture audio.",
    unsupportedMessage: "Voice input is not supported in this browser. Use Chrome or Edge.",
    supportMessage: "Voice dictation is currently available in Chrome or Edge.",
    startButtonLabel: "Start Voice Note",
    listeningButtonLabel: "Stop Recording",
    processingButtonLabel: "Processing",
    successButtonLabel: "Voice Added",
    errorButtonLabel: "Retry Voice",
    successBadgeLabel: "Inserted",
    previewLabel: "Transcript",
  },
  assistant: {
    eyebrow: "Voice Agent",
    idleMessage: "Record a short voice prompt and the transcript will be inserted into the composer.",
    listeningMessage: "Speak naturally. The mic will capture your prompt.",
    processingMessage: "Transcribing voice input...",
    successMessage: "Voice prompt added to the assistant composer.",
    errorMessage: "Could not capture audio.",
    unsupportedMessage: "Voice input is not supported in this browser. Use Chrome or Edge.",
    supportMessage: "Voice dictation is currently available in Chrome or Edge.",
    startButtonLabel: "Start Voice Query",
    listeningButtonLabel: "Stop Recording",
    processingButtonLabel: "Processing",
    successButtonLabel: "Voice Ready",
    errorButtonLabel: "Retry Voice",
    successBadgeLabel: "Ready",
    previewLabel: "Transcript",
  },
};

const AUDIO_CAPTURE_ERRORS = {
  NotAllowedError: "Microphone access was denied. Allow permission and try again.",
  SecurityError: "Microphone access was blocked by the browser. Allow permission and try again.",
  NotFoundError: "No microphone was detected. Check your input device and try again.",
  NotReadableError: "The microphone is unavailable right now. Close other apps and try again.",
  AbortError: "Voice capture stopped before any audio was recorded.",
};

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
];

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

  return new File([blob], `voice-input-${Date.now()}.${extension}`, {
    type: mimeType || blob.type || "audio/webm",
  });
};

export default function VoiceInputControl({
  textareaRef,
  onValueChange,
  onTranscriptInserted,
  disabled = false,
  className = "",
  mode = "notes",
}) {
  const voiceCopy = VOICE_COPY_PRESETS[mode] || VOICE_COPY_PRESETS.notes;

  const STATUS_META = useMemo(
    () => ({
      idle: {
        tone: "neutral",
        label: "Ready",
        message: voiceCopy.idleMessage,
      },
      listening: {
        tone: "accent",
        label: "Recording",
        message: voiceCopy.listeningMessage,
      },
      processing: {
        tone: "warning",
        label: "Processing",
        message: voiceCopy.processingMessage,
      },
      success: {
        tone: "success",
        label: voiceCopy.successBadgeLabel,
        message: voiceCopy.successMessage,
      },
      error: {
        tone: "danger",
        label: "Error",
        message: voiceCopy.errorMessage,
      },
    }),
    [voiceCopy],
  );

  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(STATUS_META.idle.message);
  const [preview, setPreview] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [isSecureContext, setIsSecureContext] = useState(true);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [error, setError] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const mountedRef = useRef(false);
  const recordingStartedAtRef = useRef(null);
  const durationTimerRef = useRef(null);
  const resetTimerRef = useRef(null);
  const lastAudioFileRef = useRef(null);

  const updateStatus = (nextStatus, nextMessage, nextError = "") => {
    setStatus(nextStatus);
    setMessage(nextMessage);
    setError(nextError);
  };

  const clearTimers = () => {
    if (durationTimerRef.current) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
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
      } catch {
        // Ignore recorder shutdown failures.
      }
    }

    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  const clearResetState = () => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  };

  const insertTranscript = (transcript) => {
    const cleanedTranscript = normalizeText(transcript);
    if (!cleanedTranscript || typeof onValueChange !== "function") {
      return;
    }

    onValueChange((currentValue = "") => {
      const sourceValue = typeof currentValue === "string" ? currentValue : "";
      const target = textareaRef?.current;

      if (
        target &&
        typeof document !== "undefined" &&
        document.activeElement === target &&
        typeof target.selectionStart === "number" &&
        typeof target.selectionEnd === "number"
      ) {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const before = sourceValue.slice(0, start);
        const after = sourceValue.slice(end);
        const needsPrefixSpace = before.length > 0 && !/\s$/.test(before);
        const needsSuffixSpace = after.length > 0 && !/^\s/.test(after);

        const nextValue = `${before}${needsPrefixSpace ? " " : ""}${cleanedTranscript}${
          needsSuffixSpace ? " " : ""
        }${after}`;

        window.requestAnimationFrame(() => {
          const currentTarget = textareaRef?.current;
          if (!currentTarget) {
            return;
          }

          currentTarget.focus();
          const cursorPosition =
            before.length +
            (needsPrefixSpace ? 1 : 0) +
            cleanedTranscript.length +
            (needsSuffixSpace ? 1 : 0);

          try {
            currentTarget.setSelectionRange(cursorPosition, cursorPosition);
          } catch {
            // Some browsers may not support programmatic selection in all cases.
          }
        });

        return nextValue;
      }

      const needsPrefixSpace = sourceValue.length > 0 && !/\s$/.test(sourceValue);
      const nextValue = `${sourceValue}${needsPrefixSpace ? " " : ""}${cleanedTranscript}`;

      window.requestAnimationFrame(() => {
        const currentTarget = textareaRef?.current;
        if (!currentTarget) {
          return;
        }

        currentTarget.focus();
        try {
          currentTarget.setSelectionRange(nextValue.length, nextValue.length);
        } catch {
          // No-op if the browser refuses selection updates.
        }
      });

      return nextValue;
    });
  };

  const resetAfterSuccess = () => {
    clearResetState();
    resetTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return;
      }

      setPreview("");
      lastAudioFileRef.current = null;
      updateStatus("idle", STATUS_META.idle.message);
    }, 2200);
  };

  const processAudioFile = async (audioFile) => {
    lastAudioFileRef.current = audioFile;
    updateStatus("processing", STATUS_META.processing.message);

    const result = await transcribeVoiceInputAudio({ audioFile });
    const transcript = normalizeText(result?.transcriptText || result?.transcript_text || "");
    if (!transcript) {
      throw new Error("No speech was detected. Please try again.");
    }

    setPreview(transcript);
    insertTranscript(transcript);
    if (typeof onTranscriptInserted === "function") {
      onTranscriptInserted(transcript);
    }
    updateStatus("success", STATUS_META.success.message);
    lastAudioFileRef.current = null;
    resetAfterSuccess();
  };

  const startRecording = async () => {
    if (disabled) {
      return;
    }

    if (!isSupported) {
      updateStatus("error", voiceCopy.unsupportedMessage, voiceCopy.unsupportedMessage);
      return;
    }

    if (!isSecureContext) {
      updateStatus(
        "error",
        "Microphone access requires a secure context.",
        "Microphone access requires HTTPS or localhost.",
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      updateStatus("error", voiceCopy.unsupportedMessage, voiceCopy.unsupportedMessage);
      return;
    }

    clearTimers();
    clearResetState();
    cleanupRecorder();
    chunksRef.current = [];
    setPreview("");
    setError("");
    setRecordingElapsedMs(0);
    lastAudioFileRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        const errorMessage = event?.error?.message || voiceCopy.errorMessage;
        updateStatus("error", errorMessage, errorMessage);
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
        updateStatus("listening", voiceCopy.listeningMessage);
      };

      recorder.onstop = async () => {
        clearTimers();
        recordingStartedAtRef.current = null;

        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: recordedMimeType });
        chunksRef.current = [];
        cleanupRecorder();
        setRecordingElapsedMs(0);

        if (!audioBlob.size) {
          updateStatus("error", "No voice was captured. Please re-record.", "No voice was captured.");
          return;
        }

        try {
          const file = makeAudioFile(audioBlob, recordedMimeType);
          await processAudioFile(file);
        } catch (captureError) {
          const errorMessage = captureError?.response?.data?.detail || captureError?.message || voiceCopy.errorMessage;
          updateStatus("error", errorMessage, errorMessage);
        }
      };

      recorder.start();
    } catch (captureError) {
      const errorName = captureError?.name || "";
      const errorMessage =
        AUDIO_CAPTURE_ERRORS[errorName] ||
        captureError?.response?.data?.detail ||
        captureError?.message ||
        "Unable to access the microphone.";

      if (errorName === "NotAllowedError" || errorName === "SecurityError") {
        updateStatus("error", AUDIO_CAPTURE_ERRORS[errorName], AUDIO_CAPTURE_ERRORS[errorName]);
      } else if (errorName === "NotFoundError" || errorName === "NotReadableError") {
        updateStatus("error", errorMessage, errorMessage);
      } else {
        updateStatus("error", errorMessage, errorMessage);
      }

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
    } catch {
      updateStatus("error", "Voice capture could not be stopped cleanly.", "Voice capture could not be stopped cleanly.");
      cleanupRecorder();
    }
  };

  const handleToggle = () => {
    if (status === "listening") {
      void stopRecording();
      return;
    }

    void startRecording();
  };

  const handleRetry = () => {
    if (disabled) {
      return;
    }

    if (lastAudioFileRef.current) {
      void processAudioFile(lastAudioFileRef.current).catch((retryError) => {
        const errorMessage =
          retryError?.response?.data?.detail || retryError?.message || "Unable to retry transcription.";
        updateStatus("error", errorMessage, errorMessage);
      });
      return;
    }

    void startRecording();
  };

  useEffect(() => {
    mountedRef.current = true;
    setIsSupported(Boolean(typeof window !== "undefined" && window.MediaRecorder && navigator?.mediaDevices?.getUserMedia));
    setIsSecureContext(Boolean(typeof window === "undefined" ? true : window.isSecureContext));

    return () => {
      mountedRef.current = false;
      cleanupRecorder();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = STATUS_META[status] || STATUS_META.idle;
  const badgeLabel = !isSupported ? "Unsupported" : meta.label;
  const badgeTone = !isSupported ? "danger" : meta.tone;
  const badgeMessage = !isSupported ? voiceCopy.unsupportedMessage : meta.message;
  const displayMessage = isSupported ? message : badgeMessage;
  const buttonLabel =
    !isSupported
      ? "Unavailable"
      : status === "listening"
        ? voiceCopy.listeningButtonLabel
        : status === "processing"
          ? voiceCopy.processingButtonLabel
          : status === "success"
            ? voiceCopy.successButtonLabel
            : status === "error"
              ? voiceCopy.errorButtonLabel
              : voiceCopy.startButtonLabel;

  return (
    <div className={`voice-input-control ${className}`.trim()}>
      <div className={`voice-input-card voice-input-card-${status}`}>
        <div className="voice-input-header">
          <div className="voice-input-copy">
            <span className="voice-input-eyebrow">{voiceCopy.eyebrow}</span>
            {displayMessage ? (
              <p className="voice-input-message" aria-live="polite">
                {displayMessage}
              </p>
            ) : null}
          </div>

          <div className="voice-input-status-wrap">
            <StatusBadge label={badgeLabel} tone={badgeTone} title={badgeMessage} />
          </div>
        </div>

        <div className="voice-input-actions">
          <button
            type="button"
            className={`voice-input-button voice-input-button-${status}`}
            onClick={handleToggle}
            disabled={disabled || !isSupported || status === "processing" || status === "success"}
            aria-pressed={status === "listening"}
            aria-label={buttonLabel}
            title={meta.message}
          >
            <span className="voice-input-icon">
              {status === "listening" ? <StopRoundedIcon fontSize="inherit" /> : <MicRoundedIcon fontSize="inherit" />}
            </span>
            <span>{buttonLabel}</span>
          </button>

          {status === "error" && isSupported ? (
            <button
              type="button"
              className="voice-input-retry"
              onClick={handleRetry}
              disabled={disabled}
              aria-label="Retry voice input"
              title="Retry"
            >
              <ReplayRoundedIcon fontSize="inherit" />
              <span>Retry</span>
            </button>
          ) : null}
        </div>
      </div>

      {preview ? (
        <p className="voice-input-preview">
          {voiceCopy.previewLabel}: &quot;{preview}&quot;
        </p>
      ) : null}

      {status === "listening" && recordingElapsedMs ? (
        <p className="voice-input-support">Recording for {formatDuration(recordingElapsedMs)}</p>
      ) : null}

      {error ? (
        <p className="voice-input-support" style={{ color: "#ffb08c" }}>
          <ErrorOutlineOutlinedIcon
            fontSize="inherit"
            style={{ verticalAlign: "text-bottom", marginRight: "0.35rem" }}
          />
          {error}
        </p>
      ) : !isSupported ? (
        <p className="voice-input-support">{voiceCopy.supportMessage}</p>
      ) : null}
    </div>
  );
}
