"use client";

import {
  getSubmissionDriverLabel,
  getSubmissionEventLabel,
  getSubmissionId,
  getSubmissionTrackLabel,
  getSubmissionVehicleLabel,
} from "./submissionReviewHelpers";

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const getDisplayText = (value, fallback = "Not available") => {
  const text = normalizeText(value);
  return text && text !== "-" ? text : fallback;
};

const SOURCE_VOICE_PATTERN = /(voice|audio|transcript|speech|dictat|mic)/i;
const SOURCE_OCR_PATTERN = /(ocr|photo|image|scan|screenshot|setup[\s_-]?sheet)/i;
const SOURCE_NOTES_PATTERN = /(notes|manual|text|typed|quick|detail|raw)/i;

const getSourceHints = (record) =>
  [
    record?.sourceTypeKey,
    record?.sourceType,
    record?.sourceTypeLabel,
    record?.sourceChannel,
    record?.analysisResult?.source_type,
    record?.analysisResult?.sourceType,
    record?.analysisResult?.submission_mode,
    record?.analysisResult?.submissionMode,
    record?.analysisResult?.raw_input_mode,
    record?.analysisResult?.rawInputMode,
  ]
    .map(normalizeLower)
    .filter(Boolean);

const getSourceHintText = (record) => getSourceHints(record).join(" ");

const hasVoiceSignal = (record, sourceHintText) =>
  Boolean(
    record?.voiceSession ||
      record?.voiceSessionId ||
      record?.voiceTranscript ||
      record?.voiceAudioDownloadUrl ||
      record?.voiceAudioFileName ||
      record?.voiceTranscriptConfidence !== null && record?.voiceTranscriptConfidence !== undefined ||
      SOURCE_VOICE_PATTERN.test(sourceHintText),
  );

const hasOcrSignal = (record, sourceHintText) =>
  Boolean(
    record?.ocrText ||
      record?.imageUrl ||
      record?.image ||
      record?.analysisResult?.ocr_text ||
      record?.analysisResult?.ocrText ||
      record?.analysisResult?.ocr_result ||
      record?.analysisResult?.ocrResult ||
      SOURCE_OCR_PATTERN.test(sourceHintText),
  );

const hasNotesSignal = (record, sourceHintText) =>
  Boolean(
    record?.notesLabel ||
      record?.rawText ||
      record?.data?.notes ||
      record?.data?.feedback ||
      SOURCE_NOTES_PATTERN.test(sourceHintText),
  );

export const getSessionSourceKey = (record) => {
  const sourceHintText = getSourceHintText(record);

  if (hasVoiceSignal(record, sourceHintText)) {
    return "voice";
  }

  if (hasOcrSignal(record, sourceHintText)) {
    return "ocr";
  }

  if (hasNotesSignal(record, sourceHintText)) {
    return "notes";
  }

  return sourceHintText ? "notes" : "unknown";
};

export const getSessionSourceLabel = (record) => {
  const key = getSessionSourceKey(record);
  if (key === "voice") return "Voice";
  if (key === "ocr") return "OCR";
  if (key === "unknown") return "Unknown";
  return "Notes";
};

export const getSessionSourceTone = (record) => {
  const key = getSessionSourceKey(record);
  if (key === "voice") return "accent";
  if (key === "ocr") return "warning";
  return "neutral";
};

export const getSessionDateTimeLabel = (record) => {
  const date = normalizeText(record?.sessionDateLabel || "");
  const time = normalizeText(record?.sessionTimeLabel || "");

  if (date && time) {
    return `${date} · ${time}`;
  }

  if (date) {
    return date;
  }

  return getDisplayText(record?.submittedAtLabel || record?.dateLabel, "Not available");
};

export const getSessionEventTrackLabel = (record) => {
  const eventLabel = normalizeText(getSubmissionEventLabel(record));
  const trackLabel = normalizeText(getSubmissionTrackLabel(record));

  if (eventLabel && trackLabel && eventLabel !== trackLabel) {
    return { main: eventLabel, sub: trackLabel };
  }

  if (eventLabel) {
    return { main: eventLabel, sub: "" };
  }

  if (trackLabel) {
    return { main: trackLabel, sub: "" };
  }

  return { main: "Unknown Event", sub: "No track selected" };
};

export const getSessionRunGroupLabel = (record) =>
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

export const getSessionLastUpdatedByLabel = (record) =>
  normalizeText(
    record?.analysisResult?.last_edited_by ||
      record?.analysisResult?.lastEditedBy ||
      record?.analysisResult?.reviewed_by_name ||
      record?.analysisResult?.reviewedByName ||
      record?.analysisResult?.reviewed_by_id ||
      record?.analysisResult?.updated_by_name ||
      record?.analysisResult?.updatedByName ||
      record?.analysisResult?.updated_by ||
      record?.analysisResult?.updatedBy ||
      record?.createdByLabel ||
      record?.createdByUser?.name ||
      record?.createdByUser?.email ||
      record?.updatedByLabel ||
      record?.updatedByUser?.name ||
      record?.updatedByUser?.email ||
      "System",
  ) || "System";

export const getSessionNotesSummary = (record) =>
  normalizeText(
    record?.notesLabel ||
      record?.rawText ||
      record?.voiceTranscript ||
      record?.ocrText ||
      "No notes provided.",
  ) || "No notes provided.";

export const getSessionSourceSubtext = (record) => {
  const key = getSessionSourceKey(record);

  if (key === "voice") {
    return "Voice session";
  }

  if (key === "ocr") {
    return "OCR intake";
  }

  if (key === "unknown") {
    return "Source unavailable";
  }

  return "Driver portal";
};

export const getSessionSourceBody = (record) => {
  const key = getSessionSourceKey(record);

  if (key === "voice") {
    const transcript = normalizeText(
      record?.voiceTranscript ||
        record?.analysisResult?.voice_transcript_text ||
        record?.analysisResult?.voiceTranscriptText ||
        "",
    );

    if (transcript) {
      return transcript;
    }

    const fallbackLines = [
      record?.voiceAudioFileName ? `Audio file: ${record.voiceAudioFileName}` : "",
      record?.voiceAudioDurationLabel ? `Duration: ${record.voiceAudioDurationLabel}` : "",
      record?.voiceValidationMessage ? `Validation: ${record.voiceValidationMessage}` : "",
      record?.rawText ? `Raw text: ${record.rawText}` : "",
    ].filter(Boolean);

    return fallbackLines.join("\n") || "No voice transcript is available for this session.";
  }

  if (key === "ocr") {
    const ocrText = normalizeText(
      record?.ocrText ||
        record?.analysisResult?.ocr_result?.text ||
        record?.analysisResult?.ocrResult?.text ||
        record?.analysisResult?.extracted_text ||
        record?.analysisResult?.extractedText ||
        "",
    );

    if (ocrText) {
      return ocrText;
    }

    const fallbackLines = [
      record?.imageUrl ? "Image attachment available." : "",
      record?.confidenceLabel ? `Confidence: ${record.confidenceLabel}` : "",
      record?.parserVersion ? `Parser: ${record.parserVersion}` : "",
      record?.rawText ? `Raw text: ${record.rawText}` : "",
    ].filter(Boolean);

    return fallbackLines.join("\n") || "No OCR text is available for this session.";
  }

  if (key === "unknown") {
    const fallbackLines = [
      record?.rawText ? `Raw text: ${record.rawText}` : "",
      record?.notesLabel ? `Notes: ${record.notesLabel}` : "",
    ].filter(Boolean);

    return fallbackLines.join("\n") || "No source content is available for this session.";
  }

  const notesText = normalizeText(
    record?.notesLabel ||
      record?.rawText ||
      record?.data?.notes ||
      record?.data?.feedback ||
      "",
  );

  if (notesText) {
    return notesText;
  }

  const fallbackLines = [
    record?.sessionTypeLabel ? `Session type: ${record.sessionTypeLabel}` : "",
    record?.sessionNumberLabel ? `Session #: ${record.sessionNumberLabel}` : "",
    record?.tireSetLabel ? `Tire set: ${record.tireSetLabel}` : "",
  ].filter(Boolean);

  return fallbackLines.join("\n") || "No notes were captured for this session.";
};

export const getSessionSourceLabelHint = (record) => {
  const key = getSessionSourceKey(record);

  if (key === "voice") {
    return "Submitted from the voice flow.";
  }

  if (key === "ocr") {
    return "Submitted from the OCR flow.";
  }

  if (key === "unknown") {
    return "The backend payload did not expose a clear source type.";
  }

  return "Submitted from the notes flow.";
};

export const getSessionSourceAttachment = (record) => {
  const key = getSessionSourceKey(record);

  if (key === "voice" && record?.voiceAudioDownloadUrl) {
    return {
      href: record.voiceAudioDownloadUrl,
      label: "Open voice audio",
    };
  }

  if (key === "ocr" && record?.imageUrl) {
    return {
      href: record.imageUrl,
      label: "Open source image",
    };
  }

  return null;
};

export const getSessionReportHref = (record, { edit = false } = {}) => {
  const submissionId = getSubmissionId(record);
  if (!submissionId) {
    return "";
  }

  const params = new URLSearchParams();
  if (edit) {
    params.set("edit", "1");
  }

  const query = params.toString();
  return `/admin/submissions/report/${encodeURIComponent(String(submissionId))}${query ? `?${query}` : ""}`;
};
