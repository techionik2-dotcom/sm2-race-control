"use client"

import { useEffect, useMemo } from "react"
import Image from "next/image"
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined"
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined"
import CloudSyncOutlinedIcon from "@mui/icons-material/CloudSyncOutlined"
import DatasetOutlinedIcon from "@mui/icons-material/DatasetOutlined"
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined"
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined"
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined"
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined"
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded"
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined"
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined"
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined"
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined"

import StatusBadge from "../../../components/Common/StatusBadge"
import { formatDateTime, formatEntityId } from "../../fleet/_components/fleetManagementHelpers"
import ProtectedAudioPlayer from "./ProtectedAudioPlayer"
import {
  getSubmissionDriverLabel,
  getSubmissionEventLabel,
  getSubmissionTrackLabel,
  getSubmissionVehicleLabel,
} from "./submissionReviewHelpers"

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

const isFilled = (value) => {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.some((item) => isFilled(item))
  if (typeof value === "object") return Object.keys(value).length > 0
  return normalizeText(value) !== ""
}

const toDisplayValue = (value, fallback = "-") => {
  if (!isFilled(value)) return fallback
  if (Array.isArray(value)) {
    return value.map((item) => toDisplayValue(item, "")).filter(Boolean).join(" / ") || fallback
  }

  if (typeof value === "object") {
    return fallback
  }

  return normalizeText(value) || fallback
}

const formatTimelineTimestamp = (value) => {
  const formatted = formatDateTime(value)
  return formatted === "-" ? toDisplayValue(value) : formatted
}

const labelKey = (value) => normalizeText(value).toLowerCase()

const buildLookup = (fields = []) =>
  fields.reduce((lookup, field) => {
    const key = labelKey(field?.label)
    if (!key) {
      return lookup
    }

    lookup[key] = normalizeText(field?.value)
    return lookup
  }, {})

const pickLookupValue = (lookup, ...labels) => {
  for (const label of labels) {
    const value = lookup?.[labelKey(label)]
    if (isFilled(value)) {
      return value
    }
  }

  return ""
}

const toneFromText = (text) => {
  const value = normalizeText(text).toLowerCase()
  if (!value) return "neutral"
  if (/no match|not found|unavailable|none/.test(value)) return "warning"
  if (/fail|error|reject|invalid|missing/.test(value)) return "danger"
  if (/pass|valid|success|synced|approved|complete/.test(value)) return "success"
  if (/warn|review|partial|pending/.test(value)) return "warning"
  return "neutral"
}

const buildTimeline = ({ record, submissionType, statusLabel, actionLabel }) => {
  const voiceSession = record?.voiceSession || record?.voice_session || null
  const createdAt = record?.createdAt || record?.submittedAt || record?.updatedAt || null
  const processedAt = record?.processedAt || record?.updatedAt || null
  const actorLabel = record?.sourceChannel || record?.sourceTypeLabel || "System"
  const reviewedBy = record?.analysisResult?.reviewed_by_name || record?.analysisResult?.reviewed_by_id || "Owner"
  const reviewedAt = record?.analysisResult?.reviewed_at || record?.analysisResult?.reviewedAt || null

  const timeline = [
    {
      id: "created",
      action: "Created",
      note: "Submission entered the review workspace.",
      timestamp: createdAt,
      actor: actorLabel,
      tone: "accent",
    },
    {
      id: "processed",
      action: "Processed",
      note: record?.auditSnippet || "Parser and validation pipeline completed.",
      timestamp: processedAt,
      actor: "Parser",
      tone: "info",
    },
    {
      id: "reviewed",
      action: actionLabel || "Reviewed",
      note:
        statusLabel ||
        (submissionType ? `Review state: ${submissionType}` : "No manual review recorded yet."),
      timestamp: reviewedAt,
      actor: reviewedBy,
      tone: "neutral",
    },
  ]

  if (voiceSession) {
    timeline.push(
      {
        id: "voice-uploaded",
        action: "Voice Uploaded",
        note: voiceSession.audioFileName ? `Stored ${voiceSession.audioFileName} for transcription.` : "Voice audio stored for transcription.",
        timestamp: voiceSession.uploadedAt || voiceSession.created_at || voiceSession.createdAt || createdAt,
        actor: "Voice Capture",
        tone: "info",
      },
      {
        id: "voice-transcribed",
        action: "Voice Transcribed",
        note:
          voiceSession.transcriptEditedText || voiceSession.transcriptText
            ? "OpenAI transcript is available for review."
            : voiceSession.lastErrorMessage || "Transcription is still pending or failed.",
        timestamp: voiceSession.transcribedAt || voiceSession.updatedAt || processedAt,
        actor: "OpenAI",
        tone: voiceSession.status === "TRANSCRIPTION_FAILED" ? "danger" : "success",
      },
    )

    if (voiceSession.confirmedAt) {
      timeline.push({
        id: "voice-confirmed",
        action: "Voice Confirmed",
        note: "Driver confirmed the transcript before submission.",
        timestamp: voiceSession.confirmedAt,
        actor: "Driver",
        tone: "success",
      })
    }

    if (voiceSession.submittedAt) {
      timeline.push({
        id: "voice-submitted",
        action: "Voice Submitted",
        note: "Voice note was finalized into the standard submission workflow.",
        timestamp: voiceSession.submittedAt,
        actor: "Submission API",
        tone: "accent",
      })
    }
  }

  if (record?.isArchived || record?.analysisResult?.archived_at || record?.analysisResult?.archivedAt) {
    timeline.push({
      id: "archived",
      action: "Archived",
      note: "Submission archived for audit history.",
      timestamp: record?.analysisResult?.archived_at || record?.analysisResult?.archivedAt || processedAt,
      actor: reviewedBy,
      tone: "neutral",
    })
  }

  return timeline
    .filter((item) => item.action)
    .sort((left, right) => {
      const leftTime = new Date(left.timestamp || 0).getTime()
      const rightTime = new Date(right.timestamp || 0).getTime()
      return rightTime - leftTime
    })
}

const normalizeAttachment = (attachment, index) => {
  if (!attachment) return null

  const url =
    attachment.url ||
    attachment.href ||
    attachment.path ||
    attachment.file_url ||
    attachment.fileUrl ||
    attachment.image_url ||
    attachment.imageUrl ||
    attachment.download_url ||
    null

  const type = normalizeText(attachment.type || attachment.mime_type || attachment.mimeType || "").toLowerCase()
  const kind = type.includes("audio") ? "audio" : type.includes("video") ? "video" : "image"

  return {
    id: attachment.id || attachment.key || `${kind}-${index}`,
    kind,
    url,
    name: attachment.name || attachment.filename || attachment.file_name || `Attachment ${index + 1}`,
    description: attachment.description || attachment.label || attachment.caption || "",
    voiceSessionId: attachment.voiceSessionId || attachment.voice_session_id || null,
    mimeType: attachment.mimeType || attachment.mime_type || null,
  }
}

const buildAttachments = (record = {}, analysisResult = {}, imageUrl = null) => {
  const fromAnalysis = Array.isArray(analysisResult.attachments) ? analysisResult.attachments : []
  const fromPayload = Array.isArray(record?.data?.attachments) ? record.data.attachments : []
  const voiceSession = record?.voiceSession || record?.voice_session || null

  const items = [
    ...(imageUrl
      ? [
          {
            id: "primary-image",
            kind: "image",
            url: imageUrl,
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
    .reduce((list, item) => {
      if (list.some((existing) => existing.url === item.url)) {
        return list
      }

      list.push(item)
      return list
    }, [])

  return items
}

const buildCornerValues = (pressures = {}) => {
  const selected = pressures.cold || pressures.hot || {}
  const corners = [
    { label: "Front Left", value: selected.fl },
    { label: "Front Right", value: selected.fr },
    { label: "Rear Left", value: selected.rl },
    { label: "Rear Right", value: selected.rr },
  ]

  return corners.map((corner) => ({
    label: corner.label,
    value: toDisplayValue(corner.value),
  }))
}

const formatSuspensionCorners = (suspension = {}, baseKey) => {
  const values = [
    suspension?.[`${baseKey}_fl`] ?? suspension?.[`${baseKey}_f`] ?? null,
    suspension?.[`${baseKey}_fr`] ?? suspension?.[`${baseKey}_f`] ?? null,
    suspension?.[`${baseKey}_rl`] ?? suspension?.[`${baseKey}_r`] ?? null,
    suspension?.[`${baseKey}_rr`] ?? suspension?.[`${baseKey}_r`] ?? null,
  ]

  if (!values.some((value) => isFilled(value))) {
    return "-"
  }

  return values.map((value) => toDisplayValue(value)).join(" / ")
}

const formatTemperatureCorners = (temperatures = {}, corner) => {
  const values = [temperatures?.[`${corner}_out`], temperatures?.[`${corner}_mid`], temperatures?.[`${corner}_in`]]
  if (!values.some((value) => isFilled(value))) {
    return "-"
  }

  return values.map((value) => toDisplayValue(value)).join(" / ")
}

const buildGroupedSectionsFromFields = (fields = []) => {
  const groups = [
    {
      title: "Session",
      description: "Core event, session, driver, and vehicle details.",
      match: /(session|event|driver|vehicle|track|run group|date|time|duration|created|submission ref|type)/i,
      items: [],
    },
    {
      title: "Setup",
      description: "Pressures, suspension, alignment, and tire-related fields.",
      match: /(pressure|suspension|alignment|camber|toe|caster|rake|temperature|tire|history|inventory|wheelbase|wing|sway|rebound|bump)/i,
      items: [],
    },
    {
      title: "Metadata",
      description: "Review and ingest metadata that frames the result.",
      match: /(structured ingest|image review|confidence|status|source|note|error|submission type|created by)/i,
      items: [],
    },
  ]

  const other = []

  fields.forEach((field) => {
    const label = normalizeText(field?.label)
    const value = normalizeText(field?.value)
    if (!label || !value) {
      return
    }

    const target = groups.find((group) => group.match.test(label))
    const entry = { label, value }

    if (target) {
      target.items.push(entry)
    } else {
      other.push(entry)
    }
  })

  const result = groups
    .filter((group) => group.items.length)
    .map((group) => ({
      title: group.title,
      description: group.description,
      items: group.items,
    }))

  if (other.length) {
    result.push({
      title: "Other",
      description: "Additional visible fields from the selected record.",
      items: other,
    })
  }

  return result
}

export const buildWorkspaceFromRecord = (record) => {
  if (!record) {
    return null
  }

  const data = record.data || {}
  const analysis = record.analysisResult || {}
  const submissionId = record.submissionId || record.submission_ref || formatEntityId("SUB", record.id)
  const confidenceTone =
    record.confidence === null
      ? "neutral"
      : record.confidence >= 90
        ? "success"
        : record.confidence >= 80
          ? "warning"
          : "danger"

  const heroBadges = [
    { label: record.validationStateLabel, tone: record.validationStateTone, title: "Validation status" },
    { label: record.syncStateLabel, tone: record.syncStateTone, title: "Sync status" },
    { label: record.structuredStatusLabel, tone: record.structuredStatusTone, title: "Structured normalization status" },
    { label: record.sourceTypeLabel, tone: record.sourceTypeTone, title: "Source type" },
    record.confidenceLabel
      ? {
          label: `Confidence ${record.confidenceLabel}`,
          tone: confidenceTone,
          title: "Parsing confidence",
        }
      : null,
  ].filter(Boolean)

  const overviewItems = [
    { label: "Submission ID", value: submissionId, mono: true },
    { label: "Event", value: getSubmissionEventLabel(record) },
    { label: "Driver", value: getSubmissionDriverLabel(record) },
    { label: "Vehicle", value: getSubmissionVehicleLabel(record) },
    { label: "Track", value: getSubmissionTrackLabel(record) },
    {
      label: "Run Group",
      value: record.run_group?.normalized || record.runGroup || record.run_group?.rawText || "-",
    },
    { label: "Session Type", value: data.session_type || data.sessionType || "-" },
    { label: "Session Number", value: data.session_number || data.sessionNumber || "-" },
    { label: "Created At", value: formatDateTime(record.createdAt || record.submittedAt) },
    { label: "Source Type", value: record.sourceTypeLabel || "-" },
    record.voiceStatus ? { label: "Voice Status", value: record.voiceStatus } : null,
    record.voiceValidationStatus ? { label: "Voice Review", value: record.voiceValidationStatus } : null,
    record.voiceAudioDurationLabel ? { label: "Voice Duration", value: record.voiceAudioDurationLabel } : null,
  ]
    .filter(Boolean)

  const validationMessages = Array.isArray(record.validationMessages) ? record.validationMessages : []
  const issueCards = [
    { label: "Missing Fields", value: record.missingFields?.length ? record.missingFields.join(", ") : "None" },
    { label: "Failed Fields", value: record.failedFields?.length ? record.failedFields.join(", ") : "None" },
    { label: "Duplicate Detection", value: record.duplicateDetection?.message || "No duplicate detected." },
    { label: "Driver / Vehicle", value: record.driverVehicleMismatch ? "Mismatch detected" : "Aligned" },
    { label: "Track Normalization", value: record.trackNormalizationWarning ? "Needs review" : "Aligned" },
    { label: "Run Group Normalization", value: record.runGroupNormalizationWarning ? "Needs review" : "Aligned" },
  ]

  const rawCards = [
    { title: "raw_text", value: record.rawText || "No raw text submitted.", kind: "text" },
    record.voiceSession
      ? {
          title: "voice_transcript",
          value: record.voiceTranscript || "No transcript available.",
          kind: "text",
          meta: [
            record.voiceStatus ? `Status: ${record.voiceStatus}` : null,
            record.voiceValidationStatus ? `Review: ${record.voiceValidationStatus}` : null,
            record.voiceTranscriptConfidence !== null && record.voiceTranscriptConfidence !== undefined
              ? `Confidence: ${
                  Math.round(
                    ((record.voiceTranscriptConfidence <= 1
                      ? record.voiceTranscriptConfidence * 100
                      : record.voiceTranscriptConfidence) * 10) / 10,
                  )
                }%`
              : null,
          ]
            .filter(Boolean)
            .join(" | "),
        }
      : null,
    { title: "raw_payload_json", value: data, kind: "json" },
    { title: "OCR Text", value: record.ocrText || "No OCR text captured.", kind: "text" },
    {
      title: "Proof Attachment",
      kind: "image",
      imageUrl: record.imageUrl || null,
    },
  ].filter(Boolean)

  const parsedSections = [
    {
      title: "Session",
      description: "Core session metadata and timing.",
      items: [
        { label: "Date", value: data.date },
        { label: "Time", value: data.time },
        { label: "Session Type", value: data.session_type || data.sessionType },
        { label: "Session #", value: data.session_number || data.sessionNumber },
        { label: "Duration", value: data.duration_min ? `${data.duration_min} min` : "-" },
        { label: "Track", value: data.track || getSubmissionTrackLabel(record) },
        { label: "Wheelbase", value: data.wheelbase_mm ? `${data.wheelbase_mm} mm` : "-" },
      ],
    },
    {
      title: "Pressures",
      description: "Corner values from the active pressure set.",
      items: [
        { label: "Unit", value: data.pressures?.unit || "psi" },
        { label: "Mode", value: data.pressures?.mode || "cold" },
        ...buildCornerValues(data.pressures || {}),
      ],
    },
    {
      title: "Suspension",
      description: "Damper, platform, and aero-related settings.",
      items: [
        { label: "Rebound", value: formatSuspensionCorners(data.suspension || {}, "rebound") },
        { label: "Bump", value: formatSuspensionCorners(data.suspension || {}, "bump") },
        { label: "Sway Bar", value: `${toDisplayValue(data.suspension?.sway_bar_f)} / ${toDisplayValue(data.suspension?.sway_bar_r)}` },
        {
          label: "Wing Angle",
          value:
            data.suspension?.wing_angle_deg !== undefined && data.suspension?.wing_angle_deg !== null
              ? `${data.suspension.wing_angle_deg} deg`
              : "-",
        },
      ],
    },
    {
      title: "Alignment",
      description: "Camber, toe, caster, and rake values.",
      items: [
        { label: "Camber FL / FR", value: `${toDisplayValue(data.alignment?.camber_fl)} / ${toDisplayValue(data.alignment?.camber_fr)}` },
        { label: "Camber RL / RR", value: `${toDisplayValue(data.alignment?.camber_rl)} / ${toDisplayValue(data.alignment?.camber_rr)}` },
        { label: "Toe Front / Rear", value: `${toDisplayValue(data.alignment?.toe_front)} / ${toDisplayValue(data.alignment?.toe_rear)}` },
        { label: "Caster FL / FR", value: `${toDisplayValue(data.alignment?.caster_fl)} / ${toDisplayValue(data.alignment?.caster_fr)}` },
        { label: "Rake", value: data.alignment?.rake_mm !== undefined && data.alignment?.rake_mm !== null ? `${data.alignment.rake_mm} mm` : "-" },
      ],
    },
    {
      title: "Tire Temperatures",
      description: "Outer, middle, and inner readings for each corner.",
      items: [
        { label: "Front Left", value: formatTemperatureCorners(data.tire_temperatures || {}, "fl") },
        { label: "Front Right", value: formatTemperatureCorners(data.tire_temperatures || {}, "fr") },
        { label: "Rear Left", value: formatTemperatureCorners(data.tire_temperatures || {}, "rl") },
        { label: "Rear Right", value: formatTemperatureCorners(data.tire_temperatures || {}, "rr") },
      ],
    },
    {
      title: "Tire History",
      description: "Wear, heat cycle, and usage context.",
      items: [
        { label: "Set ID", value: data.tire_history?.set_id },
        { label: "Compound", value: data.tire_history?.compound },
        { label: "Batch", value: data.tire_history?.batch },
        { label: "Condition", value: data.tire_history?.condition },
        { label: "Heat Cycles", value: data.tire_history?.heat_cycles },
        { label: "Wear %", value: data.tire_history?.wear_percent ? `${data.tire_history.wear_percent}%` : "-" },
        { label: "Stint Count", value: data.tire_history?.stint_count },
        { label: "Last Used", value: data.tire_history?.last_used_at ? formatDateTime(data.tire_history.last_used_at) : "-" },
      ],
    },
    {
      title: "Tire Inventory",
      description: "Inventory and storage details for the current tire set.",
      items: [
        { label: "Brand", value: data.tire_inventory?.brand },
        { label: "Batch", value: data.tire_inventory?.batch },
        { label: "Condition", value: data.tire_inventory?.condition },
        { label: "Size", value: data.tire_inventory?.size },
        { label: "Quantity", value: data.tire_inventory?.quantity },
        { label: "Location", value: data.tire_inventory?.location },
        { label: "Status", value: data.tire_inventory?.status },
      ],
    },
  ].filter((section) => section.items.some((item) => isFilled(item.value)))

  const timeline = buildTimeline({
    record,
    submissionType: record.reviewStateLabel,
    statusLabel: record.recommendation,
    actionLabel: record.isArchived ? "Archived" : "Reviewed",
  })

  const attachments = buildAttachments(record, analysis, record.imageUrl)

  return {
    hero: {
      eyebrow: "Session Review",
      title: submissionId,
      subtitle:
        "Inspect raw input, parsed session details, sync state, and system findings from the selected record.",
      badges: heroBadges,
      anchors: [
        { label: "Overview", href: "#overview" },
        { label: "Validation", href: "#validation" },
        { label: "Raw", href: "#raw" },
        { label: "Parsed", href: "#parsed" },
        { label: "System", href: "#system" },
      ],
    },
    overviewItems,
    validation: {
      title: "Validation Status and Correction Tracker",
      description: "Review missing fields, mismatch warnings, and manual notes before approving or rejecting the submission.",
      badges: [
        { label: record.validationStateLabel, tone: record.validationStateTone, title: "Validation status" },
        { label: record.syncStateLabel, tone: record.syncStateTone, title: "Sync status" },
        record.confidenceLabel
          ? { label: record.confidenceLabel, tone: confidenceTone, title: "Confidence" }
          : null,
        { label: record.structuredStatusLabel, tone: record.structuredStatusTone, title: "Structured status" },
      ].filter(Boolean),
      alertTone: record.validationStateTone,
      alertTitle: validationMessages.length ? "Issues detected" : "No blocking validation errors",
      alertMessages: validationMessages,
      recommendation: record.recommendation,
      issueCards,
      adminNote: {
        title: "Owner Feedback",
        description: "Add correction notes, validation remarks, or follow-up instructions.",
        value:
          record.analysisResult?.admin_comment ||
          record.analysisResult?.comments ||
          record.analysis_result?.admin_comment ||
          record.analysis_result?.comments ||
          "",
        tone: "neutral",
      },
    },
    raw: {
      title: "Exact Raw Content and Media",
      description: "Review the exact text or media submitted by the driver. Raw content is preserved as submitted while owner notes remain editable.",
      cards: rawCards,
    },
    parsedSections,
    system: {
      title: "Backend Record Preview",
      description: "Confirm the stored payload, review state, and metadata currently held by the API.",
      items: [
        { label: "Created At", value: formatDateTime(record.createdAt || record.submittedAt) },
        { label: "Updated At", value: formatDateTime(record.updatedAt || record.submittedAt) },
        { label: "Status", value: record.syncStateLabel },
        { label: "Review", value: record.reviewStateLabel },
        { label: "Structured Status", value: record.structuredStatusLabel },
        { label: "Structured Warnings", value: record.structuredWarningCount || 0 },
        record.confidenceLabel ? { label: "Voice Confidence", value: record.confidenceLabel } : null,
        record.voiceStatus ? { label: "Voice Status", value: record.voiceStatus } : null,
        record.voiceValidationStatus ? { label: "Voice Review", value: record.voiceValidationStatus } : null,
        record.voiceAudioDurationLabel ? { label: "Voice Duration", value: record.voiceAudioDurationLabel } : null,
      ].filter(Boolean),
      auditSnippet: record.auditSnippet,
      timeline,
      attachments,
      sourceChannel: record.sourceChannel || record.sourceTypeLabel,
      parserVersion: record.parserVersion,
      archiveState: record.isArchived ? "Archived" : "Live",
    },
    confidenceTone,
  }
}

const buildWorkspaceFromItem = (item) => {
  if (!item) {
    return null
  }

  const fields = Array.isArray(item.fields) ? item.fields : []
  const lookup = buildLookup(fields)
  const submissionRef = pickLookupValue(lookup, "submission ref") || item.title || "Submission"
  const subtitle =
    item.subtitle ||
    pickLookupValue(lookup, "note") ||
    pickLookupValue(lookup, "error") ||
    "No summary available."

  const heroBadges = [
    { label: item.badge || "Result", tone: item.badgeTone || toneFromText(item.badge), title: "Result status" },
    pickLookupValue(lookup, "structured ingest")
      ? {
          label: pickLookupValue(lookup, "structured ingest"),
          tone: toneFromText(pickLookupValue(lookup, "structured ingest")),
          title: "Structured ingest",
        }
      : null,
    pickLookupValue(lookup, "image review")
      ? {
          label: pickLookupValue(lookup, "image review"),
          tone: toneFromText(pickLookupValue(lookup, "image review")),
          title: "Image review",
        }
      : null,
  ].filter(Boolean)

  const consumed = new Set(
    [
      "submission ref",
      "session",
      "event",
      "driver",
      "vehicle",
      "run group",
      "track",
      "created",
      "submission type",
      "structured ingest",
      "image review",
      "status",
      "source",
      "confidence",
      "note",
      "error",
    ].map(labelKey),
  )

  const overviewItems = [
    { label: "Submission Ref", value: submissionRef, mono: true },
    { label: "Session", value: pickLookupValue(lookup, "session") || item.session },
    { label: "Event", value: pickLookupValue(lookup, "event") || item.event },
    { label: "Driver", value: pickLookupValue(lookup, "driver") || item.driver },
    { label: "Vehicle", value: pickLookupValue(lookup, "vehicle") || item.vehicle },
    { label: "Run Group", value: pickLookupValue(lookup, "run group") || item.runGroup },
    { label: "Track", value: pickLookupValue(lookup, "track") || item.track },
    { label: "Created", value: pickLookupValue(lookup, "created") || item.created },
    { label: "Type", value: pickLookupValue(lookup, "submission type") || item.type || item.badge },
    { label: "Status", value: item.badge || pickLookupValue(lookup, "status") },
  ]

  const validationMessages = [
    pickLookupValue(lookup, "error"),
    pickLookupValue(lookup, "note"),
  ].filter(Boolean)

  const issueCards = [
    { label: "Submission Type", value: pickLookupValue(lookup, "submission type") || item.badge || "-" },
    { label: "Structured Ingest", value: pickLookupValue(lookup, "structured ingest") || "Not reported" },
    { label: "Image Review", value: pickLookupValue(lookup, "image review") || "Not reported" },
    { label: "Status", value: item.badge || "Unknown" },
  ]

  const rawCards = [
    { title: "raw_text", value: subtitle, kind: "text" },
    {
      title: "field_snapshot_json",
      value: fields.map((field) => ({ label: normalizeText(field?.label), value: normalizeText(field?.value) })),
      kind: "json",
    },
  ]

  const groupedFields = buildGroupedSectionsFromFields(
    fields.filter((field) => !consumed.has(labelKey(field?.label))),
  )

  const parsedSections = groupedFields.length
    ? groupedFields
    : fields.length
      ? [
          {
            title: "Selected Fields",
            description: "Visible values returned in the chatbot response.",
            items: fields.map((field) => ({
              label: normalizeText(field?.label),
              value: normalizeText(field?.value),
            })),
          },
        ]
      : []

  const timeline = [
    {
      id: "captured",
      action: "Captured",
      note: subtitle,
      timestamp: pickLookupValue(lookup, "created") || null,
      actor: item.badge || "AI Race Assistant",
      tone: "accent",
    },
    {
      id: "reviewed",
      action: "Reviewed",
      note: item.badge || "Result returned from the chatbot.",
      timestamp: pickLookupValue(lookup, "created") || null,
      actor: "AI Race Assistant",
      tone: "info",
    },
  ]

  const attachments = [
    ...(pickLookupValue(lookup, "image") || item.imageUrl
      ? [
          {
            id: "chatbot-image",
            kind: "image",
            url: pickLookupValue(lookup, "image") || item.imageUrl,
            name: "Supporting image",
            description: "Optional image captured in the chatbot response.",
          },
        ]
      : []),
  ]

  return {
    hero: {
      eyebrow: "Session Review",
      title: submissionRef,
      subtitle: subtitle,
      badges: heroBadges,
      anchors: [
        { label: "Overview", href: "#overview" },
        { label: "Validation", href: "#validation" },
        { label: "Raw", href: "#raw" },
        { label: "Parsed", href: "#parsed" },
        { label: "System", href: "#system" },
      ],
    },
    overviewItems,
    validation: {
      title: "Result Summary and Quick Checks",
      description: "Review the returned values, guidance, and any supporting warnings.",
      badges: heroBadges,
      alertTone: toneFromText(item.badge),
      alertTitle: item.badge || "Result",
      alertMessages: validationMessages,
      recommendation: subtitle,
      issueCards,
      adminNote: {
        title: "Response Context",
        description: "Summary of the selected chatbot result.",
        value: subtitle,
        tone: toneFromText(item.badge),
      },
    },
    raw: {
      title: "Response Snapshot",
      description: "The chatbot result is displayed with the same review-style framing as Session Review.",
      cards: rawCards,
    },
    parsedSections,
    system: {
      title: "Result Metadata",
      description: "Supporting details from the selected chatbot row.",
      items: [
        { label: "Created", value: pickLookupValue(lookup, "created") || item.created || "-" },
        { label: "Status", value: item.badge || "-" },
        { label: "Submission Type", value: pickLookupValue(lookup, "submission type") || item.type || "-" },
        { label: "Structured Ingest", value: pickLookupValue(lookup, "structured ingest") || "-" },
        { label: "Image Review", value: pickLookupValue(lookup, "image review") || "-" },
        { label: "Source", value: pickLookupValue(lookup, "source") || "Chatbot response" },
      ],
      auditSnippet: subtitle,
      timeline,
      attachments,
      sourceChannel: "Chatbot response",
      parserVersion: "chatbot-summary",
      archiveState: "Live",
    },
    confidenceTone: toneFromText(item.badge),
  }
}

const KeyValue = ({ label, value, mono = false }) => (
  <div className="submission-kv-card">
    <p className="submission-kv-label">{label}</p>
    <p className={`submission-kv-value ${mono ? "submission-mono" : ""}`.trim()}>{toDisplayValue(value)}</p>
  </div>
)

const Section = ({ id, icon: Icon, eyebrow, title, description, children, meta, sectionRef }) => (
  <section ref={sectionRef} id={id} className="submission-section submission-detail-section-card">
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

    <div className="submission-section-body">{children}</div>
  </section>
)

const CollapsibleSection = ({
  icon: Icon,
  eyebrow,
  title,
  description,
  summary,
  children,
  defaultOpen = false,
}) => (
  <details className="submission-detail-collapsible-card" {...(defaultOpen ? { open: true } : {})}>
    <summary className="submission-detail-collapsible-summary">
      <div className="submission-detail-collapsible-heading">
        <span className="submission-section-eyebrow">
          {Icon ? <Icon fontSize="inherit" /> : null}
          {eyebrow}
        </span>
        <div className="submission-detail-collapsible-title-row">
          <h3>{title}</h3>
          {summary ? <span className="submission-detail-section-score">{summary}</span> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>

      <span className="submission-detail-collapsible-chevron" aria-hidden="true">
        <KeyboardArrowDownRoundedIcon fontSize="inherit" />
      </span>
    </summary>

    <div className="submission-detail-collapsible-body">{children}</div>
  </details>
)

const InfoPill = ({ label, value, tone = "neutral" }) => (
  <div className={`submission-info-pill submission-info-${tone}`}>
    <span className="submission-info-label">{label}</span>
    <span className="submission-info-value">{toDisplayValue(value)}</span>
  </div>
)

const JsonBlock = ({ value, emptyLabel = "No data available." }) => (
  <pre className="submission-json-block">
    {value && Object.keys(value).length ? JSON.stringify(value, null, 2) : emptyLabel}
  </pre>
)

const TimelineItem = ({ item }) => {
  const toneClass =
    item.tone === "success"
      ? "success"
      : item.tone === "danger"
        ? "danger"
        : item.tone === "info"
          ? "info"
          : "accent"

  return (
    <li className={`submission-detail-timeline-item submission-detail-timeline-${toneClass}`}>
      <div className="submission-detail-timeline-top">
        <div>
          <div className="submission-detail-timeline-action">{item.action}</div>
          <div className="submission-detail-timeline-note">{item.note || "No note available."}</div>
        </div>
        {item.timestamp ? <StatusBadge label={formatTimelineTimestamp(item.timestamp)} tone="neutral" /> : null}
      </div>
      <div className="submission-detail-timeline-meta">
        {item.actor || "System"}
      </div>
    </li>
  )
}

const AttachmentCard = ({ attachment }) => {
  if (!attachment?.url) {
    return null
  }

  return (
    <article className="submission-detail-attachment-card">
      <div className="submission-detail-attachment-header">
        <div>
          <div className="submission-detail-group-title">{attachment.name || "Attachment"}</div>
          {attachment.description ? (
            <p className="submission-detail-group-copy">{attachment.description}</p>
          ) : null}
        </div>
      </div>

      {attachment.kind === "audio" ? (
        <ProtectedAudioPlayer
          className="submission-detail-audio-player"
          voiceSessionId={attachment.voiceSessionId || null}
          src={attachment.url}
          downloadName={attachment.name || "voice-note"}
        />
      ) : attachment.kind === "video" ? (
        <video className="submission-detail-media" controls src={attachment.url} />
      ) : (
        <Image
          className="submission-detail-media"
          src={attachment.url}
          alt={attachment.name || "Attachment preview"}
          width={1200}
          height={800}
          unoptimized
        />
      )}
    </article>
  )
}

function RawCard({ card }) {
  if (card.kind === "image") {
    return (
      <div className="submission-raw-card submission-raw-image-card">
        <div className="submission-raw-card-title">{card.title}</div>
        {card.imageUrl ? (
          <Image
            className="submission-proof-image submission-detail-preview-image"
            src={card.imageUrl}
            alt={card.title}
            width={1200}
            height={800}
            unoptimized
          />
        ) : (
          <div className="submission-image-empty">
            <ImageOutlinedIcon fontSize="inherit" />
            <span>No image uploaded.</span>
          </div>
        )}
      </div>
    )
  }

  if (card.kind === "json") {
    return (
      <div className="submission-raw-card">
        <div className="submission-raw-card-title">{card.title}</div>
        <JsonBlock value={card.value} />
      </div>
    )
  }

  return (
    <div className="submission-raw-card">
      <div className="submission-raw-card-title">{card.title}</div>
      <pre className="submission-code-block submission-detail-raw-code">
        {toDisplayValue(card.value, "No data available.")}
      </pre>
      {card.meta ? <div className="submission-detail-raw-meta">{card.meta}</div> : null}
    </div>
  )
}

function ParsedSectionCard({ section }) {
  const visibleItems = Array.isArray(section.items) ? section.items.filter((item) => isFilled(item?.value)) : []
  if (!visibleItems.length) {
    return null
  }

  return (
    <article className="submission-detail-group-card">
      <div className="submission-detail-group-header">
        <div>
          <div className="submission-detail-group-title">{section.title}</div>
          {section.description ? <p className="submission-detail-group-copy">{section.description}</p> : null}
        </div>
      </div>

      <div className="submission-detail-grid submission-detail-grid-tight">
        {visibleItems.map((item) => (
          <InfoPill key={`${section.title}-${item.label}`} label={item.label} value={item.value} />
        ))}
      </div>
    </article>
  )
}

export default function SubmissionReviewWorkspace({
  record = null,
  item = null,
  focusSection = null,
  className = "",
}) {
  const workspace = useMemo(() => {
    if (record) {
      return buildWorkspaceFromRecord(record)
    }

    if (item) {
      return buildWorkspaceFromItem(item)
    }

    return null
  }, [item, record])

  useEffect(() => {
    if (!focusSection || !workspace) {
      return undefined
    }

    const target = document.getElementById(focusSection)
    if (!target) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 60)

    return () => window.clearTimeout(timeout)
  }, [focusSection, workspace])

  if (!workspace) {
    return null
  }

  const rawPayload = record?.data || {}

  return (
    <div className={`submission-review-workspace ${className}`.trim()}>
      <header className="submission-detail-hero">
        <div className="submission-detail-hero-copy">
          <p className="submission-detail-eyebrow">{workspace.hero.eyebrow}</p>
          <h1>{workspace.hero.title}</h1>
          <p className="submission-detail-subtitle">{workspace.hero.subtitle}</p>

          <div className="submission-detail-badge-row">
            {workspace.hero.badges.map((badge) => (
              <StatusBadge
                key={`${badge.label}-${badge.title || badge.tone}`}
                label={badge.label}
                tone={badge.tone}
                title={badge.title}
              />
            ))}
            {record?.confidenceLabel ? (
              <span className={`submission-confidence-chip tone-${workspace.confidenceTone}`}>
                Confidence {record.confidenceLabel}
              </span>
            ) : null}
          </div>

          {workspace.hero.anchors.length ? (
            <div className="submission-detail-anchor-row">
              {workspace.hero.anchors.map((anchor) => (
                <a key={anchor.href} href={anchor.href}>
                  {anchor.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="submission-detail-layout">
        <main className="submission-detail-main">
          <Section
            id="overview"
            icon={ReceiptLongOutlinedIcon}
            eyebrow="Overview"
            title="Submission and Relationship Details"
            description="Confirm the core record, linked driver and vehicle, and the event context stored with the payload."
            meta={
              <>
                {record?.validationStateLabel ? (
                  <StatusBadge label={record.validationStateLabel} tone={record.validationStateTone || "neutral"} />
                ) : null}
                {record?.sourceTypeLabel ? (
                  <span className="submission-detail-section-score">{record.sourceTypeLabel}</span>
                ) : null}
              </>
            }
          >
            <div className="submission-detail-grid submission-detail-grid-overview">
              {workspace.overviewItems.map((entry) => (
                <KeyValue key={`${workspace.hero.title}-${entry.label}`} label={entry.label} value={entry.value} mono={entry.mono} />
              ))}
            </div>
          </Section>

          <Section
            id="validation"
            icon={WarningAmberOutlinedIcon}
            eyebrow="Validation Details"
            title={workspace.validation.title}
            description={workspace.validation.description}
            meta={
              <>
                {workspace.validation.badges.map((badge) => (
                  <StatusBadge
                    key={`${workspace.hero.title}-${badge.label}`}
                    label={badge.label}
                    tone={badge.tone || "neutral"}
                  />
                ))}
              </>
            }
          >
            <div className="submission-review-strip">
              {workspace.validation.badges.map((badge) => (
                <div className="submission-review-strip-item" key={`${workspace.hero.title}-strip-${badge.label}`}>
                  <span className="submission-review-strip-label">{badge.title || "Status"}</span>
                  <StatusBadge label={badge.label} tone={badge.tone || "neutral"} />
                </div>
              ))}
            </div>

            {workspace.validation.alertTone === "success" && !workspace.validation.alertMessages.length ? (
              <div className="submission-alert submission-alert-success">
                <div className="submission-alert-title">
                  <CheckCircleOutlineOutlinedIcon fontSize="small" />
                  No blocking validation errors
                </div>
                <p className="submission-alert-copy">{workspace.validation.recommendation}</p>
              </div>
            ) : (
              <div className={`submission-alert submission-alert-${workspace.validation.alertTone || toneFromText(workspace.validation.alertTitle)}`}>
                <div className="submission-alert-title">
                  <ErrorOutlineOutlinedIcon fontSize="small" />
                  {workspace.validation.alertTitle}
                </div>
                {workspace.validation.alertMessages.length ? (
                  <ul className="submission-alert-list">
                    {workspace.validation.alertMessages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="submission-alert-copy">{workspace.validation.recommendation}</p>
              </div>
            )}

            <div className="submission-detail-issue-grid">
              {workspace.validation.issueCards.map((card) => (
                <div className="submission-issue-card" key={`${workspace.hero.title}-${card.label}`}>
                  <p className="submission-issue-label">{card.label}</p>
                  <p className="submission-issue-value">{toDisplayValue(card.value)}</p>
                </div>
              ))}
            </div>

            <div className="submission-detail-admin-note" style={{ marginTop: "1rem" }}>
              <div className="submission-detail-admin-note-header">
                <div>
                  <div className="submission-detail-group-title">{workspace.validation.adminNote.title}</div>
                  {workspace.validation.adminNote.description ? (
                    <p className="submission-detail-group-copy">{workspace.validation.adminNote.description}</p>
                  ) : null}
                </div>
                <StatusBadge
                  label={workspace.validation.adminNote.value ? "Available" : "Read Only"}
                  tone={workspace.validation.adminNote.value ? "info" : "neutral"}
                />
              </div>

              <div className="submission-detail-admin-note-readonly">
                {workspace.validation.adminNote.value || "No owner feedback saved yet."}
              </div>
            </div>
          </Section>

          <CollapsibleSection
            icon={DescriptionOutlinedIcon}
            eyebrow="Raw Input"
            title={workspace.raw.title}
            description={workspace.raw.description}
            summary={workspace.raw.cards.length ? `${workspace.raw.cards.length} cards` : "No raw cards"}
          >
            <div className="submission-detail-collapsible-badge-row">
              {record?.sourceTypeLabel ? <StatusBadge label={record.sourceTypeLabel} tone={record.sourceTypeTone || "neutral"} /> : null}
              {record?.confidenceLabel ? (
                <StatusBadge label={record.confidenceLabel} tone={workspace.confidenceTone} />
              ) : null}
            </div>
            <div className="submission-raw-grid">
              {workspace.raw.cards.map((card) => (
                <RawCard key={`${workspace.hero.title}-${card.title}`} card={card} />
              ))}
            </div>
            {record?.analysisResult?.admin_comment || record?.analysisResult?.comments ? (
              <div className="submission-detail-admin-note" style={{ marginTop: "0.85rem" }}>
                <div className="submission-detail-admin-note-header">
                  <div>
                      <div className="submission-detail-group-title">Owner Comment</div>
                    <p className="submission-detail-group-copy">Notes saved alongside the raw submission.</p>
                  </div>
                </div>
                <div className="submission-detail-admin-note-readonly">
                  {record.analysisResult.admin_comment || record.analysisResult.comments}
                </div>
              </div>
            ) : null}
          </CollapsibleSection>

          <Section
            id="parsed"
            icon={DatasetOutlinedIcon}
            eyebrow="Parsed Data"
            title="Structured Submission Data"
            description="Review the interpreted session details and structured fields captured from the submission or chatbot response."
            meta={
              <>
                {workspace.parsedSections.length ? (
                  <span className="submission-detail-section-score">{workspace.parsedSections.length} sections</span>
                ) : (
                  <span className="submission-detail-section-score">No structured data</span>
                )}
              </>
            }
          >
            {workspace.parsedSections.length ? (
              <div className="submission-structured-grid">
                {workspace.parsedSections.map((section) => (
                  <ParsedSectionCard key={`${workspace.hero.title}-${section.title}`} section={section} />
                ))}
              </div>
            ) : (
              <div className="submission-image-empty">
                <InfoOutlinedIcon fontSize="inherit" />
                <span>No structured fields were available for this result.</span>
              </div>
            )}
          </Section>
        </main>

        <aside className="submission-detail-sidebar">
          <Section
            id="system"
            icon={CloudSyncOutlinedIcon}
            eyebrow="System / Processing"
            title={workspace.system.title}
            description={workspace.system.description}
          >
            <div className="submission-detail-storage-grid">
              {workspace.system.items.map((item) => (
                <KeyValue key={`${workspace.hero.title}-${item.label}`} label={item.label} value={item.value} />
              ))}
            </div>

            {workspace.system.auditSnippet ? (
              <div className="submission-audit-card">
                <div className="submission-structured-title">Audit Snippet</div>
                <p>{workspace.system.auditSnippet}</p>
              </div>
            ) : null}
          </Section>

          <CollapsibleSection
            icon={TimelineOutlinedIcon}
            eyebrow="Audit Log"
            title="History and Review Trail"
            description="Track when the record was created, processed, edited, approved, rejected, or archived."
            summary={workspace.system.timeline.length ? `${workspace.system.timeline.length} events` : "No history"}
          >
            <ul className="submission-detail-timeline">
              {workspace.system.timeline.length ? (
                workspace.system.timeline.map((timelineItem) => (
                  <TimelineItem key={timelineItem.id} item={timelineItem} />
                ))
              ) : (
                <li className="submission-detail-timeline-empty">No audit entries available yet.</li>
              )}
            </ul>
          </CollapsibleSection>

          <CollapsibleSection
            icon={AttachFileOutlinedIcon}
            eyebrow="Attachments"
            title="Media Preview and Downloads"
            description="View or download images and audio files that were uploaded with the submission."
            summary={workspace.system.attachments.length ? `${workspace.system.attachments.length} items` : "No media"}
          >
            {workspace.system.attachments.length ? (
              <div className="submission-detail-attachment-grid">
                {workspace.system.attachments.map((attachment) => (
                  <AttachmentCard key={attachment.id} attachment={attachment} />
                ))}
              </div>
            ) : (
              <div className="submission-image-empty">
                <AttachFileOutlinedIcon fontSize="inherit" />
                <span>No attachments stored for this submission.</span>
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            icon={VisibilityOutlinedIcon}
            eyebrow="Storage Snapshot"
            title="Backend Record Preview"
            description="Confirm the stored payload, review state, and metadata currently held by the API."
            summary="8 fields"
          >
            <div className="submission-detail-storage-grid">
              <KeyValue label="Created At" value={record?.createdAt || item?.created || rawPayload?.createdAt || "-"} />
              <KeyValue label="Updated At" value={record?.updatedAt || record?.processedAt || "-"} />
              <KeyValue label="Status" value={record?.syncStateLabel || item?.badge || "-"} />
              <KeyValue label="Review" value={record?.reviewStateLabel || item?.badge || "-"} />
              <KeyValue label="Structured Status" value={record?.structuredStatusLabel || pickLookupValue(buildLookup(item?.fields || []), "structured ingest") || "-"} />
              <KeyValue label="Structured Warnings" value={record?.structuredWarningCount || 0} />
              <KeyValue label="Source Channel" value={record?.sourceChannel || "Chatbot response"} />
              <KeyValue label="Parser Version" value={record?.parserVersion || "chatbot-summary"} />
            </div>
          </CollapsibleSection>
        </aside>
      </div>
    </div>
  )
}
