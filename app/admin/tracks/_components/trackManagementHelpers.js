import {
  formatDate,
  formatDateTime,
  getApiErrorMessage,
  getLifecycleLabel,
} from "../../fleet/_components/fleetManagementHelpers";

const DEFAULT_FORM_VALUES = {
  trackName: "",
  displayName: "",
  shortCode: "",
  country: "",
  latitude: "",
  longitude: "",
  notes: "",
  status: "active",
};

export const normalizeTrackShortCode = (value = "") =>
  String(value).trim().replace(/\s+/g, "").toUpperCase();

const parseNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveTrackIsActive = (track = null) => {
  if (!track) {
    return true;
  }

  if (track.isActive === false) {
    return false;
  }

  if (typeof track.status === "string" && track.status.toLowerCase() === "archived") {
    return false;
  }

  return true;
};

export const getTrackLifecycle = (track = null) => getLifecycleLabel(resolveTrackIsActive(track));

export const createBlankTrackFormValues = () => ({ ...DEFAULT_FORM_VALUES });

export const toTrackFormValues = (track = null) => {
  if (!track) {
    return createBlankTrackFormValues();
  }

  const isArchived = !resolveTrackIsActive(track);

  return {
    trackName: track.trackName || track.track_name || track.name || "",
    displayName: track.displayName || track.display_name || "",
    shortCode: track.shortCode || track.short_code || "",
    country: track.country || track.country_name || "",
    latitude: track.latitude ?? "",
    longitude: track.longitude ?? "",
    notes: track.notes || "",
    status: isArchived ? "archived" : "active",
  };
};

export const buildTrackPayload = (values = {}) => {
  const trackName = String(values.trackName || "").trim();
  const displayName = String(values.displayName || "").trim();
  const shortCode = normalizeTrackShortCode(values.shortCode);
  const country = String(values.country || "").trim();
  const latitude = parseNullableNumber(values.latitude);
  const longitude = parseNullableNumber(values.longitude);
  const notes = String(values.notes || "").trim();
  const status = String(values.status || "active").toLowerCase() === "archived" ? "archived" : "active";

  return {
    name: trackName,
    track_name: trackName,
    display_name: displayName || trackName,
    short_code: shortCode,
    country,
    latitude,
    longitude,
    notes,
    status,
    is_active: status !== "archived",
  };
};

export const getTrackName = (track = null) =>
  track?.trackName ||
  track?.track_name ||
  track?.name ||
  track?.displayName ||
  track?.display_name ||
  "";

export const getTrackDisplayName = (track = null) =>
  track?.displayName ||
  track?.display_name ||
  track?.name ||
  track?.trackName ||
  track?.track_name ||
  "";

export const getTrackSearchText = (track = null) =>
  [
    getTrackName(track),
    getTrackDisplayName(track),
    track?.shortCode,
    track?.short_code,
    track?.country,
    track?.notes,
    track?.status,
    track?.latitude,
    track?.longitude,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const getTrackSummaryCounts = (tracks = []) => {
  const active = tracks.filter((track) => resolveTrackIsActive(track)).length;
  const archived = tracks.length - active;
  const countries = new Set(
    tracks
      .map((track) => String(track?.country || "").trim())
      .filter(Boolean)
      .map((country) => country.toLowerCase()),
  );

  return {
    total: tracks.length,
    active,
    archived,
    countries: countries.size,
  };
};

export const sortTracksByLatest = (tracks = []) =>
  [...tracks].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();

    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return String(getTrackName(left)).localeCompare(String(getTrackName(right)), undefined, {
      sensitivity: "base",
    });
  });

export { formatDate, formatDateTime, getApiErrorMessage };
