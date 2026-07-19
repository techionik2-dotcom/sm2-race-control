import axiosInstance from "./axiosInstance";

const normalizeText = (value) => String(value ?? "").trim();

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
  status: error.response?.status || null,
  message:
    error.response?.data?.message ||
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
  detail: error.response?.data?.detail || null,
  data: error.response?.data || null,
});

const unwrapError = (error, fallbackMessage) => {
  console.error("Voice input API Error:", {
    url: error.config?.url,
    status: error.response?.status,
    data: error.response?.data,
  });
  throw buildApiError(error, fallbackMessage);
};

const normalizeVoiceInputTranscription = (transcription) => {
  if (!transcription || typeof transcription !== "object") {
    return null;
  }

  return {
    transcriptText: normalizeText(transcription.transcript_text || transcription.transcriptText || ""),
    transcriptConfidence: transcription.transcript_confidence ?? transcription.transcriptConfidence ?? null,
    transcriptWordCount: transcription.transcript_word_count ?? transcription.transcriptWordCount ?? null,
    audioLanguage: transcription.audio_language || transcription.audioLanguage || null,
    provider: transcription.provider || "openai",
    requestId: transcription.request_id || transcription.requestId || transcription.openai_request_id || transcription.openaiRequestId || transcription.deepgram_request_id || transcription.deepgramRequestId || null,
    model: transcription.model || transcription.openai_model || transcription.openaiModel || transcription.deepgram_model || transcription.deepgramModel || null,
    openaiRequestId: transcription.openai_request_id || transcription.openaiRequestId || transcription.deepgram_request_id || transcription.deepgramRequestId || null,
    openaiModel: transcription.openai_model || transcription.openaiModel || transcription.deepgram_model || transcription.deepgramModel || null,
    deepgramRequestId: transcription.deepgram_request_id || transcription.deepgramRequestId || null,
    deepgramModel: transcription.deepgram_model || transcription.deepgramModel || null,
    transcriptJson: transcription.transcript_json || transcription.transcriptJson || null,
  };
};

export const transcribeVoiceInputAudio = async ({ audioFile, audioLanguage = null }) => {
  try {
    const formData = new FormData();
    formData.append("audio_file", audioFile);
    if (audioLanguage) {
      formData.append("audio_language", audioLanguage);
    }

    const response = await axiosInstance.post("/voice-input/transcribe", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    return normalizeVoiceInputTranscription(response.data);
  } catch (error) {
    unwrapError(error, "Failed to transcribe voice input.");
  }
};
