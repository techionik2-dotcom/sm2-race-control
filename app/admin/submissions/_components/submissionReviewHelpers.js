import { normalizeSubmission } from "../../../utils/apiTransforms";
import { formatEntityId } from "../../fleet/_components/fleetManagementHelpers";

const nowIso = () => new Date().toISOString();

const normalizeText = (value) => String(value || "").trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const hasDetailedSections = (data = {}) =>
  Boolean(
    data.suspension ||
      data.alignment ||
      data.tire_temperatures ||
      data.tire_inventory,
  );

const toNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatConfidence = (value) => {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Math.round(percent)));
};

const formatPercentLabel = (value) => {
  const numeric = formatConfidence(value);
  return numeric === null ? "-" : `${numeric}%`;
};

const formatDateTimeLabel = (value) => {
  if (!value) return "-";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatShortDateLabel = (value) => {
  if (!value) return "-";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const isUsableLabel = (value) => {
  const text = normalizeText(value);
  return Boolean(text && text !== "-");
};

const getSubmissionExportDateTimeLabel = (record) => {
  const sessionDate = normalizeText(record?.sessionDateLabel || "");
  const sessionTime = normalizeText(record?.sessionTimeLabel || "");

  if (sessionDate && sessionTime) {
    return `${sessionDate} · ${sessionTime}`;
  }

  if (isUsableLabel(record?.submittedAtLabel)) {
    return normalizeText(record.submittedAtLabel);
  }

  if (isUsableLabel(record?.dateLabel)) {
    return normalizeText(record.dateLabel);
  }

  const fallback = formatDateTimeLabel(record?.submittedAt || record?.createdAt || record?.updatedAt);
  return fallback === "-" ? "Not available" : fallback;
};

const getSubmissionExportRunGroupLabel = (record) =>
  normalizeText(
    record?.run_group?.label ||
      record?.run_group?.displayName ||
      record?.run_group?.name ||
      record?.run_group?.normalized ||
      record?.run_group?.rawText ||
      record?.runGroup ||
      record?.data?.run_group_label ||
      record?.data?.run_group ||
      record?.data?.runGroup ||
      "Not assigned",
  ) || "Not assigned";

const getSubmissionExportSourceLabel = (record) => {
  const sourceHint = normalizeLower(
    [
      record?.sourceTypeKey,
      record?.sourceTypeLabel,
      record?.sourceChannel,
      record?.analysisResult?.source_type,
      record?.analysisResult?.sourceType,
      record?.analysisResult?.submission_mode,
      record?.analysisResult?.submissionMode,
      record?.analysisResult?.raw_input_mode,
      record?.analysisResult?.rawInputMode,
    ]
      .map(normalizeText)
      .filter(Boolean)
      .join(" "),
  );

  if (
    record?.voiceSession ||
    record?.voiceSessionId ||
    record?.voiceTranscript ||
    record?.voiceAudioDownloadUrl ||
    record?.voiceAudioFileName ||
    record?.voiceTranscriptConfidence !== null && record?.voiceTranscriptConfidence !== undefined ||
    SOURCE_VOICE_PATTERN.test(sourceHint)
  ) {
    return "Voice";
  }

  if (
    record?.ocrText ||
    record?.imageUrl ||
    record?.image ||
    record?.analysisResult?.ocr_text ||
    record?.analysisResult?.ocrText ||
    record?.analysisResult?.ocr_result ||
    record?.analysisResult?.ocrResult ||
    SOURCE_OCR_PATTERN.test(sourceHint)
  ) {
    return "OCR";
  }

  if (
    record?.notesLabel ||
    record?.rawText ||
    record?.data?.notes ||
    record?.data?.feedback ||
    SOURCE_NOTES_PATTERN.test(sourceHint)
  ) {
    return "Notes";
  }

  return "Unknown";
};

const sourceTypeCatalog = {
  quick: { label: "Quick Submission", tone: "accent" },
  detail: { label: "Detailed Submission", tone: "info" },
  voice: { label: "Voice Submission", tone: "accent" },
  ocr: { label: "OCR Submission", tone: "warning" },
  photo: { label: "Photo Submission", tone: "success" },
};

const VOICE_SOURCE_PATTERN = /(voice|audio|transcript|speech|dictat|mic)/i;
const OCR_SOURCE_PATTERN = /(ocr|photo|image|scan|screenshot|setup[\s_-]?sheet)/i;
const NOTES_SOURCE_PATTERN = /(notes|manual|text|typed|quick|detail|raw)/i;

const reviewStateCatalog = {
  pending_review: { label: "Pending Processing", tone: "warning" },
  reviewed: { label: "Processed", tone: "neutral" },
  approved: { label: "Validated", tone: "success" },
  flagged: { label: "Validation Failed", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
};

const syncStateCatalog = {
  pending: { label: "Pending Sync", tone: "warning" },
  sent: { label: "Synced", tone: "success" },
  failed: { label: "Sync Failed", tone: "danger" },
};

const structuredStateCatalog = {
  saved: { label: "Structured Saved", tone: "success" },
  saved_with_warnings: { label: "Structured Partial", tone: "warning" },
  skipped: { label: "Structured Skipped", tone: "neutral" },
};

const validationStateCatalog = {
  pending_review: { label: "Pending Processing", tone: "warning" },
  reviewed: { label: "Processed", tone: "neutral" },
  validated: { label: "Validated", tone: "success" },
  failed: { label: "Validation Failed", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
};

const validationSeverityCatalog = {
  clean: { label: "Clean", tone: "success" },
  warning: { label: "Review Recommended", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

const parseSourceTypeKey = (submission, data, analysisResult) => {
  const voiceSession = submission.voiceSession || submission.voice_session || null;
  const explicit = normalizeLower(
    analysisResult.source_type ||
      analysisResult.sourceType ||
      analysisResult.source_channel ||
      analysisResult.sourceChannel ||
      submission.source_type ||
      submission.sourceType,
  );

  if (explicit) {
    if (VOICE_SOURCE_PATTERN.test(explicit)) return "voice";
    if (OCR_SOURCE_PATTERN.test(explicit)) return "photo";
    if (NOTES_SOURCE_PATTERN.test(explicit)) {
      return explicit.includes("detail") ? "detail" : "quick";
    }
  }

  if (
    analysisResult.voice_session_id ||
      analysisResult.voiceSessionId ||
    analysisResult.voice_input_used ||
    analysisResult.voiceInputUsed ||
    analysisResult.raw_input_mode === "voice" ||
    analysisResult.rawInputMode === "voice" ||
    voiceSession
  ) {
    return "voice";
  }

  if (
    analysisResult.ocr_text ||
      analysisResult.ocrText ||
    analysisResult.ocr_result ||
    analysisResult.ocrResult
  ) {
    return "ocr";
  }

  if (submission.image || submission.image_url) {
    return hasDetailedSections(data) ? "photo" : "photo";
  }

  if (hasDetailedSections(data)) {
    return "detail";
  }

  return "quick";
};

const parseReviewStateKey = (analysisResult, validationStateKey) => {
  const explicit = normalizeLower(
    analysisResult.review_state || analysisResult.reviewState || analysisResult.review,
  );

  if (explicit) {
    if (explicit.includes("archiv")) return "archived";
    if (explicit.includes("flag")) return "flagged";
    if (explicit.includes("approv") || explicit.includes("valid")) return "approved";
    if (explicit.includes("review")) return "reviewed";
  }

  if (validationStateKey === "failed") {
    return "pending_review";
  }

  if (validationStateKey === "validated") {
    return "reviewed";
  }

  return "pending_review";
};

const buildCorners = (pressures = {}) => {
  const corners = ["fl", "fr", "rl", "rr"];
  const selectedSet = pressures.cold || pressures.hot || {};

  return corners.map((corner) => ({
    corner,
    value: selectedSet[corner],
    present: selectedSet[corner] !== null && selectedSet[corner] !== undefined && selectedSet[corner] !== "",
    numeric: toNumber(selectedSet[corner]),
  }));
};

const getSubmissionTrack = (submission, data) =>
  normalizeText(
    data.track ||
      submission.track ||
      submission.event?.track ||
      submission.event?.track_name ||
      submission.event?.trackName ||
      "",
  );

const getSubmissionDriverId = (submission, data) =>
  submission.driver?.id ||
  submission.driver?.driverId ||
  submission.driver?.driver_id ||
  data.driver_id ||
  data.driverId ||
  submission.driver_id ||
  null;

const getSubmissionVehicleId = (submission, data) =>
  submission.vehicle?.id ||
  submission.vehicle?.vehicleId ||
  submission.vehicle?.vehicle_id ||
  data.vehicle_id ||
  data.vehicleId ||
  submission.vehicle_id ||
  null;

const getSubmissionEventId = (submission) =>
  submission.event?.id || submission.eventId || submission.event_id || null;

const getSubmissionRawText = (submission) =>
  normalizeText(
    submission.raw_text ||
      submission.rawText ||
      submission.analysis_result?.raw_text ||
      submission.analysisResult?.raw_text ||
      submission.voiceSession?.transcriptEditedText ||
      submission.voiceSession?.transcriptText ||
      "",
  );

const getSubmissionOcrText = (analysisResult) =>
  normalizeText(
    analysisResult.ocr_text ||
      analysisResult.ocrText ||
      analysisResult.ocr_result?.text ||
      analysisResult.ocrResult?.text ||
      analysisResult.extracted_text ||
      analysisResult.extractedText ||
      "",
  );

const getDuplicateCandidate = (submission, allSubmissions = []) => {
  const currentId = String(submission.id || submission._id || submission.submissionId || "");
  const currentEventId = String(getSubmissionEventId(submission) || "");
  const currentDriverId = String(getSubmissionDriverId(submission, submission.data || submission.payload || {}) || "");
  const currentVehicleId = String(getSubmissionVehicleId(submission, submission.data || submission.payload || {}) || "");
  const currentRawText = normalizeLower(getSubmissionRawText(submission));
  const currentDate = normalizeText(submission.data?.date || submission.payload?.date || "");
  const currentTime = normalizeText(submission.data?.time || submission.payload?.time || "");

  const match = allSubmissions.find((candidate) => {
    const candidateId = String(candidate.id || candidate._id || candidate.submissionId || "");
    if (!candidateId || candidateId === currentId) return false;

    const candidateEventId = String(getSubmissionEventId(candidate) || "");
    if (currentEventId && candidateEventId && candidateEventId !== currentEventId) {
      return false;
    }

    const candidateDriverId = String(
      getSubmissionDriverId(candidate, candidate.data || candidate.payload || {}) || "",
    );
    const candidateVehicleId = String(
      getSubmissionVehicleId(candidate, candidate.data || candidate.payload || {}) || "",
    );
    const candidateRawText = normalizeLower(getSubmissionRawText(candidate));
    const candidateDate = normalizeText(candidate.data?.date || candidate.payload?.date || "");
    const candidateTime = normalizeText(candidate.data?.time || candidate.payload?.time || "");

    const samePair =
      currentDriverId &&
      currentVehicleId &&
      candidateDriverId === currentDriverId &&
      candidateVehicleId === currentVehicleId &&
      candidateDate === currentDate &&
      candidateTime === currentTime;

    const sameRaw = currentRawText && candidateRawText && candidateRawText === currentRawText;

    return samePair || sameRaw;
  });

  if (!match) {
    return {
      isDuplicate: false,
      message: "No duplicate detected.",
      matchedSubmissionId: null,
    };
  }

  return {
    isDuplicate: true,
    message: `Possible duplicate of ${formatEntityId("SUB", match.id || match._id || match.submissionId)}`,
    matchedSubmissionId: match.id || match._id || match.submissionId || null,
  };
};

export const buildSubmissionSearchText = (submission) =>
  [
    submission.submissionId,
    submission.submission_ref,
    submission.event?.name,
    submission.event?.track,
    submission.data?.date,
    submission.data?.time,
    submission.data?.session_type,
    submission.data?.session_number,
    submission.data?.duration_min,
    submission.data?.tire_set,
    submission.data?.notes,
    submission.data?.feedback,
    submission.createdByUser?.name,
    submission.createdByUser?.email,
    submission.driver?.firstName,
    submission.driver?.lastName,
    submission.driver?.driverName,
    submission.driver?.driverCode,
    submission.driver?.driver_id,
    submission.driver?.teamName,
    submission.driver?.team_name,
    submission.vehicle?.make,
    submission.vehicle?.model,
    submission.vehicle?.registrationNumber,
    submission.vehicle?.vehicleCode,
    submission.vehicle?.vehicle_id,
    submission.voiceSessionId,
    submission.voiceSession?.id,
    submission.raw_text,
    submission.voiceSession?.transcriptEditedText,
    submission.voiceSession?.transcriptText,
    submission.voiceSession?.audioFileName,
    submission.voiceSession?.audioLanguage,
    submission.voiceSession?.status,
    submission.voiceSession?.validationStatus,
    submission.voiceSession?.openaiRequestId,
    submission.voiceSession?.deepgramRequestId,
    submission.data?.track,
    submission.data?.session_type,
    submission.data?.driver_id,
    submission.data?.vehicle_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const getSubmissionId = (submission) =>
  submission.id || submission._id || submission.submissionId || submission.submission_ref || null;

export const getSubmissionEventLabel = (submission) =>
  normalizeText(submission.event?.name || submission.data?.event_name || submission.eventId || "Unknown Event");

export const getSubmissionDriverLabel = (submission) => {
  const driver = submission.driver || {};
  const fromName = [driver.firstName || driver.first_name, driver.lastName || driver.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return (
    driver.driverName ||
    fromName ||
    driver.fullName ||
    driver.displayName ||
    driver.teamName ||
    normalizeText(submission.data?.driver_id || submission.driver_id || "Unknown Driver")
  );
};

export const getSubmissionDriverCode = (submission) =>
  normalizeText(
    submission.driver?.driverCode ||
      submission.driver?.driver_id ||
      submission.driver_id ||
      submission.data?.driver_id ||
      "",
  );

export const getSubmissionVehicleLabel = (submission) => {
  const vehicle = submission.vehicle || {};
  const carLabel = normalizeText(vehicle.registrationNumber || vehicle.registration_number || "");
  const vehicleLabel = [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();

  return (
    carLabel ||
    vehicleLabel ||
    normalizeText(submission.data?.vehicle_id || submission.vehicle_id || "Unknown Vehicle")
  );
};

export const getSubmissionVehicleCode = (submission) =>
  normalizeText(
    submission.vehicle?.vehicleCode ||
      submission.vehicle?.vehicle_id ||
      submission.vehicle_id ||
      submission.data?.vehicle_id ||
      "",
  );

export const getSubmissionTrackLabel = (submission) =>
  normalizeText(
    submission.data?.track ||
      submission.event?.track ||
      submission.event?.track_name ||
      submission.event?.trackName ||
      "Unknown Track",
  );

export const getSubmissionSessionDateLabel = (submission) =>
  normalizeText(
    submission.data?.date ||
      submission.payload?.date ||
      submission.session_date ||
      submission.date ||
      "",
  );

export const getSubmissionSessionTimeLabel = (submission) =>
  normalizeText(
    submission.data?.time ||
      submission.payload?.time ||
      submission.session_time ||
      submission.time ||
      "",
  );

export const getSubmissionSessionTypeLabel = (submission) =>
  normalizeText(
    submission.data?.session_type ||
      submission.payload?.session_type ||
      submission.session_type ||
      submission.sessionType ||
      "-",
  );

export const getSubmissionSessionNumberLabel = (submission) => {
  const value =
    submission.data?.session_number ||
    submission.payload?.session_number ||
    submission.session_number ||
    submission.sessionNumber ||
    null;

  return value === null || value === undefined || value === "" ? "-" : String(value);
};

export const getSubmissionDurationLabel = (submission) => {
  const value =
    submission.data?.duration_min ||
    submission.payload?.duration_min ||
    submission.duration_min ||
    submission.durationMin ||
    null;

  return value === null || value === undefined || value === "" ? "-" : `${value} min`;
};

export const getSubmissionTireSetLabel = (submission) =>
  normalizeText(
    submission.data?.tire_set ||
      submission.payload?.tire_set ||
      submission.tire_set ||
      submission.tireSet ||
      "-",
  );

export const getSubmissionNotesLabel = (submission) =>
  normalizeText(
    submission.data?.notes ||
      submission.data?.feedback ||
      submission.payload?.notes ||
      submission.payload?.feedback ||
      submission.rawText ||
      submission.raw_text ||
      "",
  );

export const getSubmissionCreatedByLabel = (submission) => {
  const createdBy = submission.createdByUser || submission.created_by_user || null;
  const createdByName =
    createdBy?.name ||
    createdBy?.fullName ||
    createdBy?.displayName ||
    createdBy?.email ||
    createdBy?.username ||
    "";

  return createdByName || formatEntityId("USR", submission.userId || submission.created_by_id || "");
};

export const getConfidenceValue = (submission) => {
  const normalized = normalizeSubmission(submission);
  if (!normalized) return null;

  const analysisResult = normalized.analysisResult || normalized.analysis_result || {};
  const confidence =
    analysisResult.confidence ??
    analysisResult.confidence_score ??
    analysisResult.voice_transcript_confidence ??
    analysisResult.voiceTranscriptConfidence ??
    normalized.voiceSession?.transcriptConfidence ??
    normalized.confidence;
  const numeric = formatConfidence(confidence);
  return numeric === null ? null : numeric;
};

export const buildSubmissionSummaryCounts = (submissions = []) => {
  const rows = submissions.map((submission) => buildSubmissionMonitorRecord(submission, submissions));

  return {
    total: rows.length,
    pendingReview: rows.filter((submission) => submission.validationStateKey === "pending_review").length,
    validationFailed: rows.filter((submission) => submission.validationStateKey === "failed").length,
    synced: rows.filter((submission) => submission.syncStateKey === "sent").length,
    media: rows.filter((submission) => submission.sourceTypeKey === "ocr" || submission.sourceTypeKey === "photo").length,
    voice: rows.filter((submission) => submission.sourceTypeKey === "voice").length,
  };
};

export const buildSubmissionMonitorRecord = (submission, allSubmissions = []) => {
  const normalized = normalizeSubmission(submission);
  if (!normalized) return null;

  const data = normalized.data || normalized.payload || {};
  const analysisResult = normalized.analysisResult || normalized.analysis_result || {};
  const voiceSession = normalized.voiceSession || normalized.voice_session || null;
  const voiceTranscript = normalizeText(
    voiceSession?.transcriptEditedText ||
      voiceSession?.transcriptText ||
      analysisResult.voice_transcript_text ||
      analysisResult.voiceTranscriptText ||
      normalized.raw_text ||
      normalized.rawText ||
      "",
  );
  const sourceTypeKey = parseSourceTypeKey(normalized, data, analysisResult);
  const sourceTypeMeta = sourceTypeCatalog[sourceTypeKey] || sourceTypeCatalog.quick;
  const syncStateKey = normalizeLower(normalized.status || "pending");
  const structuredStatusKey = normalizeLower(
    normalized.structuredIngestStatus || "skipped",
  );
  const confidence = getConfidenceValue(normalized);
  const structuredWarnings = Array.isArray(normalized.structuredIngestWarnings)
    ? normalized.structuredIngestWarnings
    : [];

  const hardIssues = [];
  const warnings = [];

  const requiredFields = [
    ["date", data.date],
    ["time", data.time],
    ["track", data.track],
    ["driver_id", data.driver_id],
    ["vehicle_id", data.vehicle_id],
    ["session_type", data.session_type],
    ["session_number", data.session_number],
    ["duration_min", data.duration_min],
  ];
  const missingFields = requiredFields.filter(([, value]) => value === null || value === undefined || value === "").map(([field]) => field);
  if (missingFields.length) {
    hardIssues.push(...missingFields.map((field) => `missing:${field}`));
  }

  const pressures = data.pressures || {};
  const corners = buildCorners(pressures);
  const missingCorners = corners.filter((corner) => !corner.present).map((corner) => corner.corner.toUpperCase());
  if (missingCorners.length) {
    hardIssues.push(...missingCorners.map((corner) => `pressure:${corner}`));
  }

  const driverId = getSubmissionDriverId(normalized, data);
  const driverCode = getSubmissionDriverCode(normalized);
  const vehicleId = getSubmissionVehicleId(normalized, data);
  const vehicleDriverId = normalized.vehicle?.driverId || normalized.vehicle?.driver_id || null;
  const driverVehicleMismatch =
    Boolean(driverCode && vehicleId && vehicleDriverId && String(vehicleDriverId) !== String(driverCode));
  if (driverVehicleMismatch) {
    hardIssues.push("vehicle-driver-mismatch");
  }

  const eventTrack = normalizeLower(normalized.event?.track || normalized.event?.track_name || "");
  const submissionTrack = normalizeLower(getSubmissionTrack(normalized, data));
  const trackNormalizationWarning =
    Boolean(eventTrack && submissionTrack && eventTrack !== submissionTrack);
  if (trackNormalizationWarning) {
    warnings.push("track-normalization");
  }

  const runGroup = normalized.run_group || normalized.runGroup || {};
  const runGroupValue = normalizeLower(runGroup.normalized || runGroup.rawText || normalized.runGroup || "");
  const payloadRunGroup = normalizeLower(
    data.run_group || data.runGroup || analysisResult.run_group || analysisResult.runGroup || "",
  );
  const runGroupNormalizationWarning =
    Boolean(runGroupValue && payloadRunGroup && runGroupValue !== payloadRunGroup);
  if (runGroupNormalizationWarning) {
    warnings.push("run-group-normalization");
  }

  const duplicate = getDuplicateCandidate(normalized, allSubmissions);
  if (duplicate.isDuplicate) {
    warnings.push("duplicate-detection");
  }

  if (confidence !== null && confidence < 80) {
    warnings.push("low-confidence");
  }
  if (sourceTypeKey === "voice" && voiceSession?.status === "TRANSCRIPTION_FAILED") {
    warnings.push("voice-transcription-failed");
  }

  const ocrText = getSubmissionOcrText(analysisResult);
  if (sourceTypeKey === "ocr" || sourceTypeKey === "photo" || ocrText) {
    warnings.push("ocr-backed");
  }

  if (structuredWarnings.length) {
    warnings.push("structured-normalization");
  } else if (structuredStatusKey === "skipped" && normalized.hasStructuredData) {
    warnings.push("structured-skipped");
  }

  const analysisValidationState = normalizeLower(
    analysisResult.validation_state || analysisResult.validationState || "",
  );
  const reviewStateKey = parseReviewStateKey(analysisResult, analysisValidationState || "pending_review");
  const explicitValidationState = normalizeLower(
    analysisResult.validation_state || analysisResult.validationState || "",
  );

  let validationStateKey = "pending_review";
  if (reviewStateKey === "archived") {
    validationStateKey = "archived";
  } else if (reviewStateKey === "flagged" || explicitValidationState.includes("fail") || hardIssues.length) {
    validationStateKey = "failed";
  } else if (
    reviewStateKey === "approved" ||
    explicitValidationState.includes("valid")
  ) {
    validationStateKey = "validated";
  } else if (reviewStateKey === "reviewed") {
    validationStateKey = "reviewed";
  }

  const validationStateMeta = validationStateCatalog[validationStateKey] || validationStateCatalog.pending_review;
  const syncStateMeta = syncStateCatalog[syncStateKey] || syncStateCatalog.pending;
  const structuredStateMeta =
    structuredStateCatalog[structuredStatusKey] || structuredStateCatalog.skipped;

  const validationMessages = [];
  if (missingFields.length) {
    validationMessages.push(`Missing required fields: ${missingFields.join(", ")}`);
  }
  if (missingCorners.length) {
    validationMessages.push(`Incomplete pressure data for: ${missingCorners.join(", ")}`);
  }
  if (driverVehicleMismatch) {
    validationMessages.push("Selected vehicle does not belong to the selected driver.");
  }
  if (trackNormalizationWarning) {
    validationMessages.push("Track value differs from the event track and may need normalization.");
  }
  if (runGroupNormalizationWarning) {
    validationMessages.push("Run group value differs from the event run group.");
  }
  if (duplicate.isDuplicate) {
    validationMessages.push(duplicate.message);
  }
  if (confidence !== null && confidence < 80) {
    validationMessages.push(`Confidence is ${confidence}%, which is below the preferred review threshold.`);
  }
  if (sourceTypeKey === "voice" && voiceTranscript) {
    validationMessages.push("Voice transcript is attached and traceable to the submitted audio file.");
  }
  if (sourceTypeKey === "voice" && voiceSession?.validationStatus === "REVIEW_REQUIRED") {
    validationMessages.push("Voice transcript needs manual review because transcription confidence is below the configured threshold.");
  }
  if (sourceTypeKey === "voice" && voiceSession?.lastErrorMessage) {
    validationMessages.push(`Voice transcription error: ${voiceSession.lastErrorMessage}`);
  }
  if (structuredWarnings.length) {
    structuredWarnings.forEach((warning) => {
      validationMessages.push(
        `Structured normalization warning${warning.field ? ` (${warning.field})` : ""}: ${warning.message}`,
      );
    });
  } else if (structuredStatusKey === "skipped" && normalized.hasStructuredData) {
    validationMessages.push(
      "Structured normalization was skipped even though structured fields were present. Review the backend ingest path.",
    );
  }

  const structuredIssues = [...hardIssues, ...warnings];
  const validationSeverityKey = hardIssues.length ? "failed" : warnings.length ? "warning" : "clean";
  const validationSeverityMeta = validationSeverityCatalog[validationSeverityKey] || validationSeverityCatalog.clean;
  const recommendation =
    validationStateKey === "failed"
      ? "Correct the failed fields, then retry validation so the record stays accurate."
      : structuredWarnings.length
        ? "The canonical note is saved, but some normalized tables were only partially updated. Review the structured warnings before approving."
      : validationMessages.length
        ? "Inspect the parsed data against the raw input and retry validation if needed."
        : "Submission is stored successfully and looks clean.";

  const auditSnippet =
    normalizeText(analysisResult.audit_snippet || analysisResult.auditSnippet) ||
    `Synced ${syncStateMeta.label.toLowerCase()} with ${validationStateMeta.label.toLowerCase()} state.`;

  const voiceAudioDurationLabel =
    voiceSession?.audioDurationMs !== null && voiceSession?.audioDurationMs !== undefined
      ? `${Math.round((voiceSession.audioDurationMs / 1000) * 10) / 10}s`
      : "-";
  const voiceTranscriptConfidence = voiceSession?.transcriptConfidence ?? analysisResult.voice_transcript_confidence ?? null;

  return {
    ...normalized,
    data,
    analysisResult,
    analysis_result: analysisResult,
    voiceSession,
    voiceSessionId: voiceSession?.id || normalized.voiceSessionId || normalized.voice_session_id || null,
    voiceTranscript,
    voiceTranscriptConfidence,
    voiceTranscriptWordCount: voiceSession?.transcriptWordCount ?? null,
    voiceAudioFileName: voiceSession?.audioFileName || null,
    voiceAudioContentType: voiceSession?.audioContentType || null,
    voiceAudioDurationMs: voiceSession?.audioDurationMs || null,
    voiceAudioDurationLabel,
    voiceAudioLanguage: voiceSession?.audioLanguage || null,
    voiceAudioDownloadUrl: voiceSession?.audioDownloadUrl || null,
    voiceValidationStatus: voiceSession?.validationStatus || null,
    voiceValidationMessage: voiceSession?.validationMessage || null,
    voiceStatus: voiceSession?.status || null,
    sourceTypeKey,
    sourceTypeLabel: sourceTypeMeta.label,
    sourceTypeTone: sourceTypeMeta.tone,
    syncStateKey,
    syncStateLabel: syncStateMeta.label,
    syncStateTone: syncStateMeta.tone,
    structuredStatusKey,
    structuredStatusLabel: structuredStateMeta.label,
    structuredStatusTone: structuredStateMeta.tone,
    structuredWarnings,
    structuredWarningCount: structuredWarnings.length,
    reviewStateKey,
    reviewStateLabel: reviewStateCatalog[reviewStateKey]?.label || reviewStateCatalog.pending_review.label,
    validationStateKey,
    validationStateLabel: validationStateMeta.label,
    validationStateTone: validationStateMeta.tone,
    validationSeverityKey,
    validationSeverityLabel: validationSeverityMeta.label,
    validationSeverityTone: validationSeverityMeta.tone,
    confidence,
    confidenceLabel: formatPercentLabel(confidence),
    rawText: getSubmissionRawText(normalized),
    imageUrl: normalized.image || normalized.image_url || null,
    ocrText,
    parserVersion:
      analysisResult.parser_version ||
      analysisResult.parserVersion ||
      analysisResult.version ||
      "admin-monitor-1.0",
    processedAt: analysisResult.processed_at || analysisResult.processedAt || normalized.updatedAt || normalized.createdAt,
    sourceChannel:
      voiceSession ? "Voice Recording" :
      analysisResult.source_channel ||
      analysisResult.sourceChannel ||
      sourceTypeMeta.label,
    validationMessages,
    failedFields: missingFields,
    missingFields,
    warnings,
    duplicateDetection: duplicate,
    driverVehicleMismatch,
    trackNormalizationWarning,
    runGroupNormalizationWarning,
    isArchived: reviewStateKey === "archived",
    auditSnippet,
    recommendation,
    structuredIssues,
    hasMedia: Boolean(normalized.image || normalized.image_url || ocrText || voiceSession?.audioDownloadUrl),
    submittedAt: normalized.createdAt || normalized.updatedAt || null,
    submittedAtLabel: formatDateTimeLabel(normalized.createdAt || normalized.updatedAt || null),
    dateLabel: formatShortDateLabel(normalized.createdAt || normalized.updatedAt || null),
    sessionDateLabel: getSubmissionSessionDateLabel(normalized),
    sessionTimeLabel: getSubmissionSessionTimeLabel(normalized),
    sessionTypeLabel: getSubmissionSessionTypeLabel(normalized),
    sessionNumberLabel: getSubmissionSessionNumberLabel(normalized),
    durationLabel: getSubmissionDurationLabel(normalized),
    tireSetLabel: getSubmissionTireSetLabel(normalized),
    notesLabel: getSubmissionNotesLabel(normalized),
    driverCode: getSubmissionDriverCode(normalized),
    vehicleCode: getSubmissionVehicleCode(normalized),
    createdByLabel: getSubmissionCreatedByLabel(normalized),
  };
};

export const buildReviewAnalysisPatch = ({
  submission,
  allSubmissions = [],
  reviewState = "REVIEWED",
  reviewerId = null,
  reviewerName = null,
  note = "",
}) => {
  const snapshot = buildSubmissionMonitorRecord(submission, allSubmissions);
  const analysisResult = {
    ...(submission?.analysisResult || submission?.analysis_result || {}),
    source_type: snapshot.sourceTypeKey,
    source_channel: snapshot.sourceChannel,
    parser_version: snapshot.parserVersion,
    processed_at: nowIso(),
    validation_state: snapshot.validationStateKey,
    validation_state_label: snapshot.validationStateLabel,
    validation_messages: snapshot.validationMessages,
    failed_fields: snapshot.failedFields,
    missing_fields: snapshot.missingFields,
    warnings: snapshot.warnings,
    duplicate_detection: snapshot.duplicateDetection,
    confidence: snapshot.confidence ?? submission?.confidence ?? null,
    audit_snippet:
      note ||
      snapshot.auditSnippet ||
      `Reviewed via Submission Monitor as ${reviewState.toLowerCase()}.`,
    review_state: reviewState,
    reviewed_at: nowIso(),
  };

  if (reviewerId) {
    analysisResult.reviewed_by_id = reviewerId;
  }
  if (reviewerName) {
    analysisResult.reviewed_by_name = reviewerName;
  }
  if (reviewState === "APPROVED") {
    analysisResult.validation_state = "VALIDATED";
    analysisResult.validation_state_label = "Validated";
  }
  if (reviewState === "FLAGGED") {
    analysisResult.validation_state = "FAILED";
    analysisResult.validation_state_label = "Validation Failed";
  }
  if (reviewState === "ARCHIVED") {
    analysisResult.archived_at = nowIso();
  }

  return {
    analysis_result: analysisResult,
  };
};

export const buildSubmissionExportRows = (submissions = []) =>
  submissions.map((submission) => {
    const record = buildSubmissionMonitorRecord(submission, submissions) || submission;
    const eventLabel = normalizeText(getSubmissionEventLabel(record)) || "Unknown Event";
    const trackLabel = normalizeText(getSubmissionTrackLabel(record));

    return {
      submissionId: record.submissionId || getSubmissionId(record) || "Not available",
      dateTime: getSubmissionExportDateTimeLabel(record),
      driver: getSubmissionDriverLabel(record) || "Unknown driver",
      vehicle: getSubmissionVehicleLabel(record) || "Unknown vehicle",
      event: eventLabel,
      track: trackLabel && trackLabel !== "Unknown Track" ? trackLabel : "No track selected",
      runGroup: getSubmissionExportRunGroupLabel(record),
      submittedVia: getSubmissionExportSourceLabel(record),
    };
  });

export const mockSubmissions = [
  {
    id: "sub_mock_001",
    submission_ref: "SUB-MOCK-001",
    event_id: "evt_mock_001",
    event: {
      id: "evt_mock_001",
      name: "Spring Championship",
      track: "Sebring International Raceway",
      start_date: "2026-05-12T00:00:00Z",
      end_date: "2026-05-14T00:00:00Z",
      is_active: true,
    },
    run_group: {
      id: "rg_mock_001",
      event_id: "evt_mock_001",
      raw_text: "Red",
      normalized: "RED",
      locked: false,
    },
    driver: {
      id: "drv_mock_001",
      first_name: "Jules",
      last_name: "Bianchi",
      team_name: "Jules Racing",
    },
    vehicle: {
      id: "veh_mock_001",
      driver_id: "drv_mock_001",
      make: "Porsche",
      model: "911 GT3 R",
      registration_number: "JUL-911",
    },
    created_by_id: "usr_mock_001",
    raw_text: "s1 30min jules gt3 y-s3 pf 27 wb 2450",
    image_url: null,
    payload: {
      date: "2026-05-12",
      time: "10:12",
      track: "Sebring International Raceway",
      driver_id: "drv_mock_001",
      vehicle_id: "veh_mock_001",
      session_type: "Practice",
      session_number: 1,
      duration_min: 30,
      tire_set: "Y-S3",
      wheelbase_mm: 2450,
      pressures: {
        unit: "psi",
        cold: { fl: 27, fr: 27, rl: 29, rr: 29 },
      },
    },
    analysis_result: {
      source_type: "quick",
      confidence: 0.96,
      validation_state: "VALIDATED",
      review_state: "APPROVED",
      parser_version: "monitor-demo-1.0",
      audit_snippet: "Quick submission parsed and synced successfully.",
    },
    status: "SENT",
    created_at: "2026-05-12T10:13:00Z",
    updated_at: "2026-05-12T10:14:00Z",
  },
  {
    id: "sub_mock_002",
    submission_ref: "SUB-MOCK-002",
    event_id: "evt_mock_002",
    event: {
      id: "evt_mock_002",
      name: "Night Sprint Round 3",
      track: "Bathurst GP",
      start_date: "2026-06-02T00:00:00Z",
      end_date: "2026-06-03T00:00:00Z",
      is_active: true,
    },
    run_group: {
      id: "rg_mock_002",
      event_id: "evt_mock_002",
      raw_text: "Blue",
      normalized: "BLUE",
      locked: false,
    },
    driver: {
      id: "drv_mock_002",
      first_name: "Ava",
      last_name: "Morris",
      team_name: "Apex Garage",
    },
    vehicle: {
      id: "veh_mock_002",
      driver_id: "drv_mock_002",
      make: "Toyota",
      model: "GR Supra",
      registration_number: "AVA-992",
    },
    created_by_id: "usr_mock_001",
    raw_text: "photo-backed setup sheet sent from pit wall",
    image_url: "https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=1200&q=80",
    payload: {
      date: "2026-06-02",
      time: "20:45",
      track: "Bathurst GP",
      driver_id: "drv_mock_002",
      vehicle_id: "veh_mock_002",
      session_type: "Qualifying",
      session_number: 2,
      duration_min: 20,
      tire_set: "S7",
      wheelbase_mm: 2550,
      pressures: {
        unit: "psi",
        hot: { fl: 30, fr: 30, rl: 32, rr: 32 },
      },
      suspension: {
        rebound_fl: 7,
        rebound_fr: 7,
        rebound_rl: 5,
        rebound_rr: 5,
        bump_fl: 3,
        bump_fr: 3,
        bump_rl: 4,
        bump_rr: 4,
        sway_bar_f: 2,
        sway_bar_r: 4,
      },
    },
    analysis_result: {
      source_type: "photo",
      confidence: 0.86,
      validation_state: "REVIEWED",
      review_state: "REVIEWED",
      ocr_text: "S2 20min bathurst photo note",
      parser_version: "monitor-demo-1.0",
      audit_snippet: "Photo submission awaits final approval.",
    },
    status: "SENT",
    created_at: "2026-06-02T20:46:00Z",
    updated_at: "2026-06-02T20:47:00Z",
  },
  {
    id: "sub_mock_003",
    submission_ref: "SUB-MOCK-003",
    event_id: "evt_mock_003",
    event: {
      id: "evt_mock_003",
      name: "Summer Endurance",
      track: "Spa Francorchamps",
      start_date: "2026-07-10T00:00:00Z",
      end_date: "2026-07-12T00:00:00Z",
      is_active: true,
    },
    run_group: {
      id: "rg_mock_003",
      event_id: "evt_mock_003",
      raw_text: "Yellow",
      normalized: "YELLOW",
      locked: false,
    },
    driver: {
      id: "drv_mock_003",
      first_name: "Noah",
      last_name: "Chen",
      team_name: "Northline Motorsports",
    },
    vehicle: {
      id: "veh_mock_003",
      driver_id: "drv_mock_999",
      make: "Ferrari",
      model: "296 GT3",
      registration_number: "NCH-296",
    },
    created_by_id: "usr_mock_002",
    raw_text: "driver and vehicle mismatch detected",
    image_url: null,
    payload: {
      date: "2026-07-10",
      time: "13:20",
      track: "Spa Francorchamps",
      driver_id: "drv_mock_003",
      vehicle_id: "veh_mock_003",
      session_type: "Race",
      session_number: 4,
      duration_min: 45,
      pressures: {
        unit: "psi",
        cold: { fl: 26, fr: 26 },
      },
      alignment: {
        camber_fl: -2.4,
        camber_fr: -2.2,
      },
    },
    analysis_result: {
      source_type: "detailed",
      confidence: 0.73,
      validation_state: "FAILED",
      review_state: "FLAGGED",
      failed_fields: ["vehicle-driver-mismatch", "pressure:RL", "pressure:RR"],
      validation_messages: [
        "Vehicle does not belong to the selected driver.",
        "Rear pressure values are missing.",
      ],
      parser_version: "monitor-demo-1.0",
      audit_snippet: "Validation failed and requires correction.",
    },
    status: "FAILED",
    error_message: "Webhook delivery failed: timeout",
    created_at: "2026-07-10T13:21:00Z",
    updated_at: "2026-07-10T13:22:00Z",
  },
  {
    id: "sub_mock_004",
    submission_ref: "SUB-MOCK-004",
    event_id: "evt_mock_004",
    event: {
      id: "evt_mock_004",
      name: "Autumn Club Race",
      track: "Silverstone National",
      start_date: "2026-09-18T00:00:00Z",
      end_date: "2026-09-19T00:00:00Z",
      is_active: true,
    },
    run_group: {
      id: "rg_mock_004",
      event_id: "evt_mock_004",
      raw_text: "Green",
      normalized: "GREEN",
      locked: false,
    },
    driver: {
      id: "drv_mock_004",
      first_name: "Mia",
      last_name: "Lopez",
      team_name: "Lopez Racing",
    },
    vehicle: {
      id: "veh_mock_004",
      driver_id: "drv_mock_004",
      make: "BMW",
      model: "M4 GT4",
      registration_number: "MIA-444",
    },
    created_by_id: "usr_mock_003",
    raw_text: "archived owner review note",
    image_url: null,
    payload: {
      date: "2026-09-18",
      time: "09:05",
      track: "Silverstone National",
      driver_id: "drv_mock_004",
      vehicle_id: "veh_mock_004",
      session_type: "Practice",
      session_number: 1,
      duration_min: 30,
      tire_set: "Y-7",
      pressures: {
        unit: "psi",
        cold: { fl: 27, fr: 27, rl: 28, rr: 28 },
      },
    },
    analysis_result: {
      source_type: "quick",
      confidence: 0.92,
      validation_state: "VALIDATED",
      review_state: "ARCHIVED",
      archived_at: "2026-09-18T12:10:00Z",
      parser_version: "monitor-demo-1.0",
      audit_snippet: "Submission archived after post-session audit.",
    },
    status: "SENT",
    created_at: "2026-09-18T09:06:00Z",
    updated_at: "2026-09-19T11:45:00Z",
  },
];
