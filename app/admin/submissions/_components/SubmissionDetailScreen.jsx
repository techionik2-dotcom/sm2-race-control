"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import NoteAltOutlinedIcon from "@mui/icons-material/NoteAltOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import RuleOutlinedIcon from "@mui/icons-material/RuleOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";

import { useAuth } from "../../../context/AuthContext";
import StatusBadge from "../../../components/Common/StatusBadge";
import { EmptyStatePanel } from "../../fleet/_components/ManagementUi";
import {
  formatDate,
  formatDateTime,
  formatEntityId,
  getApiErrorMessage,
} from "../../fleet/_components/fleetManagementHelpers";
import {
  generateSessionAiSummary,
  normalizeStoredAiSummary,
  updateSubmission,
} from "../../../utils/submissionApi";
import ProtectedAudioPlayer from "./ProtectedAudioPlayer";
import AiSessionSummaryModal from "./AiSessionSummaryModal";
import {
  buildSubmissionMonitorRecord,
  getSubmissionDriverLabel,
  getSubmissionEventLabel,
  getSubmissionId,
  getSubmissionTrackLabel,
  getSubmissionVehicleLabel,
} from "./submissionReviewHelpers";
import {
  getSessionDateTimeLabel,
  getSessionEventTrackLabel,
  getSessionLastUpdatedByLabel,
  getSessionNotesSummary,
  getSessionReportHref,
  getSessionRunGroupLabel,
  getSessionSourceAttachment,
  getSessionSourceBody,
  getSessionSourceKey,
  getSessionSourceLabel,
  getSessionSourceLabelHint,
  getSessionSourceSubtext,
  getSessionSourceTone,
} from "./sessionReviewUiHelpers";

const field = (label, path, options = {}) => ({ label, path, ...options });

const SEANCES_GROUPS = [
  {
    title: "Session Details",
    fields: [
      field("Date", ["date"], { type: "date", required: true }),
      field("Time", ["time"], { type: "time", required: true }),
      field("Session Type", ["session_type"], { type: "text", required: true }),
      field("Session #", ["session_number"], { type: "number", required: true }),
      field("Duration (min)", ["duration_min"], { type: "number", required: true }),
      field("Laps", ["laps"], { type: "number" }),
      field("Conditions", ["conditions"], { type: "text" }),
      field("Feedback", ["feedback"], {
        type: "textarea",
        span: 2,
        rows: 3,
        placeholder: "Grip, weather, tire behavior, or driver notes.",
      }),
      field("Wheelbase (mm)", ["wheelbase_mm"], { type: "number" }),
    ],
  },
];

const PRESSURE_GROUPS = [
  {
    title: "Core",
    fields: [
      field("Unit", ["pressures", "unit"], { type: "text", required: true, placeholder: "psi" }),
      field("Mode", ["pressures", "mode"], { type: "text", placeholder: "cold or hot" }),
    ],
  },
  {
    title: "Cold Set",
    fields: [
      field("Front-Left", ["pressures", "cold", "fl"], { type: "number" }),
      field("Front-Right", ["pressures", "cold", "fr"], { type: "number" }),
      field("Rear-Left", ["pressures", "cold", "rl"], { type: "number" }),
      field("Rear-Right", ["pressures", "cold", "rr"], { type: "number" }),
    ],
  },
  {
    title: "Hot Set",
    fields: [
      field("Front-Left", ["pressures", "hot", "fl"], { type: "number" }),
      field("Front-Right", ["pressures", "hot", "fr"], { type: "number" }),
      field("Rear-Left", ["pressures", "hot", "rl"], { type: "number" }),
      field("Rear-Right", ["pressures", "hot", "rr"], { type: "number" }),
    ],
  },
];

const SUSPENSION_GROUPS = [
  {
    title: "Dampers",
    fields: [
      field("Rebound FL", ["suspension", "rebound_fl"], { type: "number" }),
      field("Rebound FR", ["suspension", "rebound_fr"], { type: "number" }),
      field("Rebound RL", ["suspension", "rebound_rl"], { type: "number" }),
      field("Rebound RR", ["suspension", "rebound_rr"], { type: "number" }),
      field("Bump FL", ["suspension", "bump_fl"], { type: "number" }),
      field("Bump FR", ["suspension", "bump_fr"], { type: "number" }),
      field("Bump RL", ["suspension", "bump_rl"], { type: "number" }),
      field("Bump RR", ["suspension", "bump_rr"], { type: "number" }),
    ],
  },
  {
    title: "Platform",
    fields: [
      field("Ride Height FL", ["suspension", "ride_height_fl"], { type: "number" }),
      field("Ride Height FR", ["suspension", "ride_height_fr"], { type: "number" }),
      field("Ride Height RL", ["suspension", "ride_height_rl"], { type: "number" }),
      field("Ride Height RR", ["suspension", "ride_height_rr"], { type: "number" }),
      field("Sway Bar Front", ["suspension", "sway_bar_f"], { type: "number" }),
      field("Sway Bar Rear", ["suspension", "sway_bar_r"], { type: "number" }),
      field("Wing Angle (deg)", ["suspension", "wing_angle_deg"], { type: "number" }),
    ],
  },
];

const ALIGNMENT_GROUPS = [
  {
    title: "Camber",
    fields: [
      field("Front-Left", ["alignment", "camber_fl"], { type: "number" }),
      field("Front-Right", ["alignment", "camber_fr"], { type: "number" }),
      field("Rear-Left", ["alignment", "camber_rl"], { type: "number" }),
      field("Rear-Right", ["alignment", "camber_rr"], { type: "number" }),
    ],
  },
  {
    title: "Toe / Caster",
    fields: [
      field("Toe Front", ["alignment", "toe_front"], { type: "number" }),
      field("Toe Rear", ["alignment", "toe_rear"], { type: "number" }),
      field("Caster FL", ["alignment", "caster_fl"], { type: "number" }),
      field("Caster FR", ["alignment", "caster_fr"], { type: "number" }),
    ],
  },
  {
    title: "Ride / Rake",
    fields: [
      field("Rake (mm)", ["alignment", "rake_mm"], { type: "number" }),
    ],
  },
];

const TEMPERATURE_GROUPS = [
  {
    title: "Front-Left",
    fields: [
      field("Outer", ["tire_temperatures", "fl_out"], { type: "number" }),
      field("Middle", ["tire_temperatures", "fl_mid"], { type: "number" }),
      field("Inner", ["tire_temperatures", "fl_in"], { type: "number" }),
    ],
  },
  {
    title: "Front-Right",
    fields: [
      field("Outer", ["tire_temperatures", "fr_out"], { type: "number" }),
      field("Middle", ["tire_temperatures", "fr_mid"], { type: "number" }),
      field("Inner", ["tire_temperatures", "fr_in"], { type: "number" }),
    ],
  },
  {
    title: "Rear-Left",
    fields: [
      field("Outer", ["tire_temperatures", "rl_out"], { type: "number" }),
      field("Middle", ["tire_temperatures", "rl_mid"], { type: "number" }),
      field("Inner", ["tire_temperatures", "rl_in"], { type: "number" }),
    ],
  },
  {
    title: "Rear-Right",
    fields: [
      field("Outer", ["tire_temperatures", "rr_out"], { type: "number" }),
      field("Middle", ["tire_temperatures", "rr_mid"], { type: "number" }),
      field("Inner", ["tire_temperatures", "rr_in"], { type: "number" }),
    ],
  },
];

const TIRE_HISTORY_GROUPS = [
  {
    title: "History",
    fields: [
      field("Set ID", ["tire_history", "set_id"], { type: "text" }),
      field("Compound", ["tire_history", "compound"], { type: "text" }),
      field("Batch", ["tire_history", "batch"], { type: "text" }),
      field("Condition", ["tire_history", "condition"], { type: "text" }),
      field("Heat Cycles", ["tire_history", "heat_cycles"], { type: "number" }),
      field("Wear %", ["tire_history", "wear_percent"], { type: "number" }),
      field("Stint Count", ["tire_history", "stint_count"], { type: "number" }),
      field("Last Used", ["tire_history", "last_used_at"], { type: "date" }),
      field("Notes", ["tire_history", "notes"], {
        type: "textarea",
        span: 2,
        rows: 3,
        placeholder: "How this tire set behaved over time.",
      }),
    ],
  },
];

const TIRE_INVENTORY_GROUPS = [
  {
    title: "Inventory",
    fields: [
      field("Brand", ["tire_inventory", "brand"], { type: "text" }),
      field("Batch", ["tire_inventory", "batch"], { type: "text" }),
      field("Condition", ["tire_inventory", "condition"], { type: "text" }),
      field("Size", ["tire_inventory", "size"], { type: "text" }),
      field("Quantity", ["tire_inventory", "quantity"], { type: "number" }),
      field("Location", ["tire_inventory", "location"], { type: "text" }),
      field("Status", ["tire_inventory", "status"], { type: "text" }),
      field("Notes", ["tire_inventory", "notes"], {
        type: "textarea",
        span: 2,
        rows: 3,
        placeholder: "Inventory condition, storage notes, or follow-up actions.",
      }),
    ],
  },
];

const CATEGORY_SECTIONS = [
  {
    key: "seances",
    title: "SEANCES",
    subtitle: "Session details, timing, and driver feedback.",
    icon: NoteAltOutlinedIcon,
    groups: SEANCES_GROUPS,
  },
  {
    key: "pressures",
    title: "PRESSURES",
    subtitle: "Tire pressures by corner for cold and hot sets.",
    icon: TrackChangesOutlinedIcon,
    groups: PRESSURE_GROUPS,
  },
  {
    key: "suspensions",
    title: "SUSPENSIONS",
    subtitle: "Damper, platform, and aero-related settings.",
    icon: TimelineOutlinedIcon,
    groups: SUSPENSION_GROUPS,
  },
  {
    key: "alignment",
    title: "ALIGNMENT",
    subtitle: "Camber, toe, caster, and rake values.",
    icon: TrackChangesOutlinedIcon,
    groups: ALIGNMENT_GROUPS,
  },
  {
    key: "tire_temperatures",
    title: "TIRE_TEMPERATURES",
    subtitle: "Outer, middle, and inner readings for each corner.",
    icon: InfoOutlinedIcon,
    groups: TEMPERATURE_GROUPS,
  },
  {
    key: "tire_history",
    title: "TIRE_HISTORY",
    subtitle: "Wear, set usage, and compound history.",
    icon: HistoryIcon,
    groups: TIRE_HISTORY_GROUPS,
  },
  {
    key: "tire_inventory",
    title: "TIRE_INVENTORY",
    subtitle: "Inventory, batch, and storage details.",
    icon: AttachFileOutlinedIcon,
    groups: TIRE_INVENTORY_GROUPS,
  },
];

const SOURCE_FIELDS = [
  field("Driver Notes", ["raw_text"], {
    type: "textarea",
    span: 2,
    rows: 5,
    placeholder: "Driver notes, OCR text, or transcript summary.",
  }),
  field("Photo", ["image_url"], {
    type: "text",
    span: 2,
    placeholder: "Source image or media URL",
  }),
];

const SOURCE_SECTION = {
  key: "source_notes",
  title: "Source Notes",
  groups: [
    {
      title: "Source Notes",
      fields: SOURCE_FIELDS,
    },
  ],
};

const OVERVIEW_CONTEXT_FIELDS = [
  field("Submission ID", ["submissionId"], { type: "text" }),
  field("Driver", ["driver"], { type: "text" }),
  field("Vehicle", ["vehicle"], { type: "text" }),
  field("Event / Track", ["eventTrack"], { type: "text" }),
  field("Run Group", ["runGroup"], { type: "text" }),
  field("Submitted Via", ["source"], { type: "text" }),
  field("Confidence", ["confidence"], { type: "text" }),
  field("Created / Updated", ["timestamps"], { type: "text" }),
  field("Last Updated By", ["lastUpdatedBy"], { type: "text" }),
];

const OVERVIEW_CONTEXT_SECTION = {
  key: "overview_context",
  title: "Session Context",
  groups: [
    {
      title: "Session Context",
      fields: OVERVIEW_CONTEXT_FIELDS,
    },
  ],
};

const OVERVIEW_SECTION = {
  key: "overview",
  title: "Overview",
  groups: [
    SEANCES_GROUPS[0],
    {
      title: "Source Notes",
      fields: SOURCE_FIELDS,
    },
  ],
};

const SECTION_TITLES = {
  pressures: "Tire Pressures",
  suspensions: "Suspension",
  alignment: "Alignment",
  tire_temperatures: "Tire Temperatures",
  tire_history: "Tire History",
  tire_inventory: "Tire Inventory",
};

const FIELD_LABELS = {
  date: "Date",
  time: "Time",
  track: "Track",
  driver_id: "Driver",
  vehicle_id: "Vehicle",
  session_type: "Session Type",
  session_number: "Session Number",
  duration_min: "Duration",
  laps: "Laps",
  conditions: "Conditions",
  feedback: "Feedback",
  wheelbase_mm: "Wheelbase",
  raw_text: "Driver Notes",
  image_url: "Photo",
  pressures: "Tire Pressures",
  suspension: "Suspension",
  alignment: "Alignment",
  tire_temperatures: "Tire Temperatures",
  tire_history: "Tire History",
  tire_inventory: "Tire Inventory",
  run_group: "Run Group",
};

const TAB_CONFIG = [
  { key: "overview", label: "Overview", icon: ReceiptLongOutlinedIcon },
  { key: "setup", label: "Setup Data", icon: TrackChangesOutlinedIcon },
  { key: "source", label: "Source Data", icon: DescriptionOutlinedIcon },
  { key: "validation", label: "Validation", icon: ErrorOutlineOutlinedIcon },
  { key: "history", label: "History", icon: TimelineOutlinedIcon },
];

const SETUP_SECTIONS = CATEGORY_SECTIONS.filter((section) => section.key !== "seances");

function HistoryIcon(props) {
  return <TimelineOutlinedIcon {...props} />;
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value ?? {}));

const toStoredAiSummaryEntry = (summary) => {
  if (!summary?.summary) {
    return null;
  }

  return {
    summary_id: summary.summaryId || null,
    generated_at: summary.generatedAt || new Date().toISOString(),
    summary: summary.summary,
    key_observations: Array.isArray(summary.keyObservations) ? summary.keyObservations : [],
    needs_review: Array.isArray(summary.needsReview) ? summary.needsReview : [],
    recommended_actions: Array.isArray(summary.recommendedActions) ? summary.recommendedActions : [],
    generated_by: summary.generatedBy || null,
    model: summary.model || null,
  };
};

const mergeAiSummaryIntoAnalysis = (analysis, summary) => {
  const entry = toStoredAiSummaryEntry(summary);
  if (!entry) {
    return cloneJson(analysis);
  }

  const existingAnalysis = cloneJson(analysis);
  const historySource = Array.isArray(summary.summaryHistory) ? summary.summaryHistory : [summary];
  const history = historySource.map(toStoredAiSummaryEntry).filter(Boolean);
  const nextHistory = history.length ? history : [entry];

  return {
    ...existingAnalysis,
    ai_summary_current: entry,
    ai_summary_history: nextHistory,
    ai_summary_count: nextHistory.length,
    ai_summary_last_generated_at: entry.generated_at,
    ai_summary_last_generated_by: entry.generated_by,
  };
};

const isFilled = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => isFilled(item));
  return String(value).trim() !== "";
};

const getValueAtPath = (source, path) =>
  path.reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), source);

const setValueAtPath = (source, path, nextValue) => {
  const next = cloneJson(source);
  let current = next;

  path.forEach((key, index) => {
    if (index === path.length - 1) {
      current[key] = nextValue;
      return;
    }

    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key];
  });

  return next;
};

const formatDisplayValue = (value, fieldType = "text") => {
  if (!isFilled(value)) return "Not set";
  if (fieldType === "textarea") return String(value);
  if (fieldType === "date") return formatDate(value);
  if (fieldType === "time") return String(value);
  if (fieldType === "datetime-local") return formatDateTime(value);
  return Array.isArray(value) ? value.join(" / ") : String(value);
};

const toInputValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value);
};

const normalizeStatus = (record) => {
  if (!record) {
    return { label: "Pending", tone: "warning" };
  }

  if (record.validationStateKey === "validated") {
    return { label: "Validated", tone: "success" };
  }

  if (record.validationStateKey === "failed") {
    return { label: "Rejected", tone: "danger" };
  }

  if (record.validationStateKey === "archived") {
    return { label: "Archived", tone: "neutral" };
  }

  return { label: "Pending", tone: "warning" };
};

const buildSectionStatus = (section, payload, record) => {
  const fields = section.groups.flatMap((group) => group.fields);
  const requiredMissing = fields.filter((item) => item.required && !isFilled(getValueAtPath(payload, item.path)));
  const presentCount = fields.filter((item) => isFilled(getValueAtPath(payload, item.path))).length;

  if (requiredMissing.length) {
    return {
      label: record?.validationSeverityKey === "failed" ? "Error" : "Missing Data",
      tone: record?.validationSeverityKey === "failed" ? "danger" : "warning",
      helper: `${requiredMissing.length} required field${requiredMissing.length === 1 ? "" : "s"} missing`,
    };
  }

  if (!presentCount) {
    return {
      label: "Missing Data",
      tone: "warning",
      helper: "Section has no recorded values yet",
    };
  }

  return {
    label: "Valid",
    tone: "success",
    helper: `${presentCount}/${fields.length} fields populated`,
  };
};

const normalizeAuditLogEntry = (entry, index) => {
  if (!entry) return null;

  if (typeof entry === "string") {
    return {
      id: `audit-string-${index}`,
      action: "Note",
      note: entry,
      timestamp: null,
      actor: "Owner",
      tone: "neutral",
    };
  }

  return {
    id: entry.id || `audit-${index}`,
    action: entry.action || entry.type || "Update",
    note: entry.note || entry.message || entry.description || "",
    timestamp: entry.timestamp || entry.created_at || entry.createdAt || entry.at || null,
      actor: entry.actor || entry.user || entry.by || "Owner",
    tone: entry.tone || "neutral",
  };
};

const buildAuditTimeline = (record, analysisResult = {}) => {
  const voiceSession = record?.voiceSession || record?.voice_session || null;
  const existing = Array.isArray(analysisResult.audit_log)
    ? analysisResult.audit_log.map(normalizeAuditLogEntry).filter(Boolean)
    : [];

  const fallback = [
    {
      action: "Created",
      note: "Submission entered the system.",
      timestamp: record?.createdAt || record?.submittedAt || null,
      actor: record?.sourceChannel || record?.sourceTypeLabel || "System",
      tone: "accent",
    },
    {
      action: "Processed",
      note: record?.auditSnippet || "Parser and validation pipeline completed.",
      timestamp: record?.processedAt || record?.updatedAt || null,
      actor: "Parser",
      tone: "info",
    },
    {
      action: "Reviewed",
      note: analysisResult.review_state ? `Review state: ${analysisResult.review_state}` : "No manual review recorded yet.",
      timestamp: analysisResult.reviewed_at || analysisResult.reviewedAt || null,
      actor: analysisResult.reviewed_by_name || analysisResult.reviewed_by_id || "Owner",
      tone: "neutral",
    },
    {
      action: "Updated",
      note: record?.updatedAt ? "Last record update saved." : "No update timestamp available.",
      timestamp: record?.updatedAt || null,
      actor: "System",
      tone: "neutral",
    },
  ];

  if (voiceSession) {
    fallback.unshift(
      {
        action: "Voice Captured",
        note: voiceSession.audioFileName ? `Stored ${voiceSession.audioFileName} for transcription.` : "Voice note audio stored for processing.",
        timestamp: voiceSession.uploadedAt || voiceSession.createdAt || record?.createdAt || null,
        actor: "Voice Capture",
        tone: "info",
      },
      {
        action: "Voice Transcribed",
        note:
          voiceSession.transcriptEditedText || voiceSession.transcriptText
            ? "OpenAI transcript available for review."
            : voiceSession.lastErrorMessage || "Transcription is pending or failed.",
        timestamp: voiceSession.transcribedAt || voiceSession.updatedAt || record?.processedAt || null,
        actor: "OpenAI",
        tone: voiceSession.status === "TRANSCRIPTION_FAILED" ? "danger" : "success",
      },
    );

    if (voiceSession.confirmedAt) {
      fallback.push({
        action: "Voice Confirmed",
        note: "Driver confirmed the transcript before final submission.",
        timestamp: voiceSession.confirmedAt,
        actor: "Driver",
        tone: "success",
      });
    }

    if (voiceSession.submittedAt) {
      fallback.push({
        action: "Voice Submitted",
        note: "Voice note finalized into the standard submission pipeline.",
        timestamp: voiceSession.submittedAt,
        actor: "Submission API",
        tone: "accent",
      });
    }
  }

  if (analysisResult.archived_at || analysisResult.archivedAt) {
    fallback.push({
      action: "Archived",
      note: "Submission archived for audit history.",
      timestamp: analysisResult.archived_at || analysisResult.archivedAt,
      actor: analysisResult.reviewed_by_name || "Owner",
      tone: "neutral",
    });
  }

  const merged = [...existing, ...fallback]
    .filter(Boolean)
    .sort((left, right) => {
      const rightTime = new Date(right.timestamp || 0).getTime();
      const leftTime = new Date(left.timestamp || 0).getTime();
      return rightTime - leftTime;
    });

  return merged;
};

const normalizeAttachment = (attachment, index) => {
  if (!attachment) return null;

  const url =
    attachment.url ||
    attachment.href ||
    attachment.path ||
    attachment.file_url ||
    attachment.fileUrl ||
    attachment.image_url ||
    attachment.imageUrl ||
    attachment.download_url ||
    null;

  const type = String(attachment.type || attachment.mime_type || attachment.mimeType || "").toLowerCase();
  const kind = type.includes("audio")
    ? "audio"
    : type.includes("video")
      ? "video"
      : "image";

  return {
    id: attachment.id || attachment.key || `${kind}-${index}`,
    kind,
    url,
    name: attachment.name || attachment.filename || attachment.file_name || `Attachment ${index + 1}`,
    description: attachment.description || attachment.label || attachment.caption || "",
    voiceSessionId: attachment.voiceSessionId || attachment.voice_session_id || null,
    mimeType: attachment.mimeType || attachment.mime_type || null,
  };
};

const buildAttachmentList = (record, draftAnalysis = {}) => {
  const fromAnalysis = Array.isArray(draftAnalysis.attachments) ? draftAnalysis.attachments : [];
  const fromPayload = Array.isArray(record?.data?.attachments) ? record.data.attachments : [];
  const voiceSession = record?.voiceSession || record?.voice_session || null;

  const normalized = [
    ...(record?.imageUrl
      ? [
          {
            id: "primary-image",
            kind: "image",
            url: record.imageUrl,
            name: "Primary image",
            description: "Driver supplied media attachment.",
          },
        ]
      : []),
    ...(voiceSession?.audioDownloadUrl || voiceSession?.audio_storage_key
      ? [
          {
            id: `voice-audio-${voiceSession.id || "session"}`,
            kind: "audio",
            url: voiceSession.audioDownloadUrl || voiceSession.audio_download_url || null,
            voiceSessionId: voiceSession.id || voiceSession.voiceSessionId || null,
            name: voiceSession.audioFileName || "Voice recording",
            description: voiceSession.transcriptEditedText || voiceSession.transcriptText || "Driver voice capture.",
            mimeType: voiceSession.audioContentType || voiceSession.audio_content_type || "audio/webm",
          },
        ]
      : []),
    ...fromAnalysis.map(normalizeAttachment),
    ...fromPayload.map(normalizeAttachment),
  ]
    .filter((item) => item && item.url)
    .reduce((items, item) => {
      if (items.some((existing) => existing.url === item.url)) {
        return items;
      }

      items.push(item);
      return items;
    }, []);

  return normalized;
};

const escapeTsvValue = (value) => String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();

const buildSubmissionExcel = ({ record, draftPayload, draftAnalysis, timeline, attachments }) => {
  const row = {
    "Submission ID": record.submissionId || formatEntityId("SUB", record.id),
    "Submission Status": normalizeStatus(record).label,
    "Review State": record.reviewStateLabel || "-",
    "Validation State": record.validationStateLabel || "-",
    "Source Type": record.sourceTypeLabel || "-",
    "Voice Status": record.voiceStatus || "-",
    "Voice Review": record.voiceValidationStatus || "-",
    "Voice Session ID": record.voiceSessionId || "",
    "OpenAI Request ID": record.voiceSession?.openaiRequestId || record.voiceSession?.deepgramRequestId || "",
    "Voice Transcript": record.voiceTranscript || "",
    "Voice Confidence": record.confidenceLabel || "",
    "Voice Audio File": record.voiceAudioFileName || "",
    "Voice Audio Duration": record.voiceAudioDurationLabel || "",
    Driver: getSubmissionDriverLabel(record),
    Vehicle: getSubmissionVehicleLabel(record),
    Event: getSubmissionEventLabel(record),
    Track: getSubmissionTrackLabel(record),
    RawText: record.rawText || "",
    Comments: draftAnalysis.admin_comment || draftAnalysis.comments || "",
    Payload: JSON.stringify(draftPayload ?? {}, null, 2),
    Analysis: JSON.stringify(draftAnalysis ?? {}, null, 2),
    AuditLog: JSON.stringify(timeline ?? [], null, 2),
    Attachments: JSON.stringify(attachments ?? [], null, 2),
    CreatedAt: record.createdAt || "",
    UpdatedAt: record.updatedAt || "",
  };

  const headers = Object.keys(row);
  const values = headers.map((header) => escapeTsvValue(row[header]));
  return `${headers.map(escapeTsvValue).join("\t")}\n${values.join("\t")}\n`;
};

const humanizeFieldKey = (value) => {
  const key = String(value ?? "").trim();
  if (!key) {
    return "";
  }

  if (FIELD_LABELS[key]) {
    return FIELD_LABELS[key];
  }

  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatFieldList = (fields = []) =>
  fields
    .map((fieldName) => humanizeFieldKey(fieldName))
    .filter(Boolean)
    .join(", ");

const getSectionDisplayTitle = (sectionKey) => {
  if (sectionKey === "seances") {
    return "Overview";
  }

  return SECTION_TITLES[sectionKey] || humanizeFieldKey(sectionKey);
};

const normalizeComparableValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item)).join("|");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value).trim();
};

const hasValueChanged = (left, right) => normalizeComparableValue(left) !== normalizeComparableValue(right);

const buildValidationIssueRows = (record) => {
  const rows = [];
  const missingFields = Array.isArray(record?.missingFields) ? record.missingFields : [];
  const failedFields = Array.isArray(record?.failedFields) ? record.failedFields : [];
  const structuredWarnings = Array.isArray(record?.structuredWarnings) ? record.structuredWarnings : [];

  if (missingFields.length) {
    rows.push({
      key: "missing-fields",
      issue: "Missing fields",
      section: "Overview",
      recommendedFix: `Fill in ${formatFieldList(missingFields)}.`,
      statusLabel: "Needs attention",
      tone: "warning",
    });
  }

  if (failedFields.length) {
    rows.push({
      key: "failed-fields",
      issue: "Failed fields",
      section: "Validation",
      recommendedFix: `Review ${formatFieldList(failedFields)} and save the corrected values.`,
      statusLabel: "Invalid",
      tone: "danger",
    });
  }

  if (record?.duplicateDetection?.isDuplicate) {
    rows.push({
      key: "duplicate-detection",
      issue: "Duplicate submission",
      section: "Validation",
      recommendedFix: record.duplicateDetection.message || "Confirm this session is not a duplicate before saving.",
      statusLabel: "Needs attention",
      tone: "warning",
    });
  }

  if (record?.driverVehicleMismatch) {
    rows.push({
      key: "driver-vehicle",
      issue: "Driver / vehicle mismatch",
      section: "Overview",
      recommendedFix: "Make sure the selected vehicle belongs to the selected driver.",
      statusLabel: "Invalid",
      tone: "danger",
    });
  }

  if (record?.trackNormalizationWarning) {
    rows.push({
      key: "track-normalization",
      issue: "Track normalization",
      section: "Overview",
      recommendedFix: "Verify the event track and confirm the session is linked to the correct circuit.",
      statusLabel: "Partial",
      tone: "warning",
    });
  }

  if (record?.runGroupNormalizationWarning) {
    rows.push({
      key: "run-group-normalization",
      issue: "Run group normalization",
      section: "Overview",
      recommendedFix: "Confirm the run group text from the event and save the normalized value.",
      statusLabel: "Partial",
      tone: "warning",
    });
  }

  if (structuredWarnings.length) {
    rows.push({
      key: "structured-normalization",
      issue: "Structured normalization",
      section: "Source Data",
      recommendedFix: "Review the structured ingest warnings before approving the final payload.",
      statusLabel: "Partial",
      tone: "warning",
    });
  }

  if (record?.confidence !== null && record?.confidence !== undefined && record.confidence < 80) {
    rows.push({
      key: "confidence",
      issue: "Confidence score",
      section: "Source Data",
      recommendedFix: `Confidence is ${record.confidenceLabel}. Recheck the raw source before saving.`,
      statusLabel: "Needs attention",
      tone: "warning",
    });
  }

  if (!rows.length) {
    rows.push({
      key: "clean",
      issue: "No blocking issues",
      section: "Validation",
      recommendedFix: "The current session data looks consistent.",
      statusLabel: "Complete",
      tone: "success",
    });
  }

  return rows;
};

const DownloadLink = ({ attachment }) => {
  if (!attachment?.url || (attachment.kind === "audio" && attachment.voiceSessionId)) {
    return null;
  }

  return (
    <a
      className="fleet-btn fleet-btn-secondary submission-detail-attachment-link"
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
    >
      <DownloadOutlinedIcon fontSize="inherit" />
      Download
    </a>
  );
};

const SectionHeader = ({ icon: Icon, eyebrow, title, description, meta }) => (
  <div className="submission-detail-section-head">
    <div className="submission-section-heading">
      <span className="submission-section-eyebrow">
        {Icon ? <Icon fontSize="inherit" /> : null}
        {eyebrow}
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>

    {meta ? <div className="submission-detail-section-meta">{meta}</div> : null}
  </div>
);

const InputField = ({
  field,
  source,
  isEditing,
  onChange,
  hideLabel = false,
  ariaLabel = "",
  className = "",
}) => {
  if (!field) {
    return null;
  }

  const inputId = `submission-edit-${field.path.join("-")}`;
  const value = getValueAtPath(source, field.path);
  const displayValue = formatDisplayValue(value, field.type);
  const fullWidth = field.span === 2;
  const wrapperClass = hideLabel
    ? `submission-edit-inline-cell${fullWidth ? " submission-detail-field-span-2" : ""}${className ? ` ${className}` : ""}`
    : `submission-detail-field${fullWidth ? " submission-detail-field-span-2" : ""}${className ? ` ${className}` : ""}`;
  const controlClass = hideLabel
    ? "submission-detail-input submission-edit-input submission-edit-input-inline"
    : "submission-detail-input submission-edit-input";
  const textAreaClass = hideLabel
    ? "submission-detail-input submission-detail-textarea submission-edit-input submission-edit-textarea"
    : "submission-detail-input submission-detail-textarea submission-edit-input submission-edit-textarea";
  const labelText = ariaLabel || field.label;

  const control = isEditing ? (
    field.type === "textarea" ? (
      <textarea
        id={inputId}
        className={textAreaClass}
        rows={field.rows || 3}
        placeholder={field.placeholder || ""}
        value={toInputValue(value)}
        aria-label={hideLabel ? labelText : undefined}
        onChange={(event) => onChange(field.path, event.target.value)}
      />
    ) : field.options ? (
      <select
        id={inputId}
        className={controlClass}
        value={toInputValue(value)}
        aria-label={hideLabel ? labelText : undefined}
        onChange={(event) => onChange(field.path, event.target.value)}
      >
        <option value="">Not set</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={inputId}
        className={controlClass}
        type={field.type || "text"}
        inputMode={field.type === "number" ? "decimal" : undefined}
        placeholder={field.placeholder || ""}
        value={toInputValue(value)}
        aria-label={hideLabel ? labelText : undefined}
        onChange={(event) => onChange(field.path, event.target.value)}
      />
    )
  ) : (
    <div className={`submission-detail-field-value${field.type === "textarea" ? " submission-detail-field-value-block" : ""}`}>
      {displayValue}
    </div>
  );

  if (hideLabel) {
    return <div className={wrapperClass}>{control}</div>;
  }

  return (
    <label className={wrapperClass} htmlFor={inputId}>
      <span className="submission-detail-field-label">
        {field.label}
        {field.required ? <span className="required-marker">*</span> : null}
      </span>
      {control}
      {field.help ? <span className="submission-detail-field-help">{field.help}</span> : null}
    </label>
  );
};

const FieldGridCard = ({ section, source, isEditing, onChange, record, title, description, icon: Icon }) => {
  if (!section) {
    return null;
  }

  const sectionStatus = buildSectionStatus(section, source, record);
  const fields = section.groups.flatMap((group) => group.fields || []);
  const cardTitle = title || getSectionDisplayTitle(section.key);
  const cardDescription = description || section.subtitle || "";

  return (
    <section className="submission-section submission-detail-section-card">
      <SectionHeader
        icon={Icon || section.icon}
        eyebrow={cardTitle}
        title={cardTitle}
        description={cardDescription}
        meta={
          <>
            <StatusBadge label={sectionStatus.label} tone={sectionStatus.tone} title={sectionStatus.helper} />
            <span className="submission-detail-section-score">{sectionStatus.helper}</span>
          </>
        }
      />

      <div className="submission-detail-field-grid submission-detail-field-grid-overview">
        {fields.map((item) => (
          <InputField
            key={`${section.key}-${item.path.join(".")}`}
            field={item}
            source={source}
            isEditing={isEditing}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
};

const MatrixSectionCard = ({ section, source, isEditing, onChange, record }) => {
  if (!section) {
    return null;
  }

  const sectionStatus = buildSectionStatus(section, source, record);
  const title = getSectionDisplayTitle(section.key);
  const description = section.subtitle || "";

  const renderFieldGrid = (fields = [], columns = 2) => {
    if (!fields.length) {
      return null;
    }

    return (
      <div
        className="submission-detail-field-grid submission-edit-inline-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {fields.map((item) => (
          <InputField
            key={`${section.key}-${item.path.join(".")}`}
            field={item}
            source={source}
            isEditing={isEditing}
            onChange={onChange}
          />
        ))}
      </div>
    );
  };

  let leadingFields = [];
  let trailingFields = [];
  let rows = [];
  let columns = [];

  if (section.key === "pressures") {
    const coreFields = section.groups[0]?.fields || [];
    const coldFields = section.groups[1]?.fields || [];
    const hotFields = section.groups[2]?.fields || [];

    leadingFields = coreFields;
    columns = ["Cold", "Hot"];
    rows = [
      { label: "FL", fields: [coldFields[0], hotFields[0]] },
      { label: "FR", fields: [coldFields[1], hotFields[1]] },
      { label: "RL", fields: [coldFields[2], hotFields[2]] },
      { label: "RR", fields: [coldFields[3], hotFields[3]] },
    ];
  } else if (section.key === "suspensions") {
    const damperFields = section.groups[0]?.fields || [];
    const platformFields = section.groups[1]?.fields || [];

    columns = ["FL", "FR", "RL", "RR"];
    rows = [
      { label: "Rebound", fields: damperFields.slice(0, 4) },
      { label: "Bump", fields: damperFields.slice(4, 8) },
      { label: "Ride Height", fields: platformFields.slice(0, 4) },
    ];
    trailingFields = platformFields.slice(4);
  } else if (section.key === "alignment") {
    const camberFields = section.groups[0]?.fields || [];
    const toeCasterFields = section.groups[1]?.fields || [];
    const rideFields = section.groups[2]?.fields || [];

    columns = ["FL", "FR", "RL", "RR"];
    rows = [{ label: "Camber", fields: camberFields }];
    trailingFields = [...toeCasterFields, ...rideFields];
  } else if (section.key === "tire_temperatures") {
    const frontLeft = section.groups[0]?.fields || [];
    const frontRight = section.groups[1]?.fields || [];
    const rearLeft = section.groups[2]?.fields || [];
    const rearRight = section.groups[3]?.fields || [];

    columns = ["Inner", "Middle", "Outer"];
    rows = [
      { label: "FL", fields: [frontLeft[2], frontLeft[1], frontLeft[0]] },
      { label: "FR", fields: [frontRight[2], frontRight[1], frontRight[0]] },
      { label: "RL", fields: [rearLeft[2], rearLeft[1], rearLeft[0]] },
      { label: "RR", fields: [rearRight[2], rearRight[1], rearRight[0]] },
    ];
  }

  return (
    <section className="submission-section submission-detail-section-card">
      <SectionHeader
        icon={section.icon}
        eyebrow={title}
        title={title}
        description={description}
        meta={
          <>
            <StatusBadge label={sectionStatus.label} tone={sectionStatus.tone} title={sectionStatus.helper} />
            <span className="submission-detail-section-score">{sectionStatus.helper}</span>
          </>
        }
      />

      {leadingFields.length ? renderFieldGrid(leadingFields, 2) : null}

      <div className="submission-edit-table-wrap">
        <table className="submission-edit-table">
          <thead>
            <tr>
              <th scope="col">{section.key === "pressures" ? "Position" : "Setting"}</th>
              {columns.map((column) => (
                <th scope="col" key={`${section.key}-${column}`}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${section.key}-${row.label}`}>
                <th scope="row">{row.label}</th>
                {row.fields.map((fieldDef, index) => (
                  <td key={`${section.key}-${row.label}-${fieldDef?.path?.join(".") || index}`}>
                    {fieldDef ? (
                      <InputField
                        field={fieldDef}
                        source={source}
                        isEditing={isEditing}
                        onChange={onChange}
                        hideLabel
                        ariaLabel={`${row.label} ${columns[index]}`}
                      />
                    ) : (
                      <span className="submission-edit-table-value">Not set</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {trailingFields.length ? renderFieldGrid(trailingFields, trailingFields.length > 2 ? 3 : 2) : null}
    </section>
  );
};

const TimelineItem = ({ item }) => {
  const toneClass =
    item.tone === "success"
      ? "success"
      : item.tone === "danger"
        ? "danger"
        : item.tone === "info"
          ? "info"
          : item.tone === "accent"
            ? "accent"
            : "neutral";

  return (
    <li className={`submission-detail-timeline-item submission-detail-timeline-${toneClass}`}>
      <div className="submission-detail-timeline-top">
        <div>
          <div className="submission-detail-timeline-action">{item.action}</div>
          <div className="submission-detail-timeline-note">{item.note || "No note available."}</div>
        </div>
        {item.timestamp ? (
          <StatusBadge label={formatDateTime(item.timestamp)} tone="neutral" />
        ) : null}
      </div>
      <div className="submission-detail-timeline-meta">{item.actor || "System"}</div>
    </li>
  );
};

const AttachmentCard = ({ attachment }) => {
  const isAudio = attachment.kind === "audio";
  const isImage = attachment.kind === "image";
  const isVideo = attachment.kind === "video";

  if (!attachment?.url) {
    return null;
  }

  return (
    <article className="submission-detail-attachment-card">
      <div className="submission-detail-attachment-header">
        <div>
          <div className="submission-detail-attachment-name">{attachment.name}</div>
          {attachment.description ? (
            <div className="submission-detail-attachment-description">{attachment.description}</div>
          ) : null}
        </div>
        <StatusBadge label={attachment.kind.toUpperCase()} tone={isAudio ? "info" : "accent"} />
      </div>

      {isImage ? (
        <Image
          className="submission-detail-media"
          src={attachment.url}
          alt={attachment.name}
          width={1200}
          height={800}
          unoptimized
        />
      ) : isAudio ? (
        <ProtectedAudioPlayer
          className="submission-detail-audio-player"
          voiceSessionId={attachment.voiceSessionId || null}
          src={attachment.url}
          downloadName={attachment.name || "voice-note"}
        />
      ) : isVideo ? (
        <video className="submission-detail-media" controls src={attachment.url} />
      ) : (
        <div className="submission-detail-media-placeholder">
          <VisibilityOutlinedIcon fontSize="inherit" />
          <span>Preview not available.</span>
        </div>
      )}

      <div className="submission-detail-attachment-actions">
        <DownloadLink attachment={attachment} />
      </div>
    </article>
  );
};

const CompletionRow = ({ label, status, detail }) => (
  <div className="submission-edit-completeness-row">
    <span className="submission-edit-completeness-label">{label}</span>
    <div className={`submission-edit-completion submission-edit-completion-${status.tone}`}>
      <span className="submission-edit-completion-dot" />
      <span className="submission-edit-completion-value">{status.label}</span>
      {detail ? <span className="submission-edit-completion-detail">{detail}</span> : null}
    </div>
  </div>
);

export default function SubmissionDetailScreen({
  submission,
  allSubmissions = [],
  previewMessage = "",
  previewTone = "warning",
  initialEditMode = false,
}) {
  const router = useRouter();
  const { user } = useAuth();

  const [liveSubmission, setLiveSubmission] = useState(submission);
  const [isEditing, setIsEditing] = useState(Boolean(initialEditMode));
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [activeTab, setActiveTab] = useState("setup");
  const [draftPayload, setDraftPayload] = useState(() =>
    cloneJson(submission?.payload || submission?.data || {}),
  );
  const [draftSource, setDraftSource] = useState(() => ({
    raw_text: submission?.raw_text || submission?.rawText || "",
    image_url: submission?.image_url || submission?.imageUrl || "",
  }));
  const [draftAnalysis, setDraftAnalysis] = useState(() =>
    cloneJson(submission?.analysis_result || submission?.analysisResult || {}),
  );
  const [draftComment, setDraftComment] = useState(() =>
    submission?.analysis_result?.admin_comment ||
    submission?.analysisResult?.admin_comment ||
    submission?.analysis_result?.comments ||
    submission?.analysisResult?.comments ||
    "",
  );
  const [isAiSummaryOpen, setIsAiSummaryOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState(() =>
    normalizeStoredAiSummary(submission?.analysis_result || submission?.analysisResult || {}),
  );
  const [aiSummaryError, setAiSummaryError] = useState("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [isSavingAiSummaryToNotes, setIsSavingAiSummaryToNotes] = useState(false);
  const [savedNotesBaseline, setSavedNotesBaseline] = useState(null);

  const record = useMemo(
    () => buildSubmissionMonitorRecord(liveSubmission, allSubmissions),
    [allSubmissions, liveSubmission],
  );

  const basePayload = useMemo(
    () => cloneJson(record?.data || record?.payload || liveSubmission?.payload || {}),
    [liveSubmission?.payload, record],
  );
  const baseSource = useMemo(
    () => ({
      raw_text: record?.rawText || liveSubmission?.raw_text || liveSubmission?.rawText || "",
      image_url: record?.imageUrl || liveSubmission?.image_url || liveSubmission?.imageUrl || "",
    }),
    [liveSubmission?.image_url, liveSubmission?.imageUrl, liveSubmission?.rawText, liveSubmission?.raw_text, record],
  );
  const baseAnalysis = useMemo(
    () => cloneJson(record?.analysisResult || record?.analysis_result || liveSubmission?.analysis_result || {}),
    [liveSubmission?.analysis_result, record],
  );
  const baseComment = useMemo(
    () =>
      record?.analysisResult?.admin_comment ||
      record?.analysisResult?.comments ||
      record?.analysis_result?.admin_comment ||
      record?.analysis_result?.comments ||
      "",
    [record],
  );

  useEffect(() => {
    if (!record) {
      return;
    }

    setDraftPayload(cloneJson(record.data || record.payload || liveSubmission?.payload || {}));
    setDraftSource({
      raw_text: record.rawText || liveSubmission?.raw_text || liveSubmission?.rawText || "",
      image_url: record.imageUrl || liveSubmission?.image_url || liveSubmission?.imageUrl || "",
    });
    setDraftAnalysis(cloneJson(record.analysisResult || record.analysis_result || liveSubmission?.analysis_result || {}));
    setDraftComment(
      record.analysisResult?.admin_comment ||
        record.analysisResult?.comments ||
        record.analysis_result?.admin_comment ||
        record.analysis_result?.comments ||
        "",
    );
    setActiveTab("setup");
    setAiSummary(normalizeStoredAiSummary(record.analysisResult || record.analysis_result || liveSubmission?.analysis_result || {}));
    setAiSummaryError("");
    setSavedNotesBaseline(null);
    setNotice(null);
  }, [liveSubmission?.payload, liveSubmission?.analysis_result, liveSubmission?.raw_text, liveSubmission?.image_url, liveSubmission?.rawText, liveSubmission?.imageUrl, record]);

  const workingAnalysis = useMemo(
    () => ({
      ...draftAnalysis,
      admin_comment: draftComment,
      comments: draftComment,
    }),
    [draftAnalysis, draftComment],
  );

  const workingRecord = useMemo(
    () => ({
      ...record,
      data: draftPayload,
      payload: draftPayload,
      rawText: draftSource.raw_text,
      raw_text: draftSource.raw_text,
      imageUrl: draftSource.image_url,
      image_url: draftSource.image_url,
      analysisResult: workingAnalysis,
      analysis_result: workingAnalysis,
    }),
    [draftPayload, draftSource.image_url, draftSource.raw_text, record, workingAnalysis],
  );

  const status = useMemo(() => normalizeStatus(record), [record]);
  const sourceKey = getSessionSourceKey(workingRecord);
  const sourceLabel = getSessionSourceLabel(workingRecord);
  const sourceTone = getSessionSourceTone(workingRecord);
  const sourceSubtext = getSessionSourceSubtext(workingRecord);
  const sourceHint = getSessionSourceLabelHint(workingRecord);
  const sourceBody = getSessionSourceBody(workingRecord);
  const sourceAttachment = getSessionSourceAttachment(workingRecord);
  const eventTrack = getSessionEventTrackLabel(workingRecord);
  const driverName = getSubmissionDriverLabel(workingRecord || submission || {});
  const vehicleName = getSubmissionVehicleLabel(workingRecord || submission || {});
  const submissionId = record?.submissionId || formatEntityId("SUB", record?.id);
  const runGroupLabel = getSessionRunGroupLabel(workingRecord);
  const notesSummary = getSessionNotesSummary(workingRecord);
  const lastUpdatedByLabel = getSessionLastUpdatedByLabel(workingRecord);
  const lastUpdatedLabel = formatDateTime(record?.updatedAt || record?.createdAt || record?.submittedAt || null);
  const createdLabel = formatDateTime(record?.createdAt || record?.submittedAt || null);
  const confidenceTone =
    record?.confidence === null || record?.confidence === undefined
      ? "neutral"
      : record.confidence >= 90
        ? "success"
        : record.confidence >= 80
          ? "warning"
          : "danger";

  const overviewSource = useMemo(
    () => ({
      ...draftPayload,
      raw_text: draftSource.raw_text,
      image_url: draftSource.image_url,
    }),
    [draftPayload, draftSource.image_url, draftSource.raw_text],
  );

  const overviewContextSource = useMemo(
    () => ({
      submissionId,
      driver: driverName,
      vehicle: vehicleName,
      eventTrack: [eventTrack.main, eventTrack.sub].filter(Boolean).join(" • "),
      runGroup: runGroupLabel,
      source: sourceLabel,
      confidence: record?.confidenceLabel || "Not available",
      timestamps: `${createdLabel || "Not available"} · ${lastUpdatedLabel || "Not available"}`,
      lastUpdatedBy: lastUpdatedByLabel,
    }),
    [
      createdLabel,
      driverName,
      eventTrack.main,
      eventTrack.sub,
      lastUpdatedByLabel,
      lastUpdatedLabel,
      record?.confidenceLabel,
      runGroupLabel,
      sourceLabel,
      submissionId,
      vehicleName,
    ],
  );

  const overviewStatus = useMemo(() => buildSectionStatus(OVERVIEW_SECTION, overviewSource, record), [overviewSource, record]);

  const setupSections = useMemo(() => SETUP_SECTIONS, []);
  const setupSummarySections = useMemo(
    () => setupSections.map((section) => ({ section, status: buildSectionStatus(section, draftPayload, record) })),
    [draftPayload, record, setupSections],
  );

  const trackedChangeCount = useMemo(() => {
    const overviewFields = [...SEANCES_GROUPS[0].fields, ...SOURCE_FIELDS];
    const setupFields = setupSections.flatMap((section) => section.groups.flatMap((group) => group.fields || []));

    const payloadChanges = [...overviewFields, ...setupFields].reduce(
      (count, item) =>
        count +
        (hasValueChanged(
          getValueAtPath(item.path[0] === "raw_text" || item.path[0] === "image_url" ? baseSource : basePayload, item.path),
          getValueAtPath(item.path[0] === "raw_text" || item.path[0] === "image_url" ? draftSource : draftPayload, item.path),
        )
          ? 1
          : 0),
      0,
    );

    const commentBaseline = savedNotesBaseline ?? baseComment;
    const commentChanged = hasValueChanged(commentBaseline, draftComment) ? 1 : 0;
    return payloadChanges + commentChanged;
  }, [baseComment, basePayload, baseSource, draftComment, draftPayload, draftSource, savedNotesBaseline, setupSections]);

  const isDirty = trackedChangeCount > 0;
  const attachmentList = useMemo(
    () => buildAttachmentList(workingRecord, workingAnalysis),
    [workingAnalysis, workingRecord],
  );
  const aiSummaryHistory = Array.isArray(aiSummary?.summaryHistory) ? aiSummary.summaryHistory : [];
  const auditTimeline = useMemo(
    () => buildAuditTimeline(workingRecord, workingAnalysis),
    [workingAnalysis, workingRecord],
  );
  const validationRows = useMemo(() => buildValidationIssueRows(record), [record]);
  const setupSummaryCards = useMemo(
    () =>
      setupSummarySections.map(({ section, status: sectionStatus }) => ({
        key: section.key,
        label: getSectionDisplayTitle(section.key),
        status: sectionStatus,
      })),
    [setupSummarySections],
  );

  const handleUpdatePayload = (path, value) => {
    setDraftPayload((current) => setValueAtPath(current, path, value));
  };

  const handleUpdateSource = (path, value) => {
    setDraftSource((current) => setValueAtPath(current, path, value));
  };

  const resetDraftState = () => {
    setDraftPayload(cloneJson(basePayload));
    setDraftSource(cloneJson(baseSource));
    setDraftAnalysis(cloneJson(baseAnalysis));
    setDraftComment(baseComment);
    setAiSummary(normalizeStoredAiSummary(baseAnalysis));
    setAiSummaryError("");
    setSavedNotesBaseline(null);
    setNotice(null);
    setActiveTab("setup");
  };

  const persistUpdate = async (updatePayload, successMessage, tone = "success") => {
    setIsSaving(true);

    try {
      const response = await updateSubmission(
        updatePayload.id || updatePayload._id || updatePayload.submissionId,
        updatePayload.updatePayload,
      );
      const updatedSubmission = response.submission || response.data || response;

      if (updatedSubmission) {
        setLiveSubmission(updatedSubmission);
        setNotice({ tone, message: successMessage });
        setIsEditing(false);
      } else {
        setNotice({ tone: "warning", message: successMessage });
      }
    } catch (error) {
      setNotice({
        tone: "error",
        message: getApiErrorMessage(error, "Unable to save session changes."),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!record) {
      return;
    }

    const nextAnalysis = cloneJson(workingAnalysis);
    nextAnalysis.audit_log = Array.isArray(nextAnalysis.audit_log) ? [...nextAnalysis.audit_log] : [];
    nextAnalysis.audit_log.push({
      id: `edited-${Date.now()}`,
      action: "Edited",
      note: "Session details were updated from the admin edit workspace.",
      actor: user?.name || user?.email || "Owner",
      timestamp: new Date().toISOString(),
      tone: "info",
    });
    nextAnalysis.last_edited_at = new Date().toISOString();
    nextAnalysis.last_edited_by = user?.name || user?.email || "Owner";

    await persistUpdate(
      {
        id: record.id,
        _id: record._id,
        submissionId: record.submissionId,
        updatePayload: {
          payload: draftPayload,
          raw_text: typeof draftSource.raw_text === "string" && draftSource.raw_text.trim() ? draftSource.raw_text.trim() : null,
          image_url: typeof draftSource.image_url === "string" && draftSource.image_url.trim() ? draftSource.image_url.trim() : null,
          analysis_result: nextAnalysis,
        },
      },
      "Session changes were saved.",
    );
  };

  const handleExport = () => {
    if (!record) {
      return;
    }

    const excel = buildSubmissionExcel({
      record: {
        ...workingRecord,
        rawText: draftSource.raw_text,
        imageUrl: draftSource.image_url,
      },
      draftPayload,
      draftAnalysis: workingAnalysis,
      timeline: auditTimeline,
      attachments: attachmentList,
    });

    const blob = new Blob([excel], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${submissionId || "submission"}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setNotice({ tone: "success", message: "Session exported as Excel." });
  };

  const handleBackToReview = () => {
    router.push("/admin/submission-review-dashboard");
  };

  const handleOpenSession = () => {
    if (!record) {
      return;
    }

    router.push(getSessionReportHref(record));
  };

  const handleEnterEditMode = () => {
    if (!record) {
      return;
    }

    setIsEditing(true);
    router.replace(getSessionReportHref(record, { edit: true }));
  };

  const handleCancelChanges = () => {
    resetDraftState();
    setIsEditing(false);
    if (record) {
      router.replace(getSessionReportHref(record));
    }
  };

  const handleAiSummary = async () => {
    if (!record) {
      return;
    }

    if (aiSummaryLoading) {
      return;
    }

    const targetSubmissionId = record.id || record._id || record.submissionId || getSubmissionId(record);
    if (!targetSubmissionId) {
      setAiSummaryError("Not enough session data is available to generate a useful summary.");
      setIsAiSummaryOpen(true);
      return;
    }

    setIsAiSummaryOpen(true);
    setAiSummaryError("");
    setAiSummaryLoading(true);

    try {
      const generatedSummary = await generateSessionAiSummary(targetSubmissionId);
      setAiSummary(generatedSummary);
      setDraftAnalysis((current) => mergeAiSummaryIntoAnalysis(current, generatedSummary));
      setNotice({ tone: "success", message: "AI summary generated for this session." });
      toast.success("Session summary generated.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not generate AI summary. Please try again.");
      setAiSummaryError(message);
      setNotice({ tone: "error", message });
      toast.error(message);
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const handleSaveAiSummaryToNotes = async (summaryText) => {
    if (!record || !summaryText || isSavingAiSummaryToNotes) {
      return;
    }

    const targetSubmissionId = record.id || record._id || record.submissionId || getSubmissionId(record);
    if (!targetSubmissionId) {
      toast.error("Could not save summary to notes.");
      return;
    }

    setIsSavingAiSummaryToNotes(true);

    try {
      const existingComment = String(draftComment || "").trim();
      const nextComment = existingComment
        ? `${existingComment}\n\n${summaryText.trim()}`
        : summaryText.trim();
      const nextAnalysis = mergeAiSummaryIntoAnalysis({
        ...(workingAnalysis || {}),
        admin_comment: nextComment,
        comments: nextComment,
        ai_summary_last_saved_to_notes_at: new Date().toISOString(),
        ai_summary_last_saved_to_notes_by: user?.name || user?.email || "Owner",
      }, aiSummary);

      await updateSubmission(targetSubmissionId, { analysis_result: nextAnalysis });
      setDraftAnalysis(nextAnalysis);
      setDraftComment(nextComment);
      setSavedNotesBaseline(nextComment);
      setNotice({ tone: "success", message: "Summary saved to notes." });
      toast.success("Summary saved to notes.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not save summary to notes.");
      setNotice({ tone: "error", message });
      toast.error(message);
    } finally {
      setIsSavingAiSummaryToNotes(false);
    }
  };

  if (!record) {
    return (
      <div className="submission-detail-empty-shell">
        <EmptyStatePanel
          icon={DescriptionOutlinedIcon}
          title="Submission not available"
          description="The requested submission could not be loaded."
        />
      </div>
    );
  }

  const overviewCardFields = SEANCES_GROUPS[0].fields || [];
  const setupSectionsToRender = setupSections;

  return (
    <div className="submission-detail-page submission-edit-page">
      <div className="submission-detail-orb submission-detail-orb-one" />
      <div className="submission-detail-orb submission-detail-orb-two" />

      <div className="submission-detail-shell submission-edit-shell">
        <header className="submission-detail-hero submission-edit-hero">
          <div className="submission-edit-hero-top">
            <button
              type="button"
              className="fleet-btn fleet-btn-secondary"
              onClick={handleBackToReview}
            >
              <ArrowBackOutlinedIcon fontSize="inherit" />
              Back to Session Review
            </button>

            <button
              type="button"
              className="fleet-btn fleet-btn-primary"
              onClick={handleExport}
            >
              <DownloadOutlinedIcon fontSize="inherit" />
              Export Excel
            </button>
          </div>

          <div className="submission-detail-hero-copy">
            <p className="submission-detail-eyebrow">{isEditing ? "Edit Session" : "Session Details"}</p>
            <h1>{submissionId}</h1>
            <p className="submission-detail-subtitle submission-edit-identity-line">
              {[driverName, vehicleName, eventTrack.main || trackName || runGroupLabel].filter(Boolean).join(" • ")}
            </p>
            {eventTrack.sub && eventTrack.sub !== eventTrack.main ? (
              <p className="submission-edit-subline">{eventTrack.sub}</p>
            ) : null}

            <div className="submission-detail-badge-row">
              <StatusBadge label={sourceLabel} tone={sourceTone} title={sourceHint} />
              <StatusBadge label={lastUpdatedLabel || "Unknown"} tone="neutral" title="Last updated" />
              {record.confidenceLabel ? (
                <StatusBadge label={record.confidenceLabel} tone={confidenceTone} title="Confidence" />
              ) : null}
            </div>
          </div>

          <nav className="submission-edit-tabs" aria-label="Edit session sections">
            {TAB_CONFIG.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`submission-edit-tab${isActive ? " submission-edit-tab-active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon fontSize="inherit" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </header>

        {notice ? (
          <div className={`submission-monitor-notice submission-monitor-notice-${notice.tone}`}>
            {notice.message}
          </div>
        ) : null}

        {previewMessage ? (
          <div className={`submission-monitor-notice submission-monitor-notice-${previewTone}`}>
            {previewMessage}
          </div>
        ) : null}

        <div className="submission-detail-layout submission-edit-layout">
          <main className="submission-detail-main submission-edit-main">
            {activeTab === "overview" ? (
              <div className="submission-edit-tab-stack">
                <FieldGridCard
                  section={OVERVIEW_SECTION}
                  title="Session Details"
                  description="Basic session metadata and editable setup details."
                  source={overviewSource}
                  record={record}
                  isEditing={isEditing}
                  onChange={handleUpdatePayload}
                  fields={overviewCardFields}
                  icon={ReceiptLongOutlinedIcon}
                />

                <FieldGridCard
                  section={SOURCE_SECTION}
                  title="Driver Notes & Photo"
                  description="Keep the original submission notes and the source image link together."
                  source={draftSource}
                  record={record}
                  isEditing={isEditing}
                  onChange={handleUpdateSource}
                  icon={DescriptionOutlinedIcon}
                />

                <FieldGridCard
                  section={OVERVIEW_CONTEXT_SECTION}
                  title="Session Context"
                  description="Read-only context pulled from the current submission and event record."
                  source={overviewContextSource}
                  record={record}
                  isEditing={false}
                  onChange={() => {}}
                  icon={InfoOutlinedIcon}
                />
              </div>
            ) : null}

            {activeTab === "setup" ? (
              <div className="submission-edit-tab-stack">
                {setupSectionsToRender.map((section) => {
                  if (section.key === "tire_history" || section.key === "tire_inventory") {
                    return (
                      <FieldGridCard
                        key={section.key}
                        section={section}
                        title={getSectionDisplayTitle(section.key)}
                        description={section.subtitle}
                        source={draftPayload}
                        record={record}
                        isEditing={isEditing}
                        onChange={handleUpdatePayload}
                        icon={section.icon}
                      />
                    );
                  }

                  return (
                    <MatrixSectionCard
                      key={section.key}
                      section={section}
                      source={draftPayload}
                      isEditing={isEditing}
                      onChange={handleUpdatePayload}
                      record={record}
                    />
                  );
                })}
              </div>
            ) : null}

            {activeTab === "source" ? (
              <div className="submission-edit-tab-stack">
                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={DescriptionOutlinedIcon}
                    eyebrow="Source Data"
                    title="Source Context"
                    description="Reference information from the original submission source."
                    meta={
                      <>
                        <StatusBadge label={sourceLabel} tone={sourceTone} title={sourceHint} />
                        {record.confidenceLabel ? (
                          <StatusBadge label={record.confidenceLabel} tone={confidenceTone} title="Confidence" />
                        ) : null}
                      </>
                    }
                  />

                  <div className="submission-detail-admin-note">
                    <div className="submission-detail-admin-note-header">
                      <div>
                        <div className="submission-detail-group-title">{sourceSubtext}</div>
                        <p className="submission-detail-group-copy">{sourceHint}</p>
                      </div>
                      {sourceAttachment ? (
                        <a
                          className="fleet-btn fleet-btn-secondary"
                          href={sourceAttachment.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <OpenInNewOutlinedIcon fontSize="inherit" />
                          {sourceAttachment.label}
                        </a>
                      ) : null}
                    </div>

                    <pre className="submission-code-block submission-detail-raw-code submission-edit-source-code">
                      {sourceBody || "No source content is available for this session."}
                    </pre>
                  </div>
                </section>

                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={ImageOutlinedIcon}
                    eyebrow="Source Media"
                    title="Media Preview"
                    description="Original photo or voice media captured with the submission."
                    meta={
                      <>
                        {record.voiceStatus ? (
                          <StatusBadge label={record.voiceStatus} tone={record.voiceStatus === "TRANSCRIPTION_FAILED" ? "danger" : "info"} />
                        ) : null}
                        {record.voiceAudioDurationLabel ? (
                          <StatusBadge label={record.voiceAudioDurationLabel} tone="neutral" />
                        ) : null}
                      </>
                    }
                  />

                  {record.voiceSession ? (
                    <ProtectedAudioPlayer
                      className="submission-detail-audio-player"
                      voiceSessionId={record.voiceSessionId || record.voiceSession?.id || null}
                      src={record.voiceAudioDownloadUrl || record.voiceSession?.audioDownloadUrl || null}
                      downloadName={record.voiceAudioFileName || "voice-note"}
                    />
                  ) : draftSource.image_url ? (
                    <Image
                      className="submission-proof-image submission-detail-preview-image"
                      src={draftSource.image_url}
                      alt="Submission source image"
                      width={1200}
                      height={800}
                      unoptimized
                    />
                  ) : (
                    <div className="submission-image-empty">
                      <ImageOutlinedIcon fontSize="inherit" />
                      <span>No source image or audio preview available.</span>
                    </div>
                  )}
                </section>

                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={InfoOutlinedIcon}
                    eyebrow="Source Metadata"
                    title="Technical Details"
                    description="Metadata retained for tracing and troubleshooting the original source."
                  />

                  <div className="submission-detail-storage-grid">
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Source Type</p>
                      <p className="submission-kv-value">{sourceLabel}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Source Channel</p>
                      <p className="submission-kv-value">{workingRecord.sourceChannel || sourceLabel}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Parser Version</p>
                      <p className="submission-kv-value">{workingRecord.parserVersion || "Not available"}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Submitted</p>
                      <p className="submission-kv-value">
                        {formatDateTime(workingRecord.submittedAt || workingRecord.createdAt || workingRecord.updatedAt)}
                      </p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Last Updated By</p>
                      <p className="submission-kv-value">{lastUpdatedByLabel}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Notes Preview</p>
                      <p className="submission-kv-value">{notesSummary}</p>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            {activeTab === "validation" ? (
              <div className="submission-edit-tab-stack">
                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={ErrorOutlineOutlinedIcon}
                    eyebrow="Validation"
                    title="Validation Summary"
                    description="Review the key issues before saving or handing the session off."
                    meta={
                      <>
                        <StatusBadge label={record.validationStateLabel} tone={record.validationStateTone} />
                        <StatusBadge label={record.syncStateLabel} tone={record.syncStateTone} />
                        <StatusBadge label={record.structuredStatusLabel} tone={record.structuredStatusTone} />
                      </>
                    }
                  />

                  <div className={`submission-alert submission-alert-${record.validationStateTone}`}>
                    <div className="submission-alert-title">
                      {record.validationMessages.length ? (
                        <ErrorOutlineOutlinedIcon fontSize="small" />
                      ) : (
                        <CheckCircleOutlineOutlinedIcon fontSize="small" />
                      )}
                      {record.validationMessages.length ? "Needs attention" : "Complete"}
                    </div>

                    {record.validationMessages.length ? (
                      <ul className="submission-alert-list">
                        {record.validationMessages.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    ) : null}

                    <p className="submission-alert-copy">{record.recommendation}</p>
                  </div>

                  <div className="submission-detail-issue-grid">
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Missing Fields</p>
                      <p className="submission-issue-value">
                        {record.missingFields.length ? formatFieldList(record.missingFields) : "None"}
                      </p>
                    </div>
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Failed Fields</p>
                      <p className="submission-issue-value">
                        {record.failedFields.length ? formatFieldList(record.failedFields) : "None"}
                      </p>
                    </div>
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Duplicate Detection</p>
                      <p className="submission-issue-value">
                        {record.duplicateDetection.message || "No duplicate detected."}
                      </p>
                    </div>
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Driver / Vehicle</p>
                      <p className="submission-issue-value">
                        {record.driverVehicleMismatch ? "Mismatch detected" : "Aligned"}
                      </p>
                    </div>
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Track Normalization</p>
                      <p className="submission-issue-value">
                        {record.trackNormalizationWarning ? "Needs review" : "Aligned"}
                      </p>
                    </div>
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Run Group Normalization</p>
                      <p className="submission-issue-value">
                        {record.runGroupNormalizationWarning ? "Needs review" : "Aligned"}
                      </p>
                    </div>
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Structured Normalization</p>
                      <p className="submission-issue-value">
                        {record.structuredStatusLabel}
                        {record.structuredWarningCount
                          ? ` (${record.structuredWarningCount} warning${record.structuredWarningCount === 1 ? "" : "s"})`
                          : ""}
                      </p>
                    </div>
                    <div className="submission-issue-card">
                      <p className="submission-issue-label">Confidence</p>
                      <p className="submission-issue-value">{record.confidenceLabel || "Not available"}</p>
                    </div>
                  </div>
                </section>

                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={RuleOutlinedIcon}
                    eyebrow="Issue Table"
                    title="Recommended Fixes"
                    description="A simple checklist of what should be reviewed before the session is finalized."
                  />

                  <div className="submission-edit-issue-table-wrap">
                    <table className="submission-edit-issue-table">
                      <thead>
                        <tr>
                          <th scope="col">Issue</th>
                          <th scope="col">Section</th>
                          <th scope="col">Recommended Fix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validationRows.map((row) => (
                          <tr key={row.key}>
                            <td>
                              <div className="submission-edit-issue-cell">
                                <StatusBadge label={row.statusLabel} tone={row.tone} />
                                <span>{row.issue}</span>
                              </div>
                            </td>
                            <td>{row.section}</td>
                            <td>{row.recommendedFix}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={EditOutlinedIcon}
                    eyebrow="Owner Feedback"
                    title="Review Notes"
                    description="Add correction notes, validation remarks, or follow-up instructions."
                    meta={
                      <StatusBadge label={isEditing ? "Editing Enabled" : "Read Only"} tone={isEditing ? "info" : "neutral"} />
                    }
                  />

                  {isEditing ? (
                    <textarea
                      className="submission-detail-input submission-detail-textarea submission-detail-admin-textarea"
                      rows={5}
                      value={draftComment}
                      onChange={(event) => setDraftComment(event.target.value)}
                      placeholder="Leave correction notes for the driver or the next reviewer."
                    />
                  ) : (
                    <div className="submission-detail-admin-note-readonly">
                      {draftComment ? draftComment : "No owner feedback saved yet."}
                    </div>
                  )}
                </section>
              </div>
            ) : null}

            {activeTab === "history" ? (
              <div className="submission-edit-tab-stack">
                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={TimelineOutlinedIcon}
                    eyebrow="History"
                    title="Audit Trail"
                    description="Track when the record was created, processed, edited, approved, or archived."
                  />

                  <ul className="submission-detail-timeline">
                    {auditTimeline.length ? (
                      auditTimeline.map((item) => <TimelineItem key={item.id} item={item} />)
                    ) : (
                      <li className="submission-detail-timeline-empty">No audit entries available yet.</li>
                    )}
                  </ul>
                </section>

                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={AttachFileOutlinedIcon}
                    eyebrow="Attachments"
                    title="Media and Downloads"
                    description="Images and audio files uploaded with the submission."
                  />

                  {attachmentList.length ? (
                    <div className="submission-detail-attachment-grid">
                      {attachmentList.map((attachment) => (
                        <AttachmentCard key={attachment.id} attachment={attachment} />
                      ))}
                    </div>
                  ) : (
                    <div className="submission-image-empty">
                      <AttachFileOutlinedIcon fontSize="inherit" />
                      <span>No attachments stored for this submission.</span>
                    </div>
                  )}
                </section>

                <section className="submission-section submission-detail-section-card">
                  <SectionHeader
                    icon={InfoOutlinedIcon}
                    eyebrow="Storage Snapshot"
                    title="Backend Record Preview"
                    description="Confirm the metadata currently held by the API."
                  />

                  <div className="submission-detail-storage-grid">
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Created At</p>
                      <p className="submission-kv-value">{formatDateTime(record.createdAt || record.submittedAt)}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Updated At</p>
                      <p className="submission-kv-value">{formatDateTime(record.updatedAt || record.submittedAt)}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Status</p>
                      <p className="submission-kv-value">{status.label}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Review</p>
                      <p className="submission-kv-value">{record.reviewStateLabel}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Structured Status</p>
                      <p className="submission-kv-value">{record.structuredStatusLabel}</p>
                    </div>
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Structured Warnings</p>
                      <p className="submission-kv-value">{record.structuredWarningCount || 0}</p>
                    </div>
                    {record.voiceStatus ? (
                      <div className="submission-kv-card">
                        <p className="submission-kv-label">Voice Status</p>
                        <p className="submission-kv-value">{record.voiceStatus}</p>
                      </div>
                    ) : null}
                    {record.voiceValidationStatus ? (
                      <div className="submission-kv-card">
                        <p className="submission-kv-label">Voice Review</p>
                        <p className="submission-kv-value">{record.voiceValidationStatus}</p>
                      </div>
                    ) : null}
                    {record.confidenceLabel ? (
                      <div className="submission-kv-card">
                        <p className="submission-kv-label">Voice Confidence</p>
                        <p className="submission-kv-value">{record.confidenceLabel}</p>
                      </div>
                    ) : null}
                    {record.voiceAudioDurationLabel ? (
                      <div className="submission-kv-card">
                        <p className="submission-kv-label">Voice Duration</p>
                        <p className="submission-kv-value">{record.voiceAudioDurationLabel}</p>
                      </div>
                    ) : null}
                    <div className="submission-kv-card">
                      <p className="submission-kv-label">Last Updated By</p>
                      <p className="submission-kv-value">{lastUpdatedByLabel}</p>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
          </main>

          <aside className="submission-detail-sidebar submission-edit-sidebar">
            <section className="submission-section submission-detail-section-card submission-edit-summary-card">
              <SectionHeader
                icon={InfoOutlinedIcon}
                eyebrow="Session Summary"
                title="Session Summary"
                description="A quick read on the current session and the areas that still need attention."
                meta={<StatusBadge label={status.label} tone={status.tone} />}
              />

              <div className="submission-detail-storage-grid submission-edit-summary-grid">
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Driver</p>
                  <p className="submission-kv-value">{driverName}</p>
                </div>
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Vehicle</p>
                  <p className="submission-kv-value">{vehicleName}</p>
                </div>
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Event / Track</p>
                  <p className="submission-kv-value">
                    {[eventTrack.main, eventTrack.sub].filter(Boolean).join(" • ") || "Not available"}
                  </p>
                </div>
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Run Group</p>
                  <p className="submission-kv-value">{runGroupLabel}</p>
                </div>
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Submitted Via</p>
                  <p className="submission-kv-value">{sourceLabel}</p>
                </div>
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Last Updated</p>
                  <p className="submission-kv-value">{lastUpdatedLabel || "Not available"}</p>
                </div>
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Confidence</p>
                  <p className="submission-kv-value">{record.confidenceLabel || "Not available"}</p>
                </div>
                <div className="submission-kv-card">
                  <p className="submission-kv-label">Notes</p>
                  <p className="submission-kv-value">{notesSummary}</p>
                </div>
              </div>

              <div className="submission-edit-completeness-list">
                <CompletionRow label="Overview" status={overviewStatus} detail={overviewStatus.helper} />
                {setupSummaryCards.map((item) => (
                  <CompletionRow
                    key={item.key}
                    label={item.label}
                    status={item.status}
                    detail={item.status.helper}
                  />
                ))}
              </div>
            </section>

            <section className="submission-section submission-detail-section-card submission-edit-actions-card">
              <SectionHeader
                icon={AutoAwesomeOutlinedIcon}
                eyebrow="Actions"
                title="Quick Actions"
                description="Open, update, summarize, or save the current session."
                meta={
                  isDirty ? (
                    <span className="submission-edit-unsaved-chip">Unsaved: {trackedChangeCount}</span>
                  ) : aiSummaryHistory.length ? (
                    <StatusBadge label={`${aiSummaryHistory.length} AI summaries`} tone="success" />
                  ) : null
                }
              />

              <div className="submission-edit-actions-grid">
                <button
                  type="button"
                  className="submission-detail-action-button"
                  onClick={handleOpenSession}
                >
                  <span className="submission-detail-action-icon">
                    <OpenInNewOutlinedIcon fontSize="inherit" />
                  </span>
                  <span>
                    <strong>Open Session</strong>
                    <small>View session record</small>
                  </span>
                </button>

                <button
                  type="button"
                  className="submission-detail-action-button"
                  onClick={handleEnterEditMode}
                  disabled={isEditing}
                >
                  <span className="submission-detail-action-icon">
                    <EditOutlinedIcon fontSize="inherit" />
                  </span>
                  <span>
                    <strong>Update Session</strong>
                    <small>{isEditing ? "Editing enabled" : "Enable editing"}</small>
                  </span>
                </button>

                <button
                  type="button"
                  className="submission-detail-action-button submission-detail-action-button-ai"
                  onClick={handleAiSummary}
                  disabled={aiSummaryLoading}
                >
                  <span className="submission-detail-action-icon">
                    <AutoAwesomeOutlinedIcon fontSize="inherit" />
                  </span>
                  <span>
                    <strong>AI Summary</strong>
                    <small>{aiSummaryLoading ? "Generating session summary..." : "Generate session summary"}</small>
                  </span>
                </button>

                <button
                  type="button"
                  className="submission-detail-action-button submission-detail-action-button-primary"
                  onClick={handleSaveDraft}
                  disabled={isSaving || !isEditing || !isDirty}
                >
                  <span className="submission-detail-action-icon">
                    <SaveOutlinedIcon fontSize="inherit" />
                  </span>
                  <span>
                    <strong>{isSaving ? "Saving..." : "Save Changes"}</strong>
                    <small>Persist current edits</small>
                  </span>
                </button>

                <button
                  type="button"
                  className="submission-detail-action-button submission-detail-action-button-muted"
                  onClick={handleCancelChanges}
                >
                  <span className="submission-detail-action-icon">
                    <CancelOutlinedIcon fontSize="inherit" />
                  </span>
                  <span>
                    <strong>Cancel</strong>
                    <small>Discard draft edits</small>
                  </span>
                </button>
              </div>
            </section>

            <section className="submission-section submission-detail-section-card submission-edit-ai-card">
              <SectionHeader
                icon={AutoAwesomeOutlinedIcon}
                eyebrow="AI Summary"
                title="Summary History"
                description="Previously generated summaries for this submission."
                meta={aiSummary?.generatedAt ? <StatusBadge label="Latest available" tone="success" /> : null}
              />

              <div className="submission-detail-ai-history-list">
                {aiSummaryHistory.length ? (
                  aiSummaryHistory.slice(0, 3).map((item, index) => (
                    <button
                      type="button"
                      key={item.summaryId || `${item.generatedAt}-${index}`}
                      className="submission-detail-ai-history-item"
                      onClick={() => {
                        setAiSummary({ ...item, summaryHistory: aiSummaryHistory });
                        setAiSummaryError("");
                        setIsAiSummaryOpen(true);
                      }}
                    >
                      <span>
                        <strong>{formatDateTime(item.generatedAt) || "Generated summary"}</strong>
                        <small>{item.summary}</small>
                      </span>
                      {index === 0 ? <StatusBadge label="Latest" tone="success" /> : null}
                    </button>
                  ))
                ) : (
                  <div className="submission-detail-ai-history-empty">
                    No AI summaries generated yet.
                  </div>
                )}
              </div>
              {aiSummaryHistory.length > 3 ? (
                <p className="submission-detail-ai-history-more">
                  {aiSummaryHistory.length - 3} older summaries are available in the AI Summary modal.
                </p>
              ) : null}
            </section>
          </aside>
        </div>
      </div>

      {isDirty ? (
        <div className="submission-edit-savebar">
          <div className="submission-edit-savebar-copy">
            <strong>{trackedChangeCount} unsaved changes</strong>
            <span>Don’t forget to save your updates.</span>
          </div>

          <div className="submission-edit-savebar-actions">
            <button
              type="button"
              className="fleet-btn fleet-btn-secondary"
              onClick={handleCancelChanges}
            >
              Cancel Changes
            </button>
            <button
              type="button"
              className="fleet-btn fleet-btn-primary"
              onClick={handleSaveDraft}
              disabled={isSaving}
            >
              <SaveOutlinedIcon fontSize="inherit" />
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      ) : null}

      <AiSessionSummaryModal
        open={isAiSummaryOpen}
        onClose={() => setIsAiSummaryOpen(false)}
        submissionLabel={submissionId}
        summary={aiSummary}
        history={aiSummaryHistory}
        isLoading={aiSummaryLoading}
        error={aiSummaryError}
        onRegenerate={handleAiSummary}
        onSaveToNotes={handleSaveAiSummaryToNotes}
        isSavingToNotes={isSavingAiSummaryToNotes}
      />
    </div>
  );
}
