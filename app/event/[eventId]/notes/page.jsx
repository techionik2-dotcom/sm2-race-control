"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import AppSelect from "@/components/ui/app-select";
import { useAuth } from "../../../context/AuthContext";
import ProtectedRoute from "../../../components/ProtectedRoute";
import ScreenBackButton from "../../../components/Common/ScreenBackButton";
import { generateUUID } from "../../../utils/uuid";
import { getEventById, selectActiveEvent } from "../../../utils/eventApi";
import {
  createSubmission,
  getSubmissionById,
  shouldUseRawSubmissionRoute,
  updateSubmission,
} from "../../../utils/submissionApi";
import { getTrackCatalog } from "../../../utils/trackCatalogApi";
import { getRunGroup } from "../../../utils/runGroupApi";
import { getDrivers, getVehicles } from "../../../utils/fleetApi";
import { getEventSubmissionState } from "../../../utils/eventSchedule";
import {
  DRIVER_OPTIONS,
  VEHICLE_OPTIONS,
  SESSION_TYPE_OPTIONS,
  PRESSURE_UNIT_OPTIONS,
} from "../../../utils/staticOptions";
import "./NotesSubmission.css";

const getCurrentLocalTimeValue = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const GENERATED_SESSION_ID_PATTERN = /^\d{8}-\d{4}-[A-Z0-9]+-S\d+$/;
const LEGACY_SESSION_ID_PATTERN =
  /^[A-Z0-9]+-\d{8}-\d{4}-[A-Z0-9]+-\d+-[A-Z0-9]+-[A-Z0-9][A-Z0-9-]*$/;
const TIRE_INVENTORY_STATUS_OPTIONS = [
  { id: "ACTIVE", label: "Active" },
  { id: "DISCARDED", label: "Discarded" },
];
const PRESSURE_LIMITS = {
  cold: { min: 5, max: 60, label: "Cold" },
  hot: { min: 5, max: 80, label: "Hot" },
};
const PRESSURE_CORNERS = [
  ["fl", "FL"],
  ["fr", "FR"],
  ["rl", "RL"],
  ["rr", "RR"],
];

const isValidDateValue = (value) => {
  const cleaned = String(value || "").trim();
  if (!DATE_PATTERN.test(cleaned)) {
    return false;
  }

  const [year, month, day] = cleaned.split("-").map((part) => Number(part));
  if (![year, month, day].every((part) => Number.isInteger(part))) {
    return false;
  }

  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
};

const isValidTimeValue = (value) => TIME_PATTERN.test(String(value || "").trim());

const isValidSessionId = (value) => {
  const cleaned = String(value || "").trim().toUpperCase();
  return (
    GENERATED_SESSION_ID_PATTERN.test(cleaned) ||
    LEGACY_SESSION_ID_PATTERN.test(cleaned)
  );
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
    !isValidDateValue(normalizedDate) ||
    !isValidTimeValue(normalizedTime) ||
    !normalizedDriverId ||
    !/^\d+$/.test(normalizedSessionNumber)
  ) {
    return "";
  }

  return `${normalizedDate.replace(/-/g, "")}-${normalizedTime.replace(":", "")}-${normalizedDriverId}-S${normalizedSessionNumber}`;
};

const toNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const countFilledValues = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countFilledValues(item), 0);
  }

  if (typeof value === "object") {
    return Object.values(value).reduce(
      (total, item) => total + countFilledValues(item),
      0,
    );
  }

  if (typeof value === "string") {
    return value.trim() ? 1 : 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? 1 : 0;
  }

  return value ? 1 : 0;
};

const getPressureWarnings = (pressures = {}) => {
  const warnings = [];

  Object.entries(PRESSURE_LIMITS).forEach(([phase, limits]) => {
    PRESSURE_CORNERS.forEach(([cornerKey, cornerLabel]) => {
      const numericValue = toNullableNumber(pressures?.[phase]?.[cornerKey]);
      if (numericValue === null) {
        return;
      }

      if (numericValue < limits.min || numericValue > limits.max) {
        warnings.push({
          id: `${phase}-${cornerKey}`,
          section: "pressures",
          field: `${phase}_${cornerKey}`,
          label: `${limits.label} ${cornerLabel}`,
          message: `${limits.label} ${cornerLabel} ${numericValue} psi is outside the normalized DB range of ${limits.min}-${limits.max} psi. The note can still save, but this pressure value will be skipped from normalized tables.`,
        });
      }
    });
  });

  return warnings;
};

const formatStructuredWarning = (warning) => {
  const fieldLabel = warning?.field ? `${warning.field}: ` : "";
  return `${fieldLabel}${warning?.message || "Structured normalization completed with a warning."}`;
};

const validateSubmissionFields = ({
  formState,
  trackValue,
  runGroupValue,
  driverOptions,
  vehicleOptions,
  isRawQuickSubmission = false,
}) => {
  const errors = {};
  const validDriverIds = new Set(
    (driverOptions || [])
      .map((driver) => String(driver?.id || "").trim())
      .filter(Boolean),
  );
  const validVehicleIds = new Set(
    (vehicleOptions || [])
      .map((vehicle) => String(vehicle?.id || "").trim())
      .filter(Boolean),
  );

  if (!isRawQuickSubmission) {
    if (!isValidDateValue(formState.date)) {
      errors.date = "Please enter a valid date.";
    }

    if (!isValidTimeValue(formState.time)) {
      errors.time = "Please enter a valid time.";
    }

    if (!String(formState.session_type || "").trim()) {
      errors.session_type = "Session type is required.";
    }

    const sessionNumberValue = String(formState.session_number ?? "").trim();
    if (!sessionNumberValue) {
      errors.session_number = "Session number is required.";
    } else {
      const parsedSessionNumber = Number(sessionNumberValue);
      if (!Number.isInteger(parsedSessionNumber) || parsedSessionNumber <= 0) {
        errors.session_number = "Session number must be a whole number greater than 0.";
      }
    }

    if (!isValidSessionId(formState.session_id)) {
      errors.session_id =
        "Session ID must use the generated format or a legacy session reference.";
    }

    const wheelbaseValue = String(formState.wheelbase_mm ?? "").trim();
    if (wheelbaseValue) {
      const parsedWheelbase = Number(wheelbaseValue);
      if (!Number.isFinite(parsedWheelbase) || parsedWheelbase <= 0) {
        errors.wheelbase_mm = "Wheelbase must be greater than 0.";
      }
    }

    if (!String(trackValue || "").trim()) {
      errors.track = "Please select a track.";
    }

    if (!String(runGroupValue || "").trim()) {
      errors.run_group = "Run group is required before notes can be submitted.";
    }

    const driverId = String(formState.driver_id || "").trim();
    if (!driverId || !validDriverIds.has(driverId)) {
      errors.driver_id = "Please select a driver.";
    }

    const vehicleId = String(formState.vehicle_id || "").trim();
    if (!vehicleId || !validVehicleIds.has(vehicleId)) {
      errors.vehicle_id = "Please select a vehicle.";
    }
  }

  return errors;
};

const getSubmissionFailureMessage = (errorLike) => {
  const code = String(errorLike?.code || "").trim().toUpperCase();
  const message = String(
    errorLike?.message ||
    errorLike?.error ||
    "",
  ).trim();

  if (code === "SUBMISSION_ALREADY_EXISTS") {
    return "This Session ID already exists. Use a new Session ID or click Use Generated ID.";
  }

  if (code === "SUBMISSION_DUPLICATE") {
    return "A note for this event, driver, vehicle, date, time, and session number already exists. Review the previous submission or adjust the session details.";
  }

  if (code === "SUBMISSION_SAVE_FAILED") {
    return "The backend could not save this submission. Please try once more. If it happens again, check the backend logs for the exact error.";
  }

  if (code === "SUBMISSION_LOAD_FAILED") {
    return "The backend saved the note but could not reload it. Check Submissions before retrying so you do not create a duplicate.";
  }

  if (code === "SUBMISSION_RETRY_FAILED") {
    return "The backend could not retry this submission right now. Please try again.";
  }

  return message || "Failed to submit notes. Please try again.";
};

const getSubmissionSuccessState = (submission, { overwrite = false } = {}) => {
  if (submission?.rawSubmissionMessage) {
    return {
      status: "sent",
      message: submission.rawSubmissionMessage,
      warnings: [],
    };
  }

  const structuredStatus = String(submission?.structuredIngestStatus || "").trim().toLowerCase();
  const structuredWarnings = Array.isArray(submission?.structuredIngestWarnings)
    ? submission.structuredIngestWarnings
    : [];

  if (structuredStatus === "saved_with_warnings" && structuredWarnings.length) {
    return {
      status: "sent_with_warnings",
      message: overwrite
        ? "Note overwritten. Some structured fields could not be normalized, so review the warnings below."
        : "Note saved. Some structured fields could not be normalized, so review the warnings below.",
      warnings: structuredWarnings,
    };
  }

  if (structuredStatus === "skipped" && structuredWarnings.length) {
    return {
      status: "sent_with_warnings",
      message: overwrite
        ? "Note overwritten, but structured normalization was skipped for some fields. Review the warnings below."
        : "Note saved, but structured normalization was skipped for some fields. Review the warnings below.",
      warnings: structuredWarnings,
    };
  }

  return {
    status: "sent",
    message: overwrite
      ? "Notes overwritten successfully! Redirecting..."
      : "Notes submitted successfully! Redirecting...",
    warnings: [],
  };
};

const createBaseFormState = () => ({
  date: "",
  time: getCurrentLocalTimeValue(),
  session_id: "",
  track: "",
  driver_id: "",
  vehicle_id: "",
  session_type: "Practice",
  session_number: 1,
  duration_min: 30,
  tire_set: "",
  wheelbase_mm: "",
  pressures: {
    unit: "psi",
    cold: { fl: "", fr: "", rl: "", rr: "" },
    hot: { fl: "", fr: "", rl: "", rr: "" },
  },
});

const createDetailFormState = () => ({
  ...createBaseFormState(),
  suspension: {
    rebound_fl: "",
    rebound_fr: "",
    rebound_rl: "",
    rebound_rr: "",
    bump_fl: "",
    bump_fr: "",
    bump_rl: "",
    bump_rr: "",
    sway_bar_f: "",
    sway_bar_r: "",
    wing_angle_deg: "",
  },
  alignment: {
    camber_fl: "",
    camber_fr: "",
    camber_rl: "",
    camber_rr: "",
    toe_front: "",
    toe_rear: "",
    caster_l: "",
    caster_r: "",
    ride_height_f: "",
    ride_height_r: "",
    corner_weight_fl: "",
    corner_weight_fr: "",
    corner_weight_rl: "",
    corner_weight_rr: "",
    cross_weight_pct: "",
    rake_mm: "",
  },
  tire_temperatures: {
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
  tire_inventory: {
    tire_id: "",
    manufacturer: "",
    model: "",
    size: "",
    purchase_date: "",
    heat_cycles: "",
    track_time_min: "",
    status: "ACTIVE",
  },
});

const toInputValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

const buildPressureFormState = (pressures = {}) => ({
  unit: String(pressures?.unit || "psi"),
  cold: {
    fl: toInputValue(pressures?.cold?.fl),
    fr: toInputValue(pressures?.cold?.fr),
    rl: toInputValue(pressures?.cold?.rl),
    rr: toInputValue(pressures?.cold?.rr),
  },
  hot: {
    fl: toInputValue(pressures?.hot?.fl),
    fr: toInputValue(pressures?.hot?.fr),
    rl: toInputValue(pressures?.hot?.rl),
    rr: toInputValue(pressures?.hot?.rr),
  },
});

const buildBaseFormStateFromSession = (sessionData = {}) => ({
  ...createBaseFormState(),
  date: toInputValue(sessionData?.date),
  time: toInputValue(sessionData?.time),
  session_id: toInputValue(sessionData?.session_id),
  track: toInputValue(sessionData?.track),
  driver_id: toInputValue(sessionData?.driver_id),
  vehicle_id: toInputValue(sessionData?.vehicle_id),
  session_type: toInputValue(sessionData?.session_type) || "Practice",
  session_number: toInputValue(sessionData?.session_number) || 1,
  duration_min: toInputValue(sessionData?.duration_min) || 30,
  tire_set: toInputValue(sessionData?.tire_set),
  wheelbase_mm: toInputValue(sessionData?.wheelbase_mm),
  pressures: buildPressureFormState(sessionData?.pressures),
});

const buildDetailFormStateFromSession = (sessionData = {}) => ({
  ...createDetailFormState(),
  ...buildBaseFormStateFromSession(sessionData),
  suspension: {
    rebound_fl: toInputValue(sessionData?.suspension?.rebound_fl),
    rebound_fr: toInputValue(sessionData?.suspension?.rebound_fr),
    rebound_rl: toInputValue(sessionData?.suspension?.rebound_rl),
    rebound_rr: toInputValue(sessionData?.suspension?.rebound_rr),
    bump_fl: toInputValue(sessionData?.suspension?.bump_fl),
    bump_fr: toInputValue(sessionData?.suspension?.bump_fr),
    bump_rl: toInputValue(sessionData?.suspension?.bump_rl),
    bump_rr: toInputValue(sessionData?.suspension?.bump_rr),
    sway_bar_f: toInputValue(sessionData?.suspension?.sway_bar_f),
    sway_bar_r: toInputValue(sessionData?.suspension?.sway_bar_r),
    wing_angle_deg: toInputValue(sessionData?.suspension?.wing_angle_deg),
  },
  alignment: {
    camber_fl: toInputValue(sessionData?.alignment?.camber_fl),
    camber_fr: toInputValue(sessionData?.alignment?.camber_fr),
    camber_rl: toInputValue(sessionData?.alignment?.camber_rl),
    camber_rr: toInputValue(sessionData?.alignment?.camber_rr),
    toe_front: toInputValue(sessionData?.alignment?.toe_front),
    toe_rear: toInputValue(sessionData?.alignment?.toe_rear),
    caster_l: toInputValue(sessionData?.alignment?.caster_l),
    caster_r: toInputValue(sessionData?.alignment?.caster_r),
    ride_height_f: toInputValue(sessionData?.alignment?.ride_height_f),
    ride_height_r: toInputValue(sessionData?.alignment?.ride_height_r),
    corner_weight_fl: toInputValue(sessionData?.alignment?.corner_weight_fl),
    corner_weight_fr: toInputValue(sessionData?.alignment?.corner_weight_fr),
    corner_weight_rl: toInputValue(sessionData?.alignment?.corner_weight_rl),
    corner_weight_rr: toInputValue(sessionData?.alignment?.corner_weight_rr),
    cross_weight_pct: toInputValue(sessionData?.alignment?.cross_weight_pct),
    rake_mm: toInputValue(sessionData?.alignment?.rake_mm),
  },
  tire_temperatures: {
    fl_in: toInputValue(sessionData?.tire_temperatures?.fl_in),
    fl_mid: toInputValue(sessionData?.tire_temperatures?.fl_mid),
    fl_out: toInputValue(sessionData?.tire_temperatures?.fl_out),
    fr_in: toInputValue(sessionData?.tire_temperatures?.fr_in),
    fr_mid: toInputValue(sessionData?.tire_temperatures?.fr_mid),
    fr_out: toInputValue(sessionData?.tire_temperatures?.fr_out),
    rl_in: toInputValue(sessionData?.tire_temperatures?.rl_in),
    rl_mid: toInputValue(sessionData?.tire_temperatures?.rl_mid),
    rl_out: toInputValue(sessionData?.tire_temperatures?.rl_out),
    rr_in: toInputValue(sessionData?.tire_temperatures?.rr_in),
    rr_mid: toInputValue(sessionData?.tire_temperatures?.rr_mid),
    rr_out: toInputValue(sessionData?.tire_temperatures?.rr_out),
  },
  tire_inventory: {
    tire_id: toInputValue(sessionData?.tire_inventory?.tire_id),
    manufacturer: toInputValue(sessionData?.tire_inventory?.manufacturer),
    model: toInputValue(sessionData?.tire_inventory?.model),
    size: toInputValue(sessionData?.tire_inventory?.size),
    purchase_date: toInputValue(sessionData?.tire_inventory?.purchase_date),
    heat_cycles: toInputValue(sessionData?.tire_inventory?.heat_cycles),
    track_time_min: toInputValue(sessionData?.tire_inventory?.track_time_min),
    status: toInputValue(sessionData?.tire_inventory?.status) || "ACTIVE",
  },
});

const getSubmissionMode = (submission) =>
  String(
    submission?.submissionMode ||
      submission?.analysis_result?.submission_mode ||
      submission?.analysisResult?.submissionMode ||
      "",
  )
    .trim()
    .toLowerCase();

const getSubmissionEditText = (submission) =>
  submission?.raw_text ||
  submission?.rawText ||
  submission?.payload?.notes ||
  submission?.data?.notes ||
  submission?.analysis_result?.summary ||
  submission?.analysis_result?.message ||
  submission?.analysisResult?.summary ||
  "";

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

export default function NotesSubmission() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.eventId;
  const { user, isDriver } = useAuth();
  const submissionIdParam = String(searchParams?.get("submissionId") || "").trim();
  const submissionTabParam = String(searchParams?.get("tab") || "").trim().toLowerCase();
  const [event, setEvent] = useState(null);
  const [activeTab, setActiveTab] = useState(
    submissionTabParam === "detail" ? "detail" : "quick",
  ); // 'quick' | 'detail'
  const [eventRunGroup, setEventRunGroup] = useState("");
  const [trackSelection, setTrackSelection] = useState(""); // dropdown value; '__OTHER__' => manual entry
  const [trackCatalog, setTrackCatalog] = useState([]);
  const [driverOptions, setDriverOptions] = useState(() => DRIVER_OPTIONS);
  const [vehicleOptions, setVehicleOptions] = useState(() => VEHICLE_OPTIONS);

  const [pressureTypeQuick, setPressureTypeQuick] = useState("cold");
  const [pressureTypeDetail, setPressureTypeDetail] = useState("cold");

  const [quickRawText, setQuickRawText] = useState("");
  const [detailRawText, setDetailRawText] = useState("");
  const [quickAction, setQuickAction] = useState("ADD_SEANCE");
  const [detailAction, setDetailAction] = useState("ADD_SEANCE");
  const [quickConfidence, setQuickConfidence] = useState(0.85);
  const [detailConfidence, setDetailConfidence] = useState(0.85);
  const [quickDraftStatus, setQuickDraftStatus] = useState("idle");
  const [quickDraftReady, setQuickDraftReady] = useState(false);
  const [detailDraftStatus, setDetailDraftStatus] = useState("idle");
  const [detailDraftReady, setDetailDraftReady] = useState(false);
  const [quickImage, setQuickImage] = useState(null);
  const [detailImage, setDetailImage] = useState(null);
  const quickRawTextRef = useRef(null);
  const quickDraftHydratedRef = useRef(false);
  const quickDraftSaveTimeoutRef = useRef(null);
  const detailDraftHydratedRef = useRef(false);
  const detailDraftSaveTimeoutRef = useRef(null);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [editingSubmissionLoading, setEditingSubmissionLoading] = useState(false);
  const [editingSubmissionError, setEditingSubmissionError] = useState("");

  const [quickForm, setQuickForm] = useState(() => createBaseFormState());

  const [detailForm, setDetailForm] = useState(() =>
    createDetailFormState(),
  );
  const [submissionStatus, setSubmissionStatus] = useState("pending"); // sent, sent_with_warnings, pending, failed
  const [submissionFeedback, setSubmissionFeedback] = useState("");
  const [submissionWarnings, setSubmissionWarnings] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sessionIdMode, setSessionIdMode] = useState({
    quick: "auto",
    detail: "auto",
  });
  const [fieldTouched, setFieldTouched] = useState({ quick: {}, detail: {} });
  const [validationAttempted, setValidationAttempted] = useState({
    quick: false,
    detail: false,
  });
  const currentUserSubmissionLabel = useMemo(() => {
    const resolveUserLabel = (candidate) =>
      candidate?.name ||
      candidate?.email ||
      candidate?.user?.name ||
      candidate?.user?.email ||
      null;

    if (typeof window !== "undefined") {
      try {
        const storedUser = window.localStorage.getItem("sm2_user");
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          const storedLabel = resolveUserLabel(parsedUser);
          if (storedLabel) {
            return String(storedLabel).trim();
          }
        }
      } catch (error) {
        console.warn("Failed to read stored user for submission payload:", error);
      }
    }

    return resolveUserLabel(user) ? String(resolveUserLabel(user)).trim() : "";
  }, [user]);
  const currentUserStorageKey = useMemo(() => {
    const resolveUserKey = (candidate) =>
      candidate?.id ||
      candidate?._id ||
      candidate?.userId ||
      candidate?.email ||
      candidate?.user?.id ||
      candidate?.user?._id ||
      candidate?.user?.userId ||
      candidate?.user?.email ||
      null;

    if (typeof window !== "undefined") {
      try {
        const storedUser = window.localStorage.getItem("sm2_user");
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          const storedKey = resolveUserKey(parsedUser);
          if (storedKey) {
            return String(storedKey);
          }
        }
      } catch (error) {
        console.warn("Failed to read stored user for draft key:", error);
      }
    }

    return resolveUserKey(user) || "anonymous";
  }, [user]);
  const draftScopeKey = useMemo(
    () => (submissionIdParam ? `edit:${submissionIdParam}` : "new"),
    [submissionIdParam],
  );
  const quickDraftStorageKey = useMemo(() => {
    if (!eventId || !currentUserStorageKey) {
      return null;
    }

    return `sm2:submission-draft:quick:${eventId}:${currentUserStorageKey}:${draftScopeKey}`;
  }, [currentUserStorageKey, draftScopeKey, eventId]);
  const detailDraftStorageKey = useMemo(() => {
    if (!eventId || !currentUserStorageKey) {
      return null;
    }

    return `sm2:submission-draft:detail:${eventId}:${currentUserStorageKey}:${draftScopeKey}`;
  }, [currentUserStorageKey, draftScopeKey, eventId]);

  useEffect(() => {
    // Load event from API
    const loadEvent = async () => {
      try {
        const response = await getEventById(eventId);
        const eventData = response.event || response.data || response;
        if (eventData) {
          setEvent(eventData);
          selectActiveEvent(eventId).catch((error) => {
            console.warn("Failed to set active event:", error);
          });
        } else {
          router.push("/events");
        }
      } catch (error) {
        console.error("Failed to load event:", error);
        setError("Failed to load event. Please try again.");
        router.push("/events");
      }
    };

    if (eventId) {
      loadEvent();
    }
  }, [eventId, router]);

  useEffect(() => {
    // Load run group for this event (normalized or rawText)
    const loadRunGroup = async () => {
      try {
        const response = await getRunGroup(eventId);
        const value =
          response?.normalized || response?.rawText || response?.runGroup;
        if (value && typeof value === "string") {
          setEventRunGroup(value.trim());
        }
      } catch (err) {
        setEventRunGroup("");
      }
    };

    if (eventId) loadRunGroup();
  }, [eventId]);

  useEffect(() => {
    let isActive = true;
    const allowArchivedSelections = Boolean(submissionIdParam);

    const loadFleetOptions = async () => {
      try {
        const [driversResponse, vehiclesResponse] = await Promise.all([
          getDrivers(),
          getVehicles(),
        ]);

        if (!isActive) return;

        const liveDrivers = (driversResponse?.drivers || [])
          .filter((driver) => allowArchivedSelections || driver?.isActive !== false)
          .map((driver) => {
            const option = buildDriverOption(driver);
            return driver?.isActive === false
              ? { ...option, label: `${option.label} (archived)` }
              : option;
          })
          .filter((option) => option.id);

        const liveVehicles = (vehiclesResponse?.vehicles || [])
          .filter((vehicle) => allowArchivedSelections || vehicle?.isActive !== false)
          .map((vehicle) => {
            const option = buildVehicleOption(vehicle);
            return vehicle?.isActive === false
              ? { ...option, label: `${option.label} (archived)` }
              : option;
          })
          .filter((option) => option.id);

        setDriverOptions(liveDrivers.length ? liveDrivers : DRIVER_OPTIONS);
        setVehicleOptions(liveVehicles.length ? liveVehicles : VEHICLE_OPTIONS);
      } catch (error) {
        console.warn("Falling back to static fleet options:", error);
        if (!isActive) return;
        setDriverOptions(DRIVER_OPTIONS);
        setVehicleOptions(VEHICLE_OPTIONS);
      }
    };

    loadFleetOptions();

    return () => {
      isActive = false;
    };
  }, [submissionIdParam]);

  const clearQuickDraft = () => {
    if (!quickDraftStorageKey || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.removeItem(quickDraftStorageKey);
    } catch (error) {
      console.warn("Failed to clear quick draft:", error);
    }

    if (quickDraftSaveTimeoutRef.current) {
      window.clearTimeout(quickDraftSaveTimeoutRef.current);
      quickDraftSaveTimeoutRef.current = null;
    }

    quickDraftHydratedRef.current = false;
    setQuickDraftReady(false);
    setQuickDraftStatus("idle");
  };

  const persistQuickDraftSnapshot = useCallback((snapshot) => {
    if (!quickDraftStorageKey || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        quickDraftStorageKey,
        JSON.stringify({
          quickForm: snapshot.quickForm,
          quickRawText: snapshot.quickRawText,
          pressureTypeQuick: snapshot.pressureTypeQuick,
          quickAction: snapshot.quickAction,
          quickConfidence: snapshot.quickConfidence,
          quickImage: snapshot.quickImage,
          trackSelection: snapshot.trackSelection,
          savedAt: new Date().toISOString(),
        }),
      );
      quickDraftHydratedRef.current = true;
      setQuickDraftReady(true);
      setQuickDraftStatus("saved");
    } catch (error) {
      console.warn("Failed to save quick draft:", error);
    }
  }, [quickDraftStorageKey]);

  useEffect(() => {
    quickDraftHydratedRef.current = false;
    setQuickDraftReady(false);

    if (!quickDraftStorageKey || typeof window === "undefined") {
      return;
    }

    try {
      const storedDraft = window.localStorage.getItem(quickDraftStorageKey);
      if (!storedDraft) {
        quickDraftHydratedRef.current = true;
        setQuickDraftReady(true);
        setQuickDraftStatus("idle");
        return;
      }

      const parsedDraft = JSON.parse(storedDraft);
      if (!parsedDraft || typeof parsedDraft !== "object") {
        quickDraftHydratedRef.current = true;
        setQuickDraftReady(true);
        setQuickDraftStatus("idle");
        return;
      }

      if (parsedDraft.quickForm && typeof parsedDraft.quickForm === "object") {
        const restoredGeneratedSessionId = buildGeneratedSessionId(
          parsedDraft.quickForm.date,
          parsedDraft.quickForm.time,
          parsedDraft.quickForm.driver_id,
          parsedDraft.quickForm.session_number,
        );
        const restoredSessionId = String(parsedDraft.quickForm.session_id || "").trim();
        setSessionIdMode((prev) => ({
          ...prev,
          quick:
            restoredSessionId &&
            restoredSessionId !== restoredGeneratedSessionId
              ? "manual"
              : "auto",
        }));

        setQuickForm((prev) => ({
          ...prev,
          ...parsedDraft.quickForm,
          pressures: {
            ...prev.pressures,
            ...parsedDraft.quickForm.pressures,
            cold: {
              ...prev.pressures.cold,
              ...parsedDraft.quickForm.pressures?.cold,
            },
            hot: {
              ...prev.pressures.hot,
              ...parsedDraft.quickForm.pressures?.hot,
            },
          },
        }));
      }

      if (typeof parsedDraft.quickRawText === "string") {
        setQuickRawText(parsedDraft.quickRawText);
      }
      if (typeof parsedDraft.quickAction === "string") {
        setQuickAction(parsedDraft.quickAction);
      }
      if (typeof parsedDraft.quickConfidence === "number") {
        setQuickConfidence(parsedDraft.quickConfidence);
      }
      if (typeof parsedDraft.quickImage === "string") {
        setQuickImage(parsedDraft.quickImage);
      }
      if (typeof parsedDraft.pressureTypeQuick === "string") {
        setPressureTypeQuick(parsedDraft.pressureTypeQuick);
      }
      if (typeof parsedDraft.trackSelection === "string") {
        setTrackSelection(parsedDraft.trackSelection);
      }

      quickDraftHydratedRef.current = true;
      setQuickDraftReady(true);
      setQuickDraftStatus("restored");
    } catch (error) {
      console.warn("Failed to load quick draft:", error);
      quickDraftHydratedRef.current = true;
      setQuickDraftReady(true);
      setQuickDraftStatus("idle");
    }
  }, [quickDraftStorageKey]);

  useEffect(() => {
    if (quickDraftSaveTimeoutRef.current) {
      window.clearTimeout(quickDraftSaveTimeoutRef.current);
      quickDraftSaveTimeoutRef.current = null;
    }

    if (
      activeTab !== "quick" ||
      !quickDraftStorageKey ||
      typeof window === "undefined" ||
      !quickDraftHydratedRef.current ||
      !quickDraftReady
    ) {
      return undefined;
    }

    setQuickDraftStatus("saving");
    quickDraftSaveTimeoutRef.current = window.setTimeout(() => {
      try {
        persistQuickDraftSnapshot({
          quickForm,
          quickRawText,
          pressureTypeQuick,
          quickAction,
          quickConfidence,
          quickImage,
          trackSelection,
        });
      } catch (error) {
        console.warn("Failed to save quick draft:", error);
      }
    }, 800);

    return () => {
      if (quickDraftSaveTimeoutRef.current) {
        window.clearTimeout(quickDraftSaveTimeoutRef.current);
        quickDraftSaveTimeoutRef.current = null;
      }
    };
  }, [
    activeTab,
    persistQuickDraftSnapshot,
    pressureTypeQuick,
    quickAction,
    quickConfidence,
    quickDraftReady,
    quickDraftStorageKey,
    quickForm,
    quickImage,
    quickRawText,
    trackSelection,
  ]);

  const clearDetailDraft = () => {
    if (!detailDraftStorageKey || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.removeItem(detailDraftStorageKey);
    } catch (error) {
      console.warn("Failed to clear detail draft:", error);
    }

    if (detailDraftSaveTimeoutRef.current) {
      window.clearTimeout(detailDraftSaveTimeoutRef.current);
      detailDraftSaveTimeoutRef.current = null;
    }

    detailDraftHydratedRef.current = false;
    setDetailDraftReady(false);
    setDetailDraftStatus("idle");
  };

  const persistDetailDraftSnapshot = (nextDetailForm) => {
    if (
      activeTab !== "detail" ||
      !detailDraftStorageKey ||
      typeof window === "undefined"
    ) {
      return;
    }

    if (detailDraftSaveTimeoutRef.current) {
      window.clearTimeout(detailDraftSaveTimeoutRef.current);
    }

    setDetailDraftStatus("saving");
    detailDraftSaveTimeoutRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          detailDraftStorageKey,
          JSON.stringify({
            detailForm: nextDetailForm,
            detailRawText,
            pressureTypeDetail,
            detailAction,
            detailConfidence,
            detailImage,
            savedAt: new Date().toISOString(),
          }),
        );
        detailDraftHydratedRef.current = true;
        setDetailDraftReady(true);
        setDetailDraftStatus("saved");
      } catch (error) {
        console.warn("Failed to save detail draft:", error);
      }
    }, 150);
  };

  useEffect(() => {
    detailDraftHydratedRef.current = false;
    setDetailDraftReady(false);

    if (!detailDraftStorageKey || typeof window === "undefined") {
      return;
    }

    try {
      const storedDraft = window.localStorage.getItem(detailDraftStorageKey);
      const legacyDraftKey = `sm2:submission-draft:${eventId}:${currentUserStorageKey}`;
      const fallbackDraft =
        storedDraft || window.localStorage.getItem(legacyDraftKey);
      if (!fallbackDraft) {
        detailDraftHydratedRef.current = true;
        setDetailDraftReady(true);
        setDetailDraftStatus("idle");
        return;
      }

      const parsedDraft = JSON.parse(fallbackDraft);
      if (!parsedDraft || typeof parsedDraft !== "object") {
        detailDraftHydratedRef.current = true;
        setDetailDraftReady(true);
        setDetailDraftStatus("idle");
        return;
      }

      if (parsedDraft.detailForm && typeof parsedDraft.detailForm === "object") {
        const restoredGeneratedSessionId = buildGeneratedSessionId(
          parsedDraft.detailForm.date,
          parsedDraft.detailForm.time,
          parsedDraft.detailForm.driver_id,
          parsedDraft.detailForm.session_number,
        );
        const restoredSessionId = String(parsedDraft.detailForm.session_id || "").trim();
        setSessionIdMode((prev) => ({
          ...prev,
          detail:
            restoredSessionId &&
            restoredSessionId !== restoredGeneratedSessionId
              ? "manual"
              : "auto",
        }));

        setDetailForm((prev) => ({
          ...prev,
          ...parsedDraft.detailForm,
          pressures: {
            ...prev.pressures,
            ...parsedDraft.detailForm.pressures,
            cold: {
              ...prev.pressures.cold,
              ...parsedDraft.detailForm.pressures?.cold,
            },
            hot: {
              ...prev.pressures.hot,
              ...parsedDraft.detailForm.pressures?.hot,
            },
          },
          suspension: {
            ...prev.suspension,
            ...parsedDraft.detailForm.suspension,
          },
          alignment: {
            ...prev.alignment,
            ...parsedDraft.detailForm.alignment,
          },
          tire_temperatures: {
            ...prev.tire_temperatures,
            ...parsedDraft.detailForm.tire_temperatures,
          },
          tire_inventory: {
            ...prev.tire_inventory,
            ...parsedDraft.detailForm.tire_inventory,
          },
        }));
      }

      if (typeof parsedDraft.trackSelection === "string") {
        setTrackSelection(parsedDraft.trackSelection);
      } else if (parsedDraft.detailForm?.track) {
        setTrackSelection(
          parsedDraft.detailForm.track === event?.track
            ? parsedDraft.detailForm.track
            : "__OTHER__",
        );
      }
      if (typeof parsedDraft.pressureTypeDetail === "string") {
        setPressureTypeDetail(parsedDraft.pressureTypeDetail);
      }
      if (typeof parsedDraft.detailAction === "string") {
        setDetailAction(parsedDraft.detailAction);
      }
      if (typeof parsedDraft.detailConfidence === "number") {
        setDetailConfidence(parsedDraft.detailConfidence);
      }
      if (typeof parsedDraft.detailRawText === "string") {
        setDetailRawText(parsedDraft.detailRawText);
      }
      if (typeof parsedDraft.detailImage === "string") {
        setDetailImage(parsedDraft.detailImage);
      }

      detailDraftHydratedRef.current = true;
      setDetailDraftReady(true);
      setDetailDraftStatus("restored");
    } catch (error) {
      console.warn("Failed to load detail draft:", error);
      detailDraftHydratedRef.current = true;
      setDetailDraftReady(true);
      setDetailDraftStatus("idle");
    }
  }, [currentUserStorageKey, detailDraftStorageKey, event?.track, eventId]);

  useEffect(() => {
    if (
      !detailDraftStorageKey ||
      typeof window === "undefined" ||
      currentUserStorageKey === "anonymous"
    ) {
      return;
    }

    const anonymousDraftKey = `sm2:submission-draft:${eventId}:anonymous`;

    try {
      const currentDraft = window.localStorage.getItem(detailDraftStorageKey);
      if (currentDraft) {
        return;
      }

      const anonymousDraft = window.localStorage.getItem(anonymousDraftKey);
      if (!anonymousDraft) {
        return;
      }

      window.localStorage.setItem(detailDraftStorageKey, anonymousDraft);
      detailDraftHydratedRef.current = true;
      setDetailDraftReady(true);
      setDetailDraftStatus("restored");
    } catch (error) {
      console.warn("Failed to migrate anonymous detail draft:", error);
    }
  }, [currentUserStorageKey, detailDraftStorageKey, eventId]);

  useEffect(() => {
    if (detailDraftSaveTimeoutRef.current) {
      window.clearTimeout(detailDraftSaveTimeoutRef.current);
      detailDraftSaveTimeoutRef.current = null;
    }

    if (
      activeTab !== "detail" ||
      !detailDraftStorageKey ||
      typeof window === "undefined" ||
      !detailDraftHydratedRef.current ||
      !detailDraftReady
    ) {
      return undefined;
    }

    setDetailDraftStatus("saving");
    detailDraftSaveTimeoutRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          detailDraftStorageKey,
          JSON.stringify({
            detailForm,
            detailRawText,
            trackSelection,
            pressureTypeDetail,
            detailAction,
            detailConfidence,
            detailImage,
            savedAt: new Date().toISOString(),
          }),
        );
        setDetailDraftStatus("saved");
      } catch (error) {
        console.warn("Failed to save detail draft:", error);
      }
    }, 800);

    return () => {
      if (detailDraftSaveTimeoutRef.current) {
        window.clearTimeout(detailDraftSaveTimeoutRef.current);
        detailDraftSaveTimeoutRef.current = null;
      }
    };
  }, [
    activeTab,
    detailAction,
    detailConfidence,
    detailDraftStorageKey,
    detailDraftReady,
    detailForm,
    detailImage,
    detailRawText,
    pressureTypeDetail,
    trackSelection,
  ]);

  useEffect(() => {
    let isActive = true;

    const loadTrackCatalog = async () => {
      try {
        const response = await getTrackCatalog();

        if (!isActive) return;

        setTrackCatalog(response.tracks || []);
      } catch (error) {
        console.warn("Falling back to the current event track only:", error);
        if (!isActive) return;

        setTrackCatalog([]);
      }
    };

    loadTrackCatalog();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadSubmissionForOverwrite = async () => {
      if (!submissionIdParam) {
        setEditingSubmission(null);
        setEditingSubmissionError("");
        setEditingSubmissionLoading(false);
        return;
      }

      setEditingSubmissionLoading(true);
      setEditingSubmissionError("");

      try {
        const response = await getSubmissionById(submissionIdParam);
        if (!isActive) return;

        const submissionData =
          response?.submissionId || response?.id || response?._id
            ? response
            : response?.submission || response;
        if (!submissionData) {
          throw new Error("Submission not found");
        }

        const sessionData =
          submissionData?.data ||
          submissionData?.payload?.data ||
          submissionData?.payload ||
          {};
        const submissionMode = getSubmissionMode(submissionData);
        const nextTab =
          submissionTabParam === "detail" || submissionTabParam === "quick"
            ? submissionTabParam
            : submissionMode === "detail"
              ? "detail"
              : "quick";
        const submissionTrack = toInputValue(sessionData?.track);
        const eventTrack = toInputValue(event?.track);
        const noteText = getSubmissionEditText(submissionData);
        const submissionImage = toInputValue(
          submissionData?.image_url ||
            submissionData?.imageUrl ||
            submissionData?.image ||
            "",
        );
        const quickGeneratedSessionId = buildGeneratedSessionId(
          sessionData?.date,
          sessionData?.time,
          sessionData?.driver_id,
          sessionData?.session_number,
        );
        const detailGeneratedSessionId = quickGeneratedSessionId;

        setEditingSubmission(submissionData);
        setActiveTab(nextTab);
        setQuickForm(buildBaseFormStateFromSession(sessionData));
        setDetailForm(buildDetailFormStateFromSession(sessionData));
        setQuickRawText(noteText);
        setDetailRawText(noteText);
        setQuickAction(
          String(
            submissionData?.analysis_result?.action ||
              submissionData?.analysisResult?.action ||
              "ADD_SEANCE",
          ),
        );
        setDetailAction(
          String(
            submissionData?.analysis_result?.action ||
              submissionData?.analysisResult?.action ||
              "ADD_SEANCE",
          ),
        );
        setQuickConfidence(
          Number(
            submissionData?.analysis_result?.confidence ||
              submissionData?.analysisResult?.confidence ||
              0.85,
          ) || 0.85,
        );
        setDetailConfidence(
          Number(
            submissionData?.analysis_result?.confidence ||
              submissionData?.analysisResult?.confidence ||
              0.85,
          ) || 0.85,
        );
        setQuickImage(submissionImage || null);
        setDetailImage(submissionImage || null);
        setPressureTypeQuick("cold");
        setPressureTypeDetail("cold");
        setSessionIdMode((prev) => ({
          ...prev,
          quick:
            String(sessionData?.session_id || "").trim() &&
            String(sessionData?.session_id || "").trim() !== quickGeneratedSessionId
              ? "manual"
              : "auto",
          detail:
            String(sessionData?.session_id || "").trim() &&
            String(sessionData?.session_id || "").trim() !== detailGeneratedSessionId
              ? "manual"
              : "auto",
        }));

        if (submissionTrack) {
          setTrackSelection(
            submissionTrack.toLowerCase() === eventTrack.toLowerCase()
              ? eventTrack || submissionTrack
              : "__OTHER__",
          );
          if (submissionTrack.toLowerCase() !== eventTrack.toLowerCase()) {
            setQuickForm((prev) => ({ ...prev, track: submissionTrack }));
            setDetailForm((prev) => ({ ...prev, track: submissionTrack }));
          }
        }
      } catch (error) {
        if (!isActive) return;
        console.error("Failed to load submission for overwrite:", error);
        setEditingSubmission(null);
        setEditingSubmissionError(
          error?.message ||
            error?.error ||
            "Failed to load this submission for overwrite.",
        );
      } finally {
        if (isActive) {
          setEditingSubmissionLoading(false);
        }
      }
    };

    loadSubmissionForOverwrite();

    return () => {
      isActive = false;
    };
  }, [event?.track, submissionIdParam, submissionTabParam]);

  const submissionState = useMemo(() => getEventSubmissionState(event), [event]);
  const canOverwriteSubmission = Boolean(editingSubmission) && !editingSubmissionLoading;
  const isEditAttempt = Boolean(submissionIdParam);
  const canSubmitNotes = (submissionState.isOpen && !isEditAttempt) || canOverwriteSubmission;
  const submissionUnavailableMessage = canOverwriteSubmission
    ? ""
    : submissionState.isUpcoming
      ? "Submission notes will open when the event start date arrives."
      : submissionState.hasEnded
        ? "Submission notes close after the event end date."
        : submissionState.isArchived
          ? "Submission notes are unavailable for archived events."
          : "Submission notes are unavailable until the event schedule is ready.";
  const submitButtonLabel = canOverwriteSubmission
    ? "Overwrite Notes"
    : isEditAttempt
      ? "Overwrite Unavailable"
    : canSubmitNotes
      ? "Submit Notes"
      : submissionState.isUpcoming
        ? "Opens At Event Start"
        : submissionState.hasEnded
          ? "Event Closed"
          : "Notes Unavailable";

  const updateQuickForm = (key, value) => {
    setQuickForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateDetailForm = (key, value) => {
    setDetailForm((prev) => {
      const next = { ...prev, [key]: value };
      persistDetailDraftSnapshot(next);
      return next;
    });
  };

  const updatePressure = (setFn, type, corner, value) => {
    setFn((prev) => {
      const next = {
        ...prev,
        pressures: {
          ...prev.pressures,
          [type]: {
            ...prev.pressures[type],
            [corner]: value,
          },
        },
      };

      if (!isQuickTab) {
        persistDetailDraftSnapshot(next);
      }

      return next;
    });
  };

  const updateNested = (setFn, path, value) => {
    // path as array e.g. ['suspension', 'rebound_fl']
    setFn((prev) => {
      const updated = { ...prev };
      let cursor = updated;
      for (let i = 0; i < path.length - 1; i++) {
        cursor[path[i]] = { ...cursor[path[i]] };
        cursor = cursor[path[i]];
      }
      cursor[path[path.length - 1]] = value;
      if (!isQuickTab) {
        persistDetailDraftSnapshot(updated);
      }
      return updated;
    });
  };

  const handleImageChange = (e, setter) => {
    const file = e.target.files?.[0];
    if (!file) {
      setter(null);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setter(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const buildData = (formState) => ({
    date: formState.date || null,
    time: formState.time || null,
    session_id: formState.session_id || null,
    track: formState.track || null,
    run_group: eventRunGroup || null,
    driver_id: formState.driver_id || null,
    vehicle_id: formState.vehicle_id || null,
    session_type: formState.session_type || null,
    session_number: toNullableNumber(formState.session_number),
    duration_min: toNullableNumber(formState.duration_min),
    tire_set: formState.tire_set || null,
    wheelbase_mm: toNullableNumber(formState.wheelbase_mm),
    pressures: {
      unit: formState.pressures?.unit || "psi",
      cold: {
        fl: toNullableNumber(formState.pressures?.cold?.fl),
        fr: toNullableNumber(formState.pressures?.cold?.fr),
        rl: toNullableNumber(formState.pressures?.cold?.rl),
        rr: toNullableNumber(formState.pressures?.cold?.rr),
      },
      hot: {
        fl: toNullableNumber(formState.pressures?.hot?.fl),
        fr: toNullableNumber(formState.pressures?.hot?.fr),
        rl: toNullableNumber(formState.pressures?.hot?.rl),
        rr: toNullableNumber(formState.pressures?.hot?.rr),
      },
    },
  });

  const buildDetailExtensions = (formState) => ({
    suspension: {
      rebound_fl: toNullableNumber(formState.suspension.rebound_fl),
      rebound_fr: toNullableNumber(formState.suspension.rebound_fr),
      rebound_rl: toNullableNumber(formState.suspension.rebound_rl),
      rebound_rr: toNullableNumber(formState.suspension.rebound_rr),
      bump_fl: toNullableNumber(formState.suspension.bump_fl),
      bump_fr: toNullableNumber(formState.suspension.bump_fr),
      bump_rl: toNullableNumber(formState.suspension.bump_rl),
      bump_rr: toNullableNumber(formState.suspension.bump_rr),
      sway_bar_f: toNullableNumber(formState.suspension.sway_bar_f),
      sway_bar_r: toNullableNumber(formState.suspension.sway_bar_r),
      wing_angle_deg: toNullableNumber(formState.suspension.wing_angle_deg),
    },
    alignment: {
      camber_fl: toNullableNumber(formState.alignment.camber_fl),
      camber_fr: toNullableNumber(formState.alignment.camber_fr),
      camber_rl: toNullableNumber(formState.alignment.camber_rl),
      camber_rr: toNullableNumber(formState.alignment.camber_rr),
      toe_front: toNullableNumber(formState.alignment.toe_front),
      toe_rear: toNullableNumber(formState.alignment.toe_rear),
      caster_l: toNullableNumber(formState.alignment.caster_l),
      caster_r: toNullableNumber(formState.alignment.caster_r),
      ride_height_f: toNullableNumber(formState.alignment.ride_height_f),
      ride_height_r: toNullableNumber(formState.alignment.ride_height_r),
      corner_weight_fl: toNullableNumber(
        formState.alignment.corner_weight_fl,
      ),
      corner_weight_fr: toNullableNumber(
        formState.alignment.corner_weight_fr,
      ),
      corner_weight_rl: toNullableNumber(
        formState.alignment.corner_weight_rl,
      ),
      corner_weight_rr: toNullableNumber(
        formState.alignment.corner_weight_rr,
      ),
      cross_weight_pct: toNullableNumber(
        formState.alignment.cross_weight_pct,
      ),
      rake_mm: toNullableNumber(formState.alignment.rake_mm),
    },
    tire_temperatures: {
      fl_in: toNullableNumber(formState.tire_temperatures.fl_in),
      fl_mid: toNullableNumber(formState.tire_temperatures.fl_mid),
      fl_out: toNullableNumber(formState.tire_temperatures.fl_out),
      fr_in: toNullableNumber(formState.tire_temperatures.fr_in),
      fr_mid: toNullableNumber(formState.tire_temperatures.fr_mid),
      fr_out: toNullableNumber(formState.tire_temperatures.fr_out),
      rl_in: toNullableNumber(formState.tire_temperatures.rl_in),
      rl_mid: toNullableNumber(formState.tire_temperatures.rl_mid),
      rl_out: toNullableNumber(formState.tire_temperatures.rl_out),
      rr_in: toNullableNumber(formState.tire_temperatures.rr_in),
      rr_mid: toNullableNumber(formState.tire_temperatures.rr_mid),
      rr_out: toNullableNumber(formState.tire_temperatures.rr_out),
    },
    tire_inventory: {
      tire_id: formState.tire_inventory.tire_id || null,
      manufacturer: formState.tire_inventory.manufacturer || null,
      model: formState.tire_inventory.model || null,
      size: formState.tire_inventory.size || null,
      purchase_date: formState.tire_inventory.purchase_date || null,
      heat_cycles: toNullableNumber(formState.tire_inventory.heat_cycles),
      track_time_min: toNullableNumber(
        formState.tire_inventory.track_time_min,
      ),
      status: formState.tire_inventory.status || null,
    },
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!canSubmitNotes) {
      setSubmissionStatus("failed");
      setError(submissionUnavailableMessage);
      setSubmissionFeedback("");
      setSubmissionWarnings([]);
      return;
    }

    const isQuick = activeTab === "quick";
    const tabKey = isQuick ? "quick" : "detail";
    const formState = isQuick ? quickForm : detailForm;
    const isOverwrite = Boolean(editingSubmission);
    const rawTextValue = isQuick ? quickRawText : detailRawText;
    const imageValue = isQuick ? quickImage : detailImage;
    const actionValue = isQuick ? quickAction : detailAction;
    const confidenceValue = isQuick ? quickConfidence : detailConfidence;
    const submissionErrors = validateSubmissionFields({
      formState,
      trackValue,
      runGroupValue: eventRunGroup,
      driverOptions,
      vehicleOptions: vehicleOptionsForDriver,
      isRawQuickSubmission: isQuick && quickRawRoute,
    });

    if (Object.keys(submissionErrors).length > 0) {
      markCurrentTabRequiredFieldsTouched();
      setValidationAttempted((prev) => ({
        ...prev,
        [tabKey]: true,
      }));
      setSubmissionStatus("failed");
      setError("Please fix the highlighted fields before submitting.");
      setSubmissionFeedback("");
      setSubmissionWarnings([]);
      return;
    }

    setIsSubmitting(true);
    setSubmissionStatus("pending");
    setError("");
    setSubmissionFeedback("");
    setSubmissionWarnings([]);

    try {
      const normalizedFormState = {
        ...formState,
        session_id: String(formState.session_id || "").trim() || generateUUID(),
        track: trackValue,
      };

      const data = buildData(normalizedFormState);
      if (!isQuick) {
        Object.assign(data, buildDetailExtensions(normalizedFormState));
      }

      const createPayload = {
        submissionId: normalizedFormState.session_id,
        session_id: normalizedFormState.session_id,
        correlation_id: generateUUID(),
        source: "pwa",
        created_by: currentUserSubmissionLabel || undefined,
        eventId: event?._id || event?.id || eventId,
        runGroup: eventRunGroup || undefined,
        action: actionValue,
        confidence: Number(confidenceValue),
        data,
        analysis_result: {
          action: actionValue,
          confidence: Number(confidenceValue),
          run_group: eventRunGroup || undefined,
          submission_mode: isQuick ? "quick" : "detail",
        },
        raw_text: rawTextValue?.trim() ? rawTextValue : undefined,
        image_url: imageValue || undefined,
      };

      const overwritePayload = {
        driver_id: normalizedFormState.driver_id || null,
        vehicle_id: normalizedFormState.vehicle_id || null,
        raw_text: rawTextValue?.trim() ? rawTextValue : null,
        image_url: imageValue || null,
        payload: data,
        analysis_result: {
          action: actionValue,
          confidence: Number(confidenceValue),
          run_group: eventRunGroup || undefined,
          submission_mode: isQuick ? "quick" : "detail",
        },
      };

      const response = isOverwrite
        ? await updateSubmission(editingSubmission.id || editingSubmission._id || submissionIdParam, overwritePayload)
        : await createSubmission(createPayload);

      if (response.success) {
        const successState = getSubmissionSuccessState(response.submission, {
          overwrite: isOverwrite,
        });
        clearQuickDraft();
        clearDetailDraft();
        setSubmissionStatus(successState.status);
        setQuickRawText("");
        setDetailRawText("");
        setQuickAction("ADD_SEANCE");
        setDetailAction("ADD_SEANCE");
        setQuickConfidence(0.85);
        setDetailConfidence(0.85);
        setPressureTypeQuick("cold");
        setPressureTypeDetail("cold");
        setQuickImage(null);
        setDetailImage(null);
        setQuickForm(createBaseFormState());
        setDetailForm(createDetailFormState());
        setSessionIdMode({
          quick: "auto",
          detail: "auto",
        });
        setError("");
        setSubmissionFeedback(successState.message);
        setSubmissionWarnings(successState.warnings);
        setFieldTouched({ quick: {}, detail: {} });
        setValidationAttempted({ quick: false, detail: false });

        setTimeout(() => {
          router.push(`/event/${eventId}/submissions`);
        }, 2000);
      } else {
        setSubmissionStatus("failed");
        setSubmissionFeedback("");
        setSubmissionWarnings([]);
        setError(
          response?.submission?.errorMessage ||
          getSubmissionFailureMessage(response),
        );
      }
    } catch (error) {
      console.error("Submission error:", error);
      setSubmissionStatus("failed");
      setSubmissionFeedback("");
      setSubmissionWarnings([]);
      setError(getSubmissionFailureMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isQuickTab = activeTab === "quick";
  const pageTitle = isQuickTab ? "Submit Notes" : "Detailed Submission";
  const formState = isQuickTab ? quickForm : detailForm;
  const setFormFn = isQuickTab ? setQuickForm : setDetailForm;
  const updateFormFn = isQuickTab ? updateQuickForm : updateDetailForm;
  const pressureType = isQuickTab ? pressureTypeQuick : pressureTypeDetail;
  const setPressureTypeFn = isQuickTab
    ? setPressureTypeQuick
    : setPressureTypeDetail;
  const rawTextValue = isQuickTab ? quickRawText : detailRawText;
  const setRawTextValue = isQuickTab ? setQuickRawText : setDetailRawText;
  const actionValue = isQuickTab ? quickAction : detailAction;
  const setActionValue = isQuickTab ? setQuickAction : setDetailAction;
  const confidenceValue = isQuickTab ? quickConfidence : detailConfidence;
  const setConfidenceValue = isQuickTab
    ? setQuickConfidence
    : setDetailConfidence;
  const setImageValue = isQuickTab ? setQuickImage : setDetailImage;
  const driverLabelMap = useMemo(
    () =>
      new Map(
        driverOptions
          .filter((driver) => driver?.id)
          .map((driver) => [String(driver.id), driver.label]),
      ),
    [driverOptions],
  );
  const vehicleOptionsForDriver = useMemo(() => {
    if (!formState.driver_id) {
      return vehicleOptions;
    }

    return vehicleOptions.filter(
      (vehicle) => String(vehicle.driverId || "") === String(formState.driver_id),
    );
  }, [formState.driver_id, vehicleOptions]);

  const trackOptionsForSelect = useMemo(() => {
    const seen = new Set();
    const nextOptions = [];

    const addTrack = (trackInput) => {
      const normalizedId = String(
        trackInput?.id || trackInput?.label || trackInput || "",
      ).trim();
      const normalizedLabel = String(
        trackInput?.label || trackInput?.id || trackInput || "",
      ).trim();

      if (!normalizedId) return;

      const lookupKey = normalizedId.toLowerCase();
      if (seen.has(lookupKey)) return;

      seen.add(lookupKey);
      nextOptions.push({ id: normalizedId, label: normalizedLabel });
    };

    addTrack(event?.track);
    trackCatalog.forEach((track) => addTrack(track));

    return nextOptions;
  }, [event?.track, trackCatalog]);

  const handleDriverChange = (driverId) => {
    markActiveFieldTouched("driver_id");
    updateFormFn("driver_id", driverId);

    if (
      formState.vehicle_id &&
      !vehicleOptions.filter(
        (vehicle) => String(vehicle.driverId || "") === String(driverId),
      ).some(
        (vehicle) => vehicle.id === formState.vehicle_id,
      )
    ) {
      markActiveFieldTouched("vehicle_id");
      updateFormFn("vehicle_id", "");
    }
  };
  const trackValue =
    trackSelection === "__OTHER__"
      ? formState.track
      : trackSelection || formState.track || event?.track || "";
  const activeTabKey = isQuickTab ? "quick" : "detail";
  const generatedQuickSessionId = useMemo(
    () =>
      buildGeneratedSessionId(
        quickForm.date,
        quickForm.time,
        quickForm.driver_id,
        quickForm.session_number,
      ),
    [quickForm.date, quickForm.time, quickForm.driver_id, quickForm.session_number],
  );
  const generatedDetailSessionId = useMemo(
    () =>
      buildGeneratedSessionId(
        detailForm.date,
        detailForm.time,
        detailForm.driver_id,
        detailForm.session_number,
      ),
    [detailForm.date, detailForm.time, detailForm.driver_id, detailForm.session_number],
  );
  const generatedSessionId = isQuickTab
    ? generatedQuickSessionId
    : generatedDetailSessionId;
  const detailAdvancedFieldCount = useMemo(
    () =>
      countFilledValues({
        suspension: detailForm.suspension,
        alignment: detailForm.alignment,
        tire_temperatures: detailForm.tire_temperatures,
        tire_inventory: detailForm.tire_inventory,
      }),
    [
      detailForm.alignment,
      detailForm.suspension,
      detailForm.tire_inventory,
      detailForm.tire_temperatures,
    ],
  );
  const activeFieldTouched = fieldTouched[activeTabKey] || {};
  const activeValidationAttempted = validationAttempted[activeTabKey] || false;
  const validationErrors = useMemo(
    () =>
      validateSubmissionFields({
        formState,
        trackValue,
        runGroupValue: eventRunGroup,
        driverOptions,
        vehicleOptions: vehicleOptionsForDriver,
      }),
    [driverOptions, eventRunGroup, formState, trackValue, vehicleOptionsForDriver],
  );
  const shouldShowFieldError = (field) =>
    activeValidationAttempted || Boolean(activeFieldTouched[field]);
  const getFieldError = (field) =>
    shouldShowFieldError(field) ? validationErrors[field] || "" : "";
  const getFieldClassName = (baseClassName, field) =>
    `${baseClassName} ${getFieldError(field) ? "input-error" : ""}`.trim();
  const renderFieldError = (field) =>
    getFieldError(field) ? (
      <p className="field-error" role="alert">
        {getFieldError(field)}
      </p>
    ) : null;
  const pressureWarnings = useMemo(
    () => getPressureWarnings(formState.pressures),
    [formState.pressures],
  );
  const quickRawRoute = useMemo(
    () =>
      shouldUseRawSubmissionRoute({
        analysis_result: {
          submission_mode: "quick",
        },
        raw_text: quickRawText,
        image_url: quickImage,
        ...(quickImage ? { payload: { image_url: quickImage } } : {}),
      }),
    [quickImage, quickRawText],
  );

  useEffect(() => {
    if (sessionIdMode.quick !== "auto") {
      return;
    }

    setQuickForm((prev) => {
      if (prev.session_id === generatedQuickSessionId) {
        return prev;
      }

      return {
        ...prev,
        session_id: generatedQuickSessionId,
      };
    });
  }, [generatedQuickSessionId, sessionIdMode.quick]);

  useEffect(() => {
    if (sessionIdMode.detail !== "auto") {
      return;
    }

    setDetailForm((prev) => {
      if (prev.session_id === generatedDetailSessionId) {
        return prev;
      }

      return {
        ...prev,
        session_id: generatedDetailSessionId,
      };
    });
  }, [generatedDetailSessionId, sessionIdMode.detail]);

  const markActiveFieldTouched = (field) => {
    setFieldTouched((prev) => ({
      ...prev,
      [activeTabKey]: {
        ...(prev[activeTabKey] || {}),
        [field]: true,
      },
    }));
  };
  const updateRequiredField = (field, value) => {
    markActiveFieldTouched(field);
    updateFormFn(field, value);
  };
  const markCurrentTabRequiredFieldsTouched = () => {
    setFieldTouched((prev) => ({
      ...prev,
      [activeTabKey]: {
        ...(prev[activeTabKey] || {}),
        date: true,
        time: true,
        track: true,
        run_group: true,
        session_id: true,
        session_type: true,
        session_number: true,
        driver_id: true,
        vehicle_id: true,
      },
    }));
  };

  if (!event) {
    return (
      <ProtectedRoute requireDriver={true}>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <p>Loading event...</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
      <ProtectedRoute requireDriver={true}>
      <div className="notes-submission-page">
        <div className="page-header">
          <div className="header-content">
            <ScreenBackButton fallbackHref={`/event/${eventId}`} label="Back" />
            <h1 className="page-title">{pageTitle}</h1>
          </div>
        </div>

        <div className="container">
          <div className="event-info">
            <h2 className="event-name">{event.name}</h2>
            {/*<p className="event-track">{event.track}</p>*/}
          </div>

          <div className="tab-toggle">
            <button
              type="button"
              data-testid="submission-tab-quick"
              className={`tab-button ${isQuickTab ? "active" : ""}`}
              onClick={() => setActiveTab("quick")}
            >
              Quick Submission
            </button>
            <button
              type="button"
              data-testid="submission-tab-detail"
              className={`tab-button ${!isQuickTab ? "active" : ""}`}
              onClick={() => setActiveTab("detail")}
            >
              Detailed Submission
            </button>
          </div>

          {isQuickTab && quickDraftStorageKey ? (
            <p
              style={{
                marginTop: "0.75rem",
                color:
                  quickDraftStatus === "saving"
                    ? "#f0b429"
                    : quickDraftStatus === "saved" || quickDraftStatus === "restored"
                      ? "#7ddc95"
                      : "#9aa4b2",
                fontSize: "0.85rem",
              }}
            >
              {quickDraftStatus === "saving"
                ? "Saving quick note locally..."
                : quickDraftStatus === "saved"
                  ? "Quick note saved locally on this device."
                  : quickDraftStatus === "restored"
                    ? "Quick note restored from this device."
                    : "Quick note autosave is enabled for this device."}
            </p>
          ) : null}

          {!isQuickTab && detailDraftStorageKey ? (
            <p
              style={{
                marginTop: "0.75rem",
                color:
                  detailDraftStatus === "saving"
                    ? "#f0b429"
                    : detailDraftStatus === "saved" || detailDraftStatus === "restored"
                      ? "#7ddc95"
                      : "#9aa4b2",
                fontSize: "0.85rem",
              }}
            >
              {detailDraftStatus === "saving"
                ? "Saving draft locally..."
                : detailDraftStatus === "saved"
                  ? "Draft saved locally on this device."
                  : detailDraftStatus === "restored"
                    ? "Draft restored from this device."
                : "Draft autosave is enabled for the detailed form."}
            </p>
          ) : null}

          {editingSubmissionLoading ? (
            <div className="status-message status-pending" style={{ marginTop: "0.75rem" }}>
              <strong>Overwrite mode.</strong>
              <span>Loading the existing submission so you can update it.</span>
            </div>
          ) : null}

          {editingSubmissionError ? (
            <div className="status-message status-failed" style={{ marginTop: "0.75rem" }}>
              <strong>Overwrite unavailable.</strong>
              <span>{editingSubmissionError}</span>
            </div>
          ) : null}

          {editingSubmission && !editingSubmissionLoading ? (
            <div className="status-message status-pending" style={{ marginTop: "0.75rem" }}>
              <strong>Overwrite mode enabled.</strong>
              <span>This will update your saved submission instead of creating a new one.</span>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="notes-form">
            <div className="form-group">
              <label className="form-label">Session Information</label>
              <div className="grid-2">
                <div>
                  <label className="form-label sub-label">Date</label>
                  <input
                    data-testid="submission-date"
                    className={getFieldClassName("input", "date")}
                    type="date"
                    value={formState.date}
                    onChange={(e) => updateRequiredField("date", e.target.value)}
                    onBlur={() => markActiveFieldTouched("date")}
                    title="Use YYYY-MM-DD."
                    aria-invalid={Boolean(getFieldError("date"))}
                  />
                  {renderFieldError("date")}
                </div>
                <div>
                  <label className="form-label sub-label">Time</label>
                  <input
                    data-testid="submission-time"
                    className={getFieldClassName("input", "time")}
                    type="time"
                    step="60"
                    value={formState.time}
                    onChange={(e) => updateRequiredField("time", e.target.value)}
                    onBlur={() => markActiveFieldTouched("time")}
                    title="Use 24-hour HH:MM."
                    aria-invalid={Boolean(getFieldError("time"))}
                  />
                  {renderFieldError("time")}
                </div>
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <label className="form-label sub-label">Session ID</label>
                <input
                  data-testid="submission-session-id"
                  className={getFieldClassName("input", "session_id")}
                  type="text"
                  value={formState.session_id}
                  onChange={(e) => {
                    setSessionIdMode((prev) => ({
                      ...prev,
                      [activeTabKey]: "manual",
                    }));
                    updateRequiredField("session_id", e.target.value.toUpperCase());
                  }}
                  onBlur={() => markActiveFieldTouched("session_id")}
                  maxLength={120}
                  autoComplete="off"
                  placeholder="YYYYMMDD-HHMM-DRIVERID-S1"
                  title="Format: YYYYMMDD-HHMM-DRIVERID-S1"
                  spellCheck={false}
                  aria-invalid={Boolean(getFieldError("session_id"))}
                />
                <p className="field-hint">
                  Auto-generated from date, time, driver, and session number. You can still edit it.
                </p>
                <div style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setSessionIdMode((prev) => ({
                        ...prev,
                        [activeTabKey]: "auto",
                      }));
                      updateRequiredField("session_id", generatedSessionId);
                    }}
                  >
                    Use Generated ID
                  </button>
                </div>
                {renderFieldError("session_id")}
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <label
                  id={`submission-track-select-label-${activeTabKey}`}
                  className="form-label sub-label"
                  htmlFor={`submission-track-select-${activeTabKey}`}
                >
                  Track
                </label>
                <AppSelect
                  id={`submission-track-select-${activeTabKey}`}
                  testId="submission-track-select"
                  triggerClassName={getFieldClassName("select", "track")}
                  value={trackSelection || (event?.track ? event.track : "")}
                  onValueChange={(value) => {
                    setTrackSelection(value);
                    if (value !== "__OTHER__") {
                      updateRequiredField("track", value);
                    } else {
                      updateRequiredField("track", formState.track || "");
                    }
                  }}
                  onBlur={() => markActiveFieldTouched("track")}
                  options={[
                    ...trackOptionsForSelect.map((track) => ({
                      value: track.id,
                      label: track.label,
                    })),
                    { value: "__OTHER__", label: "Other (type manually)" },
                  ]}
                  placeholder="Select Track"
                  title="Choose the event track or select Other to type a custom value."
                  invalid={Boolean(getFieldError("track"))}
                  ariaLabelledby={`submission-track-select-label-${activeTabKey}`}
                />
                {trackSelection === "__OTHER__" && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <input
                      data-testid="submission-track-manual"
                      className={getFieldClassName("input", "track")}
                      type="text"
                      placeholder="Type track name"
                      value={formState.track}
                      onChange={(e) => updateRequiredField("track", e.target.value)}
                      onBlur={() => markActiveFieldTouched("track")}
                      title="Type the exact track name."
                      aria-invalid={Boolean(getFieldError("track"))}
                    />
                  </div>
                )}
                {renderFieldError("track")}
              </div>

                <div style={{ marginTop: "0.75rem" }}>
                  <label className="form-label sub-label">Run Group</label>
                  <input
                    className={getFieldClassName("input", "run_group")}
                    type="text"
                    value={eventRunGroup || ""}
                    readOnly
                    placeholder="Not assigned yet"
                    onBlur={() => markActiveFieldTouched("run_group")}
                    aria-invalid={Boolean(getFieldError("run_group"))}
                  />
                  {renderFieldError("run_group")}
                </div>
              </div>

            <div className="form-group">
              <label
                id={`submission-driver-select-label-${activeTabKey}`}
                className="form-label"
                htmlFor={`submission-driver-select-${activeTabKey}`}
              >
                Driver
              </label>
              <AppSelect
                id={`submission-driver-select-${activeTabKey}`}
                testId="submission-driver-select"
                triggerClassName={getFieldClassName("select", "driver_id")}
                value={formState.driver_id}
                onValueChange={(value) => handleDriverChange(value)}
                onBlur={() => markActiveFieldTouched("driver_id")}
                options={driverOptions.map((driver) => ({
                  value: driver.id,
                  label: driver.label,
                }))}
                placeholder="Select Driver"
                title="Pick the driver assigned to this session."
                invalid={Boolean(getFieldError("driver_id"))}
                ariaLabelledby={`submission-driver-select-label-${activeTabKey}`}
              />
              {renderFieldError("driver_id")}
            </div>

            <div className="form-group">
              <label
                id={`submission-vehicle-select-label-${activeTabKey}`}
                className="form-label"
                htmlFor={`submission-vehicle-select-${activeTabKey}`}
              >
                Vehicle
              </label>
              <AppSelect
                id={`submission-vehicle-select-${activeTabKey}`}
                testId="submission-vehicle-select"
                triggerClassName={getFieldClassName("select", "vehicle_id")}
                value={formState.vehicle_id}
                onValueChange={(value) => updateRequiredField("vehicle_id", value)}
                onBlur={() => markActiveFieldTouched("vehicle_id")}
                title="Pick the vehicle used for this session."
                invalid={Boolean(getFieldError("vehicle_id"))}
                ariaLabelledby={`submission-vehicle-select-label-${activeTabKey}`}
                placeholder={formState.driver_id ? "Select Assigned Vehicle" : "Select Vehicle"}
                emptyMessage="No vehicles assigned to this driver"
                options={vehicleOptionsForDriver.map((vehicle) => {
                  const assignedDriverLabel = vehicle.driverId
                    ? driverLabelMap.get(String(vehicle.driverId)) || vehicle.driverId
                    : "";
                  const optionLabel =
                    formState.driver_id || !assignedDriverLabel
                      ? vehicle.label
                      : `${vehicle.label} · ${assignedDriverLabel}`;

                  return {
                    value: vehicle.id,
                    label: optionLabel,
                  };
                })}
              />
              {renderFieldError("vehicle_id")}
            </div>

            <div className="form-group">
              <label className="form-label">Session Details</label>
              <div className="grid-2">
                <div>
                  <label
                    id={`submission-session-type-label-${activeTabKey}`}
                    className="form-label sub-label"
                    htmlFor={`submission-session-type-${activeTabKey}`}
                  >
                    Session Type
                  </label>
                  <AppSelect
                    id={`submission-session-type-${activeTabKey}`}
                    testId="submission-session-type"
                    triggerClassName={getFieldClassName("select", "session_type")}
                    value={formState.session_type}
                    onValueChange={(value) => updateRequiredField("session_type", value)}
                    onBlur={() => markActiveFieldTouched("session_type")}
                    options={SESSION_TYPE_OPTIONS.map((sessionType) => ({
                      value: sessionType.id,
                      label: sessionType.label,
                    }))}
                    placeholder="Select session type"
                    title="Choose the session classification."
                    invalid={Boolean(getFieldError("session_type"))}
                    ariaLabelledby={`submission-session-type-label-${activeTabKey}`}
                  />
                  {renderFieldError("session_type")}
                </div>
                <div>
                  <label className="form-label sub-label">Session #</label>
                  <input
                    data-testid="submission-session-number"
                    className={getFieldClassName("input", "session_number")}
                    type="number"
                    min="1"
                    step="1"
                    value={formState.session_number}
                    onChange={(e) => {
                      markActiveFieldTouched("session_number");
                      updateFormFn("session_number", e.target.value);
                    }}
                    onBlur={() => markActiveFieldTouched("session_number")}
                    aria-invalid={Boolean(getFieldError("session_number"))}
                  />
                  {renderFieldError("session_number")}
                </div>
              </div>
              <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                <div>
                  <label className="form-label sub-label">
                    Duration (Minutes)
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="1"
                    value={formState.duration_min}
                    onChange={(e) =>
                      updateFormFn("duration_min", e.target.value)
                    }
                  />
                </div>
                <div>
                  <label className="form-label sub-label">Wheelbase (mm)</label>
                  <input
                    data-testid="submission-wheelbase"
                    className={getFieldClassName("input", "wheelbase_mm")}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="2450"
                    value={formState.wheelbase_mm}
                    onChange={(e) =>
                      updateFormFn("wheelbase_mm", e.target.value)
                    }
                    onBlur={() => markActiveFieldTouched("wheelbase_mm")}
                    aria-invalid={Boolean(getFieldError("wheelbase_mm"))}
                  />
                  <p className="field-hint">
                    Optional. Leave blank if the wheelbase is unknown.
                  </p>
                  {renderFieldError("wheelbase_mm")}
                </div>
              </div>
              <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                <div>
                  <label className="form-label sub-label">Tire Set</label>
                  <input
                    data-testid="detail-tire-set"
                    className="input"
                    type="text"
                    placeholder="Y-S3"
                    value={formState.tire_set}
                    onChange={(e) => updateFormFn("tire_set", e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label sub-label">Pressure Unit</label>
                  <AppSelect
                    triggerClassName="select"
                    value={formState.pressures.unit}
                    onValueChange={(value) =>
                      setFormFn((prev) => {
                        const next = {
                          ...prev,
                          pressures: { ...prev.pressures, unit: value },
                        };
                        if (!isQuickTab) {
                          persistDetailDraftSnapshot(next);
                        }
                        return next;
                      })
                    }
                    options={PRESSURE_UNIT_OPTIONS.map((option) => ({
                      value: option.id,
                      label: option.label,
                    }))}
                  />
                </div>
              </div>
            </div>

            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">Pressures</label>
                <AppSelect
                  triggerClassName="select select-small"
                  value={pressureType}
                  onValueChange={(value) => setPressureTypeFn(value)}
                  options={[
                    { value: "cold", label: "Cold" },
                    { value: "hot", label: "Hot" },
                  ]}
                />
              </div>
              <div className="grid-2">
                <div>
                  <label className="form-label sub-label">FL</label>
                  <input
                    data-testid="detail-pressure-fl"
                    className="input"
                    type="number"
                    step="0.1"
                    value={formState.pressures[pressureType].fl}
                    onChange={(e) =>
                      updatePressure(
                        isQuickTab ? setQuickForm : setDetailForm,
                        pressureType,
                        "fl",
                        e.target.value,
                      )
                    }
                  />
                </div>
                <div>
                  <label className="form-label sub-label">FR</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={formState.pressures[pressureType].fr}
                    onChange={(e) =>
                      updatePressure(
                        isQuickTab ? setQuickForm : setDetailForm,
                        pressureType,
                        "fr",
                        e.target.value,
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                <div>
                  <label className="form-label sub-label">RL</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={formState.pressures[pressureType].rl}
                    onChange={(e) =>
                      updatePressure(
                        isQuickTab ? setQuickForm : setDetailForm,
                        pressureType,
                        "rl",
                        e.target.value,
                      )
                    }
                  />
                </div>
                <div>
                  <label className="form-label sub-label">RR</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={formState.pressures[pressureType].rr}
                    onChange={(e) =>
                      updatePressure(
                        isQuickTab ? setQuickForm : setDetailForm,
                        pressureType,
                        "rr",
                        e.target.value,
                      )
                    }
                    />
                  </div>
                </div>

                {pressureWarnings.length ? (
                  <div
                    className="status-message status-pending"
                    style={{ marginTop: "0.75rem", marginBottom: 0 }}
                  >
                    <strong>Structured warning:</strong>{" "}
                    Pressure values outside the SM2 normalized DB limits will stay on the note, but those pressure fields will be skipped from normalized tables.
                    <ul style={{ margin: "0.5rem 0 0 1rem" }}>
                      {pressureWarnings.map((warning) => (
                        <li key={warning.id}>{warning.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

            {!isQuickTab && (
              <>
                <div className="form-group">
                  <div className="raw-notes-header">
                    <label className="form-label">Short Notes (Raw Text)</label>
                  </div>
                  <textarea
                    data-testid="detail-raw-notes"
                    className="textarea raw-notes-textarea"
                    placeholder="Add a short summary or overwrite note here..."
                    value={detailRawText}
                    onChange={(e) => setDetailRawText(e.target.value)}
                    rows={4}
                  />

                <div style={{ marginTop: "0.5rem" }}>
                  <label className="form-label sub-label">Photo</label>
                  <input
                    data-testid="detail-photo-input"
                      className="input"
                      type="file"
                      accept="image/*"
                    onChange={(e) => handleImageChange(e, setImageValue)}
                  />
                </div>
              </div>

              <details className="notes-advanced-details">
                <summary className="notes-advanced-details-summary">
                  <div className="notes-advanced-details-copy">
                    <span className="notes-advanced-details-eyebrow">Advanced Setup Fields</span>
                    <strong>Open the full chassis, temperature, and inventory sections only when needed.</strong>
                    <p>
                      Keep the detailed form lighter by expanding these optional sections only when you need the full
                      structured dataset.
                    </p>
                  </div>
                  <span className="notes-advanced-details-badge">
                    {detailAdvancedFieldCount ? `${detailAdvancedFieldCount} values present` : "Optional"}
                  </span>
                </summary>

                <div className="notes-advanced-details-body">
                <div className="form-group">
                  <label className="form-label">Suspension</label>
                  <div className="grid-2">
                    <div>
                      <label className="form-label sub-label">Rebound FL</label>
                      <input
                        data-testid="detail-suspension-rebound-fl"
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.rebound_fl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "rebound_fl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Rebound FR</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.rebound_fr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "rebound_fr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Rebound RL</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.rebound_rl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "rebound_rl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Rebound RR</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.rebound_rr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "rebound_rr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Bump FL</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.bump_fl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "bump_fl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Bump FR</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.bump_fr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "bump_fr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Bump RL</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.bump_rl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "bump_rl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Bump RR</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.bump_rr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "bump_rr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Sway Bar F</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.sway_bar_f}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "sway_bar_f"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Sway Bar R</label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        min="0"
                        value={detailForm.suspension.sway_bar_r}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["suspension", "sway_bar_r"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: "0.75rem" }}>
                    <label className="form-label sub-label">
                      Wing Angle (deg)
                    </label>
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      value={detailForm.suspension.wing_angle_deg}
                      onChange={(e) =>
                        updateNested(
                          setDetailForm,
                          ["suspension", "wing_angle_deg"],
                          e.target.value,
                        )
                      }
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Alignment</label>
                  <div className="grid-2">
                    <div>
                      <label className="form-label sub-label">Camber FL</label>
                      <input
                        data-testid="detail-alignment-camber-fl"
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.camber_fl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "camber_fl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Camber FR</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.camber_fr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "camber_fr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Camber RL</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.camber_rl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "camber_rl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Camber RR</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.camber_rr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "camber_rr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Toe Front</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.toe_front}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "toe_front"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Toe Rear</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.toe_rear}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "toe_rear"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Caster L</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.caster_l}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "caster_l"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Caster R</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.caster_r}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "caster_r"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">
                        Ride Height F (mm)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.ride_height_f}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "ride_height_f"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">
                        Ride Height R (mm)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.ride_height_r}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "ride_height_r"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">
                        Corner Weight FL (lbs)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.corner_weight_fl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "corner_weight_fl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">
                        Corner Weight FR (lbs)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.corner_weight_fr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "corner_weight_fr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">
                        Corner Weight RL (lbs)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.corner_weight_rl}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "corner_weight_rl"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">
                        Corner Weight RR (lbs)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.corner_weight_rr}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "corner_weight_rr"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">
                        Cross Weight (%)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.cross_weight_pct}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "cross_weight_pct"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Rake (mm)</label>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        value={detailForm.alignment.rake_mm}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["alignment", "rake_mm"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Tire Temperatures</label>
                  <div className="grid-2">
                    <div>
                      <label className="form-label sub-label">
                        FL (In/Mid/Out)
                      </label>
                      <div
                        className="grid-2"
                        style={{
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "0.4rem",
                        }}
                      >
                        <input
                          data-testid="detail-temp-fl-in"
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.fl_in}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "fl_in"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.fl_mid}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "fl_mid"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.fl_out}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "fl_out"],
                              e.target.value,
                            )
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <label className="form-label sub-label">
                        FR (In/Mid/Out)
                      </label>
                      <div
                        className="grid-2"
                        style={{
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "0.4rem",
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.fr_in}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "fr_in"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.fr_mid}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "fr_mid"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.fr_out}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "fr_out"],
                              e.target.value,
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">
                        RL (In/Mid/Out)
                      </label>
                      <div
                        className="grid-2"
                        style={{
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "0.4rem",
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.rl_in}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "rl_in"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.rl_mid}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "rl_mid"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.rl_out}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "rl_out"],
                              e.target.value,
                            )
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <label className="form-label sub-label">
                        RR (In/Mid/Out)
                      </label>
                      <div
                        className="grid-2"
                        style={{
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "0.4rem",
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.rr_in}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "rr_in"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.rr_mid}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "rr_mid"],
                              e.target.value,
                            )
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={detailForm.tire_temperatures.rr_out}
                          onChange={(e) =>
                            updateNested(
                              setDetailForm,
                              ["tire_temperatures", "rr_out"],
                              e.target.value,
                            )
                          }
                        />
                  </div>
                </div>
              </div>
            </div>

                <div className="form-group">
                  <label className="form-label">Tire Inventory</label>
                  <div className="grid-2">
                    <div>
                      <label className="form-label sub-label">Tire ID</label>
                      <input
                        className="input"
                        type="text"
                        value={detailForm.tire_inventory.tire_id}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "tire_id"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">
                        Manufacturer
                      </label>
                      <input
                        className="input"
                        type="text"
                        value={detailForm.tire_inventory.manufacturer}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "manufacturer"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">Model</label>
                      <input
                        className="input"
                        type="text"
                        value={detailForm.tire_inventory.model}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "model"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Size</label>
                      <input
                        className="input"
                        type="text"
                        value={detailForm.tire_inventory.size}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "size"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">
                        Purchase Date
                      </label>
                      <input
                        className="input"
                        type="date"
                        value={detailForm.tire_inventory.purchase_date}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "purchase_date"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">
                        Heat Cycles
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        value={detailForm.tire_inventory.heat_cycles}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "heat_cycles"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <label className="form-label sub-label">
                        Track Time (min)
                      </label>
                      <input
                        className="input"
                        type="number"
                        step="1"
                        value={detailForm.tire_inventory.track_time_min}
                        onChange={(e) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "track_time_min"],
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label sub-label">Status</label>
                      <AppSelect
                        testId="detail-tire-status"
                        triggerClassName="select"
                        value={detailForm.tire_inventory.status}
                        onValueChange={(value) =>
                          updateNested(
                            setDetailForm,
                            ["tire_inventory", "status"],
                            value,
                          )
                        }
                        options={TIRE_INVENTORY_STATUS_OPTIONS.map((option) => ({
                          value: option.id,
                          label: option.label,
                        }))}
                      />
                    </div>
                  </div>
                </div>
                </div>
              </details>
              </>
            )}

            {isQuickTab && (
              <div className="form-group">
                <div className="raw-notes-header">
                  <label className="form-label">Race Notes (Raw Text)</label>
                </div>
                <textarea
                  data-testid="quick-raw-notes"
                  className="textarea raw-notes-textarea"
                  placeholder='e.g. "s1 30min nico gt4 Y-S3 pf 27 wb 2450"'
                  value={rawTextValue}
                  onChange={(e) => setRawTextValue(e.target.value)}
                  rows={4}
                  ref={quickRawTextRef}
                />

                <div className="voice-note-moved-banner" data-testid="voice-submission-redirect-banner">
                  <div className="voice-note-moved-copy">
                    <span className="voice-note-moved-label">Voice Submission</span>
                    <strong>Voice notes now use a dedicated screen.</strong>
                    <p>
                      Open the focused voice workflow to record audio, review the OpenAI transcript, and finalize the linked submission without mixing that state into Quick Submission.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => router.push(`/event/${eventId}/voice-submission`)}
                  >
                    Open Voice Submission
                  </button>
                </div>

                <div style={{ marginTop: "0.5rem" }}>
                  <label className="form-label sub-label">Photo</label>
                  <input
                    data-testid="quick-photo-input"
                    className="input"
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageChange(e, setImageValue)}
                  />
                </div>
              </div>
            )}

            <div className="submission-status">
              {!canSubmitNotes && (
                <div className="status-message status-pending">
                  {submissionUnavailableMessage}
                </div>
              )}
              {submissionStatus === "sent" && (
                <div className="status-message status-success">
                  ✓ {submissionFeedback || "Notes submitted successfully! Redirecting..."}
                </div>
              )}
              {submissionStatus === "sent_with_warnings" && (
                <div className="status-message status-pending">
                  <div>⚠ {submissionFeedback}</div>
                  {submissionWarnings.length ? (
                    <ul style={{ margin: "0.5rem 0 0 1rem" }}>
                      {submissionWarnings.map((warning, index) => (
                        <li key={`${warning.code || "structured-warning"}-${index}`}>
                          {formatStructuredWarning(warning)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
              {submissionStatus === "pending" && isSubmitting && (
                <div className="status-message status-pending">
                  ⏳ Submitting notes...
                </div>
              )}
              {(submissionStatus === "failed" || error) && (
                <div className="status-message status-failed">
                  ✗ {error || "Submission failed. Please try again."}
                </div>
              )}
            </div>

            <div className="form-actions">
              <div className="form-action-buttons">
                <button
                  type="button"
                  onClick={() => router.push(`/event/${eventId}`)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-large"
                  disabled={isSubmitting || !canSubmitNotes}
                >
                  {isSubmitting ? "Submitting..." : submitButtonLabel}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </ProtectedRoute>
  );
}
