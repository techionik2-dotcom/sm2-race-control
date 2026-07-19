"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DocumentScannerRoundedIcon from "@mui/icons-material/DocumentScannerRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import PendingActionsRoundedIcon from "@mui/icons-material/PendingActionsRounded";
import PhotoCameraBackRoundedIcon from "@mui/icons-material/PhotoCameraBackRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import Loader from "../../../components/Common/Loader";
import ScreenBackButton from "../../../components/Common/ScreenBackButton";
import StatusBadge from "../../../components/Common/StatusBadge";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { getEventById, selectActiveEvent } from "../../../utils/eventApi";
import { formatEventDateRange, getEventSubmissionState } from "../../../utils/eventSchedule";
import { getDrivers, getVehicles } from "../../../utils/fleetApi";
import { getRunGroup } from "../../../utils/runGroupApi";
import { DRIVER_OPTIONS, SESSION_TYPE_OPTIONS, VEHICLE_OPTIONS } from "../../../utils/staticOptions";
import {
  clearOcrDraft,
  extractOcrDraft,
  getLatestOcrDraftForEvent,
  getOcrDraftStatus,
  loadOcrDraft,
  rerunOcrDraft,
  saveOcrDraft,
  submitReviewedOcrNote,
} from "../../../utils/submissionApi";
import { generateUUID } from "../../../utils/uuid";
import "./OCRNotes.css";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_OCR_IMAGES = 3;

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

const toInputValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

const toNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
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
    !DATE_PATTERN.test(normalizedDate) ||
    !TIME_PATTERN.test(normalizedTime) ||
    !normalizedDriverId ||
    !/^\d+$/.test(normalizedSessionNumber)
  ) {
    return "";
  }

  return `${normalizedDate.replace(/-/g, "")}-${normalizedTime.replace(":", "")}-${normalizedDriverId}-S${normalizedSessionNumber}`;
};

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

const DEFAULT_SESSION_TYPE = SESSION_TYPE_OPTIONS[0]?.id || "Practice";

const createIntakeState = ({ useSessionDefaults = true, useDateTimeDefaults = true } = {}) => ({
  date: useDateTimeDefaults ? getCurrentLocalDateValue() : "",
  time: useDateTimeDefaults ? getCurrentLocalTimeValue() : "",
  track: "",
  driver_id: "",
  vehicle_id: "",
  session_type: useSessionDefaults ? DEFAULT_SESSION_TYPE : "",
  session_number: useSessionDefaults ? "1" : "",
  duration_min: "",
  notes: "",
});

const buildImageAttachment = (dataUrl, name, index = 0) => {
  const normalizedDataUrl = normalizeText(dataUrl);
  if (!normalizedDataUrl) {
    return null;
  }

  return {
    id: generateUUID(),
    dataUrl: normalizedDataUrl,
    name: normalizeText(name) || `Source image ${index + 1}`,
  };
};

const collectImageAttachments = (...sources) => {
  const attachments = [];

  const appendAttachment = (dataUrl, name) => {
    if (attachments.length >= MAX_OCR_IMAGES) {
      return;
    }

    const attachment = buildImageAttachment(dataUrl, name, attachments.length);
    if (!attachment) {
      return;
    }

    if (attachments.some((existingAttachment) => existingAttachment.dataUrl === attachment.dataUrl)) {
      return;
    }

    attachments.push(attachment);
  };

  const consume = (value) => {
    if (!value || attachments.length >= MAX_OCR_IMAGES) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(consume);
      return;
    }

    if (typeof value === "string") {
      appendAttachment(value);
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const directDataUrl = value.dataUrl || value.image_url || value.imageUrl || value.url;
    if (typeof directDataUrl === "string") {
      appendAttachment(directDataUrl, value.name || value.fileName || value.label);
      return;
    }

    consume(value.image_urls || value.imageUrls);
    consume(value.image_url || value.imageUrl);
  };

  sources.forEach(consume);
  return attachments;
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => reject(new Error(`Failed to read ${file?.name || "image file"}.`));
    reader.readAsDataURL(file);
  });

const CLIENT_SHEET_FIELDS = [
  ["fuel_liters", "Fuel (Liters)"],
  ["driver_weight_lbs", "Driver Weight (lbs)"],
  ["scale_weight_lbs", "Scale Weight (lbs)"],
  ["percentage_box_weight_lbs", "Percentage Box Weight (lbs)"],
  ["cross_weight_percent", "Cross Weight (%)"],
  ["roll_bar_text", "Roll-Bar"],
  ["spacer_text", "Spacer"],
  ["bump_text", "Bump"],
  ["rebound_text", "Rebound"],
  ["springs_front", "Springs Front"],
  ["springs_rear", "Springs Rear"],
  ["bump_stops_front", "Bump-Stops Front"],
  ["bump_stops_rear", "Bump-Stops Rear"],
  ["wheelbase_left_mm", "Wheelbase Left"],
  ["wheelbase_right_mm", "Wheelbase Right"],
  ["wing_rake_deg", "Wing Rake"],
  ["wing_angle_deg", "Wing Angle"],
  ["wing_gurney_mm", "Wing Gurney"],
  ["wicker_text", "Wicker"],
  ["specs_toe_text", "Specs Toe"],
  ["corner_weight_text", "Corner Weight"],
  ["static_ride_height_text", "Static Ride Height"],
  ["bump_stop_height_text", "Bump Stop Height"],
  ["arb_front_text", "ARB Front"],
  ["arb_rear_text", "ARB Rear"],
  ["fuel_pumped_out_liters", "Fuel Pumped Out"],
];

const PRINTED_FORM_PRIMARY_FIELDS = CLIENT_SHEET_FIELDS.filter(
  ([field]) => field !== "fuel_pumped_out_liters",
);

const PRINTED_FORM_MAIN_FIELD_GROUPS = [
  {
    title: "Upper Setup Sheet",
    subtitle: "Fuel, bars, bump, rebound, weights, and springs",
    fields: [
      ["fuel_liters", "Fuel (Liters)"],
      ["driver_weight_lbs", "Driver Weight (lbs)"],
      ["scale_weight_lbs", "Scale Weight (lbs)"],
      ["percentage_box_weight_lbs", "Percentage Box Weight (lbs)"],
      ["cross_weight_percent", "Cross Weight (%)"],
      ["roll_bar_text", "Roll-Bar"],
      ["spacer_text", "Spacer"],
      ["bump_text", "Bump"],
      ["rebound_text", "Rebound"],
      ["springs_front", "Springs Front"],
      ["springs_rear", "Springs Rear"],
      ["bump_stops_front", "Bump-Stops Front"],
      ["bump_stops_rear", "Bump-Stops Rear"],
    ],
  },
  {
    title: "Geometry and Aero Labels",
    subtitle: "Wheelbase, wing, ARB, and template-specific setup values",
    fields: [
      ["wheelbase_left_mm", "Wheelbase Left"],
      ["wheelbase_right_mm", "Wheelbase Right"],
      ["wing_rake_deg", "Wing Rake"],
      ["wing_angle_deg", "Wing Angle"],
      ["wing_gurney_mm", "Wing Gurney"],
      ["wicker_text", "Wicker"],
      ["specs_toe_text", "Specs Toe"],
      ["corner_weight_text", "Corner Weight"],
      ["static_ride_height_text", "Static Ride Height"],
      ["bump_stop_height_text", "Bump Stop Height"],
      ["arb_front_text", "ARB Front"],
      ["arb_rear_text", "ARB Rear"],
    ],
  },
];

const POST_SESSION_FIELDS = [
  ["camber_text", "After Session Camber"],
  ["toe_text", "After Session Toe"],
  ["weight_text", "After Session Weight"],
  ["height_text", "After Session Height"],
  ["shocks_text", "After Session Shocks"],
];

const PRINTED_FORM_AFTER_SESSION_FIELDS = [
  ["fuel_pumped_out_liters", "Fuel Pumped Out"],
  ...POST_SESSION_FIELDS,
];

const SHOCK_SETUP_GROUPS = [
  ["rr", "RR"],
  ["lr", "LR"],
  ["lf", "LF"],
  ["rf", "RF"],
];

const SHOCK_SETUP_FIELDS = [
  ["position", "Position"],
  ["hsr", "HSR"],
  ["lsr", "LSR"],
  ["hsb", "HSB"],
  ["lsb", "LSB"],
  ["total_setup", "Total Setup"],
];

const OCR_REVIEW_SAFE_STATUSES = new Set([
  "partial_extracted",
  "review_required",
  "blank_template_detected",
  "low_quality_review_required",
  "parser_failed_but_raw_text_available",
]);

const createEmptyReviewDraft = () => ({
  status: "idle",
  message: "",
  submissionRef: "",
  correlationId: "",
  source: "",
  docType: "unknown",
  templateName: "",
  confidence: null,
  summary: "",
  rawText: "",
  extractedText: "",
  recommendedReviewStatus: "PENDING",
  parserVersion: null,
  modelUsed: null,
  fallbackUsed: false,
  model: null,
  metadata: {},
  rawEvidence: {
    visible_text: [],
    detected_grids: [],
    detected_labels: [],
    unmapped_values: [],
    quality_flags: [],
    template_labels: [],
  },
  fieldEvidence: [],
  normalizedSections: {},
  preprocessing: {},
  reviewFlags: [],
  parsedSession: {
    date: "",
    time: "",
    track: "",
    session_type: "",
    session_number: "",
    duration_min: "",
    driver_id: "",
    vehicle_id: "",
  },
  alignment: {
    rh_fl: "",
    rh_fr: "",
    rh_rl: "",
    rh_rr: "",
    ride_height_f: "",
    ride_height_r: "",
    camber_fl: "",
    camber_fr: "",
    camber_rl: "",
    camber_rr: "",
    toe_fl: "",
    toe_fr: "",
    toe_rl: "",
    toe_rr: "",
    toe_front: "",
    toe_rear: "",
    caster_l: "",
    caster_r: "",
    rake_mm: "",
    wheelbase_mm: "",
  },
  pressures: {
    cold: { fl: "", fr: "", rl: "", rr: "" },
    hot: { fl: "", fr: "", rl: "", rr: "" },
  },
  suspension: {
    rebound_fl: "",
    rebound_fr: "",
    rebound_rl: "",
    rebound_rr: "",
    bump_fl: "",
    bump_fr: "",
    bump_rl: "",
    bump_rr: "",
    hsr_fl: "",
    hsr_fr: "",
    hsr_rl: "",
    hsr_rr: "",
    lsr_fl: "",
    lsr_fr: "",
    lsr_rl: "",
    lsr_rr: "",
    hsb_fl: "",
    hsb_fr: "",
    hsb_rl: "",
    hsb_rr: "",
    lsb_fl: "",
    lsb_fr: "",
    lsb_rl: "",
    lsb_rr: "",
    sway_bar_f: "",
    sway_bar_r: "",
    wing_angle_deg: "",
  },
  tireTemperatures: {
    fl_in: "",
    fl_mid: "",
    fl_out: "",
    fr_in: "",
    fr_mid: "",
    fr_out: "",
    rl_in: "",
    rl_mid: "",
    rl_out: "",
    rr_in: "",
    rr_mid: "",
    rr_out: "",
  },
  sheetFields: {
    fuel_liters: "",
    driver_weight_lbs: "",
    scale_weight_lbs: "",
    percentage_box_weight_lbs: "",
    cross_weight_percent: "",
    roll_bar_text: "",
    spacer_text: "",
    bump_text: "",
    rebound_text: "",
    springs_front: "",
    springs_rear: "",
    bump_stops_front: "",
    bump_stops_rear: "",
    wheelbase_left_mm: "",
    wheelbase_right_mm: "",
    wing_rake_deg: "",
    wing_angle_deg: "",
    wing_gurney_mm: "",
    wicker_text: "",
    specs_toe_text: "",
    corner_weight_text: "",
    static_ride_height_text: "",
    bump_stop_height_text: "",
    arb_front_text: "",
    arb_rear_text: "",
    fuel_pumped_out_liters: "",
    notes_block: "",
  },
  postSession: {
    camber_text: "",
    toe_text: "",
    weight_text: "",
    height_text: "",
    shocks_text: "",
  },
  shockSetup: {
    rr_position: "",
    rr_hsr: "",
    rr_lsr: "",
    rr_hsb: "",
    rr_lsb: "",
    rr_total_setup: "",
    lr_position: "",
    lr_hsr: "",
    lr_lsr: "",
    lr_hsb: "",
    lr_lsb: "",
    lr_total_setup: "",
    lf_position: "",
    lf_hsr: "",
    lf_lsr: "",
    lf_hsb: "",
    lf_lsb: "",
    lf_total_setup: "",
    rf_position: "",
    rf_hsr: "",
    rf_lsr: "",
    rf_hsb: "",
    rf_lsb: "",
    rf_total_setup: "",
  },
  notes: [],
});

const splitNotes = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  return String(value || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
};

const joinNotes = (value) => splitNotes(value).join("\n");

const sanitizeStringMap = (value) =>
  Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).map(([key, item]) => [key, toInputValue(item)]),
  );

const flattenShockSetup = (value) => {
  const rawValue = value && typeof value === "object" ? value : {};
  const flattened = {};

  SHOCK_SETUP_GROUPS.forEach(([cornerKey]) => {
    const nestedCorner =
      rawValue?.[cornerKey] && typeof rawValue[cornerKey] === "object" ? rawValue[cornerKey] : null;

    flattened[`${cornerKey}_position`] = toInputValue(
      nestedCorner?.position ?? rawValue?.[`${cornerKey}_position`],
    );
    SHOCK_SETUP_FIELDS.forEach(([fieldKey]) => {
      flattened[`${cornerKey}_${fieldKey}`] = toInputValue(
        nestedCorner?.[fieldKey] ??
          rawValue?.[`${cornerKey}_${fieldKey}`] ??
          (fieldKey === "hsb" ? rawValue?.[`${cornerKey}_hbs`] : undefined),
      );
    });
  });

  return flattened;
};

const nestShockSetup = (value) =>
  Object.fromEntries(
    SHOCK_SETUP_GROUPS.map(([cornerKey]) => [
      cornerKey,
      {
        position: normalizeText(value?.[`${cornerKey}_position`]),
        hsr: normalizeText(value?.[`${cornerKey}_hsr`]),
        lsr: normalizeText(value?.[`${cornerKey}_lsr`]),
        hsb: normalizeText(value?.[`${cornerKey}_hsb`]),
        lsb: normalizeText(value?.[`${cornerKey}_lsb`]),
        total_setup: normalizeText(value?.[`${cornerKey}_total_setup`]),
      },
    ]),
  );

const hasMeaningfulMapValue = (value) => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).some((item) => {
    if (item && typeof item === "object") {
      return hasMeaningfulMapValue(item);
    }

    return normalizeText(item).length > 0;
  });
};

const countMeaningfulValues = (value) => {
  if (!value || typeof value !== "object") {
    return 0;
  }

  return Object.values(value).reduce((total, item) => {
    if (item && typeof item === "object") {
      return total + countMeaningfulValues(item);
    }

    return total + (normalizeText(item).length > 0 ? 1 : 0);
  }, 0);
};

const pickFieldSubset = (source, fields) =>
  fields.reduce((accumulator, [field]) => {
    accumulator[field] = source?.[field] ?? "";
    return accumulator;
  }, {});

const formatCapturedSummary = (count, populatedLabel, emptyLabel = "Available for manual entry") =>
  count > 0 ? `${count} ${populatedLabel}${count === 1 ? "" : "s"} captured` : emptyLabel;

const formatNullableMetaValue = (value, fallback = "NULL") => normalizeText(value) || fallback;

const resolveAggregateReviewValue = (aggregateValue, primaryValue, secondaryValue) => {
  const explicitAggregateValue = toInputValue(aggregateValue);
  if (explicitAggregateValue) {
    return explicitAggregateValue;
  }

  const normalizedPrimaryValue = toInputValue(primaryValue);
  const normalizedSecondaryValue = toInputValue(secondaryValue);
  return normalizedPrimaryValue && normalizedPrimaryValue === normalizedSecondaryValue ? normalizedPrimaryValue : "";
};

const formatReviewSnapshotSessionLabel = (sessionType, sessionNumber) => {
  const normalizedSessionType = normalizeText(sessionType);
  const normalizedSessionNumber = normalizeText(sessionNumber);

  if (normalizedSessionType && normalizedSessionNumber) {
    return `${normalizedSessionType} / S${normalizedSessionNumber}`;
  }

  if (normalizedSessionType) {
    return normalizedSessionType;
  }

  if (normalizedSessionNumber) {
    return `S${normalizedSessionNumber}`;
  }

  return "Optional";
};

const hasExtractedDraftData = (reviewDraft) =>
  Boolean(
    normalizeText(reviewDraft?.summary) ||
      normalizeText(reviewDraft?.rawText) ||
      normalizeText(reviewDraft?.extractedText) ||
      (Array.isArray(reviewDraft?.notes) && reviewDraft.notes.length > 0) ||
      hasMeaningfulMapValue(reviewDraft?.alignment) ||
      hasMeaningfulMapValue(reviewDraft?.pressures) ||
      hasMeaningfulMapValue(reviewDraft?.suspension) ||
      hasMeaningfulMapValue(reviewDraft?.tireTemperatures) ||
      hasMeaningfulMapValue(reviewDraft?.sheetFields) ||
      hasMeaningfulMapValue(reviewDraft?.postSession) ||
      hasMeaningfulMapValue(reviewDraft?.shockSetup),
  );

const mergePreviewIntoReviewDraft = (preview) => {
  const baseDraft = createEmptyReviewDraft();
  const structuredData = preview?.structuredData || {};
  const alignmentSource = structuredData?.alignment || {};
  const pressureSource = structuredData?.pressures || {};
  const frontRideHeight = resolveAggregateReviewValue(
    alignmentSource.ride_height_f,
    alignmentSource.rh_fl,
    alignmentSource.rh_fr,
  );
  const rearRideHeight = resolveAggregateReviewValue(
    alignmentSource.ride_height_r,
    alignmentSource.rh_rl,
    alignmentSource.rh_rr,
  );
  const frontToe = resolveAggregateReviewValue(
    alignmentSource.toe_front,
    alignmentSource.toe_fl,
    alignmentSource.toe_fr,
  );
  const rearToe = resolveAggregateReviewValue(
    alignmentSource.toe_rear,
    alignmentSource.toe_rl,
    alignmentSource.toe_rr,
  );

  return {
    ...baseDraft,
    status: preview?.status || "success",
    message: preview?.message || "",
    submissionRef: preview?.submissionRef || "",
    correlationId: preview?.correlationId || "",
    source: preview?.source || "",
    docType: preview?.docType || "unknown",
    templateName:
      preview?.templateName || preview?.metadata?.template_name || preview?.metadata?.templateName || "",
    confidence: typeof preview?.confidence === "number" ? preview.confidence : null,
    rawText: preview?.rawText || "",
    summary: preview?.summary || "",
    extractedText: preview?.extractedText || "",
    recommendedReviewStatus: preview?.recommendedReviewStatus || "PENDING",
    parserVersion: preview?.parserVersion || null,
    modelUsed: preview?.modelUsed || preview?.model || null,
    fallbackUsed: Boolean(preview?.fallbackUsed),
    model: preview?.modelUsed || preview?.model || null,
    metadata: preview?.metadata || {},
    rawEvidence: preview?.rawEvidence || baseDraft.rawEvidence,
    fieldEvidence: Array.isArray(preview?.fieldEvidence) ? preview.fieldEvidence : [],
    normalizedSections:
      preview?.normalizedSections && typeof preview.normalizedSections === "object"
        ? preview.normalizedSections
        : {},
    preprocessing:
      preview?.preprocessing && typeof preview.preprocessing === "object" ? preview.preprocessing : {},
    reviewFlags: Array.isArray(preview?.reviewFlags) ? preview.reviewFlags : [],
    parsedSession: {
      ...baseDraft.parsedSession,
      ...sanitizeStringMap(structuredData?.session || {}),
    },
    alignment: {
      ...baseDraft.alignment,
      ...sanitizeStringMap(alignmentSource),
      rh_fl: toInputValue(alignmentSource.rh_fl),
      rh_fr: toInputValue(alignmentSource.rh_fr),
      rh_rl: toInputValue(alignmentSource.rh_rl),
      rh_rr: toInputValue(alignmentSource.rh_rr),
      ride_height_f: frontRideHeight,
      ride_height_r: rearRideHeight,
      toe_fl: toInputValue(alignmentSource.toe_fl),
      toe_fr: toInputValue(alignmentSource.toe_fr),
      toe_rl: toInputValue(alignmentSource.toe_rl),
      toe_rr: toInputValue(alignmentSource.toe_rr),
      toe_front: frontToe,
      toe_rear: rearToe,
    },
    pressures: {
      cold: {
        ...baseDraft.pressures.cold,
        ...sanitizeStringMap(pressureSource?.cold || {}),
      },
      hot: {
        ...baseDraft.pressures.hot,
        ...sanitizeStringMap(pressureSource?.hot || {}),
      },
    },
    suspension: {
      ...baseDraft.suspension,
      ...sanitizeStringMap(structuredData?.suspension || structuredData?.suspensions || {}),
    },
    tireTemperatures: {
      ...baseDraft.tireTemperatures,
      ...sanitizeStringMap(structuredData?.tire_temperatures || structuredData?.tireTemperatures || {}),
    },
    sheetFields: {
      ...baseDraft.sheetFields,
      ...sanitizeStringMap(structuredData?.sheet_fields || structuredData?.sheetFields || {}),
    },
    postSession: {
      ...baseDraft.postSession,
      ...sanitizeStringMap(structuredData?.post_session || structuredData?.postSession || {}),
    },
    shockSetup: {
      ...baseDraft.shockSetup,
      ...flattenShockSetup(structuredData?.shock_setup || structuredData?.shockSetup || {}),
    },
    notes: splitNotes(structuredData?.notes || []),
  };
};

const mergePreviewIntoIntake = (intakeState, preview, eventTrack) => {
  const extractedSession = preview?.structuredData?.session || {};

  return {
    ...intakeState,
    date: normalizeText(intakeState.date) || toInputValue(extractedSession.date) || intakeState.date,
    time: normalizeText(intakeState.time) || toInputValue(extractedSession.time) || intakeState.time,
    track: normalizeText(intakeState.track) || toInputValue(extractedSession.track) || eventTrack || "",
    driver_id: normalizeText(intakeState.driver_id) || toInputValue(extractedSession.driver_id),
    vehicle_id: normalizeText(intakeState.vehicle_id) || toInputValue(extractedSession.vehicle_id),
    session_type:
      normalizeText(intakeState.session_type) || toInputValue(extractedSession.session_type) || intakeState.session_type,
    session_number:
      normalizeText(intakeState.session_number) || toInputValue(extractedSession.session_number) || intakeState.session_number,
    duration_min:
      normalizeText(intakeState.duration_min) || toInputValue(extractedSession.duration_min) || intakeState.duration_min,
    notes: intakeState.notes,
  };
};

const buildReviewedRawText = (intakeState, reviewDraft) => {
  const parts = [
    normalizeText(intakeState.notes),
    normalizeText(reviewDraft.sheetFields?.notes_block),
    joinNotes(reviewDraft.notes),
    normalizeText(reviewDraft.summary),
  ].filter(Boolean);

  if (parts.length === 0 && normalizeText(reviewDraft.extractedText)) {
    parts.push(normalizeText(reviewDraft.extractedText));
  }

  if (parts.length === 0 && normalizeText(reviewDraft.rawText)) {
    parts.push(normalizeText(reviewDraft.rawText));
  }

  return parts.join("\n\n") || null;
};

const buildReviewedImageAnalysis = (intakeState, reviewDraft, eventTrack) => {
  const sessionNote = joinNotes(reviewDraft.notes);
  const frontRideHeight = resolveAggregateReviewValue(
    reviewDraft.alignment.ride_height_f,
    reviewDraft.alignment.rh_fl,
    reviewDraft.alignment.rh_fr,
  );
  const rearRideHeight = resolveAggregateReviewValue(
    reviewDraft.alignment.ride_height_r,
    reviewDraft.alignment.rh_rl,
    reviewDraft.alignment.rh_rr,
  );
  const frontToe = resolveAggregateReviewValue(
    reviewDraft.alignment.toe_front,
    reviewDraft.alignment.toe_fl,
    reviewDraft.alignment.toe_fr,
  );
  const rearToe = resolveAggregateReviewValue(
    reviewDraft.alignment.toe_rear,
    reviewDraft.alignment.toe_rl,
    reviewDraft.alignment.toe_rr,
  );

  return {
    status: reviewDraft.status || "review_required",
    message: reviewDraft.message || "",
    document_type: reviewDraft.docType || "unknown",
    template_name: reviewDraft.templateName || reviewDraft.metadata?.template_name || "",
    confidence: typeof reviewDraft.confidence === "number" ? reviewDraft.confidence : 0,
    has_values: hasExtractedDraftData(reviewDraft),
    summary: reviewDraft.summary || "",
    raw_text: reviewDraft.rawText || reviewDraft.extractedText || "",
    extracted_text: reviewDraft.extractedText || "",
    quality_flags: Array.isArray(reviewDraft.rawEvidence?.quality_flags) ? reviewDraft.rawEvidence.quality_flags : [],
    metadata: {
      driver_text: reviewDraft.metadata?.driver_text || "",
      track_text:
        normalizeText(reviewDraft.metadata?.track_text) ||
        normalizeText(intakeState.track) ||
        normalizeText(eventTrack),
      session_text:
        normalizeText(reviewDraft.metadata?.session_text) ||
        `${normalizeText(intakeState.session_type)} ${normalizeText(intakeState.session_number)}`.trim(),
    },
    raw_evidence: reviewDraft.rawEvidence || {},
    field_evidence: Array.isArray(reviewDraft.fieldEvidence) ? reviewDraft.fieldEvidence : [],
    normalized_sections:
      reviewDraft.normalizedSections && typeof reviewDraft.normalizedSections === "object"
        ? reviewDraft.normalizedSections
        : {},
    preprocessing:
      reviewDraft.preprocessing && typeof reviewDraft.preprocessing === "object" ? reviewDraft.preprocessing : {},
    setup: {
      pressures: {
        cold_fl: normalizeText(reviewDraft.pressures.cold.fl),
        cold_fr: normalizeText(reviewDraft.pressures.cold.fr),
        cold_rl: normalizeText(reviewDraft.pressures.cold.rl),
        cold_rr: normalizeText(reviewDraft.pressures.cold.rr),
        hot_fl: normalizeText(reviewDraft.pressures.hot.fl),
        hot_fr: normalizeText(reviewDraft.pressures.hot.fr),
        hot_rl: normalizeText(reviewDraft.pressures.hot.rl),
        hot_rr: normalizeText(reviewDraft.pressures.hot.rr),
      },
      suspension: {
        ...sanitizeStringMap(reviewDraft.suspension),
      },
      alignment: {
        rh_fl: normalizeText(reviewDraft.alignment.rh_fl),
        rh_fr: normalizeText(reviewDraft.alignment.rh_fr),
        rh_rl: normalizeText(reviewDraft.alignment.rh_rl),
        rh_rr: normalizeText(reviewDraft.alignment.rh_rr),
        camber_fl: normalizeText(reviewDraft.alignment.camber_fl),
        camber_fr: normalizeText(reviewDraft.alignment.camber_fr),
        camber_rl: normalizeText(reviewDraft.alignment.camber_rl),
        camber_rr: normalizeText(reviewDraft.alignment.camber_rr),
        toe_fl: normalizeText(reviewDraft.alignment.toe_fl),
        toe_fr: normalizeText(reviewDraft.alignment.toe_fr),
        toe_rl: normalizeText(reviewDraft.alignment.toe_rl),
        toe_rr: normalizeText(reviewDraft.alignment.toe_rr),
        toe_front: frontToe,
        toe_rear: rearToe,
        caster_l: normalizeText(reviewDraft.alignment.caster_l),
        caster_r: normalizeText(reviewDraft.alignment.caster_r),
        ride_height_f: frontRideHeight,
        ride_height_r: rearRideHeight,
        rake_mm: normalizeText(reviewDraft.alignment.rake_mm),
        wheelbase_mm: normalizeText(reviewDraft.alignment.wheelbase_mm),
      },
      tire_temperatures: {
        ...sanitizeStringMap(reviewDraft.tireTemperatures),
      },
      sheet_fields: {
        ...sanitizeStringMap(reviewDraft.sheetFields),
      },
      post_session: {
        ...sanitizeStringMap(reviewDraft.postSession),
      },
      shock_setup: nestShockSetup(reviewDraft.shockSetup),
      notes: splitNotes(reviewDraft.notes),
    },
    warnings: Array.isArray(reviewDraft.reviewFlags) ? reviewDraft.reviewFlags : [],
    recommended_review_status: reviewDraft.recommendedReviewStatus || "PENDING",
    parser_version: reviewDraft.parserVersion || undefined,
    model: reviewDraft.modelUsed || reviewDraft.model || undefined,
    fallback_model_used: Boolean(reviewDraft.fallbackUsed),
  };
};

const buildReviewedSubmissionRequest = ({
  intakeState,
  reviewDraft,
  eventId,
  runGroupValue,
  eventTrack,
  imageAttachments,
}) => {
  const normalizedImageAttachments = collectImageAttachments(imageAttachments);
  const imageUrls = normalizedImageAttachments.map((attachment) => attachment.dataUrl).filter(Boolean);
  const primaryImageUrl = imageUrls[0] || null;
  const generatedSessionId =
    buildGeneratedSessionId(intakeState.date, intakeState.time, intakeState.driver_id, intakeState.session_number) ||
    generateUUID();
  const reviewedImageAnalysis = buildReviewedImageAnalysis(intakeState, reviewDraft, eventTrack);
  const rideHeightFront = resolveAggregateReviewValue(
    reviewDraft.alignment.ride_height_f,
    reviewDraft.alignment.rh_fl,
    reviewDraft.alignment.rh_fr,
  );
  const rideHeightRear = resolveAggregateReviewValue(
    reviewDraft.alignment.ride_height_r,
    reviewDraft.alignment.rh_rl,
    reviewDraft.alignment.rh_rr,
  );
  const toeFront = resolveAggregateReviewValue(
    reviewDraft.alignment.toe_front,
    reviewDraft.alignment.toe_fl,
    reviewDraft.alignment.toe_fr,
  );
  const toeRear = resolveAggregateReviewValue(
    reviewDraft.alignment.toe_rear,
    reviewDraft.alignment.toe_rl,
    reviewDraft.alignment.toe_rr,
  );

  return {
    submissionId: generatedSessionId,
    session_id: generatedSessionId,
    correlation_id: generateUUID(),
    source: "pwa",
    eventId,
    runGroup: runGroupValue || undefined,
    driver_id: normalizeText(intakeState.driver_id) || null,
    vehicle_id: normalizeText(intakeState.vehicle_id) || null,
    confidence: reviewDraft.confidence ?? 0.84,
    raw_text: buildReviewedRawText(intakeState, reviewDraft),
    image_url: primaryImageUrl,
    image_urls: imageUrls,
    payload: {
      image_urls: imageUrls,
      data: {
        date: normalizeText(intakeState.date) || null,
        time: normalizeText(intakeState.time) || null,
        session_id: generatedSessionId,
        track: normalizeText(intakeState.track) || normalizeText(eventTrack) || null,
        run_group: normalizeText(runGroupValue) || null,
        driver_id: normalizeText(intakeState.driver_id) || null,
        vehicle_id: normalizeText(intakeState.vehicle_id) || null,
        session_type: normalizeText(intakeState.session_type) || null,
        session_number: toNullableNumber(intakeState.session_number),
        duration_min: toNullableNumber(intakeState.duration_min),
        wheelbase_mm: toNullableNumber(reviewDraft.alignment.wheelbase_mm),
        pressures: {
          cold: {
            fl: toNullableNumber(reviewDraft.pressures.cold.fl),
            fr: toNullableNumber(reviewDraft.pressures.cold.fr),
            rl: toNullableNumber(reviewDraft.pressures.cold.rl),
            rr: toNullableNumber(reviewDraft.pressures.cold.rr),
          },
          hot: {
            fl: toNullableNumber(reviewDraft.pressures.hot.fl),
            fr: toNullableNumber(reviewDraft.pressures.hot.fr),
            rl: toNullableNumber(reviewDraft.pressures.hot.rl),
            rr: toNullableNumber(reviewDraft.pressures.hot.rr),
          },
        },
        suspension: Object.fromEntries(
          Object.entries(reviewDraft.suspension).map(([key, value]) => [
            key,
            toNullableNumber(value) ?? (normalizeText(value) || null),
          ]),
        ),
        alignment: {
          camber_fl: toNullableNumber(reviewDraft.alignment.camber_fl),
          camber_fr: toNullableNumber(reviewDraft.alignment.camber_fr),
          camber_rl: toNullableNumber(reviewDraft.alignment.camber_rl),
          camber_rr: toNullableNumber(reviewDraft.alignment.camber_rr),
          toe_front: toNullableNumber(toeFront) ?? (normalizeText(toeFront) || null),
          toe_rear: toNullableNumber(toeRear) ?? (normalizeText(toeRear) || null),
          caster_l: toNullableNumber(reviewDraft.alignment.caster_l),
          caster_r: toNullableNumber(reviewDraft.alignment.caster_r),
          ride_height_f: toNullableNumber(rideHeightFront),
          ride_height_r: toNullableNumber(rideHeightRear),
          rake_mm: toNullableNumber(reviewDraft.alignment.rake_mm),
          wheelbase_mm: toNullableNumber(reviewDraft.alignment.wheelbase_mm),
        },
        tire_temperatures: Object.fromEntries(
          Object.entries(reviewDraft.tireTemperatures).map(([key, value]) => [key, toNullableNumber(value)]),
        ),
        extended_setup: {
          sheet_fields: {
            ...sanitizeStringMap(reviewDraft.sheetFields),
          },
          post_session: {
            ...sanitizeStringMap(reviewDraft.postSession),
          },
          shock_setup: {
            ...nestShockSetup(reviewDraft.shockSetup),
          },
        },
      },
      ocr_review: {
        doc_type: reviewDraft.docType,
        template_name: reviewDraft.templateName || null,
        confidence: reviewDraft.confidence,
        raw_text: reviewDraft.rawText,
        summary: reviewDraft.summary,
        extracted_text: reviewDraft.extractedText,
        notes: reviewDraft.notes,
        review_flags: reviewDraft.reviewFlags,
        metadata: reviewDraft.metadata,
      },
    },
    analysis_result: {
      submission_mode: "detail",
      source_type: "ocr_review",
      confidence: reviewDraft.confidence ?? 0.84,
      ocr_entrypoint: true,
      ocr_review_required: true,
      force_review_staging: true,
      review_before_submission: true,
      has_image_analysis: true,
      image_analysis_review_status: reviewDraft.recommendedReviewStatus || "PENDING",
      image_analysis: reviewedImageAnalysis,
      ocr_metadata: reviewDraft.metadata,
      ocr_review_flags: reviewDraft.reviewFlags,
      ocr_workflow_state: "review_submitted",
      ocr_doc_type: reviewDraft.docType,
      ocr_parser_version: reviewDraft.parserVersion,
      ocr_model: reviewDraft.modelUsed || reviewDraft.model,
      ocr_fallback_used: Boolean(reviewDraft.fallbackUsed),
      ocr_source_submission_ref: normalizeText(reviewDraft.submissionRef) || null,
      ocr_source_correlation_id: normalizeText(reviewDraft.correlationId) || null,
      ocr_source: normalizeText(reviewDraft.source) || null,
    },
  };
};

const getSubmissionFailureMessage = (errorLike) => {
  const code = String(errorLike?.code || "").trim().toUpperCase();
  const message = String(errorLike?.message || errorLike?.error || "").trim();

  if (code === "SUBMISSION_ALREADY_EXISTS") {
    return "This OCR session already exists. Adjust the session time or session number, then submit again.";
  }

  if (code === "SUBMISSION_DUPLICATE") {
    return "A matching OCR submission already exists for this event and session context.";
  }

  if (code === "SUBMISSION_SAVE_FAILED") {
    return "The backend could not save this OCR review submission. Please try again.";
  }

  return message || "OCR review submission failed. Please try again.";
};

const getExtractionFailureMessage = (errorLike) => {
  const code = String(errorLike?.code || "").trim().toUpperCase();
  const message = String(errorLike?.message || errorLike?.error || "").trim();

  if (code === "OCR_EXTRACTION_DISABLED") {
    return "OCR extraction is unavailable right now. Please try again later or use the typed notes flow.";
  }

  if (code === "OCR_EXTRACTION_FAILED") {
    return "OCR service failed. Please retry or enter manually.";
  }

  return message || "OCR extraction failed. Please try again.";
};

const getOcrStatusMessage = (status, fallbackMessage = "") => {
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "blank_template_detected") {
    return "Blank setup template detected. No handwritten values found.";
  }
  if (normalizedStatus === "partial_extracted") {
    return "Partial OCR extracted. Please review highlighted fields.";
  }
  if (normalizedStatus === "low_quality_review_required") {
    return "Low-quality image. Manual review is required.";
  }
  if (normalizedStatus === "parser_failed_but_raw_text_available") {
    return "Parser failed, but raw OCR text is available.";
  }
  if (normalizedStatus === "review_required") {
    return "OCR draft needs review. Some values may be incomplete or uncertain.";
  }
  if (normalizedStatus === "extraction_failed") {
    return "OCR service failed. Please retry or enter manually.";
  }
  if (normalizedStatus === "submitted_to_make") {
    return "Submitted to Make.com. Waiting for the OCR draft response.";
  }
  if (normalizedStatus === "success") {
    return "OCR draft ready. Review and correct the extracted setup values before submitting.";
  }
  return fallbackMessage || "OCR draft needs review. Some values may be incomplete or uncertain.";
};

const isReviewSafeOcrStatus = (status) => OCR_REVIEW_SAFE_STATUSES.has(normalizeText(status));

const getSubmissionSuccessState = (submission) => {
  const structuredStatus = String(submission?.structuredIngestStatus || "").trim().toLowerCase();
  const warnings = Array.isArray(submission?.structuredIngestWarnings)
    ? submission.structuredIngestWarnings
    : [];
  const stagedForReview = warnings.some(
    (warning) => String(warning?.code || "").trim().toUpperCase() === "IMAGE_STAGED_FOR_REVIEW",
  );

  if (structuredStatus === "pending_review" || stagedForReview) {
    return {
      status: "submitted_for_review",
      message:
        "OCR note submitted for review. The source image and reviewed setup draft are staged for validation before final application.",
      warnings,
    };
  }

  if (warnings.length > 0) {
    return {
      status: "submitted_with_warnings",
      message: "OCR note submitted. Review the warnings below before relying on the extracted setup values.",
      warnings,
    };
  }

  return {
    status: "submitted",
    message: "OCR note submitted successfully. Review it from the event submissions history.",
    warnings: [],
  };
};

const resolveCurrentUserStorageKey = () => {
  if (typeof window === "undefined") {
    return "anonymous";
  }

  try {
    const storedUser = window.localStorage.getItem("sm2_user");
    if (!storedUser) {
      return "anonymous";
    }

    const parsedUser = JSON.parse(storedUser);
    return (
      parsedUser?.id ||
      parsedUser?._id ||
      parsedUser?.userId ||
      parsedUser?.email ||
      parsedUser?.user?.id ||
      parsedUser?.user?._id ||
      parsedUser?.user?.userId ||
      parsedUser?.user?.email ||
      "anonymous"
    );
  } catch (error) {
    console.warn("Failed to resolve OCR draft storage key:", error);
    return "anonymous";
  }
};

const getWorkflowPresentation = (workflowState) => {
  switch (workflowState) {
    case "waiting_for_image":
      return {
        label: "Waiting for Image",
        note: "Upload a setup sheet or handwritten notes image to begin OCR extraction.",
      };
    case "ready_to_extract":
      return {
        label: "Ready to Submit",
        note: "Minimal intake context is set. Submit to Make.com to build the first editable draft.",
      };
    case "extracting":
      return {
        label: "Submitting to Make.com",
        note: "The image and intake context were submitted to Make.com. Waiting for the OCR draft response.",
      };
    case "submitted_to_make":
      return {
        label: "Submitted to Make.com",
        note: "The image reached Make.com. Waiting for the OCR draft response.",
      };
    case "extract_success":
      return {
        label: "OCR Draft Ready",
        note: "Review the extracted setup values, resolve warnings, and submit the reviewed draft for staging.",
      };
    case "extract_failed":
      return {
        label: "Make.com Submission Failed",
        note: "Keep the image, adjust the intake context if needed, and resubmit to Make.com.",
      };
    case "editing_review":
      return {
        label: "Review Required",
        note: "The extracted values are editable. Confirm or correct them before submission.",
      };
    case "rerunning_ocr":
      return {
        label: "Resubmitting to Make.com",
        note: "Refreshing the OCR draft by resubmitting the current image and intake context to Make.com.",
      };
    case "saving_draft":
      return {
        label: "Saving Draft",
        note: "Saving this OCR workflow locally on the current device.",
      };
    case "draft_saved":
      return {
        label: "Draft Saved",
        note: "The current OCR intake and review edits are stored locally on this device.",
      };
    case "submitting_review":
      return {
        label: "Submitting Review",
        note: "Submitting the reviewed OCR-backed note for staging and validation.",
      };
    case "submit_success":
      return {
        label: "Ready for Submission",
        note: "The OCR-backed note is now in the review pipeline and available from Submissions history.",
      };
    case "submit_failed":
      return {
        label: "Submission Failed",
        note: "The reviewed OCR note did not submit cleanly. Nothing was reset, so you can correct and retry.",
      };
    default:
      return {
        label: "Waiting for Image",
        note: "Upload a setup sheet or handwritten notes image to begin OCR extraction.",
      };
  }
};

export function OCRWorkflowPage({ initialView = "intake" } = {}) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const routeEventId = params?.eventId;
  const isReviewView = initialView === "review";
  const intakeRoute = routeEventId ? `/event/${routeEventId}/ocr-notes` : "/events";
  const reviewRoute = routeEventId ? `/event/${routeEventId}/ocr-review` : "/events";
  const manualIntakeRoute = routeEventId ? `/event/${routeEventId}/ocr-notes?view=intake` : "/events";
  const forceIntakeView = searchParams?.get("view") === "intake";
  const queryCorrelationId = normalizeText(searchParams?.get("correlation_id"));
  const querySubmissionRef = normalizeText(searchParams?.get("submission_ref"));
  const buildReviewRoute = useCallback(
    (correlationId, submissionRef) => {
      const params = new URLSearchParams();
      if (normalizeText(correlationId)) {
        params.set("correlation_id", normalizeText(correlationId));
      }
      if (normalizeText(submissionRef)) {
        params.set("submission_ref", normalizeText(submissionRef));
      }

      const query = params.toString();
      return query ? `${reviewRoute}?${query}` : reviewRoute;
    },
    [reviewRoute],
  );

  const [event, setEvent] = useState(null);
  const [runGroup, setRunGroup] = useState(null);
  const [driverOptions, setDriverOptions] = useState(DRIVER_OPTIONS);
  const [vehicleOptions, setVehicleOptions] = useState(VEHICLE_OPTIONS);
  const [intakeState, setIntakeState] = useState(() =>
    createIntakeState({
      useSessionDefaults: !isReviewView,
      useDateTimeDefaults: !isReviewView,
    }),
  );
  const [reviewDraft, setReviewDraft] = useState(() => createEmptyReviewDraft());
  const [imageAttachments, setImageAttachments] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [submissionWarnings, setSubmissionWarnings] = useState([]);
  const [workflowState, setWorkflowState] = useState("idle");
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [currentUserStorageKey, setCurrentUserStorageKey] = useState(() => resolveCurrentUserStorageKey());
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [reviewBootstrapComplete, setReviewBootstrapComplete] = useState(() => !isReviewView);
  const imageUrls = imageAttachments.map((attachment) => attachment.dataUrl).filter(Boolean);
  const imageDataUrl = imageUrls[0] || null;
  const imageName =
    imageAttachments.length === 1
      ? imageAttachments[0]?.name || ""
      : imageAttachments.length > 1
        ? `${imageAttachments.length} source images selected`
        : "";

  useEffect(() => {
    const resolvedStorageKey = resolveCurrentUserStorageKey();
    setCurrentUserStorageKey((previousStorageKey) =>
      previousStorageKey === resolvedStorageKey ? previousStorageKey : resolvedStorageKey,
    );
  }, []);

  const loadPageData = useCallback(async () => {
    if (!routeEventId) {
      router.push("/events");
      return;
    }

    setLoading(true);
    setPageError("");

    const [eventResult, runGroupResult, driversResult, vehiclesResult] = await Promise.allSettled([
      getEventById(routeEventId),
      getRunGroup(routeEventId),
      getDrivers(),
      getVehicles(),
    ]);

    try {
      if (eventResult.status !== "fulfilled") {
        throw eventResult.reason || new Error("Failed to load event");
      }

      const eventData = eventResult.value?.event || eventResult.value?.data || eventResult.value;
      if (!eventData || !(eventData.id || eventData._id || eventData.name)) {
        throw new Error("Event not found.");
      }

      setEvent(eventData);
      selectActiveEvent(routeEventId).catch((selectError) => {
        console.warn("Failed to set active event:", selectError);
      });

      setRunGroup(
        runGroupResult.status === "fulfilled" && runGroupResult.value && typeof runGroupResult.value === "object"
          ? runGroupResult.value
          : null,
      );

      const nextDrivers =
        driversResult.status === "fulfilled"
          ? (driversResult.value?.drivers || []).map(buildDriverOption).filter((driver) => driver.id)
          : [];
      const nextVehicles =
        vehiclesResult.status === "fulfilled"
          ? (vehiclesResult.value?.vehicles || []).map(buildVehicleOption).filter((vehicle) => vehicle.id)
          : [];

      setDriverOptions(nextDrivers.length > 0 ? nextDrivers : DRIVER_OPTIONS);
      setVehicleOptions(nextVehicles.length > 0 ? nextVehicles : VEHICLE_OPTIONS);
    } catch (error) {
      console.error("Failed to load OCR notes workspace:", error);
      setEvent(null);
      setRunGroup(null);
      setPageError("Failed to load the OCR Notes workspace. Please refresh and try again.");
      setDriverOptions(DRIVER_OPTIONS);
      setVehicleOptions(VEHICLE_OPTIONS);
    } finally {
      setLoading(false);
    }
  }, [routeEventId, router]);

  useEffect(() => {
    loadPageData();
  }, [loadPageData]);

  const eventTrack = event?.track || event?.track_name || "";
  const eventDates = formatEventDateRange(event?.startDate || event?.start_date, event?.endDate || event?.end_date);
  const submissionState = event
    ? getEventSubmissionState(event)
    : { isOpen: false, isUpcoming: false, hasEnded: false };
  const runGroupValue = runGroup?.normalized || runGroup?.rawText || runGroup?.raw_text || "Not assigned yet";
  const runGroupId = runGroup?.id || runGroup?._id || null;
  const hasRunGroup = Boolean(runGroupId && runGroupValue && runGroupValue !== "Not assigned yet");
  const canSubmitOcr = hasRunGroup && submissionState.isOpen;

  useEffect(() => {
    if (!eventTrack) {
      return;
    }

    setIntakeState((prev) => {
      if (normalizeText(prev.track)) {
        return prev;
      }

      return { ...prev, track: eventTrack };
    });
  }, [eventTrack]);

  const vehicleOptionsForDriver = useMemo(() => {
    const selectedDriverId = String(intakeState.driver_id || "").trim();
    if (!selectedDriverId) {
      return vehicleOptions;
    }

    const filteredVehicles = vehicleOptions.filter(
      (vehicle) => String(vehicle.driverId || "").trim() === selectedDriverId,
    );
    return filteredVehicles.length > 0 ? filteredVehicles : vehicleOptions;
  }, [intakeState.driver_id, vehicleOptions]);

  useEffect(() => {
    if (!intakeState.vehicle_id || !intakeState.driver_id) {
      return;
    }

    const vehicleStillValid = vehicleOptionsForDriver.some(
      (vehicle) => String(vehicle.id || "").trim() === String(intakeState.vehicle_id || "").trim(),
    );

    if (!vehicleStillValid) {
      setIntakeState((prev) => ({ ...prev, vehicle_id: "" }));
    }
  }, [intakeState.driver_id, intakeState.vehicle_id, vehicleOptionsForDriver]);

  const draftStorageKey = useMemo(() => {
    if (!routeEventId || !currentUserStorageKey) {
      return null;
    }

    return `sm2:ocr-draft:${routeEventId}:${currentUserStorageKey}`;
  }, [currentUserStorageKey, routeEventId]);

  useEffect(() => {
    setHasLoadedDraft(false);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || hasLoadedDraft) {
      return;
    }

    const storedDraft = loadOcrDraft(draftStorageKey);
    if (storedDraft) {
      setIntakeState((prev) => ({
        ...prev,
        ...sanitizeStringMap(storedDraft.intakeState || {}),
        track: normalizeText(storedDraft?.intakeState?.track) || prev.track,
      }));
      setReviewDraft((prev) => ({
        ...prev,
        ...mergePreviewIntoReviewDraft({
          structuredData: {
            session: storedDraft?.reviewDraft?.parsedSession || {},
            alignment: storedDraft?.reviewDraft?.alignment || {},
            pressures: storedDraft?.reviewDraft?.pressures || {},
            suspension: storedDraft?.reviewDraft?.suspension || {},
            tire_temperatures:
              storedDraft?.reviewDraft?.tireTemperatures || storedDraft?.reviewDraft?.tire_temperatures || {},
            sheet_fields: storedDraft?.reviewDraft?.sheetFields || storedDraft?.reviewDraft?.sheet_fields || {},
            post_session: storedDraft?.reviewDraft?.postSession || storedDraft?.reviewDraft?.post_session || {},
            shock_setup: storedDraft?.reviewDraft?.shockSetup || storedDraft?.reviewDraft?.shock_setup || {},
            notes: storedDraft?.reviewDraft?.notes || [],
          },
          status: storedDraft?.reviewDraft?.status,
          message: storedDraft?.reviewDraft?.message,
          docType: storedDraft?.reviewDraft?.docType,
          templateName: storedDraft?.reviewDraft?.templateName,
          confidence: storedDraft?.reviewDraft?.confidence,
          summary: storedDraft?.reviewDraft?.summary,
          extractedText: storedDraft?.reviewDraft?.extractedText,
          rawText: storedDraft?.reviewDraft?.rawText,
          recommendedReviewStatus: storedDraft?.reviewDraft?.recommendedReviewStatus,
          parserVersion: storedDraft?.reviewDraft?.parserVersion,
          modelUsed: storedDraft?.reviewDraft?.modelUsed,
          fallbackUsed: storedDraft?.reviewDraft?.fallbackUsed,
          model: storedDraft?.reviewDraft?.model,
          submissionRef: storedDraft?.reviewDraft?.submissionRef,
          correlationId: storedDraft?.reviewDraft?.correlationId,
          source: storedDraft?.reviewDraft?.source,
          metadata: storedDraft?.reviewDraft?.metadata,
          rawEvidence: storedDraft?.reviewDraft?.rawEvidence,
          reviewFlags: storedDraft?.reviewDraft?.reviewFlags,
        }),
      }));
      setImageAttachments(
        collectImageAttachments(
          storedDraft?.imageAttachments,
          storedDraft?.imageDataUrl
            ? {
                dataUrl: storedDraft.imageDataUrl,
                name: storedDraft?.imageName,
              }
            : null,
        ),
      );
      setReviewDirty(Boolean(storedDraft?.reviewDirty));
      setWorkflowState(
        storedDraft?.workflowState ||
          (normalizeText(storedDraft?.reviewDraft?.status) === "submitted_to_make"
            ? "submitted_to_make"
            : storedDraft?.reviewDraft
              ? "extract_success"
              : "ready_to_extract"),
      );
      setWorkflowMessage("Draft restored from this device.");
      setDraftRestored(true);
    }

    setHasLoadedDraft(true);
  }, [draftStorageKey, hasLoadedDraft]);

  const selectedDriverLabel =
    driverOptions.find((driver) => driver.id === intakeState.driver_id)?.label ||
    reviewDraft.metadata?.driver_text ||
    "Optional";
  const selectedVehicleLabel =
    vehicleOptionsForDriver.find((vehicle) => vehicle.id === intakeState.vehicle_id)?.label ||
    reviewDraft.metadata?.vehicle_text ||
    "Optional";
  const selectedSessionLabel = formatReviewSnapshotSessionLabel(
    intakeState.session_type,
    intakeState.session_number,
  );
  const generatedSessionId = useMemo(
    () =>
      buildGeneratedSessionId(
        intakeState.date,
        intakeState.time,
        intakeState.driver_id,
        intakeState.session_number,
      ),
    [intakeState.date, intakeState.time, intakeState.driver_id, intakeState.session_number],
  );
  const hasExtractedDraft = hasExtractedDraftData(reviewDraft);
  const hasImage = Boolean(imageDataUrl);
  const isWaitingForMakeDraft = workflowState === "submitted_to_make" || normalizeText(reviewDraft.status) === "submitted_to_make";
  const activeAsyncState = ["extracting", "rerunning_ocr", "saving_draft", "submitting_review"].includes(workflowState);

  useEffect(() => {
    if (!isReviewView || !queryCorrelationId || !hasLoadedDraft) {
      return;
    }

    if (hasImage || hasExtractedDraft || isWaitingForMakeDraft || normalizeText(reviewDraft.correlationId)) {
      return;
    }

    setReviewDraft((prev) => ({
      ...prev,
      status: "submitted_to_make",
      message: prev.message || "Submitted to Make.com. Waiting for the OCR draft response.",
      submissionRef: prev.submissionRef || querySubmissionRef || "",
      correlationId: queryCorrelationId,
      source: prev.source || "make.com",
    }));
    setWorkflowState("submitted_to_make");
    setWorkflowMessage("Submitted to Make.com. Waiting for the OCR draft response.");
  }, [
    hasExtractedDraft,
    hasImage,
    hasLoadedDraft,
    isReviewView,
    isWaitingForMakeDraft,
    queryCorrelationId,
    querySubmissionRef,
    reviewDraft.correlationId,
  ]);

  useEffect(() => {
    if (!isReviewView) {
      setReviewBootstrapComplete(true);
      return;
    }

    if (!hasLoadedDraft) {
      return;
    }

    if (
      queryCorrelationId ||
      normalizeText(reviewDraft.correlationId) ||
      hasImage ||
      hasExtractedDraft ||
      isWaitingForMakeDraft
    ) {
      setReviewBootstrapComplete(true);
      return;
    }

    if (!routeEventId) {
      setReviewBootstrapComplete(true);
      return;
    }

    let cancelled = false;
    setReviewBootstrapComplete(false);

    const bootstrapLatestDraft = async () => {
      try {
        const preview = await getLatestOcrDraftForEvent(routeEventId);
        if (cancelled) {
          return;
        }

        const mergedDraft = mergePreviewIntoReviewDraft(preview);
        const hasRecoverableDraft =
          Boolean(normalizeText(mergedDraft.correlationId) || normalizeText(mergedDraft.submissionRef)) ||
          Boolean(preview.imageUrl) ||
          hasExtractedDraftData(mergedDraft);

        if (!hasRecoverableDraft) {
          return;
        }

        setReviewDraft(mergedDraft);
        setIntakeState((prev) => mergePreviewIntoIntake(prev, preview, eventTrack));
        setImageAttachments(collectImageAttachments(preview?.imageUrls, preview?.imageUrl));
        setReviewDirty(false);
        setPageError("");

        if (preview.status === "extraction_failed") {
          setWorkflowState("extract_failed");
          setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
          setPageError(getExtractionFailureMessage(preview));
        } else if (preview.status === "submitted_to_make") {
          setWorkflowState("submitted_to_make");
          setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
        } else {
          const nextWorkflowState = isReviewSafeOcrStatus(preview.status) ? "editing_review" : "extract_success";
          setWorkflowState(nextWorkflowState);
          setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
        }

        if (normalizeText(preview.correlationId) || normalizeText(preview.submissionRef)) {
          router.replace(buildReviewRoute(preview.correlationId, preview.submissionRef));
        }
      } catch (error) {
        const responseStatus = error?.response?.status || error?.status;
        if (responseStatus !== 404) {
          console.error("Failed to bootstrap OCR review from the latest staged draft:", error);
        }
      } finally {
        if (!cancelled) {
          setReviewBootstrapComplete(true);
        }
      }
    };

    bootstrapLatestDraft();

    return () => {
      cancelled = true;
    };
  }, [
    buildReviewRoute,
    eventTrack,
    hasExtractedDraft,
    hasImage,
    hasLoadedDraft,
    isReviewView,
    isWaitingForMakeDraft,
    queryCorrelationId,
    reviewDraft.correlationId,
    routeEventId,
    router,
  ]);

  useEffect(() => {
    if (!isWaitingForMakeDraft) {
      return undefined;
    }

    const correlationId = normalizeText(reviewDraft.correlationId);
    if (!correlationId) {
      return undefined;
    }

    let cancelled = false;
    let timeoutId = null;

    const scheduleNextPoll = (delayMs = 4000) => {
      if (cancelled) {
        return;
      }
      timeoutId = window.setTimeout(pollStatus, delayMs);
    };

    const pollStatus = async () => {
      try {
        const preview = await getOcrDraftStatus(correlationId);
        if (cancelled) {
          return;
        }

        if (preview.status === "submitted_to_make") {
          setReviewDraft((prev) => ({
            ...prev,
            status: preview.status || prev.status,
            message: preview.message || prev.message,
            submissionRef: preview.submissionRef || prev.submissionRef,
            correlationId: preview.correlationId || prev.correlationId,
            source: preview.source || prev.source,
            modelUsed: preview.modelUsed || prev.modelUsed,
            model: preview.model || prev.model,
          }));
          setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
          scheduleNextPoll();
          return;
        }

        const mergedDraft = mergePreviewIntoReviewDraft(preview);
        setReviewDraft(mergedDraft);
        setIntakeState((prev) => mergePreviewIntoIntake(prev, preview, eventTrack));
        setImageAttachments(collectImageAttachments(preview?.imageUrls, preview?.imageUrl));
        setReviewDirty(false);
        setPageError("");

        if (preview.status === "extraction_failed") {
          setWorkflowState("extract_failed");
          setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
          setPageError(getExtractionFailureMessage(preview));
          return;
        }

        setWorkflowState(isReviewSafeOcrStatus(preview.status) ? "editing_review" : "extract_success");
        setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
      } catch (error) {
        console.error("Failed to refresh OCR draft status:", error);
        if (cancelled) {
          return;
        }
        setWorkflowMessage("Submitted to Make.com. Waiting for the OCR draft response.");
        scheduleNextPoll(6000);
      }
    };

    pollStatus();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [eventTrack, isWaitingForMakeDraft, reviewDraft.correlationId]);

  useEffect(() => {
    if (isReviewView || forceIntakeView || !hasLoadedDraft) {
      return;
    }

    if (!(isWaitingForMakeDraft || hasExtractedDraft)) {
      return;
    }

    router.replace(buildReviewRoute(reviewDraft.correlationId, reviewDraft.submissionRef));
  }, [
    buildReviewRoute,
    forceIntakeView,
    hasExtractedDraft,
    hasLoadedDraft,
    isReviewView,
    isWaitingForMakeDraft,
    reviewDraft.correlationId,
    reviewDraft.submissionRef,
    router,
  ]);

  const effectiveWorkflowState = useMemo(() => {
    if (workflowState === "submit_success" || workflowState === "submit_failed") {
      return workflowState;
    }

    if (workflowState === "draft_saved") {
      return "draft_saved";
    }

    if (isWaitingForMakeDraft) {
      return "submitted_to_make";
    }

    if (workflowState === "extract_failed") {
      return "extract_failed";
    }

    if (workflowState === "extracting" || workflowState === "rerunning_ocr" || workflowState === "saving_draft" || workflowState === "submitting_review") {
      return workflowState;
    }

    if (workflowState === "editing_review" && (hasExtractedDraft || isReviewSafeOcrStatus(reviewDraft.status))) {
      return "editing_review";
    }

    if (!hasExtractedDraft) {
      return hasImage ? "ready_to_extract" : "waiting_for_image";
    }

    if (reviewDirty) {
      return "editing_review";
    }

    return "extract_success";
  }, [hasExtractedDraft, hasImage, isWaitingForMakeDraft, reviewDirty, reviewDraft.status, workflowState]);
  const hasReviewSafeStatus = isReviewSafeOcrStatus(reviewDraft.status);
  const shouldShowManualCorrection =
    hasExtractedDraft || (hasImage && (effectiveWorkflowState === "extract_failed" || hasReviewSafeStatus));
  const isHardExtractFailure = effectiveWorkflowState === "extract_failed" && !hasExtractedDraft;
  const confidenceDisplay =
    typeof reviewDraft.confidence === "number"
      ? `${Math.round(reviewDraft.confidence * 100)}%`
      : isHardExtractFailure
        ? "Unavailable"
        : "Pending extract";
  const docTypeDisplay =
    reviewDraft.docType && reviewDraft.docType !== "unknown"
      ? reviewDraft.docType.replace(/_/g, " ")
      : isHardExtractFailure
        ? "Not extracted"
        : "Pending extract";
  const modelDisplay = reviewDraft.modelUsed
    ? `${reviewDraft.modelUsed}${reviewDraft.fallbackUsed ? " (fallback)" : ""}`
    : isHardExtractFailure
      ? "Not returned"
      : "Pending extract";
  const runtimeRetryLabel =
    workflowState === "rerunning_ocr" ? "Rerunning..." : hasExtractedDraft ? "Rerun OCR" : "Retry OCR";
  const isPrintedFormDoc = reviewDraft.docType === "printed_form_with_values";

  const suspensionFieldCount = useMemo(() => countMeaningfulValues(reviewDraft.suspension), [reviewDraft.suspension]);
  const templateFieldCount = useMemo(
    () => countMeaningfulValues(reviewDraft.sheetFields) + countMeaningfulValues(reviewDraft.postSession),
    [reviewDraft.sheetFields, reviewDraft.postSession],
  );
  const shockSetupFieldCount = useMemo(() => countMeaningfulValues(reviewDraft.shockSetup), [reviewDraft.shockSetup]);
  const printedFormPrimaryFieldCount = useMemo(
    () =>
      countMeaningfulValues(reviewDraft.alignment) +
      countMeaningfulValues(reviewDraft.pressures) +
      countMeaningfulValues(pickFieldSubset(reviewDraft.sheetFields, PRINTED_FORM_PRIMARY_FIELDS)),
    [reviewDraft.alignment, reviewDraft.pressures, reviewDraft.sheetFields],
  );
  const printedFormAfterSessionFieldCount = useMemo(
    () =>
      countMeaningfulValues(reviewDraft.postSession) +
      (normalizeText(reviewDraft.sheetFields?.fuel_pumped_out_liters) ? 1 : 0),
    [reviewDraft.postSession, reviewDraft.sheetFields],
  );
  const printedFormHeaderFieldCount = useMemo(
    () => countMeaningfulValues(reviewDraft.normalizedSections?.session_context || reviewDraft.metadata),
    [reviewDraft.metadata, reviewDraft.normalizedSections],
  );
  const printedFormNotesCount = useMemo(
    () =>
      splitNotes(reviewDraft.notes).length +
      (normalizeText(reviewDraft.sheetFields?.notes_block) ? 1 : 0) +
      (normalizeText(reviewDraft.rawText || reviewDraft.extractedText) ? 1 : 0),
    [reviewDraft.notes, reviewDraft.sheetFields, reviewDraft.rawText, reviewDraft.extractedText],
  );
  const printedFormEvidenceStats = useMemo(() => {
    const mainCategories = new Set([
      "session_context",
      "alignment",
      "tire_pressure",
      "corner_weight",
      "springs",
      "anti_roll_bar",
      "wing",
      "wheel_base",
      "bump_stops",
      "notes",
      "post_session",
    ]);
    const evidence = Array.isArray(reviewDraft.fieldEvidence) ? reviewDraft.fieldEvidence : [];
    return evidence.reduce(
      (totals, entry) => {
        if (!mainCategories.has(entry?.category)) {
          return totals;
        }

        if (entry?.inferred_from_layout) {
          totals.inferred += 1;
        } else {
          totals.direct += 1;
        }

        if (entry?.needs_review) {
          totals.review += 1;
        }

        return totals;
      },
      { direct: 0, inferred: 0, review: 0 },
    );
  }, [reviewDraft.fieldEvidence]);
  const noteSignalCount = useMemo(
    () =>
      splitNotes(reviewDraft.notes).length +
      reviewDraft.reviewFlags.length +
      (normalizeText(reviewDraft.summary) ? 1 : 0) +
      (normalizeText(reviewDraft.rawText || reviewDraft.extractedText) ? 1 : 0) +
      (Array.isArray(reviewDraft.rawEvidence?.visible_text) ? reviewDraft.rawEvidence.visible_text.length : 0) +
      (Array.isArray(reviewDraft.rawEvidence?.unmapped_values) ? reviewDraft.rawEvidence.unmapped_values.length : 0),
    [
      reviewDraft.notes,
      reviewDraft.reviewFlags,
      reviewDraft.summary,
      reviewDraft.rawText,
      reviewDraft.extractedText,
      reviewDraft.rawEvidence,
    ],
  );
  const defaultAdvancedAccordionSections = useMemo(() => {
    const sections = ["notes"];

    if ((suspensionFieldCount > 0 || reviewDraft.docType === "shock_setup_sheet") && !isPrintedFormDoc) {
      sections.push("suspension");
    }

    if (!isPrintedFormDoc && templateFieldCount > 0) {
      sections.push("template");
    }

    if (reviewDraft.docType === "shock_setup_sheet") {
      sections.push("shock-sheet");
    }

    return sections;
  }, [isPrintedFormDoc, reviewDraft.docType, suspensionFieldCount, templateFieldCount]);
  const showSuspensionAccordion = !isPrintedFormDoc || suspensionFieldCount > 0 || reviewDraft.docType === "shock_setup_sheet";
  const showShockSetupAccordion = reviewDraft.docType === "shock_setup_sheet" || shockSetupFieldCount > 0;

  const workflowPresentation = getWorkflowPresentation(effectiveWorkflowState);
  const submissionWindowNote = !submissionState.isOpen
    ? "This event is closed for new OCR-backed submissions."
    : !hasRunGroup
      ? "Run group configuration is required before drivers or mechanics can stage OCR notes."
      : workflowPresentation.note;
  const pageTitle = isReviewView ? "OCR Review" : "OCR Notes";
  const pageEyebrow = isReviewView ? "OCR Review" : "OCR Flow";
  const pageSubtitle = isReviewView
    ? "Wait for Make.com to return the OCR draft, review the captured values beside the source image, and correct anything that needs a human pass before final submission."
    : "Capture only the intake details needed for OCR, upload the source image, and stage the draft in Make.com before moving into review.";
  const overviewBannerTitle = isReviewView ? "OCR draft ready for review" : "Submit to Make.com, then continue to review";
  const overviewBannerBody = isReviewView
    ? "This workspace keeps the source image, OCR runtime status, and editable setup fields together while the async Make.com callback fills the draft."
    : "The intake stays light here. As soon as Make.com accepts the OCR job, this flow opens the dedicated review screen for editing and final submission.";
  const capturePanelCopy = isReviewView
    ? "Keep the source image and OCR runtime details in view while the draft polls in, then rerun OCR from here if the first pass needs another attempt."
    : `Upload up to ${MAX_OCR_IMAGES} setup sheet or handwritten note images, send them to Make.com, and continue on the review screen once the OCR draft is staged.`;
  const footerTitle = isReviewView ? "Review, save, or submit the OCR draft" : "Stage the OCR draft and move into review";
  const footerCopy = isReviewView
    ? "This review workspace keeps polling Make.com until the draft is ready, then lets you correct the captured values before submitting the note for review."
    : "The intake screen only stages the OCR job. Save locally if you need to pause, or send the image to Make.com and continue on the dedicated review screen.";
  const reviewEmptyState =
    hasLoadedDraft &&
    reviewBootstrapComplete &&
    isReviewView &&
    !queryCorrelationId &&
    !normalizeText(reviewDraft.correlationId) &&
    !hasImage &&
    !hasExtractedDraft &&
    !isWaitingForMakeDraft;

  const getFieldClassName = (baseClassName, fieldName) =>
    fieldErrors[fieldName] ? `${baseClassName} input-error` : baseClassName;

  const clearFieldError = (fieldName) => {
    setFieldErrors((prev) => {
      if (!prev[fieldName]) {
        return prev;
      }

      return {
        ...prev,
        [fieldName]: "",
      };
    });
  };

  const handleIntakeChange = (field, value) => {
    setIntakeState((prev) => ({ ...prev, [field]: value }));
    clearFieldError(field);
  };

  const handleReviewEdit = (updater) => {
    setReviewDraft((prev) => {
      const nextDraft = updater(prev);
      if (prev.status !== "success") {
        return {
          ...nextDraft,
          status: "review_required",
          message: "",
        };
      }
      return nextDraft;
    });
    setPageError("");
    setReviewDirty(true);
    setWorkflowState("editing_review");
  };

  const resetForSourceImagesChange = (nextCount) => {
    setReviewDraft(createEmptyReviewDraft());
    setReviewDirty(false);
    setSubmissionWarnings([]);
    setWorkflowState(nextCount > 0 ? "ready_to_extract" : "waiting_for_image");
    setWorkflowMessage("");
    setPageError("");
    clearFieldError("extract");
  };

  const applyImageFiles = async (files) => {
    const nextFiles = Array.from(files || []).filter(Boolean);
    if (nextFiles.length === 0) {
      return;
    }

    const invalidFile = nextFiles.find((file) => !ACCEPTED_IMAGE_TYPES.has(file.type));
    if (invalidFile) {
      setFieldErrors((prev) => ({
        ...prev,
        image: "Upload JPG, PNG, or WEBP images only.",
      }));
      return;
    }

    if (imageAttachments.length + nextFiles.length > MAX_OCR_IMAGES) {
      setFieldErrors((prev) => ({
        ...prev,
        image: `Upload up to ${MAX_OCR_IMAGES} source images per OCR review.`,
      }));
      return;
    }

    try {
      const nextAttachments = (
        await Promise.all(
          nextFiles.map(async (file, index) => {
            const dataUrl = await readFileAsDataUrl(file);
            return buildImageAttachment(dataUrl, file.name, imageAttachments.length + index);
          }),
        )
      ).filter(Boolean);

      if (nextAttachments.length === 0) {
        setFieldErrors((prev) => ({
          ...prev,
          image: "Upload a readable JPG, PNG, or WEBP image.",
        }));
        return;
      }

      const mergedAttachments = collectImageAttachments(imageAttachments, nextAttachments);
      setImageAttachments(mergedAttachments);
      clearFieldError("image");
      resetForSourceImagesChange(mergedAttachments.length);
    } catch (error) {
      console.error("Failed to prepare OCR source images:", error);
      setFieldErrors((prev) => ({
        ...prev,
        image: "The selected image could not be loaded. Try again with another file.",
      }));
    }
  };

  const handleImageInputChange = async (eventLike) => {
    const files = eventLike.target.files;
    if (!files?.length) {
      return;
    }

    await applyImageFiles(files);
    eventLike.target.value = "";
  };

  const handleDrop = async (eventLike) => {
    eventLike.preventDefault();
    setDropzoneActive(false);
    const files = eventLike.dataTransfer?.files;
    if (!files?.length) {
      return;
    }

    await applyImageFiles(files);
  };

  const handleRemoveImage = (attachmentId) => {
    const nextAttachments = imageAttachments.filter((attachment) => attachment.id !== attachmentId);
    setImageAttachments(nextAttachments);
    clearFieldError("image");
    resetForSourceImagesChange(nextAttachments.length);
  };

  const handleClearImages = () => {
    setImageAttachments([]);
    clearFieldError("image");
    resetForSourceImagesChange(0);
  };

  const resetForm = useCallback(() => {
    setIntakeState({
      ...createIntakeState({
        useSessionDefaults: !isReviewView,
        useDateTimeDefaults: !isReviewView,
      }),
      track: eventTrack,
    });
    setReviewDraft(createEmptyReviewDraft());
    setImageAttachments([]);
    setFieldErrors({});
    setPageError("");
    setSubmissionWarnings([]);
    setWorkflowState("idle");
    setWorkflowMessage("");
    setDraftRestored(false);
    setReviewDirty(false);
    if (draftStorageKey) {
      clearOcrDraft(draftStorageKey);
    }
  }, [draftStorageKey, eventTrack, isReviewView]);

  const persistDraftSnapshot = useCallback(
    ({
      nextIntakeState = intakeState,
      nextReviewDraft = reviewDraft,
      nextWorkflowState = workflowState,
      nextReviewDirty = reviewDirty,
      nextImageAttachments = imageAttachments,
    } = {}) => {
      if (!draftStorageKey) {
        return;
      }

      saveOcrDraft(draftStorageKey, {
        intakeState: nextIntakeState,
        reviewDraft: nextReviewDraft,
        imageAttachments: nextImageAttachments,
        imageDataUrl: nextImageAttachments[0]?.dataUrl || null,
        imageName: nextImageAttachments.length === 1 ? nextImageAttachments[0]?.name || "" : "",
        reviewDirty: nextReviewDirty,
        workflowState: nextWorkflowState,
      });
    },
    [draftStorageKey, imageAttachments, intakeState, reviewDirty, reviewDraft, workflowState],
  );

  const handleExtract = async ({ rerun = false } = {}) => {
    if (!canSubmitOcr) {
      setPageError(
        !hasRunGroup
          ? "Run group is required before OCR Notes can extract."
          : "This event is closed. OCR extraction is disabled.",
      );
      setWorkflowState("extract_failed");
      return;
    }

    if (!imageDataUrl) {
      setFieldErrors((prev) => ({
        ...prev,
        image: "Upload at least one handwritten note or setup sheet image first.",
      }));
      setWorkflowState("waiting_for_image");
      return;
    }

    setPageError("");
    setSubmissionWarnings([]);
    setWorkflowState(rerun ? "rerunning_ocr" : "extracting");
    setWorkflowMessage(
      rerun
        ? "Submitted to Make.com again. Waiting for the OCR draft response."
        : "Submitted to Make.com. Waiting for the OCR draft response.",
    );

    try {
      const preview = await (rerun ? rerunOcrDraft : extractOcrDraft)({
        event_id: event?._id || event?.id || routeEventId,
        run_group_id: runGroupId,
        driver_id: normalizeText(intakeState.driver_id) || null,
        vehicle_id: normalizeText(intakeState.vehicle_id) || null,
        raw_text: normalizeText(intakeState.notes) || null,
        image_url: imageDataUrl,
        image_urls: imageUrls,
        context: {
          date: normalizeText(intakeState.date) || null,
          time: normalizeText(intakeState.time) || null,
          track: normalizeText(intakeState.track) || normalizeText(eventTrack) || null,
          session_type: normalizeText(intakeState.session_type) || null,
          session_number: normalizeText(intakeState.session_number) || null,
          duration_min: normalizeText(intakeState.duration_min) || null,
          notes: normalizeText(intakeState.notes) || null,
        },
      });

      const mergedDraft = mergePreviewIntoReviewDraft(preview);
      const nextIntakeState = mergePreviewIntoIntake(intakeState, preview, eventTrack);
      const nextImageAttachments = collectImageAttachments(
        imageAttachments,
        preview?.imageUrls,
        preview?.imageUrl,
      );
      setReviewDraft(mergedDraft);
      setIntakeState(nextIntakeState);
      setImageAttachments(nextImageAttachments);
      setReviewDirty(false);

      if (preview.status === "submitted_to_make") {
        setWorkflowState("submitted_to_make");
        setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
        setPageError("");
        if (!isReviewView) {
          try {
            persistDraftSnapshot({
              nextIntakeState,
              nextReviewDraft: mergedDraft,
              nextWorkflowState: "submitted_to_make",
              nextReviewDirty: false,
              nextImageAttachments,
            });
          } catch (draftError) {
            console.warn("Failed to stage OCR draft locally before opening review:", draftError);
          }
          router.push(buildReviewRoute(mergedDraft.correlationId || preview.correlationId, mergedDraft.submissionRef || preview.submissionRef));
        }
        return;
      }

      if (preview.status === "extraction_failed") {
        setWorkflowState("extract_failed");
        setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));
        setPageError(getExtractionFailureMessage(preview));
        return;
      }

      setPageError("");
      const nextWorkflowState = isReviewSafeOcrStatus(preview.status) ? "editing_review" : "extract_success";
      setWorkflowState(nextWorkflowState);
      setWorkflowMessage(getOcrStatusMessage(preview.status, preview.message));

      if (!isReviewView) {
        try {
          persistDraftSnapshot({
            nextIntakeState,
            nextReviewDraft: mergedDraft,
            nextWorkflowState,
            nextReviewDirty: false,
            nextImageAttachments,
          });
        } catch (draftError) {
          console.warn("Failed to stage OCR draft locally before opening review:", draftError);
        }
        router.push(buildReviewRoute(mergedDraft.correlationId || preview.correlationId, mergedDraft.submissionRef || preview.submissionRef));
      }
    } catch (error) {
      console.error("Failed to extract OCR draft:", error);
      setWorkflowState("extract_failed");
      setPageError(getExtractionFailureMessage(error));
    }
  };

  const handleSaveDraft = () => {
    if (!draftStorageKey) {
      return;
    }

    setWorkflowState("saving_draft");
    setPageError("");

    try {
      saveOcrDraft(draftStorageKey, {
        intakeState,
        reviewDraft,
        imageAttachments,
        imageDataUrl,
        imageName,
        reviewDirty,
        workflowState: isWaitingForMakeDraft
          ? "submitted_to_make"
          : hasExtractedDraft
            ? "extract_success"
            : hasImage
              ? "ready_to_extract"
              : "waiting_for_image",
      });
      setWorkflowState("draft_saved");
      setWorkflowMessage("OCR draft saved locally on this device.");
    } catch (error) {
      console.error("Failed to save OCR draft:", error);
      setWorkflowState(hasExtractedDraft ? "editing_review" : hasImage ? "ready_to_extract" : "waiting_for_image");
      setPageError("Could not save the OCR draft locally on this device.");
    }
  };

  const handleSubmitForReview = async () => {
    if (!canSubmitOcr) {
      setPageError(
        !hasRunGroup
          ? "Run group is required before OCR Notes can submit."
          : "This event is closed. OCR review submissions are disabled.",
      );
      setWorkflowState("submit_failed");
      return;
    }

    const nextErrors = {};

    if (!hasExtractedDraft) {
      nextErrors.extract = "Run OCR extraction before submitting for review.";
    }

    if (Boolean(normalizeText(intakeState.driver_id)) !== Boolean(normalizeText(intakeState.vehicle_id))) {
      nextErrors.driver_vehicle = "Driver and vehicle must be provided together if either one is selected.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
      setPageError("Complete the OCR extraction workflow before submitting.");
      setWorkflowState("submit_failed");
      return;
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.image;
      delete next.extract;
      delete next.driver_vehicle;
      return next;
    });
    setPageError("");
    setSubmissionWarnings([]);
    setWorkflowState("submitting_review");
    setWorkflowMessage("");

    try {
      const response = await submitReviewedOcrNote(
        buildReviewedSubmissionRequest({
          intakeState,
          reviewDraft,
          eventId: event?._id || event?.id || routeEventId,
          runGroupValue,
          eventTrack,
          imageAttachments,
        }),
      );
      const successState = getSubmissionSuccessState(response?.submission);
      setSubmissionWarnings(successState.warnings);
      setWorkflowState("submit_success");
      setWorkflowMessage(successState.message);
      setReviewDirty(false);
      if (draftStorageKey) {
        clearOcrDraft(draftStorageKey);
      }
    } catch (error) {
      console.error("Failed to submit OCR note for review:", error);
      setWorkflowState("submit_failed");
      setPageError(getSubmissionFailureMessage(error));
    }
  };

  if (loading) {
    return (
      <ProtectedRoute allowedRoles={["OWNER", "ADMIN", "MECHANIC", "DRIVER"]}>
        <div className="ocr-notes-page">
          <div className="ocr-notes-orb ocr-notes-orb-one" />
          <div className="ocr-notes-orb ocr-notes-orb-two" />
          <div className="ocr-notes-shell ocr-notes-state-shell">
            <Loader fullScreen={false} message="Preparing OCR Notes" sublabel="Fetching the active event, run group, and capture context..." />
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (!event) {
    return (
      <ProtectedRoute allowedRoles={["OWNER", "ADMIN", "MECHANIC", "DRIVER"]}>
        <div className="ocr-notes-page">
          <div className="ocr-notes-orb ocr-notes-orb-one" />
          <div className="ocr-notes-orb ocr-notes-orb-two" />
          <div className="ocr-notes-shell ocr-notes-state-shell">
            <div className="ocr-notes-state-card">
              <div className="ocr-notes-state-icon danger">
                <WarningAmberRoundedIcon fontSize="inherit" />
              </div>
              <p className="ocr-notes-eyebrow">OCR Notes</p>
              <h1>Unable to load the OCR workspace</h1>
              <p>{pageError || "The event context could not be loaded. Return to the events list or retry."}</p>

              <div className="ocr-notes-state-actions">
                <button type="button" className="ocr-notes-button-primary" onClick={loadPageData}>
                  Retry Load
                </button>
                <button type="button" className="ocr-notes-button-secondary" onClick={() => router.push("/events")}>
                  Back to Events
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (reviewEmptyState) {
    return (
      <ProtectedRoute allowedRoles={["OWNER", "ADMIN", "MECHANIC", "DRIVER"]}>
        <div className="ocr-notes-page">
          <div className="ocr-notes-orb ocr-notes-orb-one" />
          <div className="ocr-notes-orb ocr-notes-orb-two" />
          <div className="ocr-notes-shell ocr-notes-state-shell">
            <div className="ocr-notes-state-card">
              <div className="ocr-notes-state-icon warning">
                <DocumentScannerRoundedIcon fontSize="inherit" />
              </div>
              <p className="ocr-notes-eyebrow">OCR Review</p>
              <h1>No staged OCR draft yet</h1>
              <p>
                Start the OCR flow from intake first so this review screen has an image, correlation ID, and staged
                draft to work with.
              </p>

              <div className="ocr-notes-state-actions">
                <button type="button" className="ocr-notes-button-primary" onClick={() => router.push(intakeRoute)}>
                  Open OCR Intake
                </button>
                <button type="button" className="ocr-notes-button-secondary" onClick={() => router.push(`/event/${routeEventId}`)}>
                  Back to Event
                </button>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN", "MECHANIC", "DRIVER"]}>
      <div className="ocr-notes-page">
        <div className="ocr-notes-orb ocr-notes-orb-one" />
        <div className="ocr-notes-orb ocr-notes-orb-two" />

        <div className="ocr-notes-shell">
          <header className="ocr-notes-topbar">
            <div className="ocr-notes-topbar-copy">
              <ScreenBackButton
                fallbackHref={isReviewView ? manualIntakeRoute : `/event/${routeEventId}`}
                label={isReviewView ? "Back to OCR Intake" : "Back to Event"}
              />
              <p className="ocr-notes-eyebrow">
                <DocumentScannerRoundedIcon fontSize="inherit" />
                {pageEyebrow}
              </p>
              <h1 className="ocr-notes-title">{pageTitle}</h1>
              <p className="ocr-notes-subtitle">{pageSubtitle}</p>
            </div>

            <div className="ocr-notes-topbar-meta">
              <div className="ocr-notes-badge-row">
                <StatusBadge status={submissionState.isOpen ? "active" : "inactive"} />
                <StatusBadge status={hasRunGroup ? "active" : "warning"} label={hasRunGroup ? "Run Group Ready" : "Run Group Missing"} />
              </div>

              <button type="button" className="ocr-notes-refresh" onClick={loadPageData} disabled={activeAsyncState}>
                <RefreshRoundedIcon fontSize="inherit" />
                Refresh Context
              </button>
            </div>
          </header>

          <section className="ocr-notes-context-strip">
            <div className="ocr-notes-context-item">
              <span>Event</span>
              <strong>{event?.name || "Unknown event"}</strong>
            </div>
            <div className="ocr-notes-context-item">
              <span>Track</span>
              <strong>{eventTrack || "Pending track"}</strong>
            </div>
            <div className="ocr-notes-context-item">
              <span>Run Group</span>
              <strong>{runGroupValue}</strong>
            </div>
            <div className="ocr-notes-context-item">
              <span>Window</span>
              <strong>{eventDates || "Dates pending"}</strong>
            </div>
          </section>

          <section className="ocr-notes-status-strip">
            <div className="ocr-notes-status-item">
              <span>OCR Status</span>
              <strong>{workflowPresentation.label}</strong>
            </div>
            <div className="ocr-notes-status-item">
              <span>Confidence</span>
              <strong>{confidenceDisplay}</strong>
            </div>
            <div className="ocr-notes-status-item">
              <span>Document Type</span>
              <strong>{docTypeDisplay}</strong>
            </div>
            <div className="ocr-notes-status-item">
              <span>Model</span>
              <strong>{modelDisplay}</strong>
            </div>
            <div className="ocr-notes-status-item">
              <span>Review Flags</span>
              <strong>{reviewDraft.reviewFlags.length > 0 ? `${reviewDraft.reviewFlags.length} flagged` : "No flags yet"}</strong>
            </div>
            <div className="ocr-notes-status-item">
              <span>Session ID</span>
              <strong>{generatedSessionId || "Generated on submit"}</strong>
            </div>
          </section>

          <p className="ocr-notes-status-note">{submissionWindowNote}</p>

          <div className="ocr-notes-banner neutral">
            <DocumentScannerRoundedIcon fontSize="inherit" />
            <div>
              <strong>{overviewBannerTitle}</strong>
              <span>{overviewBannerBody}</span>
            </div>
          </div>

          {!hasRunGroup ? (
            <div className="ocr-notes-banner warning">
              <WarningAmberRoundedIcon fontSize="inherit" />
              <div>
                <strong>Run group missing</strong>
                <span>Configure the event run group before drivers or mechanics start the OCR flow.</span>
              </div>
            </div>
          ) : null}

          {draftRestored ? (
            <div className="ocr-notes-banner success">
              <CheckCircleRoundedIcon fontSize="inherit" />
              <div>
                <strong>Draft restored</strong>
                <span>Your last OCR draft for this event was restored from this device.</span>
              </div>
            </div>
          ) : null}

          {workflowMessage ? (
            <div
              className={`ocr-notes-banner${
                effectiveWorkflowState === "submit_success" || effectiveWorkflowState === "draft_saved"
                  ? " success"
                  : effectiveWorkflowState === "extract_failed" || effectiveWorkflowState === "submit_failed"
                    ? " danger"
                    : " neutral"
              }`}
            >
              {effectiveWorkflowState === "submit_success" || effectiveWorkflowState === "draft_saved" ? (
                <CheckCircleRoundedIcon fontSize="inherit" />
              ) : (
                <PendingActionsRoundedIcon fontSize="inherit" />
              )}
              <div>
                <strong>{workflowPresentation.label}</strong>
                <span>{workflowMessage}</span>
              </div>
            </div>
          ) : null}

          {hasImage && hasReviewSafeStatus ? (
            <div className="ocr-notes-banner warning" data-testid="ocr-review-required-banner">
              <WarningAmberRoundedIcon fontSize="inherit" />
              <div>
                <strong>
                  {reviewDraft.status === "blank_template_detected"
                    ? "Blank template detected"
                    : reviewDraft.status === "partial_extracted"
                      ? "Partial OCR extracted"
                      : reviewDraft.status === "low_quality_review_required"
                        ? "Low-quality image"
                        : reviewDraft.status === "parser_failed_but_raw_text_available"
                          ? "Parser fallback available"
                          : "OCR draft needs review"}
                </strong>
                <span>{getOcrStatusMessage(reviewDraft.status)}</span>
              </div>
            </div>
          ) : null}

          {submissionWarnings.length > 0 ? (
            <div className="ocr-notes-banner warning" data-testid="ocr-review-warnings">
              <WarningAmberRoundedIcon fontSize="inherit" />
              <div>
                <strong>Review warnings</strong>
                <span>The submission was accepted, but there are warnings to review.</span>
                <ul className="ocr-notes-banner-list">
                  {submissionWarnings.map((warning, index) => (
                    <li key={`${warning?.code || "warning"}-${index}`}>
                      {warning?.field ? `${warning.field}: ` : ""}
                      {warning?.message || "Submission completed with a warning."}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {pageError ? (
            <div className="ocr-notes-banner danger" data-testid="ocr-review-error">
              <WarningAmberRoundedIcon fontSize="inherit" />
              <div>
                <strong>Action required</strong>
                <span>{pageError}</span>
              </div>
            </div>
          ) : null}

          <section className={`ocr-notes-main-grid${isReviewView ? " single-panel" : ""}`}>
            {!isReviewView ? (
              <div className="ocr-notes-panel">
                <div className="ocr-notes-panel-head">
                  <div>
                    <p className="ocr-notes-panel-eyebrow">Stage 1</p>
                    <h2>Minimal intake</h2>
                  </div>
                  <PendingActionsRoundedIcon className="ocr-notes-panel-icon" fontSize="inherit" />
                </div>

                <p className="ocr-notes-panel-copy">
                  Keep the manual context light before OCR. Event and run group stay fixed while track, session, driver,
                  and vehicle can be filled only if they help extraction or review.
                </p>

                <div className="ocr-notes-form-grid">
                  <div className="ocr-notes-field ocr-notes-field-wide">
                    <label htmlFor="ocr-submission-track">Track</label>
                    <input
                      id="ocr-submission-track"
                      data-testid="ocr-submission-track"
                      className={getFieldClassName("ocr-notes-input", "track")}
                      type="text"
                      value={intakeState.track}
                      onChange={(eventLike) => handleIntakeChange("track", eventLike.target.value)}
                      placeholder="Prefilled from event when available"
                    />
                  </div>

                  <div className="ocr-notes-field">
                    <label id="ocr-submission-driver-label" htmlFor="ocr-submission-driver">
                      Driver
                    </label>
                    <Select value={intakeState.driver_id} onValueChange={(value) => handleIntakeChange("driver_id", value)}>
                      <SelectTrigger
                        id="ocr-submission-driver"
                        data-testid="ocr-submission-driver"
                        aria-labelledby="ocr-submission-driver-label"
                        className={getFieldClassName("ocr-notes-select-trigger", "driver_id")}
                      >
                        <SelectValue placeholder="Optional driver" />
                      </SelectTrigger>
                      <SelectContent position="popper" align="start" className="ocr-notes-select-content">
                        {driverOptions.map((driver) => (
                          <SelectItem key={driver.id} value={driver.id} className="ocr-notes-select-item">
                            {driver.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="ocr-notes-field">
                    <label id="ocr-submission-vehicle-label" htmlFor="ocr-submission-vehicle">
                      Vehicle
                    </label>
                    <Select value={intakeState.vehicle_id} onValueChange={(value) => handleIntakeChange("vehicle_id", value)}>
                      <SelectTrigger
                        id="ocr-submission-vehicle"
                        data-testid="ocr-submission-vehicle"
                        aria-labelledby="ocr-submission-vehicle-label"
                        className={getFieldClassName("ocr-notes-select-trigger", "vehicle_id")}
                      >
                        <SelectValue placeholder="Optional vehicle" />
                      </SelectTrigger>
                      <SelectContent position="popper" align="start" className="ocr-notes-select-content">
                        {vehicleOptionsForDriver.map((vehicle) => (
                          <SelectItem key={vehicle.id} value={vehicle.id} className="ocr-notes-select-item">
                            {vehicle.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="ocr-notes-field">
                    <label id="ocr-submission-session-type-label" htmlFor="ocr-submission-session-type">
                      Session Type
                    </label>
                    <Select value={intakeState.session_type} onValueChange={(value) => handleIntakeChange("session_type", value)}>
                      <SelectTrigger
                        id="ocr-submission-session-type"
                        data-testid="ocr-submission-session-type"
                        aria-labelledby="ocr-submission-session-type-label"
                        className="ocr-notes-select-trigger"
                      >
                        <SelectValue placeholder="Select session type" />
                      </SelectTrigger>
                      <SelectContent position="popper" align="start" className="ocr-notes-select-content">
                        {SESSION_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id} className="ocr-notes-select-item">
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="ocr-notes-field">
                    <label htmlFor="ocr-submission-session-number">Session Number</label>
                    <input
                      id="ocr-submission-session-number"
                      data-testid="ocr-submission-session-number"
                      className="ocr-notes-input"
                      type="number"
                      min="1"
                      step="1"
                      value={intakeState.session_number}
                      onChange={(eventLike) => handleIntakeChange("session_number", eventLike.target.value)}
                      placeholder="Optional"
                    />
                  </div>

                  <div className="ocr-notes-field">
                    <label htmlFor="ocr-submission-date">Date</label>
                    <input
                      id="ocr-submission-date"
                      data-testid="ocr-submission-date"
                      className="ocr-notes-input"
                      type="date"
                      value={intakeState.date}
                      onChange={(eventLike) => handleIntakeChange("date", eventLike.target.value)}
                    />
                    <p className="ocr-notes-field-hint">Optional context for extraction and generated session ID.</p>
                  </div>

                  <div className="ocr-notes-field">
                    <label htmlFor="ocr-submission-time">Time</label>
                    <input
                      id="ocr-submission-time"
                      data-testid="ocr-submission-time"
                      className="ocr-notes-input"
                      type="time"
                      value={intakeState.time}
                      onChange={(eventLike) => handleIntakeChange("time", eventLike.target.value)}
                    />
                    <p className="ocr-notes-field-hint">Optional context for extraction and generated session ID.</p>
                  </div>

                  <div className="ocr-notes-field">
                    <label htmlFor="ocr-submission-duration">Duration (min)</label>
                    <input
                      id="ocr-submission-duration"
                      data-testid="ocr-submission-duration"
                      className="ocr-notes-input"
                      type="number"
                      min="1"
                      step="1"
                      value={intakeState.duration_min}
                      onChange={(eventLike) => handleIntakeChange("duration_min", eventLike.target.value)}
                      placeholder="Optional"
                    />
                  </div>

                  <div className="ocr-notes-field ocr-notes-field-wide">
                    <label htmlFor="ocr-submission-notes">Short Context</label>
                    <textarea
                      id="ocr-submission-notes"
                      data-testid="ocr-submission-notes"
                      className="ocr-notes-textarea"
                      rows={5}
                      value={intakeState.notes}
                      onChange={(eventLike) => handleIntakeChange("notes", eventLike.target.value)}
                      placeholder="Optional callouts before extraction, like tire condition or handwriting notes."
                    />
                    <p className="ocr-notes-field-hint">
                      Keep this brief. The OCR image remains the primary source and the extracted draft appears next.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="ocr-notes-panel">
              <div className="ocr-notes-panel-head">
                <div>
                  <p className="ocr-notes-panel-eyebrow">Stage 2</p>
                  <h2>OCR capture and status</h2>
                </div>
                <PhotoCameraBackRoundedIcon className="ocr-notes-panel-icon" fontSize="inherit" />
              </div>

              <p className="ocr-notes-panel-copy">{capturePanelCopy}</p>

              <div className="ocr-notes-upload-shell">
                <label
                  className={`ocr-notes-upload-dropzone${fieldErrors.image ? " input-error" : ""}${dropzoneActive ? " is-active" : ""}`}
                  onDragOver={(eventLike) => {
                    eventLike.preventDefault();
                    setDropzoneActive(true);
                  }}
                  onDragLeave={() => setDropzoneActive(false)}
                  onDrop={handleDrop}
                >
                  <input
                    data-testid="ocr-submission-image-input"
                    className="ocr-notes-upload-input"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    multiple
                    onChange={handleImageInputChange}
                  />
                  <UploadFileRoundedIcon fontSize="inherit" />
                  <strong>{imageName || `Upload up to ${MAX_OCR_IMAGES} setup sheet images`}</strong>
                  <span>Drag and drop or click to add up to {MAX_OCR_IMAGES} JPG, PNG, or WEBP images.</span>
                </label>
                {fieldErrors.image ? <p className="ocr-notes-field-error">{fieldErrors.image}</p> : null}
                {fieldErrors.extract ? <p className="ocr-notes-field-error">{fieldErrors.extract}</p> : null}
                {fieldErrors.driver_vehicle ? <p className="ocr-notes-field-error">{fieldErrors.driver_vehicle}</p> : null}
              </div>

              <div className="ocr-notes-preview-shell">
                {imageAttachments.length > 0 ? (
                  <>
                    <div className="ocr-notes-preview-grid">
                      {imageAttachments.map((attachment, index) => (
                        <article key={attachment.id} className="ocr-notes-preview-card">
                          <div className="ocr-notes-preview-card-head">
                            <strong>{attachment.name || `Source image ${index + 1}`}</strong>
                            <button
                              type="button"
                              className="ocr-notes-inline-button"
                              onClick={() => handleRemoveImage(attachment.id)}
                            >
                              Remove
                            </button>
                          </div>
                          <Image
                            src={attachment.dataUrl}
                            alt={index === 0 ? "OCR note preview" : `OCR note preview ${index + 1}`}
                            className="ocr-notes-preview-image"
                            width={1200}
                            height={900}
                            unoptimized
                          />
                        </article>
                      ))}
                    </div>
                    <div className="ocr-notes-inline-actions">
                      <p className="ocr-notes-field-hint">
                        OCR review can combine up to {MAX_OCR_IMAGES} source images. Add extra pages only when the setup sheet spans more than one photo.
                      </p>
                      {imageAttachments.length > 1 ? (
                        <button type="button" className="ocr-notes-inline-button" onClick={handleClearImages}>
                          Remove All
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="ocr-notes-preview-empty">
                    <DocumentScannerRoundedIcon fontSize="inherit" />
                    <span>
                      {hasExtractedDraft
                        ? "No source image is attached in this browser session. You can still submit this reviewed draft, and any empty OCR fields will be sent as null."
                        : "No image selected yet."}
                    </span>
                  </div>
                )}
              </div>

              <div className="ocr-notes-review-card">
                <p className="ocr-notes-panel-eyebrow">Review Snapshot</p>
                <ul className="ocr-notes-review-list">
                  <li>
                    <span>Driver</span>
                    <strong>{selectedDriverLabel}</strong>
                  </li>
                  <li>
                    <span>Vehicle</span>
                    <strong>{selectedVehicleLabel}</strong>
                  </li>
                  <li>
                    <span>Session</span>
                    <strong>{selectedSessionLabel}</strong>
                  </li>
                  <li>
                    <span>Doc Type</span>
                    <strong>{docTypeDisplay}</strong>
                  </li>
                  <li>
                    <span>Model Used</span>
                    <strong>{modelDisplay}</strong>
                  </li>
                  <li>
                    <span>Flags</span>
                    <strong>{reviewDraft.reviewFlags.length > 0 ? `${reviewDraft.reviewFlags.length} flagged` : "None"}</strong>
                  </li>
                  <li>
                    <span>Attachment</span>
                    <strong>{imageName || "Not selected"}</strong>
                  </li>
                </ul>
              </div>

              <div className="ocr-notes-status-card">
                <div className="ocr-notes-status-card-head">
                  <strong>OCR runtime state</strong>
                  {hasImage && shouldShowManualCorrection ? (
                    <button
                      type="button"
                      className="ocr-notes-inline-button"
                      onClick={() => handleExtract({ rerun: hasExtractedDraft })}
                      disabled={activeAsyncState || !canSubmitOcr}
                    >
                      {runtimeRetryLabel}
                    </button>
                  ) : null}
                </div>
                <p>{workflowPresentation.note}</p>

                <div className="ocr-notes-metadata-list">
                  <div>
                    <span>Model Used</span>
                    <strong>{modelDisplay}</strong>
                  </div>
                  <div>
                    <span>Source</span>
                    <strong>{formatNullableMetaValue(reviewDraft.source)}</strong>
                  </div>
                  <div>
                    <span>Submission Ref</span>
                    <strong>{formatNullableMetaValue(reviewDraft.submissionRef)}</strong>
                  </div>
                  <div>
                    <span>Correlation ID</span>
                    <strong>{formatNullableMetaValue(reviewDraft.correlationId)}</strong>
                  </div>
                  <div>
                    <span>Fallback Used</span>
                    <strong>{reviewDraft.fallbackUsed ? "Yes" : "No"}</strong>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>{confidenceDisplay}</strong>
                  </div>
                </div>

                {reviewDraft.reviewFlags.length > 0 ? (
                  <div className="ocr-notes-flag-row">
                    {reviewDraft.reviewFlags.map((flag, index) => (
                      <span key={`${flag}-${index}`} className="ocr-notes-flag-chip">
                        {flag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="ocr-notes-field-hint">Any OCR warnings or ambiguous labels will appear here after extraction.</p>
                )}
              </div>
            </div>
          </section>

          {isReviewView && shouldShowManualCorrection ? (
            <section className="ocr-notes-review-workspace" data-testid="ocr-review-sections">
              <div className="ocr-notes-panel">
                <div className="ocr-notes-panel-head">
                  <div>
                    <p className="ocr-notes-panel-eyebrow">Stage 3</p>
                    <h2>{isHardExtractFailure ? "Manual correction fallback" : "Editable OCR review"}</h2>
                  </div>
                  <DocumentScannerRoundedIcon className="ocr-notes-panel-icon" fontSize="inherit" />
                </div>

                <p className="ocr-notes-panel-copy">
                  {isHardExtractFailure
                    ? "OCR could not create a safe draft from this image. Keep the image attached, retry extraction if needed, or fill the key setup fields manually before submitting for review."
                    : "The OCR draft stays editable, but the screen now keeps the high-value setup fields front and center. Advanced template fields stay tucked away until you actually need them."}
                </p>

                {isPrintedFormDoc ? (
                  <div className="ocr-notes-metadata-list ocr-notes-printed-summary">
                    <div>
                      <span>Header / Session</span>
                      <strong>{formatCapturedSummary(printedFormHeaderFieldCount, "header signal")}</strong>
                    </div>
                    <div>
                      <span>Main Setup</span>
                      <strong>{formatCapturedSummary(printedFormPrimaryFieldCount, "main setup value")}</strong>
                    </div>
                    <div>
                      <span>After Session</span>
                      <strong>{formatCapturedSummary(printedFormAfterSessionFieldCount, "after-session value")}</strong>
                    </div>
                    <div>
                      <span>Notes</span>
                      <strong>{formatCapturedSummary(printedFormNotesCount, "note item")}</strong>
                    </div>
                    <div>
                      <span>Direct Evidence</span>
                      <strong>{formatCapturedSummary(printedFormEvidenceStats.direct, "direct field")}</strong>
                    </div>
                    <div>
                      <span>Layout-Inferred</span>
                      <strong>{formatCapturedSummary(printedFormEvidenceStats.inferred, "layout field")}</strong>
                    </div>
                    <div>
                      <span>Needs Review</span>
                      <strong>{formatCapturedSummary(printedFormEvidenceStats.review, "review flag")}</strong>
                    </div>
                    <div>
                      <span>Template</span>
                      <strong>{reviewDraft.templateName || "Printed form"}</strong>
                    </div>
                  </div>
                ) : null}

                <div className="ocr-notes-review-grid ocr-notes-review-grid-core">
                  <div className="ocr-notes-review-section">
                    <div className="ocr-notes-review-section-head">
                      <h3>Ride Height</h3>
                      <span>Editable OCR values</span>
                    </div>
                    <div className="ocr-notes-matrix-grid">
                      {[
                        ["rh_fl", "RH FL"],
                        ["rh_fr", "RH FR"],
                        ["rh_rl", "RH RL"],
                        ["rh_rr", "RH RR"],
                      ].map(([field, label]) => (
                        <label key={field} className="ocr-notes-mini-field">
                          <span>{label}</span>
                          <input
                            className="ocr-notes-input"
                            type="text"
                            value={reviewDraft.alignment[field]}
                            onChange={(eventLike) =>
                              handleReviewEdit((prev) => ({
                                ...prev,
                                alignment: {
                                  ...prev.alignment,
                                  [field]: eventLike.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="ocr-notes-review-section">
                    <div className="ocr-notes-review-section-head">
                      <h3>Camber</h3>
                      <span>Front and rear corners</span>
                    </div>
                    <div className="ocr-notes-matrix-grid">
                      {[
                        ["camber_fl", "Camber FL"],
                        ["camber_fr", "Camber FR"],
                        ["camber_rl", "Camber RL"],
                        ["camber_rr", "Camber RR"],
                      ].map(([field, label]) => (
                        <label key={field} className="ocr-notes-mini-field">
                          <span>{label}</span>
                          <input
                            className="ocr-notes-input"
                            type="text"
                            value={reviewDraft.alignment[field]}
                            onChange={(eventLike) =>
                              handleReviewEdit((prev) => ({
                                ...prev,
                                alignment: {
                                  ...prev.alignment,
                                  [field]: eventLike.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="ocr-notes-review-section">
                    <div className="ocr-notes-review-section-head">
                      <h3>Toe</h3>
                      <span>Review mapped front and rear values</span>
                    </div>
                    <div className="ocr-notes-matrix-grid">
                      {[
                        ["toe_fl", "Toe FL"],
                        ["toe_fr", "Toe FR"],
                        ["toe_rl", "Toe RL"],
                        ["toe_rr", "Toe RR"],
                      ].map(([field, label]) => (
                        <label key={field} className="ocr-notes-mini-field">
                          <span>{label}</span>
                          <input
                            className="ocr-notes-input"
                            type="text"
                            value={reviewDraft.alignment[field]}
                            onChange={(eventLike) =>
                              handleReviewEdit((prev) => ({
                                ...prev,
                                alignment: {
                                  ...prev.alignment,
                                  [field]: eventLike.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="ocr-notes-review-section">
                    <div className="ocr-notes-review-section-head">
                      <h3>Wheelbase and Alignment</h3>
                      <span>Keep extracted geometry editable</span>
                    </div>
                    <div className="ocr-notes-form-grid">
                      {[
                        ["wheelbase_mm", "Wheelbase (mm)"],
                        ["caster_l", "Caster L"],
                        ["caster_r", "Caster R"],
                        ["rake_mm", "Rake (mm)"],
                      ].map(([field, label]) => (
                        <div key={field} className="ocr-notes-field">
                          <label>{label}</label>
                          <input
                            className="ocr-notes-input"
                            type="text"
                            value={reviewDraft.alignment[field]}
                            onChange={(eventLike) =>
                              handleReviewEdit((prev) => ({
                                ...prev,
                                alignment: {
                                  ...prev.alignment,
                                  [field]: eventLike.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ocr-notes-review-section">
                    <div className="ocr-notes-review-section-head">
                      <h3>Pressures</h3>
                      <span>Cold and hot tire pressures</span>
                    </div>
                    <div className="ocr-notes-pressure-grid">
                      {[
                        ["cold", "Cold"],
                        ["hot", "Hot"],
                      ].map(([phaseKey, phaseLabel]) => (
                        <div key={phaseKey} className="ocr-notes-pressure-panel">
                          <strong>{phaseLabel}</strong>
                          <div className="ocr-notes-matrix-grid">
                            {[
                              ["fl", "FL"],
                              ["fr", "FR"],
                              ["rl", "RL"],
                              ["rr", "RR"],
                            ].map(([cornerKey, cornerLabel]) => (
                              <label key={`${phaseKey}-${cornerKey}`} className="ocr-notes-mini-field">
                                <span>{cornerLabel}</span>
                                <input
                                  className="ocr-notes-input"
                                  type="text"
                                  value={reviewDraft.pressures[phaseKey][cornerKey]}
                                  onChange={(eventLike) =>
                                    handleReviewEdit((prev) => ({
                                      ...prev,
                                      pressures: {
                                        ...prev.pressures,
                                        [phaseKey]: {
                                          ...prev.pressures[phaseKey],
                                          [cornerKey]: eventLike.target.value,
                                        },
                                      },
                                    }))
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {isPrintedFormDoc
                    ? PRINTED_FORM_MAIN_FIELD_GROUPS.map((group) => (
                        <div key={group.title} className="ocr-notes-review-section">
                          <div className="ocr-notes-review-section-head">
                            <h3>{group.title}</h3>
                            <span>{group.subtitle}</span>
                          </div>
                          <div className="ocr-notes-form-grid">
                            {group.fields.map(([field, label]) => (
                              <div key={field} className="ocr-notes-field">
                                <label htmlFor={`ocr-printed-field-${field}`}>{label}</label>
                                <input
                                  id={`ocr-printed-field-${field}`}
                                  className="ocr-notes-input"
                                  type="text"
                                  value={reviewDraft.sheetFields[field]}
                                  onChange={(eventLike) =>
                                    handleReviewEdit((prev) => ({
                                      ...prev,
                                      sheetFields: {
                                        ...prev.sheetFields,
                                        [field]: eventLike.target.value,
                                      },
                                    }))
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    : null}
                </div>

                <div className="ocr-notes-review-advanced-shell">
                  <div className="ocr-notes-review-advanced-head">
                    <h3>{isPrintedFormDoc ? "Printed form reference sections" : "Advanced and reference fields"}</h3>
                    <span>
                      {isPrintedFormDoc
                        ? "The upper/main setup block stays focused above. After-session, notes, and any optional reference sections stay collapsed until you need them."
                        : "Open only the sections you need for review or manual correction."}
                    </span>
                  </div>

                  <Accordion
                    type="multiple"
                    defaultValue={defaultAdvancedAccordionSections}
                    className="ocr-notes-review-accordion"
                  >
                    <AccordionItem value="notes" className="ocr-notes-review-accordion-item">
                      <AccordionTrigger className="ocr-notes-review-accordion-trigger">
                        <div className="ocr-notes-review-accordion-copy">
                          <strong>Notes, Raw OCR, and Review Flags</strong>
                          <span>
                            {reviewDraft.reviewFlags.length > 0
                              ? `${reviewDraft.reviewFlags.length} review flag${
                                  reviewDraft.reviewFlags.length === 1 ? "" : "s"
                                } and ${formatCapturedSummary(noteSignalCount, "note signal")}`
                              : formatCapturedSummary(
                                  noteSignalCount,
                                  "note signal",
                                  "Raw OCR text, notes, and flags remain available here.",
                                )}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="ocr-notes-review-accordion-content">
                        <div className="ocr-notes-review-grid ocr-notes-review-grid-advanced">
                          <div className="ocr-notes-review-section">
                            <div className="ocr-notes-review-section-head">
                              <h3>Notes / Unstructured OCR</h3>
                              <span>Preserve extracted context and freeform lines</span>
                            </div>
                            <div className="ocr-notes-field ocr-notes-field-wide">
                              <label>Summary</label>
                              <textarea
                                className="ocr-notes-textarea"
                                rows={3}
                                value={reviewDraft.summary}
                                onChange={(eventLike) =>
                                  handleReviewEdit((prev) => ({
                                    ...prev,
                                    summary: eventLike.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="ocr-notes-field ocr-notes-field-wide">
                              <label>Raw OCR Text</label>
                              <textarea
                                className="ocr-notes-textarea"
                                rows={6}
                                value={reviewDraft.rawText || reviewDraft.extractedText}
                                onChange={(eventLike) =>
                                  handleReviewEdit((prev) => ({
                                    ...prev,
                                    rawText: eventLike.target.value,
                                    extractedText: eventLike.target.value,
                                  }))
                                }
                              />
                            </div>
                            {Array.isArray(reviewDraft.rawEvidence?.visible_text) &&
                            reviewDraft.rawEvidence.visible_text.length > 0 ? (
                              <div className="ocr-notes-metadata-list">
                                <div>
                                  <span>Visible Text Lines</span>
                                  <strong>{reviewDraft.rawEvidence.visible_text.length}</strong>
                                </div>
                                <div>
                                  <span>Detected Grids</span>
                                  <strong>
                                    {Array.isArray(reviewDraft.rawEvidence?.detected_grids)
                                      ? reviewDraft.rawEvidence.detected_grids.length
                                      : 0}
                                  </strong>
                                </div>
                                <div>
                                  <span>Unmapped Values</span>
                                  <strong>
                                    {Array.isArray(reviewDraft.rawEvidence?.unmapped_values)
                                      ? reviewDraft.rawEvidence.unmapped_values.length
                                      : 0}
                                  </strong>
                                </div>
                              </div>
                            ) : null}
                            <div className="ocr-notes-field ocr-notes-field-wide">
                              <label>Review Notes</label>
                              <textarea
                                className="ocr-notes-textarea"
                                rows={5}
                                value={joinNotes(reviewDraft.notes)}
                                onChange={(eventLike) =>
                                  handleReviewEdit((prev) => ({
                                    ...prev,
                                    notes: splitNotes(eventLike.target.value),
                                  }))
                                }
                                placeholder="One line per extracted note or correction."
                              />
                            </div>
                          </div>

                          <div className="ocr-notes-review-section">
                            <div className="ocr-notes-review-section-head">
                              <h3>Warnings and Review Flags</h3>
                              <span>Keep ambiguous values visible</span>
                            </div>
                            <div className="ocr-notes-flag-row">
                              {reviewDraft.reviewFlags.length > 0 ? (
                                reviewDraft.reviewFlags.map((flag, index) => (
                                  <span key={`${flag}-${index}`} className="ocr-notes-flag-chip">
                                    {flag}
                                  </span>
                                ))
                              ) : (
                                <span className="ocr-notes-flag-chip subdued">
                                  No review flags returned from OCR.
                                </span>
                              )}
                            </div>
                            <div className="ocr-notes-metadata-list">
                              <div>
                                <span>Driver Text</span>
                                <strong>{reviewDraft.metadata?.driver_text || "Not detected"}</strong>
                              </div>
                              <div>
                                <span>Track Text</span>
                                <strong>{reviewDraft.metadata?.track_text || "Not detected"}</strong>
                              </div>
                              <div>
                                <span>Session Text</span>
                                <strong>{reviewDraft.metadata?.session_text || "Not detected"}</strong>
                              </div>
                              <div>
                                <span>Template</span>
                                <strong>
                                  {reviewDraft.templateName || reviewDraft.metadata?.template_name || "Generic OCR"}
                                </strong>
                              </div>
                              <div>
                                <span>Model Used</span>
                                <strong>{modelDisplay}</strong>
                              </div>
                              <div>
                                <span>Fallback Used</span>
                                <strong>{reviewDraft.fallbackUsed ? "Yes" : "No"}</strong>
                              </div>
                              <div>
                                <span>Review Status</span>
                                <strong>{reviewDraft.recommendedReviewStatus || "PENDING"}</strong>
                              </div>
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    {showSuspensionAccordion ? (
                      <AccordionItem value="suspension" className="ocr-notes-review-accordion-item">
                      <AccordionTrigger className="ocr-notes-review-accordion-trigger">
                        <div className="ocr-notes-review-accordion-copy">
                          <strong>Suspension / Shocks</strong>
                          <span>{formatCapturedSummary(suspensionFieldCount, "suspension value")}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="ocr-notes-review-accordion-content">
                        <div className="ocr-notes-review-grid ocr-notes-review-grid-advanced">
                          <div className="ocr-notes-review-section">
                            <div className="ocr-notes-review-section-head">
                              <h3>Suspension / Shocks</h3>
                              <span>Rebound, bump, bars, and wing</span>
                            </div>
                            <div className="ocr-notes-form-grid">
                              {[
                                ["rebound_fl", "Rebound FL"],
                                ["rebound_fr", "Rebound FR"],
                                ["rebound_rl", "Rebound RL"],
                                ["rebound_rr", "Rebound RR"],
                                ["bump_fl", "Bump FL"],
                                ["bump_fr", "Bump FR"],
                                ["bump_rl", "Bump RL"],
                                ["bump_rr", "Bump RR"],
                                ["hsr_fl", "HSR FL"],
                                ["hsr_fr", "HSR FR"],
                                ["hsr_rl", "HSR RL"],
                                ["hsr_rr", "HSR RR"],
                                ["lsr_fl", "LSR FL"],
                                ["lsr_fr", "LSR FR"],
                                ["lsr_rl", "LSR RL"],
                                ["lsr_rr", "LSR RR"],
                                ["hsb_fl", "HSB FL"],
                                ["hsb_fr", "HSB FR"],
                                ["hsb_rl", "HSB RL"],
                                ["hsb_rr", "HSB RR"],
                                ["lsb_fl", "LSB FL"],
                                ["lsb_fr", "LSB FR"],
                                ["lsb_rl", "LSB RL"],
                                ["lsb_rr", "LSB RR"],
                                ["sway_bar_f", "Sway Bar F"],
                                ["sway_bar_r", "Sway Bar R"],
                                ["wing_angle_deg", "Wing Angle"],
                              ].map(([field, label]) => (
                                <div key={field} className="ocr-notes-field">
                                  <label>{label}</label>
                                  <input
                                    className="ocr-notes-input"
                                    type="text"
                                    value={reviewDraft.suspension[field]}
                                    onChange={(eventLike) =>
                                      handleReviewEdit((prev) => ({
                                        ...prev,
                                        suspension: {
                                          ...prev.suspension,
                                          [field]: eventLike.target.value,
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                      </AccordionItem>
                    ) : null}

                    {isPrintedFormDoc ? (
                      <AccordionItem value="after-session" className="ocr-notes-review-accordion-item">
                        <AccordionTrigger className="ocr-notes-review-accordion-trigger">
                          <div className="ocr-notes-review-accordion-copy">
                            <strong>After Session Set-Down & Notes</strong>
                            <span>
                              {printedFormAfterSessionFieldCount > 0
                                ? `${printedFormAfterSessionFieldCount} after-session value${
                                    printedFormAfterSessionFieldCount === 1 ? "" : "s"
                                  } captured`
                                : "Collapsed by default so the upper setup block stays primary."}
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="ocr-notes-review-accordion-content">
                          <div className="ocr-notes-review-grid ocr-notes-review-grid-advanced">
                            <div className="ocr-notes-review-section">
                              <div className="ocr-notes-review-section-head">
                                <h3>After Session Set-Down</h3>
                                <span>Keep the lower block separate from the main setup values</span>
                              </div>
                              <div className="ocr-notes-form-grid">
                                {PRINTED_FORM_AFTER_SESSION_FIELDS.map(([field, label]) => {
                                  const isSheetField = field === "fuel_pumped_out_liters";
                                  return (
                                    <div key={field} className="ocr-notes-field">
                                      <label htmlFor={`ocr-after-session-field-${field}`}>{label}</label>
                                      <input
                                        id={`ocr-after-session-field-${field}`}
                                        className="ocr-notes-input"
                                        type="text"
                                        value={isSheetField ? reviewDraft.sheetFields[field] : reviewDraft.postSession[field]}
                                        onChange={(eventLike) =>
                                          handleReviewEdit((prev) => ({
                                            ...prev,
                                            ...(isSheetField
                                              ? {
                                                  sheetFields: {
                                                    ...prev.sheetFields,
                                                    [field]: eventLike.target.value,
                                                  },
                                                }
                                              : {
                                                  postSession: {
                                                    ...prev.postSession,
                                                    [field]: eventLike.target.value,
                                                  },
                                                }),
                                          }))
                                        }
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="ocr-notes-review-section">
                              <div className="ocr-notes-review-section-head">
                                <h3>Template Notes Block</h3>
                                <span>Preserve the printed-form notes area without cluttering the main review grid</span>
                              </div>
                              <div className="ocr-notes-field ocr-notes-field-wide">
                                <label>Template Notes Block</label>
                                <textarea
                                  className="ocr-notes-textarea"
                                  rows={7}
                                  value={reviewDraft.sheetFields.notes_block}
                                  onChange={(eventLike) =>
                                    handleReviewEdit((prev) => ({
                                      ...prev,
                                      sheetFields: {
                                        ...prev.sheetFields,
                                        notes_block: eventLike.target.value,
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <div className="ocr-notes-metadata-list">
                                <div>
                                  <span>Main Setup Preserved</span>
                                  <strong>{formatCapturedSummary(printedFormPrimaryFieldCount, "main field")}</strong>
                                </div>
                                <div>
                                  <span>After Session Preserved</span>
                                  <strong>{formatCapturedSummary(printedFormAfterSessionFieldCount, "after-session field")}</strong>
                                </div>
                              </div>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ) : (
                      <AccordionItem value="template" className="ocr-notes-review-accordion-item">
                      <AccordionTrigger className="ocr-notes-review-accordion-trigger">
                        <div className="ocr-notes-review-accordion-copy">
                          <strong>Template-specific fields</strong>
                          <span>{formatCapturedSummary(templateFieldCount, "template value")}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="ocr-notes-review-accordion-content">
                        <div className="ocr-notes-review-grid ocr-notes-review-grid-advanced">
                          <div className="ocr-notes-review-section">
                            <div className="ocr-notes-review-section-head">
                              <h3>Client Sheet Fields</h3>
                              <span>Template-specific setup labels and side-specific values</span>
                            </div>
                            <div className="ocr-notes-form-grid">
                              {CLIENT_SHEET_FIELDS.map(([field, label]) => (
                                <div key={field} className="ocr-notes-field">
                                  <label>{label}</label>
                                  <input
                                    className="ocr-notes-input"
                                    type="text"
                                    value={reviewDraft.sheetFields[field]}
                                    onChange={(eventLike) =>
                                      handleReviewEdit((prev) => ({
                                        ...prev,
                                        sheetFields: {
                                          ...prev.sheetFields,
                                          [field]: eventLike.target.value,
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="ocr-notes-review-section">
                            <div className="ocr-notes-review-section-head">
                              <h3>After Session / Template Notes</h3>
                              <span>Keep the lower-sheet fields and long notes reviewable</span>
                            </div>
                            <div className="ocr-notes-form-grid">
                              {POST_SESSION_FIELDS.map(([field, label]) => (
                                <div key={field} className="ocr-notes-field">
                                  <label>{label}</label>
                                  <input
                                    className="ocr-notes-input"
                                    type="text"
                                    value={reviewDraft.postSession[field]}
                                    onChange={(eventLike) =>
                                      handleReviewEdit((prev) => ({
                                        ...prev,
                                        postSession: {
                                          ...prev.postSession,
                                          [field]: eventLike.target.value,
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="ocr-notes-field ocr-notes-field-wide">
                              <label>Template Notes Block</label>
                              <textarea
                                className="ocr-notes-textarea"
                                rows={5}
                                value={reviewDraft.sheetFields.notes_block}
                                onChange={(eventLike) =>
                                  handleReviewEdit((prev) => ({
                                    ...prev,
                                    sheetFields: {
                                      ...prev.sheetFields,
                                      notes_block: eventLike.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                      </AccordionItem>
                    )}

                    {showShockSetupAccordion ? (
                      <AccordionItem value="shock-sheet" className="ocr-notes-review-accordion-item">
                      <AccordionTrigger className="ocr-notes-review-accordion-trigger">
                        <div className="ocr-notes-review-accordion-copy">
                          <strong>Shock setup sheet</strong>
                          <span>{formatCapturedSummary(shockSetupFieldCount, "shock setup value")}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="ocr-notes-review-accordion-content">
                        <div className="ocr-notes-review-grid ocr-notes-review-grid-advanced">
                          <div className="ocr-notes-review-section">
                            <div className="ocr-notes-review-section-head">
                              <h3>Shock Setup Page</h3>
                              <span>Dedicated RR, LR, LF, and RF shock-sheet values</span>
                            </div>
                            <div className="ocr-notes-pressure-grid">
                              {SHOCK_SETUP_GROUPS.map(([cornerKey, cornerLabel]) => (
                                <div key={cornerKey} className="ocr-notes-pressure-panel">
                                  <strong>{cornerLabel}</strong>
                                  <div className="ocr-notes-matrix-grid">
                                    {SHOCK_SETUP_FIELDS.map(([fieldKey, fieldLabel]) => {
                                      const field = `${cornerKey}_${fieldKey}`;
                                      return (
                                        <label key={field} className="ocr-notes-mini-field">
                                          <span>{fieldLabel}</span>
                                          <input
                                            className="ocr-notes-input"
                                            type="text"
                                            value={reviewDraft.shockSetup[field]}
                                            onChange={(eventLike) =>
                                              handleReviewEdit((prev) => ({
                                                ...prev,
                                                shockSetup: {
                                                  ...prev.shockSetup,
                                                  [field]: eventLike.target.value,
                                                },
                                              }))
                                            }
                                          />
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                      </AccordionItem>
                    ) : null}
                  </Accordion>
                </div>
              </div>
            </section>
          ) : null}

          <footer className="ocr-notes-footer">
            <div className="ocr-notes-footer-copy">
              <h3>{footerTitle}</h3>
              <p>{footerCopy}</p>
            </div>

            <div className="ocr-notes-footer-actions">
              {isReviewView ? (
                <button type="button" className="ocr-notes-button-secondary" onClick={() => router.push(manualIntakeRoute)}>
                  Back to OCR Intake
                </button>
              ) : (
                <button type="button" className="ocr-notes-button-secondary" onClick={() => router.push(`/event/${routeEventId}`)}>
                  Back to Event
                </button>
              )}
              <button
                type="button"
                className="ocr-notes-button-secondary"
                onClick={() => {
                  resetForm();
                  if (isReviewView) {
                    router.push(intakeRoute);
                  }
                }}
                disabled={activeAsyncState}
              >
                {isReviewView ? "Start Over" : "Reset Form"}
              </button>
              <button
                type="button"
                data-testid="ocr-save-draft-button"
                className="ocr-notes-button-secondary"
                onClick={handleSaveDraft}
                disabled={activeAsyncState || (!hasImage && !hasExtractedDraft && !normalizeText(intakeState.notes))}
              >
                {workflowState === "saving_draft" ? "Saving Draft..." : "Save Draft"}
              </button>
              <button
                type="button"
                data-testid="ocr-extract-button"
                className={isReviewView ? "ocr-notes-button-secondary" : "ocr-notes-button-primary"}
                onClick={() => handleExtract({ rerun: hasExtractedDraft })}
                disabled={activeAsyncState || !hasImage || !canSubmitOcr}
              >
                {workflowState === "extracting"
                  ? "Submitting..."
                  : workflowState === "rerunning_ocr"
                    ? "Resubmitting..."
                    : hasExtractedDraft
                      ? "Resubmit to Make.com"
                      : isReviewView
                        ? "Send to Make.com"
                        : "Submit to Make.com"}
              </button>
              {isReviewView ? (
                <button
                  type="button"
                  data-testid="ocr-submit-review-button"
                  className="ocr-notes-button-primary"
                  onClick={handleSubmitForReview}
                  disabled={activeAsyncState || !hasExtractedDraft || !canSubmitOcr}
                >
                  {workflowState === "submitting_review" ? "Submitting..." : "Submit for Review"}
                </button>
              ) : null}
            </div>
          </footer>

          {workflowState === "submit_success" ? (
            <section className="ocr-notes-success-panel">
              <div className="ocr-notes-success-copy">
                <p className="ocr-notes-panel-eyebrow">Next Steps</p>
                <h2>Keep the review workflow moving</h2>
                <p>
                  Open submissions history to verify the staged OCR note, upload another setup sheet, or jump back into
                  the typed notes flow without leaving the event context behind.
                </p>
              </div>

              <div className="ocr-notes-link-grid">
                <button
                  type="button"
                  className="ocr-notes-link-card"
                  onClick={() => router.push(`/event/${routeEventId}/submissions`)}
                >
                  <div className="ocr-notes-link-icon">
                    <CheckCircleRoundedIcon fontSize="inherit" />
                  </div>
                  <div className="ocr-notes-link-copy">
                    <span>Review History</span>
                    <strong>Open Submissions</strong>
                  </div>
                  <KeyboardArrowRightRoundedIcon className="ocr-notes-link-arrow" fontSize="inherit" />
                </button>

                <button type="button" className="ocr-notes-link-card" onClick={resetForm}>
                  <div className="ocr-notes-link-icon accent">
                    <DocumentScannerRoundedIcon fontSize="inherit" />
                  </div>
                  <div className="ocr-notes-link-copy">
                    <span>OCR Flow</span>
                    <strong>Upload Another</strong>
                  </div>
                  <KeyboardArrowRightRoundedIcon className="ocr-notes-link-arrow" fontSize="inherit" />
                </button>

                <button
                  type="button"
                  className="ocr-notes-link-card"
                  onClick={() => router.push(`/event/${routeEventId}/notes`)}
                >
                  <div className="ocr-notes-link-icon neutral">
                    <PendingActionsRoundedIcon fontSize="inherit" />
                  </div>
                  <div className="ocr-notes-link-copy">
                    <span>Typed Entry</span>
                    <strong>Open Submit Notes</strong>
                  </div>
                  <KeyboardArrowRightRoundedIcon className="ocr-notes-link-arrow" fontSize="inherit" />
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default function OCRNotesPage() {
  return <OCRWorkflowPage initialView="intake" />;
}
