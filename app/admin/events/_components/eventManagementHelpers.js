import { normalizeEvent } from "../../../utils/apiTransforms";

const EVENT_NOTES_STORAGE_KEY = "sm2_admin_event_notes";

export const getEventId = (event) => {
  if (typeof event === "string" || typeof event === "number") {
    const normalized = String(event).trim();
    return normalized || null;
  }

  return event?.id || event?._id || event?.eventId || event?.event_id || null;
};

export const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]) - 1;
      const day = Number(dateOnlyMatch[3]);
      return new Date(year, month, day, 12, 0, 0);
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDate = (value) => {
  const date = parseDateValue(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

export const formatDateTime = (value) => {
  const date = parseDateValue(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export const formatDateRange = (startDate, endDate) => {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  if (start === "-" && end === "-") return "-";
  if (start === end) return start;
  return `${start} - ${end}`;
};

export const toLocalDateInput = (value) => {
  const date = parseDateValue(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const createBlankEventFormValues = () => ({
  name: "",
  track: "",
  runGroup: "",
  startDate: "",
  endDate: "",
  status: "active",
  notes: "",
  participantDriverIds: [],
  scheduleText: "",
});

export const getEventRunGroupText = (event) => {
  const runGroup = event?.runGroup || event?.run_group || null;
  if (!runGroup) return "";

  if (typeof runGroup === "string") {
    return runGroup.trim();
  }

  return (
    runGroup.rawText ||
    runGroup.raw_text ||
    runGroup.normalized ||
    ""
  ).trim();
};

export const toEventFormValues = (event = null) => ({
  name: event?.name || "",
  track: event?.track || "",
  runGroup: getEventRunGroupText(event),
  startDate: toLocalDateInput(event?.startDate || event?.start_date),
  endDate: toLocalDateInput(event?.endDate || event?.end_date),
  status: event && event.isActive === false ? "archived" : "active",
  notes:
    event?.notes ||
    event?.description ||
    getStoredEventNote(getEventId(event)) ||
    "",
  participantDriverIds: [],
  scheduleText: "",
});

export const normalizeAdminEvent = (event) => {
  const normalized = normalizeEvent(event);
  if (!normalized) return null;
  return {
    ...normalized,
    notes: normalized.notes || getStoredEventNote(getEventId(normalized)) || "",
  };
};

export const getEventLifecycle = (event, now = new Date()) => {
  if (!event) {
    return { key: "unknown", label: "Unknown", tone: "neutral" };
  }

  if (event.isActive === false) {
    return { key: "archived", label: "Archived", tone: "danger" };
  }

  const start = parseDateValue(event.startDate || event.start_date);
  const end = parseDateValue(event.endDate || event.end_date);
  if (!start || !end) {
    return { key: "unknown", label: "Unknown", tone: "neutral" };
  }

  if (now < start) {
    return { key: "upcoming", label: "Upcoming", tone: "info" };
  }

  if (now > end) {
    return { key: "completed", label: "Completed", tone: "neutral" };
  }

  return { key: "active", label: "Active", tone: "success" };
};

export const getEventLifecycleOrder = (event) => {
  const status = getEventLifecycle(event).key;
  const order = {
    upcoming: 0,
    active: 1,
    completed: 2,
    archived: 3,
    unknown: 4,
  };

  return order[status] ?? 4;
};

export const getRunGroupStatus = (runGroup) => {
  if (runGroup) {
    return { key: "configured", label: "Configured", tone: "success" };
  }

  return { key: "missing", label: "Not Configured", tone: "warning" };
};

export const normalizeRunGroupInput = (value = "") =>
  value.trim().replace(/\s+/g, " ").toUpperCase();

export const resolveRunGroupCode = (value = "") => {
  const normalized = normalizeRunGroupInput(value);

  if (normalized.includes("RED")) return "RED";
  if (normalized.includes("BLUE")) return "BLUE";
  if (normalized.includes("YELLOW")) return "YELLOW";
  if (normalized.includes("GREEN")) return "GREEN";

  return null;
};

export const getRunGroupPreview = (value = "") => {
  const normalized = normalizeRunGroupInput(value);
  const resolved = resolveRunGroupCode(value);

  return {
    rawText: value,
    normalized,
    resolved,
    isValid: Boolean(resolved),
    hint: resolved
      ? `Backend will normalize this to ${resolved}.`
      : "Include RED, BLUE, YELLOW, or GREEN so the backend can normalize it.",
  };
};

export const getStoredEventNotes = () => {
  if (typeof window === "undefined") return {};

  try {
    return JSON.parse(localStorage.getItem(EVENT_NOTES_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};

export const getStoredEventNote = (eventId) => {
  if (!eventId) return "";

  const notes = getStoredEventNotes();
  return notes[String(eventId)] || "";
};

export const setStoredEventNote = (eventId, notes) => {
  if (typeof window === "undefined" || !eventId) return;

  const current = getStoredEventNotes();
  const key = String(eventId);
  const value = notes?.trim() || "";

  if (value) {
    current[key] = value;
  } else {
    delete current[key];
  }

  localStorage.setItem(EVENT_NOTES_STORAGE_KEY, JSON.stringify(current));
};

export const mergeStoredEventNotes = (event) => {
  const normalized = normalizeAdminEvent(event);
  if (!normalized) return null;

  return {
    ...normalized,
    notes:
      normalized.notes ||
      normalized.description ||
      getStoredEventNote(getEventId(normalized)) ||
      "",
  };
};

export const mergeStoredEventNotesList = (events = []) =>
  events.map(mergeStoredEventNotes).filter(Boolean);

export const isApiStatus = (error, status) =>
  Boolean(
    error &&
      (error.status === status ||
        error?.response?.status === status ||
        error?.data?.status === status),
  );

export const getApiErrorMessage = (error, fallback = "Something went wrong") => {
  if (!error) return fallback;
  if (typeof error === "string") return error;

  return (
    error.message ||
    error.error ||
    error.detail ||
    error?.data?.detail ||
    error?.data?.message ||
    fallback
  );
};

export const isNotFoundError = (error) =>
  isApiStatus(error, 404) ||
  /not found|not set/i.test(getApiErrorMessage(error, ""));

export const isConflictError = (error) =>
  isApiStatus(error, 409) ||
  /already set|conflict/i.test(getApiErrorMessage(error, ""));

export const sortAdminEvents = (events = [], sortMode = "latest") => {
  const list = [...events];

  const byDateDesc = (left, right, key = "updatedAt") =>
    (parseDateValue(right?.[key])?.getTime() || 0) -
    (parseDateValue(left?.[key])?.getTime() || 0);

  const byDateAsc = (left, right, key = "startDate") =>
    (parseDateValue(left?.[key])?.getTime() || 0) -
    (parseDateValue(right?.[key])?.getTime() || 0);

  return list.sort((left, right) => {
    if (sortMode === "latest") {
      return (
        byDateDesc(left, right, "updatedAt") ||
        byDateDesc(left, right, "createdAt") ||
        byDateDesc(left, right, "startDate")
      );
    }

    if (sortMode === "upcoming") {
      return (
        getEventLifecycleOrder(left) - getEventLifecycleOrder(right) ||
        byDateAsc(left, right, "startDate") ||
        byDateDesc(left, right, "createdAt")
      );
    }

    return (
      byDateAsc(left, right, "startDate") ||
      byDateAsc(left, right, "createdAt") ||
      byDateAsc(left, right, "updatedAt")
    );
  });
};

export const getEventSummaryCounts = (events = []) => {
  const summary = {
    total: events.length,
    active: 0,
    upcoming: 0,
    archived: 0,
    completed: 0,
  };

  events.forEach((event) => {
    const status = getEventLifecycle(event).key;
    if (status === "active") summary.active += 1;
    if (status === "upcoming") summary.upcoming += 1;
    if (status === "archived") summary.archived += 1;
    if (status === "completed") summary.completed += 1;
  });

  return summary;
};
