import axiosInstance from "./axiosInstance";
import { normalizeList, normalizeTrack } from "./apiTransforms";

const TRACK_STORAGE_KEYS = ["sm2_admin_tracks_v2", "sm2_admin_tracks_v1"];
const TRACK_MIGRATION_MARKER = "sm2_admin_tracks_backend_migrated_v1";

const unwrapTracks = (data) => {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.tracks)) {
    return data.tracks;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  return [];
};

const buildApiError = (error, fallbackMessage) => ({
  status: error.response?.status ?? error.status ?? null,
  message:
    error.response?.data?.detail ||
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.message ||
    fallbackMessage,
  error:
    error.response?.data?.detail ||
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.message ||
    fallbackMessage,
  data: error.response?.data ?? error.data ?? null,
});

const parseNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeShortCode = (value = "") =>
  String(value)
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

const buildFallbackShortCode = (trackName = "") => {
  const tokens = String(trackName)
    .trim()
    .match(/[A-Za-z0-9]+/g);

  if (!tokens || !tokens.length) {
    return "TRK";
  }

  return tokens
    .map((token) => token[0])
    .join("")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 32) || "TRK";
};

const normalizeTrackPayload = (trackData = {}) => {
  const name = String(
    trackData.name ||
      trackData.track_name ||
      trackData.trackName ||
      trackData.display_name ||
      trackData.displayName ||
      "",
  ).trim();
  const displayName = String(trackData.display_name || trackData.displayName || "").trim();
  const shortCode = normalizeShortCode(trackData.short_code || trackData.shortCode || "");
  const country = String(trackData.country || trackData.country_name || trackData.countryName || "").trim();
  const latitude = parseNullableNumber(trackData.latitude ?? trackData.lat);
  const longitude = parseNullableNumber(trackData.longitude ?? trackData.lng ?? trackData.lon);
  const notes = String(trackData.notes || trackData.description || "").trim();
  const activeValue =
    typeof trackData.active === "boolean"
      ? trackData.active
      : typeof trackData.is_active === "boolean"
        ? trackData.is_active
        : typeof trackData.isActive === "boolean"
          ? trackData.isActive
          : undefined;
  const statusInput = String(trackData.status || (activeValue === false ? "archived" : "active")).toLowerCase();
  const status = statusInput === "archived" ? "archived" : "active";
  const isActive = activeValue ?? status !== "archived";

  return {
    name,
    track_name: name,
    display_name: displayName || name,
    short_code: shortCode,
    country,
    latitude,
    longitude,
    notes,
    status,
    active: isActive,
    is_active: isActive,
  };
};

const readLegacyTrackStorage = () => {
  if (typeof window === "undefined") {
    return [];
  }

  for (const key of TRACK_STORAGE_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore malformed legacy data and fall through to the next key.
    }
  }

  return [];
};

const clearLegacyTrackStorage = () => {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of TRACK_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
  window.localStorage.setItem(TRACK_MIGRATION_MARKER, new Date().toISOString());
};

const hasLegacyTrackMigrationMarker = () => {
  if (typeof window === "undefined") {
    return true;
  }

  return Boolean(window.localStorage.getItem(TRACK_MIGRATION_MARKER));
};

const mapApiPayload = (trackData = {}) => normalizeTrackPayload(trackData);

const requestConfig = (includeArchived = false) =>
  includeArchived ? { params: { include_archived: true } } : undefined;

const syncLegacyTracksToBackend = async () => {
  if (hasLegacyTrackMigrationMarker()) {
    return true;
  }

  const legacyTracks = readLegacyTrackStorage();
  if (!legacyTracks.length) {
    clearLegacyTrackStorage();
    return true;
  }

  let hadFailures = false;

  for (const legacyTrack of legacyTracks) {
    const payload = mapApiPayload(legacyTrack);
    if (!payload.name) {
      continue;
    }

    if (!payload.short_code) {
      payload.short_code = buildFallbackShortCode(payload.name);
    }

    try {
      await createTrack(payload);
    } catch (error) {
      const status = error?.status ?? error?.response?.status ?? null;
      if (status === 409) {
        try {
          await updateTrack(payload.name, payload);
          continue;
        } catch (updateError) {
          hadFailures = true;
          console.warn("Failed to update legacy track during migration:", updateError);
          continue;
        }
      }

      hadFailures = true;
      console.warn("Failed to migrate legacy track:", error);
    }
  }

  if (!hadFailures) {
    clearLegacyTrackStorage();
  }

  return !hadFailures;
};

export async function getTracks(options = {}) {
  const { includeArchived = false, syncLegacyStorage = false } = options;

  try {
    const response = await axiosInstance.get("/tracks", requestConfig(includeArchived));
    let tracks = normalizeList(unwrapTracks(response.data), normalizeTrack);

    if (syncLegacyStorage && tracks.length === 0) {
      await syncLegacyTracksToBackend();
      const retryResponse = await axiosInstance.get("/tracks", requestConfig(includeArchived));
      tracks = normalizeList(unwrapTracks(retryResponse.data), normalizeTrack);
    }

    return {
      tracks,
    };
  } catch (error) {
    throw buildApiError(error, "Failed to load tracks");
  }
}

export async function createTrack(trackData) {
  try {
    const response = await axiosInstance.post("/tracks", mapApiPayload(trackData));
    return {
      success: true,
      track: normalizeTrack(response.data?.track || response.data),
    };
  } catch (error) {
    throw buildApiError(error, "Failed to create track");
  }
}

export async function updateTrack(trackId, trackData) {
  try {
    const response = await axiosInstance.put(
      `/tracks/${encodeURIComponent(String(trackId))}`,
      mapApiPayload(trackData),
    );
    return {
      success: true,
      track: normalizeTrack(response.data?.track || response.data),
    };
  } catch (error) {
    throw buildApiError(error, "Failed to update track");
  }
}

export async function archiveTrack(trackId) {
  try {
    const response = await axiosInstance.delete(`/tracks/${encodeURIComponent(String(trackId))}`);
    return {
      success: true,
      track: normalizeTrack(response.data?.track || response.data),
    };
  } catch (error) {
    throw buildApiError(error, "Failed to archive track");
  }
}
