import axiosInstance from "./axiosInstance";
import { normalizeDriver, normalizeList, normalizeVehicle } from "./apiTransforms";

const unwrapRecords = (data, collectionKey) => {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.[collectionKey])) {
    return data[collectionKey];
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  return [];
};

const normalizeApiError = (error) => error.response?.data || error.message || error;

export const getDrivers = async () => {
  try {
    const response = await axiosInstance.get("/drivers");
    return {
      drivers: normalizeList(unwrapRecords(response.data, "drivers"), normalizeDriver),
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const createDriver = async (payload) => {
  try {
    const response = await axiosInstance.post("/drivers", payload);
    return {
      success: true,
      driver: normalizeDriver(response.data),
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const updateDriver = async (driverId, payload) => {
  try {
    const response = await axiosInstance.put(`/drivers/${driverId}`, payload);
    return {
      success: true,
      driver: normalizeDriver(response.data),
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const archiveDriver = async (driverId) =>
  updateDriver(driverId, { is_active: false });

export const getVehicles = async () => {
  try {
    const response = await axiosInstance.get("/vehicles");
    return {
      vehicles: normalizeList(unwrapRecords(response.data, "vehicles"), normalizeVehicle),
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const createVehicle = async (payload) => {
  try {
    const response = await axiosInstance.post("/vehicles", payload);
    return {
      success: true,
      vehicle: normalizeVehicle(response.data),
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const updateVehicle = async (vehicleId, payload) => {
  try {
    const response = await axiosInstance.put(`/vehicles/${vehicleId}`, payload);
    return {
      success: true,
      vehicle: normalizeVehicle(response.data),
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
};

export const archiveVehicle = async (vehicleId) =>
  updateVehicle(vehicleId, { is_active: false });
