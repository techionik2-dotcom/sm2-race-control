"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import Loader from "../../components/Common/Loader";
import StatusBadge from "../../components/Common/StatusBadge";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import {
  archiveTrack,
  createTrack,
  getTracks,
  updateTrack,
} from "../../utils/trackApi";
import {
  ActionIconButton,
  EmptyStatePanel,
  MetricCard,
} from "../fleet/_components/ManagementUi";
import TrackArchiveDialog from "./_components/TrackArchiveDialog";
import TrackFormDrawer from "./_components/TrackFormDrawer";
import {
  buildTrackPayload,
  createBlankTrackFormValues,
  formatDate,
  formatDateTime,
  getApiErrorMessage,
  getTrackDisplayName,
  getTrackLifecycle,
  getTrackName,
  getTrackSearchText,
  getTrackSummaryCounts,
  normalizeTrackShortCode,
  sortTracksByLatest,
  toTrackFormValues,
} from "./_components/trackManagementHelpers";
import "../fleet/fleetManagement.css";
import "./TrackManagement.css";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export default function TracksManagementPage() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create");
  const [drawerRecordId, setDrawerRecordId] = useState(null);
  const [formValues, setFormValues] = useState(createBlankTrackFormValues());
  const [drawerError, setDrawerError] = useState("");
  const [savingTrack, setSavingTrack] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archivingTrack, setArchivingTrack] = useState(false);

  const refreshTracks = useCallback(async () => {
    setLoading(true);
    setPageError("");

    try {
      const response = await getTracks({ includeArchived: true, syncLegacyStorage: true });
      setTracks(response.tracks || []);
    } catch (error) {
      setTracks([]);
      setPageError(getApiErrorMessage(error, "Failed to load tracks."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTracks();
  }, [refreshTracks]);

  useEffect(() => {
    if (!notice) return undefined;

    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const sortedTracks = useMemo(() => sortTracksByLatest(tracks), [tracks]);
  const summaryCounts = useMemo(() => getTrackSummaryCounts(sortedTracks), [sortedTracks]);

  const countryOptions = useMemo(() => {
    const values = new Set();

    sortedTracks.forEach((track) => {
      if (track.country) {
        values.add(track.country);
      }
    });

    return Array.from(values).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [sortedTracks]);

  const filteredTracks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortedTracks.filter((track) => {
      const lifecycle = getTrackLifecycle(track);

      if (statusFilter !== "all" && lifecycle.key !== statusFilter) {
        return false;
      }

      if (countryFilter !== "all" && track.country !== countryFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return getTrackSearchText(track).includes(query);
    });
  }, [countryFilter, searchQuery, sortedTracks, statusFilter]);

  const currentTrack = useMemo(
    () => sortedTracks.find((track) => String(track.id) === String(drawerRecordId)) || null,
    [drawerRecordId, sortedTracks],
  );

  useEffect(() => {
    if (drawerOpen && currentTrack && drawerMode !== "create") {
      setFormValues(toTrackFormValues(currentTrack));
    }
  }, [currentTrack, drawerMode, drawerOpen]);

  const openCreateDrawer = () => {
    setDrawerMode("create");
    setDrawerRecordId(null);
    setFormValues(createBlankTrackFormValues());
    setDrawerError("");
    setDrawerOpen(true);
  };

  const openEditDrawer = (track) => {
    setDrawerMode("edit");
    setDrawerRecordId(track.id);
    setFormValues(toTrackFormValues(track));
    setDrawerError("");
    setDrawerOpen(true);
  };

  const openViewDrawer = (track) => {
    setDrawerMode("view");
    setDrawerRecordId(track.id);
    setFormValues(toTrackFormValues(track));
    setDrawerError("");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (savingTrack) return;
    setDrawerOpen(false);
    setDrawerError("");
    setDrawerRecordId(null);
  };

  const handleSaveTrack = async (event) => {
    event.preventDefault();
    setDrawerError("");
    setSavingTrack(true);

    const payload = buildTrackPayload(formValues);

    if (!payload.track_name || !payload.short_code || !payload.country) {
      setDrawerError("Track name, short code, and country are required.");
      setSavingTrack(false);
      return;
    }

    if (
      payload.latitude !== null &&
      (payload.latitude < -90 || payload.latitude > 90)
    ) {
      setDrawerError("Latitude must be between -90 and 90.");
      setSavingTrack(false);
      return;
    }

    if (
      payload.longitude !== null &&
      (payload.longitude < -180 || payload.longitude > 180)
    ) {
      setDrawerError("Longitude must be between -180 and 180.");
      setSavingTrack(false);
      return;
    }

    const normalizedName = payload.track_name.toLowerCase();
    const normalizedCode = normalizeTrackShortCode(payload.short_code);
    const duplicateTrack = tracks.find((track) => {
      if (currentTrack?.id && String(track.id) === String(currentTrack.id)) {
        return false;
      }

      const existingName = String(getTrackName(track)).trim().toLowerCase();
      const existingCode = normalizeTrackShortCode(track.shortCode || track.short_code || "");

      return existingName === normalizedName || existingCode === normalizedCode;
    });

    if (duplicateTrack) {
      setDrawerError(
        `A track with the same name or short code already exists (${getTrackDisplayName(duplicateTrack)} / ${duplicateTrack.shortCode || duplicateTrack.short_code || "No code"}).`,
      );
      setSavingTrack(false);
      return;
    }

    try {
      if (drawerMode === "create") {
        await createTrack(payload);
      } else if (currentTrack?.id) {
        await updateTrack(currentTrack.id, payload);
      } else {
        throw new Error("Track record could not be resolved.");
      }

      setNotice({
        type: "success",
        title: drawerMode === "create" ? "Track created" : "Track updated",
        message: `${payload.display_name || payload.track_name} is ready for standardized event use.`,
      });
      setDrawerOpen(false);
      setDrawerRecordId(null);
      await refreshTracks();
    } catch (error) {
      setDrawerError(getApiErrorMessage(error, "Failed to save track."));
    } finally {
      setSavingTrack(false);
    }
  };

  const handleArchiveTrack = (track) => {
    setArchiveTarget(track);
  };

  const confirmArchiveTrack = async () => {
    if (!archiveTarget?.id) return;

    setArchivingTrack(true);

    try {
      await archiveTrack(archiveTarget.id);
      setNotice({
        type: "warning",
        title: "Track archived",
        message: `${archiveTarget.trackName || archiveTarget.displayName || archiveTarget.id} has been archived and remains filterable.`,
      });

      if (drawerRecordId && String(drawerRecordId) === String(archiveTarget.id)) {
        setDrawerMode("view");
        setFormValues((current) => ({ ...current, status: "archived" }));
      }

      await refreshTracks();
    } catch (error) {
      setNotice({
        type: "danger",
        title: "Archive failed",
        message: getApiErrorMessage(error, "The track could not be archived."),
      });
    } finally {
      setArchivingTrack(false);
      setArchiveTarget(null);
    }
  };

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setCountryFilter("all");
  };

  const emptyStateAction = filteredTracks.length === 0 ? (
    <div className="fleet-actions-inline">
      <button type="button" className="fleet-btn fleet-btn-secondary" onClick={resetFilters}>
        Clear Filters
      </button>
      <button type="button" className="fleet-btn fleet-btn-primary" onClick={openCreateDrawer}>
        + Create Track
      </button>
    </div>
  ) : null;

  return (
    <ProtectedRoute requireOwner={true}>
      <div className="fleet-page">
        <div className="fleet-page-shell">
          <header className="fleet-page-header">
            <div className="fleet-page-heading">
              <h1 className="fleet-page-title">Track Management</h1>
              <p className="fleet-page-subtitle">
                Manage official track records used across events and race submissions. Keep track names
                standardized, archived history visible, and master data clean.
              </p>
            </div>

            <div className="fleet-page-actions">
              <button type="button" className="fleet-btn fleet-btn-primary" onClick={openCreateDrawer}>
                <AddOutlinedIcon sx={{ fontSize: 18 }} />
                + Create Track
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
                <button type="button" className="fleet-btn fleet-btn-secondary" onClick={refreshTracks}>
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          <div className="fleet-summary-grid">
            <MetricCard
              icon={RouteOutlinedIcon}
              value={summaryCounts.total}
              label="Total Tracks"
              helper="All master track records, including archived history."
              tone="accent"
            />
            <MetricCard
              icon={CheckCircleOutlineOutlinedIcon}
              value={summaryCounts.active}
              label="Active Tracks"
              helper="Available for events and future submissions."
              tone="success"
            />
            <MetricCard
              icon={ArchiveOutlinedIcon}
              value={summaryCounts.archived}
              label="Archived Tracks"
              helper="Retained for audit and historical filtering."
              tone="danger"
            />
            <MetricCard
              icon={PublicOutlinedIcon}
              value={summaryCounts.countries}
              label="Countries Represented"
              helper="Unique countries captured in the catalog."
              tone="neutral"
            />
          </div>

          <section className="fleet-page-section">
            <div className="fleet-section-header">
              <div>
                <h2 className="fleet-section-title">Track Directory</h2>
                <p className="fleet-section-subtitle">
                  Search by track name, display name, code, country, or notes. Archive keeps the master
                  record visible for history and reporting.
                </p>
              </div>
            </div>

            <div className="fleet-toolbar">
              <div className="fleet-field fleet-search-field tracks-toolbar-search">
                <label className="fleet-label" htmlFor="track-search">
                  Search
                </label>
                <SearchOutlinedIcon className="fleet-search-icon" fontSize="small" />
                <input
                  id="track-search"
                  className="fleet-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search tracks by name, display name, code, country, or notes..."
                  autoComplete="off"
                />
              </div>

              <div className="fleet-field tracks-toolbar-status">
                <label className="fleet-label" htmlFor="track-status-filter">
                  Status
                </label>
                <select
                  id="track-status-filter"
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

              <div className="fleet-field tracks-toolbar-country">
                <label className="fleet-label" htmlFor="track-country-filter">
                  Country
                </label>
                <select
                  id="track-country-filter"
                  className="fleet-select"
                  value={countryFilter}
                  onChange={(event) => setCountryFilter(event.target.value)}
                >
                  <option value="all">All Countries</option>
                  {countryOptions.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fleet-field tracks-toolbar-actions-field">
                <label className="fleet-label">Quick Actions</label>
                <div className="fleet-actions-inline tracks-toolbar-actions">
                  <button type="button" className="fleet-btn fleet-btn-secondary" onClick={resetFilters}>
                    Clear Filters
                  </button>
                  <button type="button" className="fleet-btn fleet-btn-secondary" onClick={refreshTracks}>
                    <TuneOutlinedIcon sx={{ fontSize: 18 }} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="tracks-toolbar-meta">
                <span className="tracks-toolbar-count">
                  Showing {filteredTracks.length} of {summaryCounts.total} tracks
                </span>
                <div className="fleet-actions-inline">
                  <button type="button" className="fleet-btn fleet-btn-primary" onClick={openCreateDrawer}>
                    + Create Track
                  </button>
                </div>
              </div>
            </div>

            <div className="fleet-table-card">
              {loading ? (
                <Loader fullHeight label="Loading tracks" sublabel="Syncing master track records and archive history..." />
              ) : filteredTracks.length === 0 ? (
                <EmptyStatePanel
                  icon={RouteOutlinedIcon}
                  title={tracks.length === 0 ? "No tracks yet" : "No tracks match the current filters"}
                  description={
                    tracks.length === 0
                      ? "Create the first master track record to keep event setup standardized."
                      : "Try clearing the filters or add a new track record to expand the catalogue."
                  }
                  action={emptyStateAction}
                />
              ) : (
                <div className="fleet-table-scroll">
                  <div
                    className="fleet-table"
                    style={{
                      "--fleet-columns": "1.5fr 1.35fr 0.95fr 1fr 0.9fr 1.2fr 152px",
                    }}
                  >
                    <div className="fleet-table-header">
                      <div className="fleet-table-header-cell">Track Name</div>
                      <div className="fleet-table-header-cell">Display Name</div>
                      <div className="fleet-table-header-cell">Short Code</div>
                      <div className="fleet-table-header-cell">Country</div>
                      <div className="fleet-table-header-cell">Status</div>
                      <div className="fleet-table-header-cell">Created Date</div>
                      <div className="fleet-table-header-cell">Actions</div>
                    </div>

                    {filteredTracks.map((track) => {
                      const lifecycle = getTrackLifecycle(track);
                      const trackName = track.trackName || track.track_name || "Unnamed Track";
                      const displayName = getTrackDisplayName(track) || "Not set";
                      const shortCode = track.shortCode || track.short_code || "Not set";

                      return (
                        <div
                          key={track.id}
                          className={`fleet-table-row ${track.isActive === false ? "tracks-row-archived" : ""}`}
                        >
                          <div className="fleet-table-cell" data-label="Track Name">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{trackName}</div>
                              <div className="fleet-cell-subtitle">Official master record</div>
                            </div>
                          </div>
                          <div className="fleet-table-cell" data-label="Display Name">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{displayName}</div>
                              <div className="fleet-cell-subtitle">Used in event forms</div>
                            </div>
                          </div>
                          <div className="fleet-table-cell" data-label="Short Code">
                            {shortCode !== "Not set" ? (
                              <span className="fleet-pill fleet-pill-accent">{shortCode}</span>
                            ) : (
                              <span className="fleet-muted">Not set</span>
                            )}
                          </div>
                          <div className="fleet-table-cell" data-label="Country">
                            {track.country ? (
                              <span className="fleet-pill">{track.country}</span>
                            ) : (
                              <span className="fleet-muted">Not set</span>
                            )}
                          </div>
                          <div className="fleet-table-cell" data-label="Status">
                            <StatusBadge label={lifecycle.label} tone={lifecycle.tone} />
                          </div>
                          <div className="fleet-table-cell" data-label="Created Date">
                            <div className="fleet-cell-stack">
                              <div className="fleet-cell-title">{formatDate(track.createdAt)}</div>
                              <div className="fleet-cell-subtitle">{formatDateTime(track.updatedAt)}</div>
                            </div>
                          </div>
                          <div className="fleet-table-cell fleet-action-cell" data-label="Actions">
                            <div className="fleet-action-group">
                              <ActionIconButton
                                icon={VisibilityOutlinedIcon}
                                tone="view"
                                label="View Track"
                                onClick={() => openViewDrawer(track)}
                              />
                              <ActionIconButton
                                icon={EditOutlinedIcon}
                                tone="edit"
                                label="Edit Track"
                                onClick={() => openEditDrawer(track)}
                              />
                              <ActionIconButton
                                icon={ArchiveOutlinedIcon}
                                tone="danger"
                                label="Archive Track"
                                onClick={() => handleArchiveTrack(track)}
                                disabled={track.isActive === false}
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

        <TrackFormDrawer
          open={drawerOpen}
          mode={drawerMode}
          track={currentTrack}
          values={formValues}
          onChange={(field, value) =>
            setFormValues((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onClose={closeDrawer}
          onSubmit={handleSaveTrack}
          onEditTrack={(track) => {
            if (track) {
              openEditDrawer(track);
            }
          }}
          onArchiveTrack={handleArchiveTrack}
          isSaving={savingTrack}
          error={drawerError}
          countryOptions={countryOptions}
        />

        <TrackArchiveDialog
          open={Boolean(archiveTarget)}
          trackName={archiveTarget?.trackName || archiveTarget?.displayName || "this track"}
          shortCode={archiveTarget?.shortCode || archiveTarget?.short_code || ""}
          onClose={() => setArchiveTarget(null)}
          onConfirm={confirmArchiveTrack}
          isSaving={archivingTrack}
        />
      </div>
    </ProtectedRoute>
  );
}
