"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import Loader from "../../components/Common/Loader";
import StatusBadge from "../../components/Common/StatusBadge";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import { createDriver, archiveDriver, getDrivers, getVehicles, updateDriver } from "../../utils/fleetApi";
import {
  buildDriverMeta,
  buildDriverPayload,
  createBlankDriverFormValues,
  formatDate,
  formatDateTime,
  formatEntityId,
  getApiErrorMessage,
  getDriverDisplayName,
  getDriverFullName,
  getDriverSearchText,
  getDriverSummaryCounts,
  getLifecycleLabel,
  mergeDriverMetaList,
  mergeVehicleMetaList,
  setDriverMeta,
  toDriverFormValues,
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

function AliasTagEditor({ aliases, onAliasesChange, disabled = false }) {
  const [draft, setDraft] = useState("");

  const addAlias = () => {
    const nextValue = draft.trim().replace(/\s+/g, " ");
    if (!nextValue) return;

    if (aliases.some((alias) => alias.toLowerCase() === nextValue.toLowerCase())) {
      setDraft("");
      return;
    }

    onAliasesChange([...aliases, nextValue]);
    setDraft("");
  };

  const removeAlias = (aliasToRemove) => {
    onAliasesChange(aliases.filter((alias) => alias !== aliasToRemove));
  };

  return (
    <div className="fleet-tag-editor">
      {aliases.length ? (
        <div className="fleet-tag-list" aria-label="Driver aliases">
          {aliases.map((alias) => (
            <span key={alias} className="fleet-tag-chip">
              {alias}
              {!disabled ? (
                <button
                  type="button"
                  className="fleet-tag-remove"
                  onClick={() => removeAlias(alias)}
                  aria-label={`Remove alias ${alias}`}
                >
                  <CloseOutlinedIcon sx={{ fontSize: 16 }} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {!disabled ? (
        <div className="fleet-tag-input-row">
          <input
            className="fleet-input fleet-tag-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addAlias();
              }

              if (event.key === "Backspace" && !draft && aliases.length) {
                removeAlias(aliases[aliases.length - 1]);
              }
            }}
            placeholder="Type an alias and press Enter"
            autoComplete="off"
          />
          <button type="button" className="fleet-btn fleet-btn-secondary" onClick={addAlias}>
            Add
          </button>
        </div>
      ) : null}

      {!disabled ? (
        <p className="fleet-helper-text">Use aliases to store nicknames, call signs, or shorthand references.</p>
      ) : null}
    </div>
  );
}

function DriverDrawerContent({
  mode,
  driver,
  formValues,
  setFormValues,
  aliasDisabled = false,
  assignedVehicles = [],
}) {
  const readOnly = mode === "view";
  const effectiveStatus = readOnly ? driver?.isActive !== false : formValues.status !== "archived";

  const onFieldChange = (field, value) => {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const assignedVehicleSummary = assignedVehicles.length
    ? `${assignedVehicles.length} vehicle${assignedVehicles.length === 1 ? "" : "s"} linked`
    : "No vehicles linked";

  return (
    <div className="fleet-page-section" style={{ gap: "1.15rem" }}>
      <div className="fleet-detail-grid">
        <div className="fleet-detail-card">
          <p className="fleet-detail-label">Driver ID</p>
          <p className="fleet-detail-value fleet-mono" title={driver?.driver_id || driver?.id || ""}>
            {driver?.driver_id || formatEntityId("DRV", driver?.id)}
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
          <p className="fleet-detail-label">Assigned Vehicles</p>
          <p className="fleet-detail-value">{assignedVehicleSummary}</p>
        </div>
        <div className="fleet-detail-card">
          <p className="fleet-detail-label">Created / Updated</p>
          <p className="fleet-detail-value">
            {formatDate(driver?.createdAt)} · {formatDateTime(driver?.updatedAt)}
          </p>
        </div>
      </div>

      <div className="fleet-form-grid">
        <div className="fleet-field fleet-span-2">
          <label className="fleet-label" htmlFor="driver-full-name">
            Full Name
          </label>
          <input
            id="driver-full-name"
            className="fleet-input"
            value={formValues.fullName}
            onChange={(event) => onFieldChange("fullName", event.target.value)}
            placeholder="Enter the driver's full name"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="driver-display-name">
            Display Name
          </label>
          <input
            id="driver-display-name"
            className="fleet-input"
            value={formValues.displayName}
            onChange={(event) => onFieldChange("displayName", event.target.value)}
            placeholder="Example: Smith Racing"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="driver-license-number">
            License Number
          </label>
          <input
            id="driver-license-number"
            className="fleet-input"
            value={formValues.licenseNumber}
            onChange={(event) => onFieldChange("licenseNumber", event.target.value)}
            placeholder="Optional"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field fleet-span-2">
          <label className="fleet-label">Aliases</label>
          <AliasTagEditor
            aliases={formValues.aliases}
            onAliasesChange={(aliases) => onFieldChange("aliases", aliases)}
            disabled={aliasDisabled || readOnly}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="driver-status">
            Status
          </label>
          <select
            id="driver-status"
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
          <label className="fleet-label" htmlFor="driver-notes">
            Notes
          </label>
          <textarea
            id="driver-notes"
            className="fleet-textarea"
            value={formValues.notes}
            onChange={(event) => onFieldChange("notes", event.target.value)}
            placeholder="Optional driver notes"
            readOnly={readOnly}
          />
        </div>
      </div>

      {mode === "view" ? (
        <div className="fleet-detail-grid">
          <div className="fleet-detail-card fleet-span-2">
            <p className="fleet-detail-label">Assigned Vehicles</p>
            {assignedVehicles.length ? (
              <div className="fleet-pill-list" style={{ marginTop: "0.45rem" }}>
                {assignedVehicles.map((vehicle) => (
                  <span key={vehicle.id} className="fleet-pill fleet-pill-accent">
                    {vehicle.vehicle_id || vehicle.registrationNumber || formatEntityId("VEH", vehicle.id)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="fleet-detail-note">No vehicles are currently linked to this driver.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function DriversManagementPage() {
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create");
  const [drawerRecordId, setDrawerRecordId] = useState(null);
  const [formValues, setFormValues] = useState(createBlankDriverFormValues());
  const [drawerError, setDrawerError] = useState("");
  const [savingDriver, setSavingDriver] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archivingDriver, setArchivingDriver] = useState(false);

  const refreshDrivers = useCallback(async () => {
    setLoading(true);
    setPageError("");

    const [driversResult, vehiclesResult] = await Promise.allSettled([
      getDrivers(),
      getVehicles(),
    ]);

    const nextDrivers =
      driversResult.status === "fulfilled"
        ? mergeDriverMetaList(driversResult.value.drivers || [])
        : [];
    const nextVehicles =
      vehiclesResult.status === "fulfilled"
        ? mergeVehicleMetaList(vehiclesResult.value.vehicles || [])
        : [];

    if (driversResult.status === "rejected" && vehiclesResult.status === "rejected") {
      setDrivers([]);
      setVehicles([]);
      setPageError(
        `${getApiErrorMessage(driversResult.reason, "Drivers")} and ${getApiErrorMessage(
          vehiclesResult.reason,
          "vehicles",
        )} could not be loaded.`,
      );
    } else {
      if (driversResult.status === "rejected") {
        setPageError(getApiErrorMessage(driversResult.reason, "Drivers could not be loaded."));
      } else if (vehiclesResult.status === "rejected") {
        setPageError(getApiErrorMessage(vehiclesResult.reason, "Vehicles could not be loaded."));
      }

      setDrivers(nextDrivers);
      setVehicles(nextVehicles);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refreshDrivers();
  }, [refreshDrivers]);

  useEffect(() => {
    if (!notice) return undefined;

    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const vehicleCountMap = useMemo(() => {
    const map = new Map();

    vehicles.forEach((vehicle) => {
      if (!vehicle.driverId) return;
      const key = String(vehicle.driverId);
      map.set(key, (map.get(key) || 0) + 1);
    });

    return map;
  }, [vehicles]);

  const enrichedDrivers = useMemo(
    () =>
      drivers.map((driver) => ({
        ...driver,
        assignedVehicleCount:
          vehicleCountMap.get(String(driver.driver_id || driver.id)) || 0,
      })),
    [drivers, vehicleCountMap],
  );

  const summaryCounts = useMemo(
    () => getDriverSummaryCounts(enrichedDrivers, vehicles),
    [enrichedDrivers, vehicles],
  );

  const filteredDrivers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return enrichedDrivers.filter((driver) => {
      const status = getLifecycleLabel(driver.isActive).key;

      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return getDriverSearchText(driver).includes(query);
    });
  }, [enrichedDrivers, searchQuery, statusFilter]);

  const currentDriver = useMemo(
    () => enrichedDrivers.find((driver) => String(driver.id) === String(drawerRecordId)) || null,
    [enrichedDrivers, drawerRecordId],
  );

  const assignedVehicles = useMemo(
    () =>
      vehicles.filter(
        (vehicle) =>
          String(vehicle.driverId || "") === String(currentDriver?.driver_id || currentDriver?.id || ""),
      ),
    [currentDriver?.driver_id, currentDriver?.id, vehicles],
  );

  useEffect(() => {
    if (drawerOpen && currentDriver && drawerMode !== "create") {
      setFormValues(toDriverFormValues(currentDriver));
    }
  }, [currentDriver, drawerMode, drawerOpen]);

  const openCreateDrawer = () => {
    setDrawerMode("create");
    setDrawerRecordId(null);
    setFormValues(createBlankDriverFormValues());
    setDrawerError("");
    setDrawerOpen(true);
  };

  const openEditDrawer = (driver) => {
    setDrawerMode("edit");
    setDrawerRecordId(driver.id);
    setFormValues(toDriverFormValues(driver));
    setDrawerError("");
    setDrawerOpen(true);
  };

  const openViewDrawer = (driver) => {
    setDrawerMode("view");
    setDrawerRecordId(driver.id);
    setFormValues(toDriverFormValues(driver));
    setDrawerError("");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (savingDriver) return;
    setDrawerOpen(false);
    setDrawerError("");
    setDrawerRecordId(null);
  };

  const handleSaveDriver = async (event) => {
    event.preventDefault();
    setDrawerError("");
    setSavingDriver(true);

    const fullName = String(formValues.fullName || "").trim();
    const displayName = String(formValues.displayName || "").trim();

    if (!fullName || !displayName) {
      setDrawerError("Full name and display name are required.");
      setSavingDriver(false);
      return;
    }

    const payload = buildDriverPayload(formValues);

    try {
      let response;

      if (drawerMode === "create") {
        response = await createDriver(payload);
      } else if (currentDriver?.id) {
        response = await updateDriver(currentDriver.id, payload);
      } else {
        throw new Error("Driver record could not be resolved.");
      }

      const savedDriver = response.driver;
      setDriverMeta(savedDriver.id, buildDriverMeta(formValues));

      if (formValues.status === "archived" && savedDriver?.isActive !== false) {
        await archiveDriver(savedDriver.id);
      }

      setNotice({
        type: "success",
        title: drawerMode === "create" ? "Driver created" : "Driver updated",
        message: `${fullName} is ready for assignment.`,
      });
      setDrawerOpen(false);
      setDrawerRecordId(null);
      await refreshDrivers();
    } catch (error) {
      setDrawerError(getApiErrorMessage(error, "Unable to save the driver."));
    } finally {
      setSavingDriver(false);
    }
  };

  const handleArchiveDriver = async (driver) => {
    setArchiveTarget(driver);
  };

  const confirmArchiveDriver = async () => {
    if (!archiveTarget?.id) return;

    setArchivingDriver(true);

    try {
      await archiveDriver(archiveTarget.id);
      setNotice({
        type: "warning",
        title: "Driver archived",
        message: `${getDriverFullName(archiveTarget) || archiveTarget.id} has been archived and remains filterable.`,
      });
      if (drawerRecordId && String(drawerRecordId) === String(archiveTarget.id)) {
        setDrawerMode("view");
        setFormValues((current) => ({ ...current, status: "archived" }));
      }
      await refreshDrivers();
    } catch (error) {
      setNotice({
        type: "danger",
        title: "Archive failed",
        message: getApiErrorMessage(error, "The driver could not be archived."),
      });
    } finally {
      setArchivingDriver(false);
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
              if (currentDriver) {
                openEditDrawer(currentDriver);
              }
            }}
          >
            Edit Driver
          </button>
          {currentDriver?.isActive !== false ? (
            <button
              type="button"
              className="fleet-btn fleet-btn-danger"
              onClick={() => handleArchiveDriver(currentDriver)}
            >
              Archive Driver
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
          disabled={savingDriver}
        >
          Cancel
        </button>
        <button
          type="button"
          className="fleet-btn fleet-btn-primary"
          onClick={handleSaveDriver}
          disabled={savingDriver}
        >
          {savingDriver ? "Saving..." : drawerMode === "create" ? "Create Driver" : "Save Driver"}
        </button>
      </>
    );
  })();

  const emptyStateAction = filteredDrivers.length === 0 ? (
    <div className="fleet-actions-inline">
      <button type="button" className="fleet-btn fleet-btn-secondary" onClick={() => {
        setSearchQuery("");
        setStatusFilter("all");
      }}>
        Clear Filters
      </button>
      <button type="button" className="fleet-btn fleet-btn-primary" onClick={openCreateDrawer}>
        + Create Driver
      </button>
    </div>
  ) : null;

  return (
    <ProtectedRoute requireOwner={true}>
      <div className="fleet-page">
        <div className="fleet-page-shell">
          <header className="fleet-page-header">
            <div className="fleet-page-heading">
              <h1 className="fleet-page-title">Driver Management</h1>
              <p className="fleet-page-subtitle">
                Manage drivers, assignments, and performance records in a clean operations
                workspace.
              </p>
            </div>

            <div className="fleet-page-actions">
              <button type="button" className="fleet-btn fleet-btn-primary" onClick={openCreateDrawer}>
                <AddOutlinedIcon sx={{ fontSize: 18 }} />
                + Create Driver
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
                <button type="button" className="fleet-btn fleet-btn-secondary" onClick={refreshDrivers}>
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          <div className="fleet-summary-grid">
            <MetricCard
              icon={PeopleAltOutlinedIcon}
              value={summaryCounts.total}
              label="Total Drivers"
              helper="Full roster across active and archived records."
            />
            <MetricCard
              icon={CheckCircleOutlineOutlinedIcon}
              value={summaryCounts.active}
              label="Active Drivers"
              helper="Currently available for sessions and assignments."
              tone="success"
            />
            <MetricCard
              icon={ArchiveOutlinedIcon}
              value={summaryCounts.archived}
              label="Archived Drivers"
              helper="Retained for history and filterable review."
              tone="danger"
            />
            <MetricCard
              icon={DirectionsCarOutlinedIcon}
              value={summaryCounts.assignedVehicles}
              label="Assigned Vehicles"
              helper="Vehicles currently linked to a driver record."
              tone="neutral"
            />
          </div>

          <section className="fleet-page-section">
            <div className="fleet-section-header">
              <div>
                <h2 className="fleet-section-title">Driver Directory</h2>
                <p className="fleet-section-subtitle">
                  Search by name, ID, alias, or license number. Archive keeps records visible.
                </p>
              </div>
            </div>

            <div className="fleet-toolbar">
              <div className="fleet-field fleet-search-field" style={{ gridColumn: "1 / -1" }}>
                <label className="fleet-label" htmlFor="driver-search">
                  Search
                </label>
                <SearchOutlinedIcon className="fleet-search-icon" fontSize="small" />
                <input
                  id="driver-search"
                  className="fleet-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search drivers by name, ID, or alias..."
                  autoComplete="off"
                />
              </div>

              <div className="fleet-field">
                <label className="fleet-label" htmlFor="driver-status-filter">
                  Status
                </label>
                <select
                  id="driver-status-filter"
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
                <label className="fleet-label">Quick Actions</label>
                <div className="fleet-actions-inline">
                  <button type="button" className="fleet-btn fleet-btn-secondary" onClick={refreshDrivers}>
                    <TuneOutlinedIcon sx={{ fontSize: 18 }} />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            <div className="fleet-table-card">
              {loading ? (
                <Loader fullHeight label="Loading drivers" sublabel="Syncing drivers and linked vehicles..." />
              ) : filteredDrivers.length === 0 ? (
                <EmptyStatePanel
                  icon={PeopleAltOutlinedIcon}
                  title={drivers.length === 0 ? "No drivers yet" : "No drivers match the current filters"}
                  description={
                    drivers.length === 0
                      ? "Create the first driver record to begin assigning vehicles and tracking records."
                      : "Try clearing search and status filters, or create a new driver record."
                  }
                  action={emptyStateAction}
                />
              ) : (
                <div className="fleet-table-scroll">
                  <div
                    className="fleet-table"
                    style={{
                      "--fleet-columns": "1.05fr 1.9fr 1.3fr 1.5fr 1.2fr 1.1fr 1.15fr 152px",
                    }}
                  >
                    <div className="fleet-table-header">
                      <div className="fleet-table-header-cell">Driver ID</div>
                      <div className="fleet-table-header-cell">Full Name</div>
                      <div className="fleet-table-header-cell">Display Name</div>
                      <div className="fleet-table-header-cell">Aliases</div>
                      <div className="fleet-table-header-cell">Status</div>
                      <div className="fleet-table-header-cell">Assigned Vehicles</div>
                      <div className="fleet-table-header-cell">Created</div>
                      <div className="fleet-table-header-cell">Actions</div>
                    </div>

                    {filteredDrivers.map((driver) => {
                      const lifecycle = getLifecycleLabel(driver.isActive);
                      const driverVehicles = vehicles.filter(
                        (vehicle) =>
                          String(vehicle.driverId || "") === String(driver.driver_id || driver.id || ""),
                      );

                      return (
                        <div key={driver.id} className="fleet-table-row">
                          <div
                            className="fleet-table-cell fleet-mono"
                            data-label="Driver ID"
                            title={driver.driver_id || driver.id}
                          >
                            {driver.driver_id || formatEntityId("DRV", driver.id)}
                          </div>
                          <div className="fleet-table-cell" data-label="Full Name">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{getDriverFullName(driver) || "Unnamed Driver"}</div>
                              <div className="fleet-cell-subtitle">
                                {driver.licenseNumber ? `License ${driver.licenseNumber}` : "No license number recorded"}
                              </div>
                            </div>
                          </div>
                          <div className="fleet-table-cell" data-label="Display Name">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{getDriverDisplayName(driver) || "Not set"}</div>
                              <div className="fleet-cell-subtitle">
                                {driver.teamName ? driver.teamName : "Mapped to team/display field"}
                              </div>
                            </div>
                          </div>
                          <div className="fleet-table-cell" data-label="Aliases">
                            {driver.aliases?.length ? (
                              <div className="fleet-pill-list">
                                {driver.aliases.slice(0, 2).map((alias) => (
                                  <span key={alias} className="fleet-pill fleet-pill-accent">
                                    {alias}
                                  </span>
                                ))}
                                {driver.aliases.length > 2 ? (
                                  <span className="fleet-pill">{`+${driver.aliases.length - 2}`}</span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="fleet-muted">None</span>
                            )}
                          </div>
                          <div className="fleet-table-cell" data-label="Status">
                            <StatusBadge label={lifecycle.label} tone={lifecycle.tone} />
                          </div>
                          <div className="fleet-table-cell" data-label="Assigned Vehicles">
                            {driverVehicles.length ? (
                              <span className="fleet-pill fleet-pill-success">
                                {driverVehicles.length} vehicle{driverVehicles.length === 1 ? "" : "s"}
                              </span>
                            ) : (
                              <span className="fleet-muted">Not assigned</span>
                            )}
                          </div>
                          <div className="fleet-table-cell" data-label="Created">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{formatDate(driver.createdAt)}</div>
                              <div className="fleet-cell-subtitle">{formatDateTime(driver.updatedAt)}</div>
                            </div>
                          </div>
                          <div className="fleet-table-cell fleet-action-cell" data-label="Actions">
                            <div className="fleet-action-group">
                              <ActionIconButton
                                icon={VisibilityOutlinedIcon}
                                tone="view"
                                label="View Driver"
                                onClick={() => openViewDrawer(driver)}
                              />
                              <ActionIconButton
                                icon={EditOutlinedIcon}
                                tone="edit"
                                label="Edit Driver"
                                onClick={() => openEditDrawer(driver)}
                              />
                              <ActionIconButton
                                icon={ArchiveOutlinedIcon}
                                tone="danger"
                                label="Archive Driver"
                                onClick={() => handleArchiveDriver(driver)}
                                disabled={driver.isActive === false}
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
              ? "Create Driver"
              : drawerMode === "edit"
                ? "Edit Driver"
                : "Driver Details"
          }
          subtitle={
            drawerMode === "create"
              ? "Add a new driver record with display metadata and archive-safe history."
              : drawerMode === "edit"
                ? "Update the driver profile, assignment display, and status."
                : "Review the current driver record and assignment footprint."
          }
          meta={
            currentDriver ? (
              <>
                <StatusBadge
                  label={getLifecycleLabel(currentDriver.isActive).label}
                  tone={getLifecycleLabel(currentDriver.isActive).tone}
                />
                <StatusBadge
                  label={`${assignedVehicles.length} linked vehicle${assignedVehicles.length === 1 ? "" : "s"}`}
                  tone={assignedVehicles.length ? "accent" : "neutral"}
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

          <DriverDrawerContent
            mode={drawerMode}
            driver={currentDriver}
            formValues={formValues}
            setFormValues={setFormValues}
            assignedVehicles={assignedVehicles}
            aliasDisabled={drawerMode === "view"}
          />
        </DrawerShell>

        <ConfirmDialog
          open={Boolean(archiveTarget)}
          title="Archive driver?"
          message={
            archiveTarget
              ? `Archive ${getDriverFullName(archiveTarget) || archiveTarget.id}? The record will remain visible in archived filters and can be reactivated later.`
              : ""
          }
          confirmLabel="Archive Driver"
          onConfirm={confirmArchiveDriver}
          onCancel={() => setArchiveTarget(null)}
          busy={archivingDriver}
          tone="danger"
          icon={WarningAmberOutlinedIcon}
          confirmTitle="Archive the selected driver"
        />
      </div>
    </ProtectedRoute>
  );
}
