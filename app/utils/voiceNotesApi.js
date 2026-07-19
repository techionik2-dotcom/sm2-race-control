import axiosInstance from "./axiosInstance";
import { normalizeSubmission } from "./apiTransforms";

const unwrapVoiceSession = (data) => data?.voiceSession || data?.data || data;
const unwrapSubmission = (data) => data?.submission || data?.data || data;

const normalizeText = (value) => String(value ?? "").trim();

const normalizeVoiceAttempt = (attempt) => {
  if (!attempt || typeof attempt !== "object") return null;

  return {
    ...attempt,
    id: attempt.id || attempt._id || null,
    voiceSessionId: attempt.voice_session_id || attempt.voiceSessionId || null,
    attemptNumber: attempt.attempt_number || attempt.attemptNumber || null,
    attemptStatus: attempt.attempt_status || attempt.attemptStatus || null,
    provider: attempt.provider || "openai",
    transcriptText: attempt.transcript_text || attempt.transcriptText || null,
    confidence: attempt.confidence ?? null,
    requestId: attempt.request_id || attempt.requestId || null,
    errorCode: attempt.error_code || attempt.errorCode || null,
    errorMessage: attempt.error_message || attempt.errorMessage || null,
  };
};

export const normalizeVoiceSession = (voiceSession) => {
  if (!voiceSession) return null;

  const id = voiceSession.id || voiceSession._id || null;
  const attempts = Array.isArray(voiceSession.attempts)
    ? voiceSession.attempts.map(normalizeVoiceAttempt).filter(Boolean)
    : [];

  return {
    ...voiceSession,
    id,
    _id: id,
    submissionId: voiceSession.submission_id || voiceSession.submissionId || null,
    eventId: voiceSession.event_id || voiceSession.eventId || null,
    runGroupId: voiceSession.run_group_id || voiceSession.runGroupId || null,
    createdById: voiceSession.created_by_id || voiceSession.createdById || null,
    clientSessionId: voiceSession.client_session_id || voiceSession.clientSessionId || null,
    status: voiceSession.status || "DRAFT",
    validationStatus: voiceSession.validation_status || voiceSession.validationStatus || "PENDING",
    validationMessage: voiceSession.validation_message || voiceSession.validationMessage || null,
    audioStorageKey: voiceSession.audio_storage_key || voiceSession.audioStorageKey || null,
    audioFileName: voiceSession.audio_file_name || voiceSession.audioFileName || null,
    audioContentType: voiceSession.audio_content_type || voiceSession.audioContentType || null,
    audioSizeBytes: voiceSession.audio_size_bytes || voiceSession.audioSizeBytes || null,
    audioDurationMs: voiceSession.audio_duration_ms || voiceSession.audioDurationMs || null,
    audioChecksum: voiceSession.audio_checksum || voiceSession.audioChecksum || null,
    audioLanguage: voiceSession.audio_language || voiceSession.audioLanguage || null,
    transcriptText:
      voiceSession.transcript_edited_text ||
      voiceSession.transcriptEditedText ||
      voiceSession.transcript_text ||
      voiceSession.transcriptText ||
      null,
    transcriptEditedText: voiceSession.transcript_edited_text || voiceSession.transcriptEditedText || null,
    transcriptConfidence: voiceSession.transcript_confidence || voiceSession.transcriptConfidence || null,
    transcriptWordCount: voiceSession.transcript_word_count || voiceSession.transcriptWordCount || null,
    transcriptJson: voiceSession.transcript_json || voiceSession.transcriptJson || null,
    transcriptionProvider:
      voiceSession.transcription_provider ||
      voiceSession.transcriptionProvider ||
      voiceSession.deepgram_request_json?.provider ||
      voiceSession.deepgramRequestJson?.provider ||
      "openai",
    openaiRequestId:
      voiceSession.openai_request_id ||
      voiceSession.openaiRequestId ||
      voiceSession.deepgram_request_id ||
      voiceSession.deepgramRequestId ||
      null,
    openaiModel:
      voiceSession.openai_model ||
      voiceSession.openaiModel ||
      voiceSession.deepgram_model ||
      voiceSession.deepgramModel ||
      null,
    deepgramRequestJson: voiceSession.deepgram_request_json || voiceSession.deepgramRequestJson || null,
    deepgramResponseJson: voiceSession.deepgram_response_json || voiceSession.deepgramResponseJson || null,
    deepgramRequestId: voiceSession.deepgram_request_id || voiceSession.deepgramRequestId || null,
    deepgramModel: voiceSession.deepgram_model || voiceSession.deepgramModel || null,
    retryCount: voiceSession.retry_count || voiceSession.retryCount || 0,
    uploadedAt: voiceSession.uploaded_at || voiceSession.uploadedAt || null,
    transcribedAt: voiceSession.transcribed_at || voiceSession.transcribedAt || null,
    confirmedAt: voiceSession.confirmed_at || voiceSession.confirmedAt || null,
    submittedAt: voiceSession.submitted_at || voiceSession.submittedAt || null,
    archivedAt: voiceSession.archived_at || voiceSession.archivedAt || null,
    lastErrorCode: voiceSession.last_error_code || voiceSession.lastErrorCode || null,
    lastErrorMessage: voiceSession.last_error_message || voiceSession.lastErrorMessage || null,
    audioDownloadUrl: voiceSession.audio_download_url || voiceSession.audioDownloadUrl || null,
    attempts,
  };
};

const buildNetworkErrorMessage = (error, fallbackMessage) => {
  if (error.response) {
    return null;
  }

  const apiBaseURL = axiosInstance.defaults.baseURL || "/api/v1";
  const target =
    apiBaseURL === "/api/v1"
      ? "the local API proxy (/api/v1 -> FastAPI on 127.0.0.1:8000)"
      : apiBaseURL;

  if (error.code === "ERR_NETWORK" || error.message === "Network Error") {
    return `Cannot reach SM2 API at ${target}. Please make sure the backend is running and try again.`;
  }

  return fallbackMessage;
};

const buildApiError = (error, fallbackMessage) => ({
  status: error.response?.status,
  code:
    (!Array.isArray(error.response?.data?.detail) &&
      error.response?.data?.detail &&
      typeof error.response.data.detail === "object" &&
      (error.response.data.detail.code || error.response.data.detail.error_code)) ||
    error.response?.data?.code ||
    null,
  message:
    error.response?.data?.message ||
    (!Array.isArray(error.response?.data?.detail) &&
      error.response?.data?.detail &&
      typeof error.response.data.detail === "object" &&
      (error.response.data.detail.message || error.response.data.detail.msg)) ||
    error.response?.data?.error ||
    (Array.isArray(error.response?.data?.detail)
      ? error.response.data.detail
          .map((item) => item?.msg || item?.message || JSON.stringify(item))
          .join("; ")
      : typeof error.response?.data?.detail === "string"
        ? error.response.data.detail
        : null) ||
    buildNetworkErrorMessage(error, fallbackMessage) ||
    error.message ||
    fallbackMessage,
  error:
    error.response?.data?.error ||
    error.response?.data?.message ||
    (!Array.isArray(error.response?.data?.detail) &&
      error.response?.data?.detail &&
      typeof error.response.data.detail === "object" &&
      (error.response.data.detail.message || error.response.data.detail.msg)) ||
    (Array.isArray(error.response?.data?.detail)
      ? error.response.data.detail
          .map((item) => item?.msg || item?.message || JSON.stringify(item))
          .join("; ")
      : typeof error.response?.data?.detail === "string"
        ? error.response.data.detail
        : null) ||
    buildNetworkErrorMessage(error, fallbackMessage) ||
    error.message ||
    fallbackMessage,
  detail: error.response?.data?.detail,
  errors:
    error.response?.data?.errors ||
    (!Array.isArray(error.response?.data?.detail) ? error.response?.data?.detail : null),
  data: error.response?.data,
});

const unwrapError = (error, fallbackMessage) => {
  console.error("Voice API Error:", {
    url: error.config?.url,
    status: error.response?.status,
    data: error.response?.data,
  });
  throw buildApiError(error, fallbackMessage);
};

export const createVoiceSession = async ({ eventId, runGroupId, clientSessionId = null, audioLanguage = null }) => {
  try {
    const response = await axiosInstance.post("/submissions/voice-sessions", {
      event_id: eventId,
      run_group_id: runGroupId,
      client_session_id: clientSessionId,
      audio_language: audioLanguage,
    });
    return normalizeVoiceSession(unwrapVoiceSession(response.data));
  } catch (error) {
    unwrapError(error, "Failed to create voice note session.");
  }
};

export const getVoiceSession = async (voiceSessionId) => {
  try {
    const response = await axiosInstance.get(`/submissions/voice-sessions/${voiceSessionId}`);
    return normalizeVoiceSession(unwrapVoiceSession(response.data));
  } catch (error) {
    unwrapError(error, "Failed to load voice note session.");
  }
};

export const uploadVoiceAudio = async ({
  voiceSessionId,
  audioFile,
  audioDurationMs = null,
  audioLanguage = null,
}) => {
  try {
    const formData = new FormData();
    formData.append("audio_file", audioFile);
    if (audioDurationMs !== null && audioDurationMs !== undefined) {
      formData.append("audio_duration_ms", String(audioDurationMs));
    }
    if (audioLanguage) {
      formData.append("audio_language", audioLanguage);
    }

    const response = await axiosInstance.post(
      `/submissions/voice-sessions/${voiceSessionId}/audio`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return normalizeVoiceSession(unwrapVoiceSession(response.data));
  } catch (error) {
    unwrapError(error, "Failed to upload voice audio.");
  }
};

export const transcribeVoiceSession = async (voiceSessionId) => {
  try {
    const response = await axiosInstance.post(`/submissions/voice-sessions/${voiceSessionId}/transcribe`);
    return normalizeVoiceSession(unwrapVoiceSession(response.data));
  } catch (error) {
    unwrapError(error, "Failed to start voice transcription.");
  }
};

export const retryVoiceTranscription = async (voiceSessionId) => {
  try {
    const response = await axiosInstance.post(`/submissions/voice-sessions/${voiceSessionId}/retry`);
    return normalizeVoiceSession(unwrapVoiceSession(response.data));
  } catch (error) {
    unwrapError(error, "Failed to retry voice transcription.");
  }
};

export const saveVoiceTranscript = async (voiceSessionId, payload) => {
  try {
    const response = await axiosInstance.patch(`/submissions/voice-sessions/${voiceSessionId}`, payload);
    return normalizeVoiceSession(unwrapVoiceSession(response.data));
  } catch (error) {
    unwrapError(error, "Failed to save voice transcript.");
  }
};

export const archiveVoiceSession = async (voiceSessionId) => {
  try {
    const response = await axiosInstance.patch(`/submissions/voice-sessions/${voiceSessionId}`, {
      status: "ARCHIVED",
      validation_status: "ARCHIVED",
    });
    return normalizeVoiceSession(unwrapVoiceSession(response.data));
  } catch (error) {
    unwrapError(error, "Failed to archive voice session.");
  }
};

export const fetchVoiceAudioBlob = async (voiceSessionId) => {
  const response = await axiosInstance.get(`/submissions/voice-sessions/${voiceSessionId}/audio`, {
    responseType: "blob",
  });
  return response.data;
};

export const finalizeVoiceSubmission = async ({ voiceSessionId, submissionData }) => {
  try {
    const response = await axiosInstance.post(
      `/submissions/voice-sessions/${voiceSessionId}/finalize`,
      {
        ...submissionData,
        voice_session_id: voiceSessionId,
      },
    );
    const submission = normalizeSubmission(unwrapSubmission(response.data));
    const success = submission?.status !== "FAILED";
    return {
      success,
      submission,
      message: success
        ? null
        : submission?.errorMessage || "Voice submission validation failed.",
    };
  } catch (error) {
    unwrapError(error, "Failed to finalize voice submission.");
  }
};

export const buildVoiceNoteTranscript = (voiceSession) =>
  normalizeText(
    voiceSession?.transcriptEditedText ||
      voiceSession?.transcriptText ||
      voiceSession?.transcript_edited_text ||
      voiceSession?.transcript_text ||
      "",
  );
