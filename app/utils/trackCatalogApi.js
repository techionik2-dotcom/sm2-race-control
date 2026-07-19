import axiosInstance from "./axiosInstance";

const buildApiError = (error, fallbackMessage) => ({
  status: error.response?.status,
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
  data: error.response?.data,
});

const normalizeTrackOption = (track) => {
  const name = String(track?.name || track?.track_name || track?.display_name || "").trim();

  if (!name) {
    return null;
  }

  return {
    id: name,
    label: name,
    country: track?.country || track?.country_code || "",
    active: track?.active ?? track?.isActive ?? true,
    latitude: track?.latitude ?? null,
    longitude: track?.longitude ?? null,
  };
};

export const getTrackCatalog = async () => {
  try {
    const response = await axiosInstance.get("/tracks");
    const items = Array.isArray(response.data) ? response.data : response.data?.tracks || [];

    return {
      tracks: items
        .map(normalizeTrackOption)
        .filter((track) => track && track.active !== false)
        .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" })),
    };
  } catch (error) {
    console.error("Get Track Catalog API Error:", {
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw buildApiError(error, "Failed to load tracks");
  }
};
