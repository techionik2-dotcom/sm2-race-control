"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DatasetOutlinedIcon from "@mui/icons-material/DatasetOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import EventOutlinedIcon from "@mui/icons-material/EventOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import ArrowDownwardOutlinedIcon from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowUpwardOutlinedIcon from "@mui/icons-material/ArrowUpwardOutlined";

import ProtectedRoute from "../../../components/ProtectedRoute";
import Loader from "../../../components/Common/Loader";
import StatusBadge from "../../../components/Common/StatusBadge";
import { EmptyStatePanel } from "../../fleet/_components/ManagementUi";
import {
  formatDate,
  formatDateTime,
  getApiErrorMessage,
} from "../../fleet/_components/fleetManagementHelpers";
import {
  buildSubmissionExportRows,
  buildSubmissionMonitorRecord,
  buildSubmissionSearchText,
  getSubmissionDriverLabel,
  getSubmissionEventLabel,
  getSubmissionId,
  getSubmissionTrackLabel,
  getSubmissionVehicleLabel,
  mockSubmissions,
} from "./submissionReviewHelpers";
import {
  getSessionEventTrackLabel,
  getSessionReportHref,
  getSessionSourceKey,
  getSessionSourceLabel,
  getSessionSourceSubtext,
  getSessionSourceTone,
} from "./sessionReviewUiHelpers";
import SubmissionReviewDrawer from "./SubmissionReviewDrawer";
import {
  getAllOcrDrafts,
  getAllSubmissions,
} from "../../../utils/submissionApi";
import "../../fleet/fleetManagement.css";
import "../SubmissionReview.css";

const SOURCE_FILTER_OPTIONS = [
  { value: "all", label: "All Sources" },
  { value: "ocr", label: "OCR" },
  { value: "voice", label: "Voice" },
  { value: "notes", label: "Notes" },
];

const TABLE_COLUMNS = [
  { key: "submissionId", label: "Submission ID", width: "minmax(140px, 0.95fr)", sortable: true },
  { key: "dateTime", label: "Date / Time", width: "minmax(160px, 1.1fr)", sortable: true },
  { key: "driver", label: "Driver", width: "minmax(190px, 1.2fr)", sortable: true },
  { key: "vehicle", label: "Vehicle", width: "minmax(170px, 1.08fr)", sortable: true },
  { key: "eventTrack", label: "Event / Track", width: "minmax(220px, 1.35fr)", sortable: true },
  { key: "submittedVia", label: "Submitted Via", width: "minmax(140px, 0.88fr)", sortable: true },
  { key: "actions", label: "Actions", width: "minmax(360px, 1.65fr)", sortable: false },
];

const TABLE_GRID_TEMPLATE = TABLE_COLUMNS.map((column) => column.width).join(" ");

const escapeTsvValue = (value) => String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");

const normalizeFilterValue = (value) => String(value ?? "").trim().toLowerCase();
const isDisplayValue = (value) => {
  const text = String(value ?? "").trim();
  return Boolean(text && text !== "-");
};

const buildUniqueFilterOptions = (records = [], getter) => {
  const map = new Map();

  records.forEach((record) => {
    const entry = getter(record);
    const value = normalizeFilterValue(entry?.value || "");
    const label = String(entry?.label || entry?.value || "").trim();

    if (!value || !label) {
      return;
    }

    if (!map.has(value)) {
      map.set(value, label);
    }
  });

  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
};

const getRowSortValue = (record, key) => {
  switch (key) {
    case "submissionId":
      return String(getSubmissionId(record) || "");
    case "dateTime":
      return new Date(record.submittedAt || record.createdAt || record.updatedAt || 0).getTime();
    case "driver":
      return String(getSubmissionDriverLabel(record) || "");
    case "vehicle":
      return String(getSubmissionVehicleLabel(record) || "");
    case "eventTrack":
      return String(getSubmissionEventLabel(record) || "");
    case "submittedVia":
      return String(getSessionSourceLabel(record) || "");
    default:
      return String(record?.[key] || "");
  }
};

const getSubmissionDateTimeText = (record) => {
  const sessionDate = formatDate(record.sessionDateLabel || record.submittedAt || record.createdAt);
  const sessionTime = record.sessionTimeLabel ? String(record.sessionTimeLabel).trim() : "";

  if (isDisplayValue(sessionDate) && sessionTime) {
    return `${sessionDate} · ${sessionTime}`;
  }

  if (isDisplayValue(sessionDate)) {
    return sessionDate;
  }

  const submittedAt = isDisplayValue(record.submittedAtLabel)
    ? record.submittedAtLabel
    : formatDateTime(record.submittedAt || record.createdAt || record.updatedAt);

  return isDisplayValue(submittedAt) ? submittedAt : "Not available";
};

const getSubmissionDriverFilterValue = (record) =>
  normalizeFilterValue(record.driverCode || record.data?.driver_id || getSubmissionDriverLabel(record));

const getSubmissionEventFilterValue = (record) =>
  normalizeFilterValue(record.event?.id || record.eventId || record.event_id || getSubmissionEventLabel(record));

const getSubmissionSourceFilterValue = (record) => {
  const sourceKey = getSessionSourceKey(record);
  return sourceKey === "unknown" ? "notes" : sourceKey;
};

const buildReportHref = (record, edit = false) => {
  const href = getSessionReportHref(record, { edit });
  return href || "";
};

const RowActionButton = ({ label, icon: Icon, tone = "neutral", primary = false, onClick, disabled = false }) => (
  <button
    type="button"
    className={`submission-row-action ${primary ? "is-primary" : ""} tone-${tone}`.trim()}
    onClick={onClick}
    disabled={disabled}
  >
    {Icon ? <Icon fontSize="inherit" /> : null}
    <span>{label}</span>
  </button>
);

const formatSourceLabel = (record) => {
  const sourceLabel = getSessionSourceLabel(record);
  const sourceTone = getSessionSourceTone(record);

  return { label: sourceLabel, tone: sourceTone };
};

const getEmptyStateCopy = (hasFilters) =>
  hasFilters
    ? {
        title: "No sessions match your filters",
        description: "Try widening the date range or clearing the current filters to review more driver sessions.",
      }
    : {
        title: "No sessions yet",
        description: "Incoming driver submissions will appear here as row-based sessions once they arrive.",
      };

export default function SessionReviewPage() {
  const router = useRouter();

  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [driverFilter, setDriverFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState("dateTime");
  const [sortDirection, setSortDirection] = useState("desc");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
  const [drawerFocus, setDrawerFocus] = useState("overview");

  const showDemoSubmission = useCallback((message) => {
    if (!mockSubmissions.length) return;

    setSubmissions(mockSubmissions.slice(0, 1));
    setPageError("");
    setNotice({
      tone: "warning",
      message,
    });

    const demoId = getSubmissionId(mockSubmissions[0]);
    if (demoId) {
      setSelectedSubmissionId(demoId);
      setDrawerFocus("overview");
      setDrawerOpen(true);
    }
  }, []);

  const refreshMonitor = useCallback(async ({ showSpinner = true } = {}) => {
    try {
      if (showSpinner) {
        setLoading(true);
      }
      setPageError("");

      const [submissionResponse, draftResponse] = await Promise.all([
        getAllSubmissions(),
        getAllOcrDrafts(),
      ]);

      const list = Array.isArray(submissionResponse)
        ? submissionResponse
        : submissionResponse?.submissions || [];
      const draftList = Array.isArray(draftResponse) ? draftResponse : [];

      if (list.length === 0 && draftList.length === 0) {
        showDemoSubmission("No live submissions were returned, so a sample session is shown for inspection.");
        return;
      }

      setSubmissions(list);
    } catch (error) {
      console.error("Failed to load submissions:", error);

      if (getApiErrorMessage(error, "").toLowerCase().includes("network error")) {
        showDemoSubmission("The backend is unreachable right now, so a sample session is shown for inspection.");
        return;
      }

      setSubmissions([]);
      setPageError(getApiErrorMessage(error, "Failed to load submissions."));
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }, [showDemoSubmission]);

  useEffect(() => {
    refreshMonitor();
  }, [refreshMonitor]);

  useEffect(() => {
    if (!notice) return undefined;

    const timeout = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const submissionRecords = useMemo(
    () => submissions.map((submission) => buildSubmissionMonitorRecord(submission, submissions)).filter(Boolean),
    [submissions],
  );

  const driverOptions = useMemo(
    () =>
      buildUniqueFilterOptions(submissionRecords, (record) => {
        const driverName = getSubmissionDriverLabel(record);
        const code = record.driverCode || record.data?.driver_id || "";
        return {
          value: code || driverName,
          label: code ? `${code} · ${driverName}` : driverName,
        };
      }),
    [submissionRecords],
  );

  const eventOptions = useMemo(
    () =>
      buildUniqueFilterOptions(submissionRecords, (record) => {
        const eventLabel = getSubmissionEventLabel(record);
        const trackLabel = getSubmissionTrackLabel(record);
        return {
          value: record.event?.id || record.eventId || record.event_id || eventLabel,
          label: trackLabel && trackLabel !== eventLabel ? `${eventLabel} · ${trackLabel}` : eventLabel,
        };
      }),
    [submissionRecords],
  );

  const filteredSubmissions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;

    let next = [...submissionRecords];

    if (query) {
      next = next.filter((record) => buildSubmissionSearchText(record).includes(query));
    }

    if (driverFilter !== "all") {
      next = next.filter((record) => getSubmissionDriverFilterValue(record) === driverFilter);
    }

    if (eventFilter !== "all") {
      next = next.filter((record) => getSubmissionEventFilterValue(record) === eventFilter);
    }

    if (sourceFilter !== "all") {
      next = next.filter((record) => getSubmissionSourceFilterValue(record) === sourceFilter);
    }

    if (fromDate) {
      next = next.filter((record) => {
        const sessionDate = record.sessionDateLabel || record.submittedAt || record.createdAt || record.updatedAt;
        const parsed = sessionDate ? new Date(sessionDate) : null;
        return parsed && !Number.isNaN(parsed.getTime()) && parsed >= fromDate;
      });
    }

    if (toDate) {
      toDate.setHours(23, 59, 59, 999);
      next = next.filter((record) => {
        const sessionDate = record.sessionDateLabel || record.submittedAt || record.createdAt || record.updatedAt;
        const parsed = sessionDate ? new Date(sessionDate) : null;
        return parsed && !Number.isNaN(parsed.getTime()) && parsed <= toDate;
      });
    }

    return next.sort((left, right) => {
      const leftValue = getRowSortValue(left, sortKey);
      const rightValue = getRowSortValue(right, sortKey);

      if (typeof leftValue === "number" || typeof rightValue === "number") {
        const leftNumber = Number(leftValue || 0);
        const rightNumber = Number(rightValue || 0);
        return sortDirection === "asc" ? leftNumber - rightNumber : rightNumber - leftNumber;
      }

      const comparison = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [
    dateFrom,
    dateTo,
    driverFilter,
    eventFilter,
    searchQuery,
    sortDirection,
    sortKey,
    sourceFilter,
    submissionRecords,
  ]);

  const selectedSubmission = useMemo(
    () => submissionRecords.find((record) => String(getSubmissionId(record)) === String(selectedSubmissionId)) || null,
    [selectedSubmissionId, submissionRecords],
  );

  const hasFilters =
    Boolean(searchQuery.trim()) ||
    driverFilter !== "all" ||
    eventFilter !== "all" ||
    sourceFilter !== "all" ||
    dateFrom ||
    dateTo;

  const toggleSort = (key) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return currentKey;
      }

      setSortDirection("asc");
      return key;
    });
  };

  const openDrawer = (submission, focusSection = "overview") => {
    const id = getSubmissionId(submission);
    if (!id) return;

    setSelectedSubmissionId(id);
    setDrawerFocus(focusSection);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setDrawerFocus("overview");
  };

  const handleExportRows = (rows, fileName = "submission-review") => {
    const headers = [
      "Submission ID",
      "Date / Time",
      "Driver",
      "Vehicle",
      "Event",
      "Track",
      "Run Group",
      "Submitted Via",
    ];

    const delimiter = "\t";
    const rowsText = [
      headers.join(delimiter),
      ...rows.map((row) =>
        [
          row.submissionId,
          row.dateTime,
          row.driver,
          row.vehicle,
          row.event,
          row.track,
          row.runGroup,
          row.submittedVia,
        ]
          .map(escapeTsvValue)
          .join(delimiter),
      ),
    ].join("\n");

    const mimeType = "application/vnd.ms-excel;charset=utf-8;";
    const extension = "xls";
    const blob = new Blob([rowsText], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportAllSessions = () => {
    const exportSubmissions = filteredSubmissions;
    const rows = buildSubmissionExportRows(exportSubmissions);
    handleExportRows(rows, "submission-review-dashboard");
    setNotice({
      tone: "success",
      message: `Exported ${rows.length} session${rows.length === 1 ? "" : "s"} to Excel.`,
    });
  };

  const handleExportSubmissionExcel = (submission) => {
    const submissionId = getSubmissionId(submission) || "session";
    const rows = buildSubmissionExportRows([submission]);
    handleExportRows(rows, `submission-${submissionId}`);
    setNotice({
      tone: "success",
      message: `Exported ${submissionId} to Excel.`,
    });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setDriverFilter("all");
    setEventFilter("all");
    setSourceFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortKey("dateTime");
    setSortDirection("desc");
  };

  const renderSortableHeader = (column) => {
    const isActive = sortKey === column.key;
    const SortIcon = isActive ? (sortDirection === "asc" ? ArrowUpwardOutlinedIcon : ArrowDownwardOutlinedIcon) : null;

    return (
      <button
        key={column.key}
        type="button"
        className={`submission-sort-header ${column.sortable ? "is-sortable" : "is-static"} ${isActive ? "is-active" : ""}`}
        onClick={column.sortable ? () => toggleSort(column.key) : undefined}
        disabled={!column.sortable}
      >
        <span>{column.label}</span>
        {column.sortable ? (
          <span className="submission-sort-icon" aria-hidden="true">
            {SortIcon ? (
              <SortIcon fontSize="inherit" />
            ) : (
              <ArrowUpwardOutlinedIcon fontSize="inherit" className="submission-sort-icon-placeholder" />
            )}
          </span>
        ) : null}
      </button>
    );
  };

  const renderSubmissionCell = (submission, column) => {
    const submissionId = getSubmissionId(submission) || "-";
    const { label: sourceLabel, tone: sourceTone } = formatSourceLabel(submission);
    const eventTrack = getSessionEventTrackLabel(submission);
    const dateTimeText = getSubmissionDateTimeText(submission);
    const driverLabel = getSubmissionDriverLabel(submission);
    const vehicleLabel = getSubmissionVehicleLabel(submission);
    switch (column.key) {
      case "submissionId":
        return (
          <div className="submission-cell-stack">
            <strong className="submission-mono">{submission.submissionId || submissionId || "Not available"}</strong>
            <span className="submission-cell-subtext">
              {isDisplayValue(submission.sessionTypeLabel) ? submission.sessionTypeLabel : getSessionSourceSubtext(submission) || "Session"}
            </span>
          </div>
        );
      case "dateTime":
        return (
          <div className="submission-cell-stack">
            <strong>{dateTimeText}</strong>
            <span className="submission-cell-subtext">
              {isDisplayValue(submission.createdByLabel)
                ? submission.createdByLabel
                : getSessionSourceSubtext(submission) || "Owner portal"}
            </span>
          </div>
        );
      case "driver":
        return (
          <div className="submission-cell-stack">
            <strong>{driverLabel}</strong>
            <span className="submission-cell-subtext">
              {submission.driverCode || submission.data?.driver_id || "Driver submitted"}
            </span>
          </div>
        );
      case "vehicle":
        return (
          <div className="submission-cell-stack">
            <strong>{vehicleLabel}</strong>
            <span className="submission-cell-subtext">
              {submission.vehicleCode || submission.data?.vehicle_id || "Vehicle submitted"}
            </span>
          </div>
        );
      case "eventTrack":
        return (
          <div className="submission-cell-stack">
            <strong>{eventTrack.main}</strong>
            {eventTrack.sub ? <span className="submission-cell-subtext">{eventTrack.sub}</span> : null}
          </div>
        );
      case "submittedVia":
        return (
          <div className="submission-source-stack">
            <StatusBadge label={sourceLabel} tone={sourceTone} />
            <span className="submission-cell-subtext">{getSessionSourceSubtext(submission)}</span>
          </div>
        );
      case "actions": {
        const updateHref = buildReportHref(submission, true);

        return (
          <div className="submission-row-actions">
            <RowActionButton
              label="Update Session"
              icon={EditOutlinedIcon}
              primary={true}
              tone="accent"
              onClick={(event) => {
                event.stopPropagation();
                if (updateHref) {
                  router.push(updateHref);
                }
              }}
              disabled={!updateHref}
            />
            <RowActionButton
              label="View Session"
              icon={VisibilityOutlinedIcon}
              onClick={(event) => {
                event.stopPropagation();
                openDrawer(submission, "overview");
              }}
            />
            <RowActionButton
              label="Export Excel"
              icon={DownloadOutlinedIcon}
              onClick={(event) => {
                event.stopPropagation();
                handleExportSubmissionExcel(submission);
              }}
            />
          </div>
        );
      }
      default:
        return <strong>{submission[column.key] ?? "Not available"}</strong>;
    }
  };

  const emptyState = getEmptyStateCopy(hasFilters);

  return (
    <ProtectedRoute requireOwner={true}>
      <div className="submission-monitor-page fleet-page-shell">
        <div className="submission-monitor-orb submission-monitor-orb-one" />
        <div className="submission-monitor-orb submission-monitor-orb-two" />

        <header className="submission-monitor-header">
          <div className="submission-monitor-copy">
            <h1>Session Review</h1>
          </div>

          <div className="submission-monitor-header-actions">
            <button type="button" className="fleet-btn fleet-btn-secondary" onClick={() => refreshMonitor()}>
              <RefreshOutlinedIcon fontSize="inherit" />
              Refresh Monitor
            </button>
            {!drawerOpen ? (
              <>
                <button type="button" className="fleet-btn fleet-btn-primary" onClick={handleExportAllSessions}>
                  <DownloadOutlinedIcon fontSize="inherit" />
                  Export Excel
                </button>
              </>
            ) : null}
          </div>
        </header>
        <section className="submission-monitor-filter-panel">
          <div className="submission-monitor-filter-grid">
            <div className="fleet-field submission-filter-search">
              <label className="fleet-label" htmlFor="submission-search">
                Search
              </label>
              <div className="submission-search-wrap">
                <SearchOutlinedIcon fontSize="small" />
                <input
                  id="submission-search"
                  className="fleet-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search submission ID, driver, vehicle, event, track, notes, or raw text..."
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="fleet-field">
              <label className="fleet-label" htmlFor="submission-driver-filter">
                Driver
              </label>
              <select
                id="submission-driver-filter"
                className="fleet-select"
                value={driverFilter}
                onChange={(event) => setDriverFilter(event.target.value)}
              >
                <option value="all">All Drivers</option>
                {driverOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="fleet-field">
              <label className="fleet-label" htmlFor="submission-event-filter">
                Event
              </label>
              <select
                id="submission-event-filter"
                className="fleet-select"
                value={eventFilter}
                onChange={(event) => setEventFilter(event.target.value)}
              >
                <option value="all">All Events</option>
                {eventOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="fleet-field">
              <label className="fleet-label" htmlFor="submission-source-filter">
                Submission Source
              </label>
              <select
                id="submission-source-filter"
                className="fleet-select"
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
              >
                {SOURCE_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="fleet-field">
              <label className="fleet-label" htmlFor="submission-date-from">
                From Date
              </label>
              <input
                id="submission-date-from"
                className="fleet-input"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>

            <div className="fleet-field">
              <label className="fleet-label" htmlFor="submission-date-to">
                To Date
              </label>
              <input
                id="submission-date-to"
                className="fleet-input"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
          </div>

          <div className="submission-monitor-filter-actions">
            <div className="submission-monitor-filter-hint">
              <TuneOutlinedIcon fontSize="small" />
              Showing {filteredSubmissions.length} of {submissionRecords.length} sessions
            </div>

            <div className="submission-monitor-button-row">
              <button
                type="button"
                className="fleet-btn fleet-btn-secondary"
                onClick={clearFilters}
                disabled={!hasFilters}
              >
                Clear Filters
              </button>
              <button type="button" className="fleet-btn fleet-btn-primary" onClick={() => refreshMonitor({ showSpinner: true })}>
                <RefreshOutlinedIcon fontSize="inherit" />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {notice ? <div className={`submission-monitor-notice submission-monitor-notice-${notice.tone}`}>{notice.message}</div> : null}

        {pageError ? <div className="submission-monitor-error">{pageError}</div> : null}

        <section className="submission-table-section">
          {loading ? (
            <Loader label="Loading submissions" sublabel="Fetching the latest session data." fullHeight />
          ) : filteredSubmissions.length ? (
            <div className="fleet-table-card submission-sheet-card">
              <div className="fleet-table-scroll">
                <div className="fleet-table submission-table submission-sheet-table">
                  <div className="fleet-table-header submission-table-header" style={{ gridTemplateColumns: TABLE_GRID_TEMPLATE }}>
                    {TABLE_COLUMNS.map((column) => renderSortableHeader(column))}
                  </div>

                  {filteredSubmissions.map((submission) => {
                    const rowId = getSubmissionId(submission);
                    const isSelected = String(selectedSubmissionId) === String(rowId);

                    return (
                      <div
                        key={rowId || submission.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open session ${rowId || submission.submissionId || "record"}`}
                        className={`fleet-table-row submission-table-row ${isSelected ? "is-selected" : ""}`}
                        style={{ gridTemplateColumns: TABLE_GRID_TEMPLATE }}
                        onClick={() => openDrawer(submission, "overview")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openDrawer(submission, "overview");
                          }
                        }}
                      >
                        {TABLE_COLUMNS.map((column) => (
                          <div key={column.key} className="fleet-table-cell" data-label={column.label}>
                            {renderSubmissionCell(submission, column)}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <EmptyStatePanel
              icon={hasFilters ? DatasetOutlinedIcon : EventOutlinedIcon}
              title={emptyState.title}
              description={emptyState.description}
              action={
                hasFilters ? (
                  <>
                    <button type="button" className="fleet-btn fleet-btn-secondary" onClick={clearFilters}>
                      Clear Filters
                    </button>
                    <button type="button" className="fleet-btn fleet-btn-primary" onClick={() => refreshMonitor({ showSpinner: true })}>
                      Refresh Monitor
                    </button>
                  </>
                ) : (
                  <button type="button" className="fleet-btn fleet-btn-primary" onClick={() => refreshMonitor({ showSpinner: true })}>
                    Refresh Monitor
                  </button>
                )
              }
            />
          )}
        </section>
      </div>

      <SubmissionReviewDrawer
        open={drawerOpen}
        submission={selectedSubmission}
        allSubmissions={submissionRecords}
        focusSection={drawerFocus}
        onClose={closeDrawer}
        onExportCurrent={() => {
          if (selectedSubmission) {
            handleExportSubmissionExcel(selectedSubmission);
          }
        }}
      />
    </ProtectedRoute>
  );
}
