const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_MIDNIGHT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0{1,6})?(?:Z|[+-]00:00)$/i;

const extractCalendarDateParts = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(DATE_ONLY_PATTERN) || trimmed.match(UTC_MIDNIGHT_PATTERN);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  };
};

const buildUtcDate = (
  year,
  monthIndex,
  day,
  hours = 12,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
) => new Date(Date.UTC(year, monthIndex, day, hours, minutes, seconds, milliseconds));

const parseInstant = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getEventStartBoundary = (value) => {
  const parts = extractCalendarDateParts(value);
  if (parts) {
    return buildUtcDate(parts.year, parts.monthIndex, parts.day, 0, 0, 0, 0);
  }

  return parseInstant(value);
};

export const getEventEndBoundary = (value) => {
  const parts = extractCalendarDateParts(value);
  if (parts) {
    return buildUtcDate(parts.year, parts.monthIndex, parts.day + 1, 0, 0, 0, 0);
  }

  return parseInstant(value);
};

export const formatEventDate = (value) => {
  const parts = extractCalendarDateParts(value);
  if (parts) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(buildUtcDate(parts.year, parts.monthIndex, parts.day));
  }

  const date = parseInstant(value);
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

export const formatEventDateRange = (startDate, endDate) => {
  const start = formatEventDate(startDate);
  const end = formatEventDate(endDate);

  if (start === "-" && end === "-") return "-";
  if (start === end) return start;
  return `${start} - ${end}`;
};

export const getEventLifecycle = (event, now = new Date()) => {
  if (!event) {
    return { key: "unknown", label: "Unknown", tone: "neutral" };
  }

  const isArchived = event?.isActive === false || event?.is_active === false;
  if (isArchived) {
    return { key: "archived", label: "Archived", tone: "danger" };
  }

  const start = getEventStartBoundary(event?.startDate || event?.start_date);
  const end = getEventEndBoundary(event?.endDate || event?.end_date);

  if (!start && !end) {
    return { key: "unknown", label: "Unknown", tone: "neutral" };
  }

  if (start && now < start) {
    return { key: "upcoming", label: "Upcoming", tone: "info" };
  }

  if (end && now >= end) {
    return { key: "completed", label: "Completed", tone: "neutral" };
  }

  return { key: "active", label: "Active", tone: "success" };
};

export const getEventSubmissionState = (event, now = new Date()) => {
  const lifecycle = getEventLifecycle(event, now);
  const start = getEventStartBoundary(event?.startDate || event?.start_date);
  const end = getEventEndBoundary(event?.endDate || event?.end_date);

  return {
    lifecycle,
    start,
    end,
    isArchived: lifecycle.key === "archived",
    isUpcoming: lifecycle.key === "upcoming",
    hasEnded: lifecycle.key === "completed",
    isOpen: lifecycle.key === "active",
    hasSchedule: Boolean(start || end),
  };
};
