import { normalizeDriver, normalizeVehicle } from "../../../utils/apiTransforms";

const DRIVER_META_STORAGE_KEY = "sm2_admin_driver_meta";
const VEHICLE_META_STORAGE_KEY = "sm2_admin_vehicle_meta";

const parseStoredJson = (value) => {
  if (!value) return {};

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const readStorageMap = (key) => {
  if (typeof window === "undefined") return {};
  return parseStoredJson(window.localStorage.getItem(key));
};

const writeStorageMap = (key, value) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const normalizeMetaValue = (value) => {
  if (!value) return "";
  return String(value).trim();
};

const normalizeAliasList = (value = []) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMetaValue(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => normalizeMetaValue(item))
      .filter(Boolean);
  }

  return [];
};

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

export const formatDate = (value) => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

export const formatDateTime = (value) => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export const formatEntityId = (prefix, id) => {
  if (!id) return "-";
  return `${prefix}-${String(id).slice(0, 8).toUpperCase()}`;
};

export const splitFullName = (fullName = "") => {
  const normalized = String(fullName).trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { firstName: "", lastName: "" };
  }

  const parts = normalized.split(" ");

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
};

export const getDriverFullName = (driver) => {
  if (!driver) return "";

  const firstName = normalizeMetaValue(driver.firstName || driver.first_name);
  const lastName = normalizeMetaValue(driver.lastName || driver.last_name);
  const driverName = normalizeMetaValue(driver.driverName || driver.driver_name);

  if (firstName && lastName && firstName === lastName) {
    return firstName;
  }

  return [firstName, lastName].filter(Boolean).join(" ").trim() || driverName;
};

export const getDriverDisplayName = (driver) =>
  normalizeMetaValue(
    driver?.displayName || driver?.display_name || driver?.teamName || driver?.team_name,
  );

export const getDriverMetaMap = () => readStorageMap(DRIVER_META_STORAGE_KEY);

export const setDriverMeta = (driverId, meta) => {
  if (!driverId) return;

  const current = readStorageMap(DRIVER_META_STORAGE_KEY);
  const normalizedMeta = {
    aliases: normalizeAliasList(meta?.aliases),
    notes: normalizeMetaValue(meta?.notes),
  };

  if (!normalizedMeta.aliases.length && !normalizedMeta.notes) {
    delete current[String(driverId)];
  } else {
    current[String(driverId)] = normalizedMeta;
  }

  writeStorageMap(DRIVER_META_STORAGE_KEY, current);
};

export const mergeDriverMeta = (driver) => {
  const normalized = normalizeDriver(driver);
  if (!normalized) return null;

  const meta = getDriverMetaMap()[String(normalized.id)] || {};

  return {
    ...normalized,
    aliases: meta.aliases?.length ? meta.aliases : normalized.aliases || [],
    notes: meta.notes || normalized.notes || "",
    displayName: normalized.displayName || normalized.teamName || "",
  };
};

export const mergeDriverMetaList = (drivers = []) =>
  drivers.map(mergeDriverMeta).filter(Boolean);

export const getVehicleMetaMap = () => readStorageMap(VEHICLE_META_STORAGE_KEY);

export const setVehicleMeta = (vehicleId, meta) => {
  if (!vehicleId) return;

  const current = readStorageMap(VEHICLE_META_STORAGE_KEY);
  const normalizedMeta = {
    vehicleClass: normalizeMetaValue(meta?.vehicleClass),
    wheelbaseMm: normalizeMetaValue(meta?.wheelbaseMm),
    notes: normalizeMetaValue(meta?.notes),
  };

  if (
    !normalizedMeta.vehicleClass &&
    !normalizedMeta.wheelbaseMm &&
    !normalizedMeta.notes
  ) {
    delete current[String(vehicleId)];
  } else {
    current[String(vehicleId)] = normalizedMeta;
  }

  writeStorageMap(VEHICLE_META_STORAGE_KEY, current);
};

export const mergeVehicleMeta = (vehicle) => {
  const normalized = normalizeVehicle(vehicle);
  if (!normalized) return null;

  const meta = getVehicleMetaMap()[String(normalized.id)] || {};

  return {
    ...normalized,
    vehicleClass: meta.vehicleClass || normalized.vehicleClass || "",
    wheelbaseMm: meta.wheelbaseMm || normalized.wheelbaseMm || "",
    notes: meta.notes || normalized.notes || "",
  };
};

export const mergeVehicleMetaList = (vehicles = []) =>
  vehicles.map(mergeVehicleMeta).filter(Boolean);

export const createBlankDriverFormValues = () => ({
  fullName: "",
  displayName: "",
  licenseNumber: "",
  aliases: [],
  notes: "",
  status: "active",
});

export const toDriverFormValues = (driver = null) => ({
  fullName: getDriverFullName(driver),
  displayName: getDriverDisplayName(driver),
  licenseNumber: normalizeMetaValue(driver?.licenseNumber || driver?.license_number),
  aliases: normalizeAliasList(driver?.aliases),
  notes: normalizeMetaValue(driver?.notes),
  status: driver && driver.isActive === false ? "archived" : "active",
});

export const buildDriverPayload = (values) => {
  const { firstName, lastName } = splitFullName(values?.fullName);
  const driverName = normalizeMetaValue(values?.fullName);

  return {
    driver_id: normalizeMetaValue(values?.driverId) || undefined,
    driver_name: driverName || undefined,
    first_name: firstName,
    last_name: lastName,
    license_number: normalizeMetaValue(values?.licenseNumber) || undefined,
    team_name: normalizeMetaValue(values?.displayName) || undefined,
    aliases: normalizeAliasList(values?.aliases),
    notes: normalizeMetaValue(values?.notes) || undefined,
    active: values?.status ? values.status !== "archived" : true,
    is_active: values?.status ? values.status !== "archived" : true,
  };
};

export const buildDriverMeta = (values) => ({
  aliases: normalizeAliasList(values?.aliases),
  notes: normalizeMetaValue(values?.notes),
});

export const createBlankVehicleFormValues = () => ({
  carNumber: "",
  driverId: "",
  make: "",
  model: "",
  year: "",
  vehicleClass: "",
  vin: "",
  wheelbaseMm: "",
  notes: "",
  status: "active",
});

export const toVehicleFormValues = (vehicle = null) => ({
  carNumber: normalizeMetaValue(
    vehicle?.registrationNumber || vehicle?.registration_number || vehicle?.carNumber,
  ),
  driverId: vehicle?.driverId || vehicle?.driver_id || "",
  make: normalizeMetaValue(vehicle?.make),
  model: normalizeMetaValue(vehicle?.model),
  year: vehicle?.year ?? "",
  vehicleClass: normalizeMetaValue(vehicle?.vehicleClass || vehicle?.vehicle_class),
  vin: normalizeMetaValue(vehicle?.vin),
  wheelbaseMm: normalizeMetaValue(vehicle?.wheelbaseMm || vehicle?.wheelbase_mm),
  notes: normalizeMetaValue(vehicle?.notes),
  status: vehicle && vehicle.isActive === false ? "archived" : "active",
});

export const buildVehiclePayload = (values) => ({
  vehicle_id: normalizeMetaValue(values?.vehicleId) || undefined,
  driver_id: normalizeMetaValue(values?.driverId) || null,
  make: normalizeMetaValue(values?.make),
  model: normalizeMetaValue(values?.model),
  year: values?.year === "" || values?.year === null ? null : Number(values.year),
  vin: normalizeMetaValue(values?.vin) || undefined,
  registration_number: normalizeMetaValue(values?.carNumber),
  vehicle_class: normalizeMetaValue(values?.vehicleClass) || undefined,
  wheelbase_mm:
    values?.wheelbaseMm === "" || values?.wheelbaseMm === null
      ? undefined
      : Number(values.wheelbaseMm),
  notes: normalizeMetaValue(values?.notes) || undefined,
  active: values?.status ? values.status !== "archived" : true,
  is_active: values?.status ? values.status !== "archived" : true,
});

export const buildVehicleMeta = (values) => ({
  vehicleClass: normalizeMetaValue(values?.vehicleClass),
  wheelbaseMm: normalizeMetaValue(values?.wheelbaseMm),
  notes: normalizeMetaValue(values?.notes),
});

export const getDriverSearchText = (driver) =>
  [
    driver?.id,
    driver?.driver_id,
    getDriverFullName(driver),
    driver?.driver_name,
    getDriverDisplayName(driver),
    driver?.licenseNumber,
    (driver?.aliases || []).join(" "),
    driver?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const getVehicleSearchText = (vehicle, driverName = "") =>
  [
    vehicle?.id,
    vehicle?.vehicle_id,
    vehicle?.registrationNumber,
    vehicle?.make,
    vehicle?.model,
    vehicle?.year,
    vehicle?.vehicleClass,
    vehicle?.notes,
    vehicle?.driverId,
    driverName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const getLifecycleLabel = (isActive) =>
  isActive === false
    ? { key: "archived", label: "Archived", tone: "neutral" }
    : { key: "active", label: "Active", tone: "success" };

export const getDriverSummaryCounts = (drivers = [], vehicles = []) => {
  const activeDrivers = drivers.filter((driver) => driver?.isActive !== false).length;
  const archivedDrivers = drivers.length - activeDrivers;
  const assignedVehicles = vehicles.filter((vehicle) => Boolean(vehicle?.driverId)).length;

  return {
    total: drivers.length,
    active: activeDrivers,
    archived: archivedDrivers,
    assignedVehicles,
  };
};

export const getVehicleSummaryCounts = (vehicles = []) => {
  const activeVehicles = vehicles.filter((vehicle) => vehicle?.isActive !== false).length;
  const archivedVehicles = vehicles.length - activeVehicles;
  const assignedDrivers = new Set(
    vehicles.map((vehicle) => vehicle?.driverId).filter(Boolean),
  ).size;

  return {
    total: vehicles.length,
    active: activeVehicles,
    archived: archivedVehicles,
    assignedDrivers,
  };
};

export const buildDriverMap = (drivers = []) =>
  drivers.reduce((map, driver) => {
    if (driver?.id) {
      map.set(String(driver.id), driver);
    }

    if (driver?.driver_id) {
      map.set(String(driver.driver_id), driver);
    }

    return map;
  }, new Map());

export const getVehicleDriverName = (vehicle, driverMap = new Map()) => {
  const driver = vehicle?.driverId ? driverMap.get(String(vehicle.driverId)) : null;
  if (!driver) return "Unassigned";

  return (
    getDriverDisplayName(driver) ||
    getDriverFullName(driver) ||
    formatEntityId("DRV", driver.driver_id || driver.id)
  );
};

export const getVehicleDriverSubtext = (vehicle, driverMap = new Map()) => {
  const driver = vehicle?.driverId ? driverMap.get(String(vehicle.driverId)) : null;
  if (!driver) return "No driver assigned";

  const fullName = getDriverFullName(driver);
  const displayName = getDriverDisplayName(driver);

  if (displayName && fullName && displayName !== fullName) {
    return fullName;
  }

  return formatEntityId("DRV", driver.driver_id || driver.id);
};
