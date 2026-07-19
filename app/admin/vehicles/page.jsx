"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import ProtectedRoute from "../../components/ProtectedRoute";
import Loader from "../../components/Common/Loader";
import StatusBadge from "../../components/Common/StatusBadge";
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import { archiveVehicle, createVehicle, getDrivers, getVehicles, updateVehicle } from "../../utils/fleetApi";
import {
  buildDriverMap,
  buildVehicleMeta,
  buildVehiclePayload,
  createBlankVehicleFormValues,
  formatDate,
  formatDateTime,
  formatEntityId,
  getApiErrorMessage,
  getDriverDisplayName,
  getDriverFullName,
  getLifecycleLabel,
  getVehicleDriverName,
  getVehicleDriverSubtext,
  getVehicleSearchText,
  getVehicleSummaryCounts,
  mergeDriverMetaList,
  mergeVehicleMetaList,
  setVehicleMeta,
  toVehicleFormValues,
} from "../fleet/_components/fleetManagementHelpers";
import {
  ActionIconButton,
  ConfirmDialog,
  DrawerShell,
  EmptyStatePanel,
  MetricCard,
} from "../fleet/_components/ManagementUi";
import "../fleet/fleetManagement.css";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const VEHICLE_CLASS_OPTIONS = [
  "GT3",
  "GT4",
  "Touring",
  "Prototype",
  "Cup",
  "Open Wheel",
  "Rally",
  "Historic",
  "Other",
];

function VehicleDriverSelect({
  options,
  value,
  onChange,
  disabled = false,
  helperText = "",
  error = false,
}) {
  const selectedOption = options.find((option) => option.id === value) || null;

  return (
    <Autocomplete
      className="fleet-autocomplete"
      disablePortal
      options={options}
      value={selectedOption}
      disabled={disabled}
      onChange={(_, nextValue) => onChange(nextValue?.id || "")}
      isOptionEqualToValue={(option, currentValue) => option.id === currentValue.id}
      getOptionLabel={(option) => option.label || ""}
      slotProps={{
        popper: {
          sx: {
            zIndex: 2200,
          },
        },
        paper: {
          elevation: 0,
          sx: {
            mt: 1,
            borderRadius: "12px",
            overflow: "hidden",
            backgroundColor: "#111111",
            color: "#ffffff",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 24px 60px rgba(0, 0, 0, 0.42)",
          },
        },
        listbox: {
          sx: {
            p: 0.5,
            bgcolor: "#111111",
            color: "#ffffff",
            "& .MuiAutocomplete-option": {
              alignItems: "flex-start",
              gap: "0.1rem",
              minHeight: "auto",
              px: 1.25,
              py: 1,
              borderRadius: "10px",
              mx: 0.25,
              my: 0.25,
              "&:hover": {
                backgroundColor: "rgba(255, 107, 53, 0.1)",
              },
              "&.Mui-focused": {
                backgroundColor: "rgba(255, 107, 53, 0.1)",
              },
              "&[aria-selected='true']": {
                backgroundColor: "rgba(255, 107, 53, 0.16) !important",
              },
            },
          },
        },
      }}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          <div className="fleet-cell-stack" style={{ padding: "0.35rem 0" }}>
            <div className="fleet-cell-title">{option.label}</div>
            <div className="fleet-cell-subtitle">{option.sublabel}</div>
          </div>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search drivers by name or display name..."
          error={error}
          helperText={helperText}
          fullWidth
          variant="outlined"
          InputLabelProps={{ shrink: true }}
          sx={{
            "& .MuiInputBase-root": {
              minHeight: "44px",
              color: "#fff",
              fontSize: "0.875rem",
            },
            "& .MuiOutlinedInput-root": {
              borderRadius: "8px",
              backgroundColor: "#1a1a1a",
            },
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "#2a3a5a",
            },
            "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "rgba(255, 107, 53, 0.45)",
            },
            "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "#ff6b35 !important",
              boxShadow: "0 0 0 4px rgba(255, 107, 53, 0.18)",
            },
            "& .MuiOutlinedInput-root.Mui-focused": {
              boxShadow: "0 0 0 4px rgba(255, 107, 53, 0.12)",
            },
            "& .MuiInputBase-input": {
              color: "#fff",
              padding: "0.55rem 0.35rem",
            },
            "& .MuiFormHelperText-root": {
              color: "#7a8090",
              marginLeft: 0,
            },
          }}
        />
      )}
    />
  );
}

function VehicleDrawerContent({
  mode,
  vehicle,
  formValues,
  setFormValues,
  driverOptions,
  driverMap,
}) {
  const readOnly = mode === "view";
  const isCreateMode = mode === "create";
  const effectiveStatus = readOnly ? vehicle?.isActive !== false : formValues.status !== "archived";

  const onFieldChange = (field, value) => {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const selectedDriver = formValues.driverId
    ? driverMap.get(String(formValues.driverId))
    : vehicle?.driverId
      ? driverMap.get(String(vehicle.driverId))
      : null;
  const driverSummary = selectedDriver
    ? `${getDriverDisplayName(selectedDriver) || getDriverFullName(selectedDriver)} - ${formatEntityId(
        "DRV",
        selectedDriver.driver_id || selectedDriver.id,
      )}`
    : "No driver assigned";
  const vehicleIdSummary = isCreateMode
    ? "Assigned after save"
    : vehicle?.vehicle_id || formatEntityId("VEH", vehicle?.id);
  const createdUpdatedSummary = isCreateMode
    ? "Created when the record is saved"
    : `${formatDate(vehicle?.createdAt)} - ${formatDateTime(vehicle?.updatedAt)}`;

  return (
    <div className="fleet-page-section" style={{ gap: "1.15rem" }}>
      <div className="fleet-detail-grid">
        <div className="fleet-detail-card">
          <p className="fleet-detail-label">Vehicle ID</p>
          <p className="fleet-detail-value fleet-mono" title={vehicleIdSummary}>
            {vehicleIdSummary}
          </p>
        </div>
        <div className="fleet-detail-card">
          <p className="fleet-detail-label">Status</p>
          <p className="fleet-detail-value">
            <StatusBadge
              label={getLifecycleLabel(effectiveStatus).label}
              tone={getLifecycleLabel(effectiveStatus).tone}
            />
          </p>
        </div>
        <div className="fleet-detail-card">
          <p className="fleet-detail-label">Assigned Driver</p>
          <p className="fleet-detail-value">{driverSummary}</p>
        </div>
        <div className="fleet-detail-card">
          <p className="fleet-detail-label">Created / Updated</p>
          <p className="fleet-detail-value">
            {createdUpdatedSummary}
          </p>
        </div>
      </div>

      <div className="fleet-form-grid">
        <div className="fleet-field fleet-span-2">
          <label className="fleet-label" htmlFor="vehicle-car-number">
            Car Number
          </label>
          <input
            id="vehicle-car-number"
            className="fleet-input"
            value={formValues.carNumber}
            onChange={(event) => onFieldChange("carNumber", event.target.value)}
            placeholder="Enter the car number"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field fleet-span-2">
          <label className="fleet-label">Assigned Driver</label>
          <VehicleDriverSelect
            options={driverOptions}
            value={formValues.driverId}
            onChange={(value) => onFieldChange("driverId", value)}
            disabled={readOnly}
            helperText={driverOptions.length ? "" : "Create a driver first to enable assignment."}
            error={false}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="vehicle-make">
            Make
          </label>
          <input
            id="vehicle-make"
            className="fleet-input"
            value={formValues.make}
            onChange={(event) => onFieldChange("make", event.target.value)}
            placeholder="Make"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="vehicle-model">
            Model
          </label>
          <input
            id="vehicle-model"
            className="fleet-input"
            value={formValues.model}
            onChange={(event) => onFieldChange("model", event.target.value)}
            placeholder="Model"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="vehicle-year">
            Year
          </label>
          <input
            id="vehicle-year"
            type="number"
            className="fleet-input"
            value={formValues.year}
            onChange={(event) => onFieldChange("year", event.target.value)}
            placeholder="2026"
            readOnly={readOnly}
            min="1900"
            max="2100"
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="vehicle-status">
            Status
          </label>
          <select
            id="vehicle-status"
            className="fleet-select"
            value={formValues.status}
            onChange={(event) => onFieldChange("status", event.target.value)}
            disabled={readOnly}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="fleet-field fleet-span-2">
          <label className="fleet-label" htmlFor="vehicle-class">
            Class
          </label>
          <select
            id="vehicle-class"
            className="fleet-select"
            value={formValues.vehicleClass}
            onChange={(event) => onFieldChange("vehicleClass", event.target.value)}
            disabled={readOnly}
          >
            <option value="">Select a class</option>
            {VEHICLE_CLASS_OPTIONS.map((vehicleClass) => (
              <option key={vehicleClass} value={vehicleClass}>
                {vehicleClass}
              </option>
            ))}
          </select>
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="vehicle-vin">
            VIN
          </label>
          <input
            id="vehicle-vin"
            className="fleet-input"
            value={formValues.vin}
            onChange={(event) => onFieldChange("vin", event.target.value)}
            placeholder="Optional"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="vehicle-wheelbase">
            Wheelbase (mm)
          </label>
          <input
            id="vehicle-wheelbase"
            className="fleet-input"
            type="number"
            min="0"
            value={formValues.wheelbaseMm}
            onChange={(event) => onFieldChange("wheelbaseMm", event.target.value)}
            placeholder="Optional"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field fleet-span-2">
          <label className="fleet-label" htmlFor="vehicle-notes">
            Notes
          </label>
          <textarea
            id="vehicle-notes"
            className="fleet-textarea"
            value={formValues.notes}
            onChange={(event) => onFieldChange("notes", event.target.value)}
            placeholder="Optional vehicle notes"
            readOnly={readOnly}
          />
        </div>
      </div>

      {mode === "view" ? (
        <div className="fleet-detail-grid">
          <div className="fleet-detail-card">
            <p className="fleet-detail-label">Class</p>
            <p className="fleet-detail-value">{formValues.vehicleClass || "Not configured"}</p>
          </div>
          <div className="fleet-detail-card">
            <p className="fleet-detail-label">Wheelbase</p>
            <p className="fleet-detail-value">
              {formValues.wheelbaseMm ? `${formValues.wheelbaseMm} mm` : "Not configured"}
            </p>
          </div>
          <div className="fleet-detail-card fleet-span-2">
            <p className="fleet-detail-label">Driver Snapshot</p>
            <p className="fleet-detail-value">
              {selectedDriver ? getDriverDisplayName(selectedDriver) || getDriverFullName(selectedDriver) : "Unassigned"}
            </p>
            <p className="fleet-detail-note">
              {selectedDriver ? getVehicleDriverSubtext(vehicle, driverMap) : "No driver is currently linked to this vehicle."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function VehiclesManagementPage() {
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [makeFilter, setMakeFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create");
  const [drawerRecordId, setDrawerRecordId] = useState(null);
  const [formValues, setFormValues] = useState(createBlankVehicleFormValues());
  const [drawerError, setDrawerError] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archivingVehicle, setArchivingVehicle] = useState(false);

  const refreshVehicles = useCallback(async () => {
    setLoading(true);
    setPageError("");

    const [vehiclesResult, driversResult] = await Promise.allSettled([
      getVehicles(),
      getDrivers(),
    ]);

    const nextVehicles =
      vehiclesResult.status === "fulfilled"
        ? mergeVehicleMetaList(vehiclesResult.value.vehicles || [])
        : [];
    const nextDrivers =
      driversResult.status === "fulfilled"
        ? mergeDriverMetaList(driversResult.value.drivers || [])
        : [];

    if (vehiclesResult.status === "rejected" && driversResult.status === "rejected") {
      setVehicles([]);
      setDrivers([]);
      setPageError(
        `${getApiErrorMessage(vehiclesResult.reason, "Vehicles")} and ${getApiErrorMessage(
          driversResult.reason,
          "drivers",
        )} could not be loaded.`,
      );
    } else {
      if (vehiclesResult.status === "rejected") {
        setPageError(getApiErrorMessage(vehiclesResult.reason, "Vehicles could not be loaded."));
      } else if (driversResult.status === "rejected") {
        setPageError(getApiErrorMessage(driversResult.reason, "Drivers could not be loaded."));
      }

      setVehicles(nextVehicles);
      setDrivers(nextDrivers);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refreshVehicles();
  }, [refreshVehicles]);

  useEffect(() => {
    if (!notice) return undefined;

    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const driverMap = useMemo(() => buildDriverMap(drivers), [drivers]);

  const driverOptions = useMemo(
    () =>
      drivers.map((driver) => {
        const displayName = getDriverDisplayName(driver) || getDriverFullName(driver) || "Unnamed Driver";
        return {
          id: driver.driver_id || driver.id,
          label: displayName,
          sublabel: `${getDriverFullName(driver) || "No full name"} - ${formatEntityId("DRV", driver.driver_id || driver.id)}`,
          searchText: [
            displayName,
            getDriverFullName(driver),
            driver.driver_id || driver.id,
            driver.licenseNumber,
            driver.aliases?.join(" "),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        };
      }),
    [drivers],
  );

  const summaryCounts = useMemo(() => getVehicleSummaryCounts(vehicles), [vehicles]);

  const makeOptions = useMemo(() => {
    const values = new Set();
    vehicles.forEach((vehicle) => {
      if (vehicle.make) values.add(vehicle.make);
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [vehicles]);

  const modelOptions = useMemo(() => {
    const values = new Set();
    vehicles.forEach((vehicle) => {
      if (vehicle.model) values.add(vehicle.model);
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [vehicles]);

  const enrichedVehicles = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        ...vehicle,
        assignedDriverName: getVehicleDriverName(vehicle, driverMap),
        assignedDriverSubtext: getVehicleDriverSubtext(vehicle, driverMap),
      })),
    [driverMap, vehicles],
  );

  const filteredVehicles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return enrichedVehicles.filter((vehicle) => {
      const status = getLifecycleLabel(vehicle.isActive).key;
      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }

      if (makeFilter !== "all" && vehicle.make !== makeFilter) {
        return false;
      }

      if (modelFilter !== "all" && vehicle.model !== modelFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return getVehicleSearchText(vehicle, vehicle.assignedDriverName).includes(query);
    });
  }, [enrichedVehicles, makeFilter, modelFilter, searchQuery, statusFilter]);

  const currentVehicle = useMemo(
    () => enrichedVehicles.find((vehicle) => String(vehicle.id) === String(drawerRecordId)) || null,
    [drawerRecordId, enrichedVehicles],
  );

  useEffect(() => {
    if (drawerOpen && currentVehicle && drawerMode !== "create") {
      setFormValues(toVehicleFormValues(currentVehicle));
    }
  }, [currentVehicle, drawerMode, drawerOpen]);

  const openCreateDrawer = () => {
    setDrawerMode("create");
    setDrawerRecordId(null);
    setFormValues(createBlankVehicleFormValues());
    setDrawerError("");
    setDrawerOpen(true);
  };

  const openEditDrawer = (vehicle) => {
    setDrawerMode("edit");
    setDrawerRecordId(vehicle.id);
    setFormValues(toVehicleFormValues(vehicle));
    setDrawerError("");
    setDrawerOpen(true);
  };

  const openViewDrawer = (vehicle) => {
    setDrawerMode("view");
    setDrawerRecordId(vehicle.id);
    setFormValues(toVehicleFormValues(vehicle));
    setDrawerError("");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (savingVehicle) return;
    setDrawerOpen(false);
    setDrawerError("");
    setDrawerRecordId(null);
  };

  const handleSaveVehicle = async (event) => {
    event.preventDefault();
    setDrawerError("");
    setSavingVehicle(true);

    if (!formValues.carNumber.trim() || !formValues.driverId || !formValues.make.trim() || !formValues.model.trim()) {
      setDrawerError("Car number, assigned driver, make, and model are required.");
      setSavingVehicle(false);
      return;
    }

    if (!formValues.vehicleClass) {
      setDrawerError("Please choose a vehicle class.");
      setSavingVehicle(false);
      return;
    }

    const payload = buildVehiclePayload(formValues);

    try {
      let response;

      if (drawerMode === "create") {
        response = await createVehicle(payload);
      } else if (currentVehicle?.id) {
        response = await updateVehicle(currentVehicle.id, payload);
      } else {
        throw new Error("Vehicle record could not be resolved.");
      }

      const savedVehicle = response.vehicle;
      setVehicleMeta(savedVehicle.id, buildVehicleMeta(formValues));

      if (formValues.status === "archived" && savedVehicle?.isActive !== false) {
        await archiveVehicle(savedVehicle.id);
      }

      setNotice({
        type: "success",
        title: drawerMode === "create" ? "Vehicle created" : "Vehicle updated",
        message: `${formValues.carNumber} is ready for driver assignment and session use.`,
      });
      setDrawerOpen(false);
      setDrawerRecordId(null);
      await refreshVehicles();
    } catch (error) {
      setDrawerError(getApiErrorMessage(error, "Unable to save the vehicle."));
    } finally {
      setSavingVehicle(false);
    }
  };

  const handleArchiveVehicle = (vehicle) => {
    setArchiveTarget(vehicle);
  };

  const confirmArchiveVehicle = async () => {
    if (!archiveTarget?.id) return;

    setArchivingVehicle(true);

    try {
      await archiveVehicle(archiveTarget.id);
      setNotice({
        type: "warning",
        title: "Vehicle archived",
        message: `${archiveTarget.registrationNumber || archiveTarget.id} has been archived and remains filterable.`,
      });
      if (drawerRecordId && String(drawerRecordId) === String(archiveTarget.id)) {
        setDrawerMode("view");
        setFormValues((current) => ({ ...current, status: "archived" }));
      }
      await refreshVehicles();
    } catch (error) {
      setNotice({
        type: "danger",
        title: "Archive failed",
        message: getApiErrorMessage(error, "The vehicle could not be archived."),
      });
    } finally {
      setArchivingVehicle(false);
      setArchiveTarget(null);
    }
  };

  const drawerFooter = (() => {
    if (drawerMode === "view") {
      return (
        <>
          <button
            type="button"
            className="fleet-btn fleet-btn-secondary"
            onClick={closeDrawer}
          >
            Close
          </button>
          <button
            type="button"
            className="fleet-btn fleet-btn-secondary"
            onClick={() => {
              if (currentVehicle) {
                openEditDrawer(currentVehicle);
              }
            }}
          >
            Edit Vehicle
          </button>
          {currentVehicle?.isActive !== false ? (
            <button
              type="button"
              className="fleet-btn fleet-btn-danger"
              onClick={() => handleArchiveVehicle(currentVehicle)}
            >
              Archive Vehicle
            </button>
          ) : null}
        </>
      );
    }

    return (
      <>
        <button
          type="button"
          className="fleet-btn fleet-btn-secondary"
          onClick={closeDrawer}
          disabled={savingVehicle}
        >
          Cancel
        </button>
        <button
          type="button"
          className="fleet-btn fleet-btn-primary"
          onClick={handleSaveVehicle}
          disabled={savingVehicle}
        >
          {savingVehicle ? "Saving..." : drawerMode === "create" ? "Create Vehicle" : "Save Vehicle"}
        </button>
      </>
    );
  })();

  const emptyStateAction = filteredVehicles.length === 0 ? (
    <div className="fleet-actions-inline">
      <button
        type="button"
        className="fleet-btn fleet-btn-secondary"
        onClick={() => {
          setSearchQuery("");
          setStatusFilter("all");
          setMakeFilter("all");
          setModelFilter("all");
        }}
      >
        Clear Filters
      </button>
      <button type="button" className="fleet-btn fleet-btn-primary" onClick={openCreateDrawer}>
        + Create Vehicle
      </button>
    </div>
  ) : null;

  return (
    <ProtectedRoute requireOwner={true}>
      <div className="fleet-page">
        <div className="fleet-page-shell">
          <header className="fleet-page-header">
            <div className="fleet-page-heading">
              <h1 className="fleet-page-title">Vehicle Management</h1>
              <p className="fleet-page-subtitle">
            Manage vehicles, assignments, and specifications in a premium motorsport owner workspace.
              </p>
            </div>

            <div className="fleet-page-actions">
              <button type="button" className="fleet-btn fleet-btn-primary" onClick={openCreateDrawer}>
                <AddOutlinedIcon sx={{ fontSize: 18 }} />
                + Create Vehicle
              </button>
            </div>
          </header>

          {notice ? (
            <div className={`fleet-notice fleet-notice-${notice.type}`}>
              <div className="fleet-notice-icon" aria-hidden="true">
                {notice.type === "success" ? (
                  <CheckCircleOutlineOutlinedIcon fontSize="small" />
                ) : notice.type === "warning" ? (
                  <WarningAmberOutlinedIcon fontSize="small" />
                ) : (
                  <ErrorOutlineOutlinedIcon fontSize="small" />
                )}
              </div>
              <div className="fleet-notice-copy">
                <p className="fleet-notice-title">{notice.title}</p>
                <p className="fleet-notice-message">{notice.message}</p>
              </div>
            </div>
          ) : null}

          {pageError ? (
            <div className="fleet-notice fleet-notice-danger" style={{ marginBottom: "1rem" }}>
              <div className="fleet-notice-icon" aria-hidden="true">
                <WarningAmberOutlinedIcon fontSize="small" />
              </div>
              <div className="fleet-notice-copy">
                <p className="fleet-notice-title">Data load issue</p>
                <p className="fleet-notice-message">{pageError}</p>
              </div>
              <div className="fleet-actions-inline" style={{ marginLeft: "auto" }}>
                <button type="button" className="fleet-btn fleet-btn-secondary" onClick={refreshVehicles}>
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          <div className="fleet-summary-grid">
            <MetricCard
              icon={DirectionsCarOutlinedIcon}
              value={summaryCounts.total}
              label="Total Vehicles"
              helper="All tracked vehicles, including archived history."
            />
            <MetricCard
              icon={CheckCircleOutlineOutlinedIcon}
              value={summaryCounts.active}
              label="Active Vehicles"
              helper="Ready for use in current operations."
              tone="success"
            />
            <MetricCard
              icon={ArchiveOutlinedIcon}
              value={summaryCounts.archived}
              label="Archived Vehicles"
              helper="Retained for operational history and audits."
              tone="danger"
            />
            <MetricCard
              icon={PeopleAltOutlinedIcon}
              value={summaryCounts.assignedDrivers}
              label="Assigned Drivers"
              helper="Distinct drivers linked to vehicle records."
              tone="neutral"
            />
          </div>

          <section className="fleet-page-section">
            <div className="fleet-section-header">
              <div>
                <h2 className="fleet-section-title">Vehicle Directory</h2>
                <p className="fleet-section-subtitle">
                  Search by vehicle ID, number, make, model, or the assigned driver.
                </p>
              </div>
            </div>

            <div className="fleet-toolbar">
              <div className="fleet-field fleet-search-field" style={{ gridColumn: "1 / -1" }}>
                <label className="fleet-label" htmlFor="vehicle-search">
                  Search
                </label>
                <SearchOutlinedIcon className="fleet-search-icon" fontSize="small" />
                <input
                  id="vehicle-search"
                  className="fleet-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search vehicles by ID, number, or driver..."
                  autoComplete="off"
                />
              </div>

              <div className="fleet-field">
                <label className="fleet-label" htmlFor="vehicle-status-filter">
                  Status
                </label>
                <select
                  id="vehicle-status-filter"
                  className="fleet-select"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  {STATUS_FILTERS.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fleet-field">
                <label className="fleet-label" htmlFor="vehicle-make-filter">
                  Make
                </label>
                <select
                  id="vehicle-make-filter"
                  className="fleet-select"
                  value={makeFilter}
                  onChange={(event) => setMakeFilter(event.target.value)}
                >
                  <option value="all">All Makes</option>
                  {makeOptions.map((make) => (
                    <option key={make} value={make}>
                      {make}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fleet-field">
                <label className="fleet-label" htmlFor="vehicle-model-filter">
                  Model
                </label>
                <select
                  id="vehicle-model-filter"
                  className="fleet-select"
                  value={modelFilter}
                  onChange={(event) => setModelFilter(event.target.value)}
                >
                  <option value="all">All Models</option>
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fleet-field">
                <label className="fleet-label">Quick Actions</label>
                <div className="fleet-actions-inline">
                  <button type="button" className="fleet-btn fleet-btn-secondary" onClick={refreshVehicles}>
                    <TuneOutlinedIcon sx={{ fontSize: 18 }} />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            <div className="fleet-table-card">
              {loading ? (
                <Loader fullHeight label="Loading vehicles" sublabel="Syncing vehicles and driver assignments..." />
              ) : filteredVehicles.length === 0 ? (
                <EmptyStatePanel
                  icon={DirectionsCarOutlinedIcon}
                  title={vehicles.length === 0 ? "No vehicles yet" : "No vehicles match the current filters"}
                  description={
                    vehicles.length === 0
                      ? "Create the first vehicle record and connect it to a driver to begin tracking assignments."
                      : "Try clearing the search and filters, or add a new vehicle record."
                  }
                  action={emptyStateAction}
                />
              ) : (
                <div className="fleet-table-scroll">
                  <div
                    className="fleet-table"
                    style={{
                      "--fleet-columns": "1fr 1.8fr 1fr 1fr 1fr 0.75fr 1.15fr 1fr 1fr 152px",
                    }}
                  >
                    <div className="fleet-table-header">
                      <div className="fleet-table-header-cell">Vehicle ID</div>
                      <div className="fleet-table-header-cell">Assigned Driver</div>
                      <div className="fleet-table-header-cell">Car Number</div>
                      <div className="fleet-table-header-cell">Make</div>
                      <div className="fleet-table-header-cell">Model</div>
                      <div className="fleet-table-header-cell">Year</div>
                      <div className="fleet-table-header-cell">Class</div>
                      <div className="fleet-table-header-cell">Status</div>
                      <div className="fleet-table-header-cell">Created</div>
                      <div className="fleet-table-header-cell">Actions</div>
                    </div>

                    {filteredVehicles.map((vehicle) => {
                      const lifecycle = getLifecycleLabel(vehicle.isActive);

                      return (
                        <div key={vehicle.id} className="fleet-table-row">
                            <div
                              className="fleet-table-cell fleet-mono"
                              data-label="Vehicle ID"
                              title={vehicle.vehicle_id || vehicle.id}
                            >
                              {vehicle.vehicle_id || formatEntityId("VEH", vehicle.id)}
                            </div>
                          <div className="fleet-table-cell" data-label="Assigned Driver">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{vehicle.assignedDriverName}</div>
                              <div className="fleet-cell-subtitle">{vehicle.assignedDriverSubtext}</div>
                            </div>
                          </div>
                          <div className="fleet-table-cell fleet-mono" data-label="Car Number">
                            {vehicle.registrationNumber || "Not set"}
                          </div>
                          <div className="fleet-table-cell" data-label="Make">
                            {vehicle.make || "—"}
                          </div>
                          <div className="fleet-table-cell" data-label="Model">
                            {vehicle.model || "—"}
                          </div>
                          <div className="fleet-table-cell" data-label="Year">
                            {vehicle.year || "—"}
                          </div>
                          <div className="fleet-table-cell" data-label="Class">
                            {vehicle.vehicleClass ? (
                              <span className="fleet-pill fleet-pill-accent">{vehicle.vehicleClass}</span>
                            ) : (
                              <span className="fleet-muted">Not set</span>
                            )}
                          </div>
                          <div className="fleet-table-cell" data-label="Status">
                            <StatusBadge label={lifecycle.label} tone={lifecycle.tone} />
                          </div>
                          <div className="fleet-table-cell" data-label="Created">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{formatDate(vehicle.createdAt)}</div>
                              <div className="fleet-cell-subtitle">{formatDateTime(vehicle.updatedAt)}</div>
                            </div>
                          </div>
                          <div className="fleet-table-cell fleet-action-cell" data-label="Actions">
                            <div className="fleet-action-group">
                              <ActionIconButton
                                icon={VisibilityOutlinedIcon}
                                tone="view"
                                label="View Vehicle"
                                onClick={() => openViewDrawer(vehicle)}
                              />
                              <ActionIconButton
                                icon={EditOutlinedIcon}
                                tone="edit"
                                label="Edit Vehicle"
                                onClick={() => openEditDrawer(vehicle)}
                              />
                              <ActionIconButton
                                icon={ArchiveOutlinedIcon}
                                tone="danger"
                                label="Archive Vehicle"
                                onClick={() => handleArchiveVehicle(vehicle)}
                                disabled={vehicle.isActive === false}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <DrawerShell
          open={drawerOpen}
          title={
            drawerMode === "create"
              ? "Create Vehicle"
              : drawerMode === "edit"
                ? "Edit Vehicle"
                : "Vehicle Details"
          }
          subtitle={
            drawerMode === "create"
              ? "Add a vehicle record and link it to an assigned driver."
              : drawerMode === "edit"
                ? "Update the vehicle record, assignment, and operational metadata."
                : "Review the current vehicle specification and assignment snapshot."
          }
          meta={
            currentVehicle ? (
              <>
                <StatusBadge
                  label={getLifecycleLabel(currentVehicle.isActive).label}
                  tone={getLifecycleLabel(currentVehicle.isActive).tone}
                />
                <StatusBadge
                  label={currentVehicle.vehicleClass || "No class set"}
                  tone={currentVehicle.vehicleClass ? "accent" : "neutral"}
                />
              </>
            ) : null
          }
          onClose={closeDrawer}
          footer={drawerFooter}
          wide
        >
          {drawerError ? (
            <div className="fleet-notice fleet-notice-danger" style={{ marginBottom: "1rem" }}>
              <div className="fleet-notice-icon" aria-hidden="true">
                <WarningAmberOutlinedIcon fontSize="small" />
              </div>
              <div className="fleet-notice-copy">
                <p className="fleet-notice-title">Validation issue</p>
                <p className="fleet-notice-message">{drawerError}</p>
              </div>
            </div>
          ) : null}

          <VehicleDrawerContent
            mode={drawerMode}
            vehicle={currentVehicle}
            formValues={formValues}
            setFormValues={setFormValues}
            driverOptions={driverOptions}
            driverMap={driverMap}
          />
        </DrawerShell>

        <ConfirmDialog
          open={Boolean(archiveTarget)}
          title="Archive vehicle?"
          message={
            archiveTarget
              ? `Archive ${archiveTarget.registrationNumber || archiveTarget.id}? The record will remain visible in archived filters and can be reactivated later.`
              : ""
          }
          confirmLabel="Archive Vehicle"
          onConfirm={confirmArchiveVehicle}
          onCancel={() => setArchiveTarget(null)}
          busy={archivingVehicle}
          tone="danger"
          icon={WarningAmberOutlinedIcon}
          confirmTitle="Archive the selected vehicle"
        />
      </div>
    </ProtectedRoute>
  );
}
