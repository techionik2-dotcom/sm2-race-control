"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppSelect from "@/components/ui/app-select";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import PinDropRoundedIcon from "@mui/icons-material/PinDropRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import ProtectedRoute from "../components/ProtectedRoute";
import Loader from "../components/Common/Loader";
import StatusBadge from "../components/Common/StatusBadge";
import { getEvents, selectActiveEvent } from "../utils/eventApi";
import { getRunGroup } from "../utils/runGroupApi";
import "./EventList.css";

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

const SORT_OPTIONS = [
  { value: "latest", label: "Latest" },
  { value: "upcoming", label: "Upcoming" },
  { value: "alpha", label: "Alphabetical" },
];

const getEventId = (event) => {
  if (typeof event === "string" || typeof event === "number") {
    const normalized = String(event).trim();
    return normalized || null;
  }

  return event?.id || event?._id || event?.eventId || event?.event_id || null;
};

const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]) - 1;
      const day = Number(dateOnlyMatch[3]);
      return new Date(year, month, day, 12, 0, 0);
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = parseDateValue(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatDateTime = (value) => {
  const date = parseDateValue(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatDateRange = (startDate, endDate) => {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  if (start === "-" && end === "-") return "-";
  if (start === end) return start;
  return `${start} - ${end}`;
};

const getEventLifecycle = (event, now = new Date()) => {
  if (!event) {
    return { key: "unknown", label: "Unknown", tone: "neutral" };
  }

  if (event.isActive === false) {
    return { key: "archived", label: "Archived", tone: "danger" };
  }

  const start = parseDateValue(event.startDate || event.start_date);
  const end = parseDateValue(event.endDate || event.end_date);

  if (!start || !end) {
    return { key: "unknown", label: "Unknown", tone: "neutral" };
  }

  if (now < start) {
    return { key: "upcoming", label: "Upcoming", tone: "info" };
  }

  if (now > end) {
    return { key: "completed", label: "Completed", tone: "neutral" };
  }

  return { key: "active", label: "Active", tone: "success" };
};

const getEventLifecycleOrder = (event) => {
  const order = {
    upcoming: 0,
    active: 1,
    completed: 2,
    archived: 3,
    unknown: 4,
  };

  return order[getEventLifecycle(event).key] ?? 4;
};

const sortEvents = (events = [], sortMode = "latest") => {
  const list = [...events];

  const byDateDesc = (left, right, key) =>
    (parseDateValue(right?.[key])?.getTime() || 0) -
    (parseDateValue(left?.[key])?.getTime() || 0);

  const byDateAsc = (left, right, key) =>
    (parseDateValue(left?.[key])?.getTime() || 0) -
    (parseDateValue(right?.[key])?.getTime() || 0);

  return list.sort((left, right) => {
    if (sortMode === "latest") {
      return (
        byDateDesc(left, right, "updatedAt") ||
        byDateDesc(left, right, "createdAt") ||
        byDateDesc(left, right, "startDate")
      );
    }

    if (sortMode === "upcoming") {
      return (
        getEventLifecycleOrder(left) - getEventLifecycleOrder(right) ||
        byDateAsc(left, right, "startDate") ||
        byDateDesc(left, right, "createdAt")
      );
    }

    return (
      String(left?.name || "").localeCompare(String(right?.name || ""), undefined, {
        sensitivity: "base",
      }) ||
      byDateDesc(left, right, "createdAt")
    );
  });
};

const getRunGroupDisplay = (runGroup) => {
  if (!runGroup) {
    return {
      configured: false,
      label: "Not Configured",
      value: "Not Configured",
    };
  }

  const value =
    runGroup.normalized ||
    runGroup.rawText ||
    runGroup.raw_text ||
    "Configured";

  return {
    configured: true,
    label: "Run Group Ready",
    value: String(value).trim() || "Configured",
  };
};

const getSummaryCounts = (events = []) => {
  const summary = {
    total: events.length,
    active: 0,
    upcoming: 0,
    ready: 0,
  };

  events.forEach((event) => {
    const lifecycle = getEventLifecycle(event).key;
    if (lifecycle === "active") summary.active += 1;
    if (lifecycle === "upcoming") summary.upcoming += 1;
    if (event.runGroup) summary.ready += 1;
  });

  return summary;
};

export default function EventList() {
  const router = useRouter();
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [trackFilter, setTrackFilter] = useState("all");
  const [sortMode, setSortMode] = useState("latest");

  const refreshEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      setPageError("");
      setNotice(null);

      const response = await getEvents();
      const eventsData = response.events || response.data || response || [];
      const baseEvents = Array.isArray(eventsData) ? eventsData : [];

      const eventsWithRunGroups = await Promise.all(
        baseEvents.map(async (event) => {
          const eventId = getEventId(event);
          if (!eventId) {
            return { ...event, runGroup: null };
          }

          try {
            const runGroup = await getRunGroup(eventId);
            return { ...event, runGroup };
          } catch (error) {
            return { ...event, runGroup: null };
          }
        }),
      );

      setEvents(eventsWithRunGroups);
    } catch (error) {
      console.error("Failed to load events:", error);
      setEvents([]);
      setPageError("Failed to load events. Please refresh and try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  useEffect(() => {
    if (!notice) return undefined;

    const timeout = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const summaryCounts = useMemo(() => getSummaryCounts(events), [events]);

  const trackOptions = useMemo(() => {
    const tracks = new Set();
    events.forEach((event) => {
      if (event.track) {
        tracks.add(event.track);
      }
    });

    return Array.from(tracks).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [events]);

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let nextEvents = [...events];

    if (query) {
      nextEvents = nextEvents.filter((event) => {
        const runGroup = event.runGroup;
        const haystack = [
          event.name,
          event.track,
          formatDateRange(event.startDate, event.endDate),
          runGroup?.rawText,
          runGroup?.raw_text,
          runGroup?.normalized,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      });
    }

    if (statusFilter !== "all") {
      nextEvents = nextEvents.filter(
        (event) => getEventLifecycle(event).key === statusFilter,
      );
    }

    if (trackFilter !== "all") {
      nextEvents = nextEvents.filter((event) => event.track === trackFilter);
    }

    return sortEvents(nextEvents, sortMode);
  }, [events, searchQuery, sortMode, statusFilter, trackFilter]);

  const handleSelectEvent = async (event) => {
    const eventId = getEventId(event);
    if (!eventId) return;

    if (!event.runGroup) {
      setNotice({
        type: "warning",
        message:
          "This event does not have a run group yet. Please ask the owner to complete setup before selecting it.",
      });
      return;
    }

    try {
      await selectActiveEvent(eventId);
      router.push(`/event/${eventId}`);
    } catch (error) {
      console.error("Failed to select event:", error);
      setNotice({
        type: "error",
        message:
          error?.detail ||
          error?.message ||
          "Unable to select this event right now. Please try again.",
      });
    }
  };

  const renderEventCard = (event) => {
    const eventId = getEventId(event);
    const lifecycle = getEventLifecycle(event);
    const runGroup = getRunGroupDisplay(event.runGroup);
    const canSelect = Boolean(eventId && runGroup.configured);
    const updatedLabel = event.updatedAt ? "Updated" : "Created";
    const updatedValue = formatDateTime(event.updatedAt || event.createdAt);

    return (
      <article
        key={eventId || `${event.name}-${event.track}`}
        className={`event-card ${!canSelect ? "event-card-muted" : ""}`}
        onClick={() => handleSelectEvent(event)}
        role="button"
        tabIndex={0}
        onKeyDown={(keyboardEvent) => {
          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
            keyboardEvent.preventDefault();
            handleSelectEvent(event);
          }
        }}
      >
        <div className="event-card-top-accent" />

        <div className="event-card-header">
          <div className="event-card-brand">
            <div className="event-card-icon" aria-hidden="true">
              <FlagRoundedIcon fontSize="inherit" />
            </div>

            <div className="event-card-title-group">
              <h3 className="event-name">{event.name || "Untitled Event"}</h3>
              <p className="event-tagline">
                {lifecycle.label} race weekend
              </p>
            </div>
          </div>

          <div className="event-card-badges">
            <StatusBadge label={lifecycle.label} tone={lifecycle.tone} />
            <StatusBadge
              label={runGroup.label}
              tone={runGroup.configured ? "success" : "warning"}
            />
          </div>
        </div>

        <div className="event-card-body">
          <div className="event-mini-grid">
            <div className="event-mini-card">
              <div className="event-mini-label">
                <PinDropRoundedIcon fontSize="inherit" />
                Track
              </div>
              <div className="event-mini-value">{event.track || "-"}</div>
            </div>

            <div className="event-mini-card">
              <div className="event-mini-label">
                <CalendarMonthRoundedIcon fontSize="inherit" />
                Date Range
              </div>
              <div className="event-mini-value">
                {formatDateRange(event.startDate, event.endDate)}
              </div>
            </div>

            <div className="event-mini-card">
              <div className="event-mini-label">
                <CheckCircleRoundedIcon fontSize="inherit" />
                Run Group
              </div>
              <div className="event-mini-value mono">{runGroup.value}</div>
            </div>

            <div className="event-mini-card">
              <div className="event-mini-label">
                <RefreshRoundedIcon fontSize="inherit" />
                {updatedLabel}
              </div>
              <div className="event-mini-value">{updatedValue}</div>
            </div>
          </div>

          <div
            className={`event-card-callout ${
              runGroup.configured ? "success" : "warning"
            }`}
          >
            {runGroup.configured ? (
              <>
                <CheckCircleRoundedIcon fontSize="inherit" />
                Drivers will see <strong>{runGroup.value}</strong> as the
                current run-group label.
              </>
            ) : (
              <>
                <WarningAmberRoundedIcon fontSize="inherit" />
                Run group is not configured yet. This event cannot be selected
                until owner setup is complete.
              </>
            )}
          </div>
        </div>

        <div className="event-card-footer">
          <button
            type="button"
            className={`btn ${canSelect ? "btn-primary" : "btn-secondary"} event-select-btn`}
            onClick={(keyboardEvent) => {
              keyboardEvent.stopPropagation();
              handleSelectEvent(event);
            }}
            disabled={!canSelect}
          >
            <span>{canSelect ? "Select Event" : "Run Group Missing"}</span>
            <ArrowForwardRoundedIcon fontSize="inherit" />
          </button>
        </div>
      </article>
    );
  };

  return (
    <ProtectedRoute requireDriver={true}>
      <div className="event-list-page">
        <div className="events-shell">
          <header className="events-hero">
            <div className="events-hero-copy">
              <div className="events-page-eyebrow">
                <FlagRoundedIcon fontSize="inherit" />
                Driver Operations
              </div>
              <h1 className="events-page-title">Select Your Event</h1>
              <p className="events-page-subtitle">
                Choose a race event to enter the submission workspace and view
                the configured run group.
              </p>
            </div>

            <div className="events-page-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={refreshEvents}
                disabled={isLoading}
              >
                <RefreshRoundedIcon fontSize="inherit" />
                Refresh
              </button>
            </div>
          </header>

          {pageError ? (
            <div className="page-banner error">
              <strong>Error.</strong>
              <span>{pageError}</span>
            </div>
          ) : null}

          {notice ? (
            <div className={`page-banner ${notice.type}`}>
              <strong>
                {notice.type === "success"
                  ? "Success."
                  : notice.type === "warning"
                    ? "Warning."
                    : "Error."}
              </strong>
              <span>{notice.message}</span>
            </div>
          ) : null}

          <section className="events-summary-grid">
            <div className="summary-card total">
              <div className="summary-card-label">Total Events</div>
              <div className="summary-card-value">{summaryCounts.total}</div>
              <div className="summary-card-note">
                Active race weekends available to drivers.
              </div>
            </div>

            <div className="summary-card active">
              <div className="summary-card-label">Active Events</div>
              <div className="summary-card-value">{summaryCounts.active}</div>
              <div className="summary-card-note">
                Events currently inside their live window.
              </div>
            </div>

            <div className="summary-card upcoming">
              <div className="summary-card-label">Upcoming Events</div>
              <div className="summary-card-value">{summaryCounts.upcoming}</div>
              <div className="summary-card-note">
                Scheduled events waiting to go live.
              </div>
            </div>

            <div className="summary-card ready">
              <div className="summary-card-label">Run Groups Ready</div>
              <div className="summary-card-value">{summaryCounts.ready}</div>
              <div className="summary-card-note">
                Events that are fully configured for submissions.
              </div>
            </div>
          </section>

          <section className="filters-card">
            <div className="filters-row">
              <div className="filters-group wide">
                <label className="filters-label" htmlFor="event-search">
                  Search
                </label>
                <div className="input-with-icon">
                  <SearchRoundedIcon className="input-icon" fontSize="small" />
                  <input
                    id="event-search"
                    className="input"
                    type="search"
                    placeholder="Search events, tracks, or run groups"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
              </div>

              <div className="filters-group">
                <label
                  id="event-status-filter-label"
                  className="filters-label"
                  htmlFor="event-status-filter"
                >
                  Status
                </label>
                <AppSelect
                  id="event-status-filter"
                  triggerClassName="input"
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value)}
                  options={STATUS_FILTER_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  ariaLabelledby="event-status-filter-label"
                />
              </div>

              <div className="filters-group">
                <label
                  id="event-track-filter-label"
                  className="filters-label"
                  htmlFor="event-track-filter"
                >
                  Track
                </label>
                <AppSelect
                  id="event-track-filter"
                  triggerClassName="input"
                  value={trackFilter}
                  onValueChange={(value) => setTrackFilter(value)}
                  options={[
                    { value: "all", label: "All Tracks" },
                    ...trackOptions.map((track) => ({
                      value: track,
                      label: track,
                    })),
                  ]}
                  ariaLabelledby="event-track-filter-label"
                />
              </div>

              <div className="filters-group">
                <label
                  id="event-sort-filter-label"
                  className="filters-label"
                  htmlFor="event-sort-filter"
                >
                  Sort
                </label>
                <AppSelect
                  id="event-sort-filter"
                  triggerClassName="input"
                  value={sortMode}
                  onValueChange={(value) => setSortMode(value)}
                  options={SORT_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  ariaLabelledby="event-sort-filter-label"
                />
              </div>
            </div>

            <div className="filters-footer">
              <div className="filters-summary">
                Showing {filteredEvents.length} of {events.length} events
              </div>

              <div className="filters-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setTrackFilter("all");
                    setSortMode("latest");
                  }}
                >
                  <FilterAltRoundedIcon fontSize="inherit" />
                  Clear Filters
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={refreshEvents}
                  disabled={isLoading}
                >
                  <RefreshRoundedIcon fontSize="inherit" />
                  Refresh
                </button>
              </div>
            </div>
          </section>

          <section className="events-section">
            <div className="events-section-header">
              <div>
                <h2 className="events-section-title">Available Events</h2>
                <p className="events-section-copy">
                  Select the race weekend that matches your session. Only
                  events with a configured run group can be opened.
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="events-loading-panel">
                <Loader
                  fullHeight={true}
                  label="Loading events"
                  sublabel="Syncing active events and run groups..."
                />
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="events-empty-state">
                <div className="events-empty-icon" aria-hidden="true">
                  <FlagRoundedIcon fontSize="inherit" />
                </div>
                <h3 className="events-empty-title">No events match your filters</h3>
                <p className="events-empty-copy">
                  Adjust the search, status, or track filters, then refresh the
                  list to try again.
                </p>
                <div className="events-empty-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                      setTrackFilter("all");
                      setSortMode("latest");
                    }}
                  >
                    Clear Filters
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={refreshEvents}
                  >
                    Refresh
                  </button>
                </div>
              </div>
            ) : (
              <div className="events-grid">{filteredEvents.map(renderEventCard)}</div>
            )}
          </section>
        </div>
      </div>
    </ProtectedRoute>
  );
}
