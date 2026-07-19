import axiosInstance from "./axiosInstance";
import { normalizeList, normalizeSubmission } from "./apiTransforms";
import { getRunGroup } from "./runGroupApi";
import { generateUUID } from "./uuid";

/**
 * Submission API Functions
 * All submission-related API calls
 */

/**
 * Create a new submission (MECHANIC)
 * @param {Object} submissionData - Submission data (notes, eventId, etc.)
 * @returns {Promise} API response
 */
const unwrapSubmission = (data) =>
  normalizeSubmission(data?.submission || data?.data || data);

const unwrapSubmissionList = (data) =>
  normalizeList(data?.submissions || data?.data || data, normalizeSubmission);

const normalizeAiSummaryEntry = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const summary = String(entry.summary || "").trim();
  if (!summary) {
    return null;
  }

  return {
    summaryId: entry.summaryId || entry.summary_id || null,
    generatedAt: entry.generatedAt || entry.generated_at || null,
    summary,
    keyObservations: Array.isArray(entry.keyObservations || entry.key_observations)
      ? (entry.keyObservations || entry.key_observations)
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    needsReview: Array.isArray(entry.needsReview || entry.needs_review)
      ? (entry.needsReview || entry.needs_review)
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    recommendedActions: Array.isArray(entry.recommendedActions || entry.recommended_actions)
      ? (entry.recommendedActions || entry.recommended_actions)
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    generatedBy: entry.generatedBy || entry.generated_by || null,
    model: entry.model || null,
  };
};

export const normalizeStoredAiSummary = (analysisResult) => {
  const analysis = isPlainObject(analysisResult) ? analysisResult : {};
  const history = Array.isArray(analysis.ai_summary_history)
    ? analysis.ai_summary_history.map(normalizeAiSummaryEntry).filter(Boolean)
    : [];
  const current = normalizeAiSummaryEntry(analysis.ai_summary_current) || history[0] || null;

  if (!current) {
    return null;
  }

  return {
    ...current,
    summaryHistory: history.length ? history : [current],
  };
};

const normalizeAiSummaryResponse = (data) => {
  const payload = data?.data || data || {};
  const current = normalizeAiSummaryEntry(payload);
  const history = Array.isArray(payload.summaryHistory || payload.summary_history)
    ? (payload.summaryHistory || payload.summary_history)
        .map(normalizeAiSummaryEntry)
        .filter(Boolean)
    : [];

  if (!current) {
    return normalizeStoredAiSummary(payload.submission?.analysis_result || payload.submission?.analysisResult);
  }

  return {
    ...current,
    submissionId: payload.submissionId || payload.submission_id || null,
    submissionRef: payload.submissionRef || payload.submission_ref || null,
    submission: payload.submission ? unwrapSubmission(payload.submission) : null,
    summaryHistory: history.length ? history : [current],
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
    error.response?.data?.error ||
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

const buildInternalSubmissionRef = (sessionIdLike) => {
  const rawBase = String(sessionIdLike || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 96);
  const base = rawBase || "SM2-NOTE";
  const suffix = `${Date.now().toString(36)}-${generateUUID().split("-")[0]}`;
  return `${base}-${suffix}`.slice(0, 120);
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const RAW_NOTE_SESSION_PATTERN = /\bs\d+\b/i;
const RAW_NOTE_CUE_PATTERNS = [
  /\b(?:pf|pc|wb|best|ca|rh|rb|bp|sb|c|t)\b/i,
  /\b[ymp]-s\d+\b/i,
  /\b\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?){3}\b/,
];

const normalizeRawNoteText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const safeBrowserStorage = () => (typeof window !== "undefined" ? window.localStorage : null);

const normalizeImageUrlList = (...values) => {
  const imageUrls = [];

  const append = (value) => {
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!normalizedValue || imageUrls.includes(normalizedValue)) {
      return;
    }
    imageUrls.push(normalizedValue);
  };

  const consume = (value) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(consume);
      return;
    }

    if (typeof value === "string") {
      append(value);
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    append(value.image_url || value.imageUrl || value.dataUrl || value.data_url || value.url);
  };

  values.forEach(consume);
  return imageUrls;
};

const getSubmissionMode = (submissionData) =>
  String(
    submissionData?.analysis_result?.submission_mode ||
      submissionData?.analysis_result?.submissionMode ||
      submissionData?.analysisResult?.submission_mode ||
      submissionData?.analysisResult?.submissionMode ||
      "",
  )
    .trim()
    .toLowerCase();

const hasVoiceNotes = (submissionData) =>
  Boolean(
    submissionData?.analysis_result?.voice_input_used ||
    submissionData?.analysis_result?.voiceInputUsed ||
    submissionData?.analysisResult?.voice_input_used ||
    submissionData?.analysisResult?.voiceInputUsed ||
    submissionData?.voice_session_id ||
    submissionData?.voiceSessionId ||
    submissionData?.voice_session?.id ||
    submissionData?.voiceSession?.id,
  );

const hasImageInput = (submissionData) =>
  Boolean(
    normalizeImageUrlList(
      submissionData?.image_urls,
      submissionData?.imageUrls,
      submissionData?.image_url,
      submissionData?.image,
      submissionData?.imageUrl,
      submissionData?.payload?.image_urls,
      submissionData?.payload?.imageUrls,
      submissionData?.payload?.image_url,
      submissionData?.payload?.imageUrl,
    ).length,
  );

const looksLikeRawRaceNote = (rawText) => {
  const text = normalizeRawNoteText(rawText);
  if (!text) {
    return false;
  }

  if (!RAW_NOTE_SESSION_PATTERN.test(text)) {
    return false;
  }

  return RAW_NOTE_CUE_PATTERNS.some((pattern) => pattern.test(text));
};

export const shouldUseRawSubmissionRoute = (submissionData) => {
  if (getSubmissionMode(submissionData) !== "quick") {
    return false;
  }

  if (hasVoiceNotes(submissionData) || hasImageInput(submissionData)) {
    return false;
  }

  return looksLikeRawRaceNote(submissionData?.raw_text ?? submissionData?.rawText ?? "");
};

const cleanStructuredValue = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cleanStructuredValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, nestedValue]) => [key, cleanStructuredValue(nestedValue)])
        .filter(([, nestedValue]) => nestedValue !== undefined),
    );
  }

  return value;
};

const normalizeOcrPreviewResponse = (data) => {
  const preview = data?.preview || data?.data || data || {};
  const structuredData =
    preview?.structured_data && isPlainObject(preview.structured_data)
      ? preview.structured_data
      : preview?.structuredData && isPlainObject(preview.structuredData)
        ? preview.structuredData
        : {};

  return {
    ...preview,
    status: String(preview?.status || "success").trim().toLowerCase() || "success",
    message: preview?.message || "",
    submissionRef: preview?.submission_ref || preview?.submissionRef || null,
    correlationId: preview?.correlation_id || preview?.correlationId || null,
    source: preview?.source || null,
    imageUrl: preview?.image_url || preview?.imageUrl || null,
    imageUrls: normalizeImageUrlList(
      preview?.image_urls,
      preview?.imageUrls,
      preview?.image_url,
      preview?.imageUrl,
    ),
    docType: preview?.doc_type || preview?.docType || "unknown",
    templateName: preview?.template_name || preview?.templateName || null,
    confidence: typeof preview?.confidence === "number" ? preview.confidence : null,
    modelUsed: preview?.model_used || preview?.modelUsed || preview?.model || null,
    fallbackUsed: Boolean(preview?.fallback_used ?? preview?.fallbackUsed),
    metadata:
      preview?.metadata && isPlainObject(preview.metadata) ? preview.metadata : {},
    rawEvidence:
      preview?.raw_evidence && isPlainObject(preview.raw_evidence)
        ? preview.raw_evidence
        : preview?.rawEvidence && isPlainObject(preview.rawEvidence)
          ? preview.rawEvidence
          : {},
    fieldEvidence: Array.isArray(preview?.field_evidence || preview?.fieldEvidence)
      ? (preview.field_evidence || preview.fieldEvidence)
      : [],
    normalizedSections:
      preview?.normalized_sections && isPlainObject(preview.normalized_sections)
        ? preview.normalized_sections
        : preview?.normalizedSections && isPlainObject(preview.normalizedSections)
          ? preview.normalizedSections
          : {},
    preprocessing:
      preview?.preprocessing && isPlainObject(preview.preprocessing) ? preview.preprocessing : {},
    structuredData,
    rawText: preview?.raw_text || preview?.rawText || preview?.extracted_text || preview?.extractedText || "",
    reviewFlags: Array.isArray(preview?.review_flags || preview?.reviewFlags)
      ? (preview.review_flags || preview.reviewFlags).map((flag) => String(flag).trim()).filter(Boolean)
      : [],
    extractedText: preview?.extracted_text || preview?.extractedText || "",
    summary: preview?.summary || "",
    recommendedReviewStatus:
      preview?.recommended_review_status || preview?.recommendedReviewStatus || "PENDING",
    parserVersion: preview?.parser_version || preview?.parserVersion || null,
    model: preview?.model_used || preview?.modelUsed || preview?.model || null,
  };
};

const normalizeOcrStagedDraft = (draft) => {
  const metadata = draft?.metadata && isPlainObject(draft.metadata) ? draft.metadata : {};

  return {
    ...draft,
    submissionInputId:
      draft?.submission_input_id ?? draft?.submissionInputId ?? null,
    ocrId: draft?.ocr_id ?? draft?.ocrId ?? null,
    submissionRef: draft?.submission_ref || draft?.submissionRef || null,
    correlationId: draft?.correlation_id || draft?.correlationId || null,
    source: draft?.source || null,
    imageUrl: draft?.image_url || draft?.imageUrl || null,
    imageUrls: normalizeImageUrlList(
      draft?.image_urls,
      draft?.imageUrls,
      draft?.image_url,
      draft?.imageUrl,
    ),
    rawText: draft?.raw_text || draft?.rawText || null,
    createdAt: draft?.created_at || draft?.createdAt || null,
    createdBy: draft?.created_by || draft?.createdBy || null,
    validationStatus: draft?.validation_status || draft?.validationStatus || "PENDING",
    validationMessage: draft?.validation_message || draft?.validationMessage || null,
    reviewStatus: draft?.review_status || draft?.reviewStatus || null,
    templateType: draft?.template_type || draft?.templateType || null,
    payloadShape: draft?.payload_shape || draft?.payloadShape || "object",
    normalized: Boolean(draft?.normalized),
    confidence: typeof draft?.confidence === "number" ? draft.confidence : null,
    documentType: draft?.document_type || draft?.documentType || null,
    eventId: draft?.event_id || draft?.eventId || metadata.event_id || null,
    eventName: draft?.event_name || draft?.eventName || metadata.event_name || null,
    runGroup: draft?.run_group || draft?.runGroup || metadata.run_group || null,
    track: draft?.track || metadata.track || null,
    sessionType: draft?.session_type || draft?.sessionType || metadata.session_type || null,
    sessionNumber:
      draft?.session_number || draft?.sessionNumber || metadata.session_number || null,
    driverId: draft?.driver_id || draft?.driverId || metadata.driver_id || null,
    vehicleId: draft?.vehicle_id || draft?.vehicleId || metadata.vehicle_id || null,
    metadata,
  };
};

const unwrapOcrDraftList = (data) =>
  normalizeList(data?.drafts || data?.data || data, normalizeOcrStagedDraft);

const buildRawSubmissionPayload = (submissionData) => {
  const rawText = submissionData?.raw_text ?? submissionData?.rawText ?? "";

  return {
    source: String(submissionData?.source || "pwa").trim() || "pwa",
    created_by:
      String(
        submissionData?.created_by ||
          submissionData?.createdBy ||
          submissionData?.created_by_user?.name ||
          submissionData?.createdByUser?.name ||
          submissionData?.created_by_user?.email ||
          submissionData?.createdByUser?.email ||
          "",
      ).trim(),
    eventId: submissionData?.eventId || submissionData?.event_id || "",
    runGroup: submissionData?.runGroup || submissionData?.run_group || "",
    raw_text: rawText,
  };
};

export const buildSubmissionPayload = async (submissionData) => {
  const legacyEventId = submissionData?.eventId || submissionData?.event_id;
  let runGroupId =
    submissionData?.run_group_id || submissionData?.runGroupId || null;
  const rawText =
    submissionData?.raw_text ?? submissionData?.rawText ?? null;
  const imageUrls = normalizeImageUrlList(
    submissionData?.image_urls,
    submissionData?.imageUrls,
    submissionData?.image_url,
    submissionData?.image,
    submissionData?.imageUrl,
  );
  const imageUrl = imageUrls[0] || null;

  if (!runGroupId && legacyEventId) {
    const runGroupResponse = await getRunGroup(legacyEventId);
    const runGroup = runGroupResponse?.runGroup || runGroupResponse;
    runGroupId = runGroup?.id || runGroup?._id || null;
  }

  const nestedPayload = cleanStructuredValue(
    submissionData?.payload || submissionData?.data || {},
  );
  const payloadData = nestedPayload?.data || {};
  const correlationId = generateUUID();
  const sessionId =
    submissionData?.session_id ||
    submissionData?.sessionId ||
    submissionData?.submissionId ||
    submissionData?.submission_id ||
    nestedPayload?.session_id ||
    nestedPayload?.sessionId ||
    payloadData?.session_id ||
    payloadData?.sessionId ||
    generateUUID();
  const submissionRef = buildInternalSubmissionRef(sessionId);
  const analysisResult = cleanStructuredValue(
    submissionData?.analysis_result ||
      submissionData?.analysisResult ||
      {
        action: submissionData?.action,
        confidence: submissionData?.confidence,
        run_group: submissionData?.runGroup || submissionData?.run_group || null,
      },
  );

  const payload = {
    submission_ref: submissionRef,
    correlation_id: correlationId,
    event_id: legacyEventId,
    run_group_id: runGroupId,
    voice_session_id:
      submissionData?.voice_session_id ||
      submissionData?.voiceSessionId ||
      submissionData?.voice_session?.id ||
      submissionData?.voiceSession?.id ||
      null,
    driver_id:
      submissionData?.driver_id ||
      submissionData?.driverId ||
      nestedPayload?.driver_id ||
      nestedPayload?.driverId ||
      payloadData?.driver_id ||
      payloadData?.driverId ||
      null,
    vehicle_id:
      submissionData?.vehicle_id ||
      submissionData?.vehicleId ||
      nestedPayload?.vehicle_id ||
      nestedPayload?.vehicleId ||
      payloadData?.vehicle_id ||
      payloadData?.vehicleId ||
      null,
    payload: nestedPayload,
    analysis_result: analysisResult,
  };

  if (typeof rawText === "string" && rawText.trim()) {
    payload.raw_text = rawText;
  }

  if (imageUrl) {
    payload.image_url = imageUrl;
  }

  if (imageUrls.length > 0) {
    payload.image_urls = imageUrls;
  }

  return payload;
};

export const createSubmission = async (submissionData) => {
  try {
    if (shouldUseRawSubmissionRoute(submissionData)) {
      const rawResponse = await axiosInstance.post(
        "/submissions/raw",
        buildRawSubmissionPayload(submissionData),
      );
      const rawResult = rawResponse.data || {};
      const rawStatus = String(rawResult.status || "").toUpperCase();
      const rawMessage = rawResult.message || "Session stored successfully";

      return {
        success: rawStatus === "SUCCESS",
        submission: {
          submission_ref:
            rawResult.id_seance ||
            buildInternalSubmissionRef(
              submissionData?.session_id ||
                submissionData?.sessionId ||
                submissionData?.submissionId ||
                submissionData?.submission_id,
            ),
          status: rawStatus === "SUCCESS" ? "SENT" : "FAILED",
          raw_text: submissionData?.raw_text ?? submissionData?.rawText ?? null,
          rawSubmissionStatus: rawStatus || "SUCCESS",
          rawSubmissionMessage: rawMessage,
          rawSubmissionIdSeance: rawResult.id_seance || null,
          structuredIngestStatus: "skipped",
          structuredIngestWarnings: [],
          errorMessage: rawStatus === "SUCCESS" ? null : rawMessage,
        },
        message: rawMessage,
      };
    }

    const response = await axiosInstance.post(
      "/submissions",
      await buildSubmissionPayload(submissionData),
    );
    const submission = unwrapSubmission(response.data);
    const success = submission?.status !== "FAILED";
    return {
      success,
      submission,
      message: success
        ? null
        : submission?.errorMessage || "Submission validation failed.",
    };
  } catch (error) {
    console.error("Create Submission API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Failed to submit notes. Please try again.");
  }
};

export const extractOcrDraft = async (previewRequest) => {
  try {
    const response = await axiosInstance.post("/submissions/ocr-preview", previewRequest);
    return normalizeOcrPreviewResponse(response.data);
  } catch (error) {
    console.error("Extract OCR Draft API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Failed to extract OCR draft. Please try again.");
  }
};

export const getOcrDraftStatus = async (correlationId) => {
  try {
    const response = await axiosInstance.get(`/submissions/ocr-preview/${encodeURIComponent(correlationId)}`);
    return normalizeOcrPreviewResponse(response.data);
  } catch (error) {
    console.error("Get OCR Draft Status API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Failed to load OCR draft status. Please try again.");
  }
};

export const getLatestOcrDraftForEvent = async (eventId) => {
  try {
    const response = await axiosInstance.get(
      `/submissions/ocr-preview/latest/event/${encodeURIComponent(eventId)}`,
    );
    return normalizeOcrPreviewResponse(response.data);
  } catch (error) {
    console.error("Get Latest OCR Draft For Event API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Failed to load the latest staged OCR draft. Please try again.");
  }
};

export const getOcrDraftsByEvent = async (eventId) => {
  try {
    const response = await axiosInstance.get(
      `/submissions/ocr-intake/event/${encodeURIComponent(eventId)}`,
    );
    return unwrapOcrDraftList(response.data);
  } catch (error) {
    console.error("Get OCR Drafts By Event API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Failed to load staged OCR drafts for this event.");
  }
};

export const getAllOcrDrafts = async () => {
  try {
    const response = await axiosInstance.get("/submissions/ocr-intake");
    return unwrapOcrDraftList(response.data);
  } catch (error) {
    console.error("Get All OCR Drafts API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Failed to load staged OCR drafts.");
  }
};

export const rerunOcrDraft = async (previewRequest) => extractOcrDraft(previewRequest);

export const submitReviewedOcrNote = async (submissionData) =>
  createSubmission({
    ...submissionData,
    analysis_result: {
      ...(submissionData?.analysis_result || submissionData?.analysisResult || {}),
      ocr_entrypoint: true,
      ocr_review_required: true,
      force_review_staging: true,
      review_before_submission: true,
    },
  });

export const saveOcrDraft = (storageKey, draftPayload) => {
  const storage = safeBrowserStorage();
  if (!storage || !storageKey) {
    return false;
  }

  storage.setItem(
    storageKey,
    JSON.stringify({
      savedAt: new Date().toISOString(),
      draft: draftPayload,
    }),
  );
  return true;
};

export const loadOcrDraft = (storageKey) => {
  const storage = safeBrowserStorage();
  if (!storage || !storageKey) {
    return null;
  }

  const rawDraft = storage.getItem(storageKey);
  if (!rawDraft) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawDraft);
    return parsed?.draft || null;
  } catch (error) {
    console.warn("Failed to parse OCR draft:", error);
    return null;
  }
};

export const clearOcrDraft = (storageKey) => {
  const storage = safeBrowserStorage();
  if (!storage || !storageKey) {
    return false;
  }

  storage.removeItem(storageKey);
  return true;
};

/**
 * Get all submissions (OWNER only)
 * @returns {Promise} API response with submissions array
 */
export const getAllSubmissions = async () => {
  try {
    const response = await axiosInstance.get("/submissions");
    return unwrapSubmissionList(response.data);
  } catch (error) {
    console.error("Get All Submissions API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error.response?.data || error.message;
  }
};

/**
 * Retry failed submission (OWNER only)
 * @param {string} submissionId - Submission ID
 * @returns {Promise} API response
 */
export const retryFailedSubmission = async (submissionId) => {
  try {
    const response = await axiosInstance.post(`/submissions/${submissionId}/retry`);
    const submission = unwrapSubmission(response.data);
    const success = submission?.status !== "FAILED";
    return {
      success,
      submission,
      message: success
        ? null
        : submission?.errorMessage || "Retry validation failed.",
    };
  } catch (error) {
    console.error("Retry Failed Submission API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error.response?.data || error.message;
  }
};

/**
 * Get submission by ID (OWNER + MECHANIC)
 * @param {string} submissionId - Submission ID
 * @returns {Promise} API response with submission data
 */
export const getSubmissionById = async (submissionId) => {
  try {
    const response = await axiosInstance.get(`/submissions/${submissionId}`);
    return unwrapSubmission(response.data);
  } catch (error) {
    console.error("Get Submission By ID API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error.response?.data || error.message;
  }
};

export const generateSessionAiSummary = async (submissionId) => {
  try {
    const response = await axiosInstance.post(
      `/admin/submissions/${encodeURIComponent(submissionId)}/ai-summary`,
    );
    return normalizeAiSummaryResponse(response.data);
  } catch (error) {
    console.error("Generate Session AI Summary API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Could not generate AI summary. Please try again.");
  }
};

/**
 * Get all submissions for a specific event (OWNER + MECHANIC)
 * @param {string} eventId - Event ID
 * @returns {Promise} API response with submissions array
 */
export const getSubmissionsByEvent = async (eventId) => {
  try {
    const response = await axiosInstance.get(`/submissions/event/${eventId}`);
    return unwrapSubmissionList(response.data);
  } catch (error) {
    console.error("Get Submissions By Event API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error.response?.data || error.message;
  }
};


/**
 * Update submission (OWNER only)
 * @param {string} submissionId - Submission ID
 * @param {Object} submissionData - Updated submission data
 * @returns {Promise} API response
 */
export const updateSubmission = async (submissionId, submissionData) => {
  try {
    const response = await axiosInstance.put(
      `/submissions/${submissionId}`,
      submissionData,
    );
    return {
      success: true,
      submission: unwrapSubmission(response.data),
    };
  } catch (error) {
    console.error("Update Submission API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error.response?.data || error.message;
  }
};

/**
 * Delete submission (OWNER only)
 * @param {string} submissionId - Submission ID
 * @returns {Promise} API response
 */
export const deleteSubmission = async (submissionId) => {
  try {
    const response = await axiosInstance.delete(`/submissions/${submissionId}`);
    return {
      success: true,
      message: response.data?.message || "Submission deleted successfully",
    };
  } catch (error) {
    console.error("Delete Submission API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error.response?.data || error.message;
  }
};
