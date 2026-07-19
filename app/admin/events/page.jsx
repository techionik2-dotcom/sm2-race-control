"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import EmptyState from "../../components/Common/EmptyState";
import Loader from "../../components/Common/Loader";
import StatusBadge from "../../components/Common/StatusBadge";
import {
  archiveEvent,
  createEvent,
  getEvents,
  updateEvent,
} from "../../utils/eventApi";
import { getRunGroup, setRunGroup, updateRunGroup } from "../../utils/runGroupApi";
import EventFormDrawer from "./_components/EventFormDrawer";
import EventArchiveDialog from "./_components/EventArchiveDialog";
import {
  createBlankEventFormValues,
  formatDateRange,
  formatDateTime,
  getApiErrorMessage,
  getEventId,
  getEventLifecycle,
  getEventSummaryCounts,
  getRunGroupPreview,
  getRunGroupStatus,
  isNotFoundError,
  mergeStoredEventNotesList,
  setStoredEventNote,
  sortAdminEvents,
  toEventFormValues,
} from "./_components/eventManagementHelpers";
import "./eventModule.css";

const FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

const SORT_OPTIONS = [
  { value: "latest", label: "Latest" },
  { value: "upcoming", label: "Upcoming" },
  { value: "oldest", label: "Oldest" },
];

const NOTICE_COPY = {
  success: "success",
  warning: "warning",
  error: "error",
};

export default function EventsManagementPage() {
  const router = useRouter();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [trackFilter, setTrackFilter] = useState("all");
  const [sortMode, setSortMode] = useState("latest");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create");
  const [drawerValues, setDrawerValues] = useState(createBlankEventFormValues());
  const [drawerEvent, setDrawerEvent] = useState(null);
  const [drawerError, setDrawerError] = useState("");
  const [savingEvent, setSavingEvent] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);

  const refreshEvents = useCallback(async () => {
    try {
      setLoading(true);
      setPageError("");

      const response = await getEvents();
      const baseEvents = mergeStoredEventNotesList(response.events || []);

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
            if (!isNotFoundError(error)) {
              console.warn("Run group lookup failed for admin event card:", {
                eventId,
                error,
              });
            }

            return { ...event, runGroup: null };
          }
        }),
      );

      setEvents(eventsWithRunGroups);
    } catch (error) {
      setEvents([]);
      setPageError(getApiErrorMessage(error, "Failed to load events."));
    } finally {
      setLoading(false);
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

  const summaryCounts = useMemo(() => getEventSummaryCounts(events), [events]);

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
        const haystack = [
          event.name,
          event.track,
          event.notes,
          event.runGroup?.rawText,
          event.runGroup?.normalized,
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

    return sortAdminEvents(nextEvents, sortMode);
  }, [events, searchQuery, sortMode, statusFilter, trackFilter]);

  const openCreateDrawer = () => {
    setDrawerMode("create");
    setDrawerValues(createBlankEventFormValues());
    setDrawerEvent(null);
    setDrawerError("");
    setDrawerOpen(true);
  };

  const openEditDrawer = (event) => {
    setDrawerMode("edit");
    setDrawerValues(toEventFormValues(event));
    setDrawerEvent(event);
    setDrawerError("");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (savingEvent) return;
    setDrawerOpen(false);
    setDrawerError("");
    setDrawerEvent(null);
  };

  const handleDrawerChange = (field, value) => {
    setDrawerValues((current) => ({
      ...current,
      [field]: value,
    }));

    if (drawerError) {
      setDrawerError("");
    }
  };

  const syncRunGroup = useCallback(async (eventId, rawText) => {
    const payload = {
      eventId,
      rawText,
    };

    try {
      return await updateRunGroup(payload);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      return await setRunGroup(payload);
    }
  }, []);

  const handleSaveEvent = async (event) => {
    event.preventDefault();
    setDrawerError("");
    setSavingEvent(true);

    const name = drawerValues.name.trim();
    const track = drawerValues.track.trim();
    const runGroup = drawerValues.runGroup.trim();
    const startDate = drawerValues.startDate;
    const endDate = drawerValues.endDate;
    const runGroupPreview = getRunGroupPreview(runGroup);

    if (!name || !track || !startDate || !endDate) {
      setDrawerError("Please complete the event name, track, and date range.");
      setSavingEvent(false);
      return;
    }

    if (!runGroupPreview.isValid) {
      setDrawerError(
        "Run group is required and must normalize to RED, BLUE, YELLOW, or GREEN.",
      );
      setSavingEvent(false);
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setDrawerError("Start date must be on or before the end date.");
      setSavingEvent(false);
      return;
    }

    try {
      const payload = {
        name,
        track,
        startDate,
        endDate,
        status: drawerValues.status,
        run_group_raw_text: runGroup,
        notes: drawerValues.notes,
      };

      if (drawerMode === "create") {
        const response = await createEvent(payload);
        const createdEvent = response.event;
        const createdEventId = getEventId(createdEvent);

        if (createdEventId) {
          await syncRunGroup(createdEventId, runGroup);
        }

        if (createdEventId) {
          setStoredEventNote(createdEventId, drawerValues.notes);
        }

        let archiveStepMessage = "";
        if (drawerValues.status === "archived" && createdEventId) {
          try {
            await archiveEvent(createdEventId);
          } catch (archiveError) {
            archiveStepMessage = getApiErrorMessage(
              archiveError,
              "the newly created event could not be archived yet",
            );
          }
        }

        await refreshEvents();
        setDrawerOpen(false);
        setDrawerEvent(null);
        setNotice({
          type: archiveStepMessage ? NOTICE_COPY.warning : NOTICE_COPY.success,
          message: archiveStepMessage
            ? `Event created, but ${archiveStepMessage}.`
            : "Event created successfully.",
        });
      } else {
        const eventId = getEventId(drawerEvent);
        if (!eventId) {
          throw new Error("Missing event identifier.");
        }

        const response = await updateEvent(eventId, payload);
        const updatedEvent = response.event;
        const updatedEventId = getEventId(updatedEvent) || eventId;

        await syncRunGroup(updatedEventId, runGroup);
        setStoredEventNote(updatedEventId, drawerValues.notes);

        await refreshEvents();
        setDrawerOpen(false);
        setDrawerEvent(null);
        setNotice({
          type: NOTICE_COPY.success,
          message: "Event updated successfully.",
        });
      }
    } catch (error) {
      setDrawerError(getApiErrorMessage(error, "Failed to save event."));
    } finally {
      setSavingEvent(false);
    }
  };

  const openArchiveConfirm = (event) => {
    if (event.isActive === false) return;
    setArchiveTarget(event);
  };

  const closeArchiveConfirm = () => {
    if (archiving) return;
    setArchiveTarget(null);
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;

    try {
      setArchiving(true);
      const eventId = getEventId(archiveTarget);
      if (!eventId) {
        throw new Error("Missing event identifier.");
      }

      await archiveEvent(eventId);
      await refreshEvents();
      if (drawerOpen && drawerEvent && getEventId(drawerEvent) === eventId) {
        setDrawerOpen(false);
        setDrawerEvent(null);
        setDrawerError("");
      }
      setArchiveTarget(null);
      setNotice({
        type: NOTICE_COPY.success,
        message: `${archiveTarget.name} was archived successfully.`,
      });
    } catch (error) {
      setNotice({
        type: NOTICE_COPY.error,
        message: getApiErrorMessage(error, "Failed to archive event."),
      });
    } finally {
      setArchiving(false);
    }
  };

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setTrackFilter("all");
    setSortMode("latest");
  };

  const createEventsCopy = useMemo(
    () => ({
      total: "All race weekends in the operational catalogue.",
      active: "Events currently running on track.",
      upcoming: "Scheduled events waiting to go live.",
      archived: "Soft-deactivated events that remain filterable.",
    }),
    [],
  );

  const renderEventCard = (event) => {
    const eventId = getEventId(event);
    const lifecycle = getEventLifecycle(event);
    const runGroupStatus = getRunGroupStatus(event.runGroup);
    const archived = lifecycle.key === "archived";
    const title = event.name || "Untitled Event";
    const runGroupValue =
      event.runGroup?.normalized || event.runGroup?.rawText || "Not Configured";
    const timestampLabel = event.updatedAt ? "Updated" : "Created";
    const timestampValue = formatDateTime(event.updatedAt || event.createdAt);

    return (
      <article
        key={eventId || `${title}-${event.track}`}
        className={`admin-event-card ${archived ? "archived" : ""}`}
      >
        <div className="admin-event-card-header">
          <div className="admin-event-card-title-group">
            <div className="admin-event-card-title" title={title}>{title}</div>
            <div className="admin-event-card-track" title={event.track || "Track not set"}>
              {event.track || "Track not set"}
            </div>
          </div>

          <div className="helper-pill-row">
            <StatusBadge label={lifecycle.label} tone={lifecycle.tone} />
            <StatusBadge
              label={runGroupStatus.label}
              tone={runGroupStatus.tone}
            />
          </div>
        </div>

        <div className="admin-event-card-meta">
          <div className="admin-event-card-meta-item">
            <div className="admin-event-card-meta-label">Track</div>
            <div className="admin-event-card-meta-value" title={event.track || "-"}>
              {event.track || "-"}
            </div>
          </div>

          <div className="admin-event-card-meta-item">
            <div className="admin-event-card-meta-label">Date Range</div>
            <div
              className="admin-event-card-meta-value"
              title={formatDateRange(event.startDate, event.endDate)}
            >
              {formatDateRange(event.startDate, event.endDate)}
            </div>
          </div>

          <div className="admin-event-card-meta-item">
            <div className="admin-event-card-meta-label">Run Group</div>
            <div className="admin-event-card-meta-value mono" title={event.runGroup ? runGroupValue : "Not Configured"}>
              {event.runGroup ? runGroupValue : "Not Configured"}
            </div>
          </div>

          <div className="admin-event-card-meta-item">
            <div className="admin-event-card-meta-label">{timestampLabel}</div>
            <div className="admin-event-card-meta-value" title={timestampValue}>{timestampValue}</div>
          </div>
        </div>

        <div className="admin-event-card-footer">
          {archived ? (
            <div className="admin-event-card-callout">
              This event is archived. It stays filterable for reporting and can
              be reactivated from Edit Event.
            </div>
          ) : event.runGroup ? (
            <div className="admin-event-card-note" />
          ) : (
            <div className="admin-event-card-callout">
              Run group is missing. Open Edit Event to configure it before
              drivers begin submissions.
            </div>
          )}

          <div className="event-action-grid">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => router.push(`/admin/events/${eventId}`)}
              disabled={!eventId}
            >
              View Event
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openEditDrawer(event)}
              disabled={!eventId}
            >
              Edit Event
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <ProtectedRoute requireOwner={true}>
      <div className="admin-events-page">
        <div className="admin-page-shell">
          <header className="admin-page-header">
            <div className="admin-page-header-copy">
              <div className="admin-page-eyebrow">Owner Operations</div>
              <h1 className="admin-page-title">Event Management</h1>
              <p className="admin-page-subtitle">
                Create, filter, archive, and configure race events from a
                single high-trust operations surface. Every card exposes the
                    exact actions an owner should have in a production racing
                workflow.
              </p>
            </div>

            <div className="admin-page-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreateDrawer}
              >
                Create Event
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => router.push("/admin/signout?next=/login")}
              >
                Logout
              </button>
            </div>
          </header>

          {notice ? (
            <div className={`page-banner ${notice.type}`}>
              <strong>{notice.type === "success" ? "Success" : notice.type === "warning" ? "Warning" : "Error"}.</strong>
              <span>{notice.message}</span>
            </div>
          ) : null}

          <section className="admin-section">
            <div className="admin-events-summary-grid">
              <div className="summary-card total">
                <div className="summary-card-label">Total Events</div>
                <div className="summary-card-value">{summaryCounts.total}</div>
                <div className="summary-card-note">{createEventsCopy.total}</div>
              </div>

              <div className="summary-card active">
                <div className="summary-card-label">Active Events</div>
                <div className="summary-card-value">{summaryCounts.active}</div>
                <div className="summary-card-note">{createEventsCopy.active}</div>
              </div>

              <div className="summary-card upcoming">
                <div className="summary-card-label">Upcoming Events</div>
                <div className="summary-card-value">{summaryCounts.upcoming}</div>
                <div className="summary-card-note">{createEventsCopy.upcoming}</div>
              </div>

              <div className="summary-card archived">
                <div className="summary-card-label">Archived Events</div>
                <div className="summary-card-value">{summaryCounts.archived}</div>
                <div className="summary-card-note">{createEventsCopy.archived}</div>
              </div>
            </div>
          </section>

          <section className="admin-section filters-card">
            <div className="filters-row">
              <div className="filters-group wide">
                <label className="filters-label" htmlFor="event-search">
                  Search
                </label>
                <input
                  id="event-search"
                  className="input"
                  type="search"
                  placeholder="Search events, tracks, notes, or run groups"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>

              <div className="filters-group">
                <label className="filters-label" htmlFor="event-status-filter">
                  Status
                </label>
                <select
                  id="event-status-filter"
                  className="input"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  {FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filters-group">
                <label className="filters-label" htmlFor="event-track-filter">
                  Track
                </label>
                <select
                  id="event-track-filter"
                  className="input"
                  value={trackFilter}
                  onChange={(event) => setTrackFilter(event.target.value)}
                >
                  <option value="all">All Tracks</option>
                  {trackOptions.map((track) => (
                    <option key={track} value={track}>
                      {track}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filters-group">
                <label className="filters-label" htmlFor="event-sort-filter">
                  Sort
                </label>
                <select
                  id="event-sort-filter"
                  className="input"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="filters-meta">
              <span className="result-count">
                Showing {filteredEvents.length} of {summaryCounts.total} events
              </span>
              <div className="filters-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetFilters}
                >
                  Reset Filters
                </button>
              </div>
            </div>
          </section>

          <section className="admin-section">
            <div className="admin-section-header">
              <div>
                <div className="admin-section-title">Events</div>
              </div>
            </div>

            {loading ? (
              <Loader
                fullHeight
                label="Loading events"
                sublabel="Fetching event cards and run-group status from the backend."
              />
            ) : pageError ? (
              <EmptyState
                icon="!"
                title="Could not load events"
                description={pageError}
                actions={
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={refreshEvents}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={openCreateDrawer}
                    >
                      Create Event
                    </button>
                  </>
                }
              />
            ) : filteredEvents.length === 0 ? (
              <EmptyState
                icon="RACE"
                title={
                  events.length === 0
                    ? "No events yet"
                    : "No events match your filters"
                }
                description={
                  events.length === 0
                    ? "Create the first motorsport event to start configuring track dates and run groups."
                    : "Try clearing the filters or broadening the search terms to see more race weekends."
                }
                actions={
                  events.length === 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={openCreateDrawer}
                    >
                      Create Event
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={resetFilters}
                      >
                        Clear Filters
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={openCreateDrawer}
                      >
                        Create Event
                      </button>
                    </>
                  )
                }
              />
            ) : (
              <div className="admin-events-grid">
                {filteredEvents.map(renderEventCard)}
              </div>
            )}
          </section>
        </div>

        <EventFormDrawer
          open={drawerOpen}
          mode={drawerMode}
          values={drawerValues}
          onChange={handleDrawerChange}
          onClose={closeDrawer}
          onSubmit={handleSaveEvent}
          onArchive={
            drawerMode === "edit" && drawerEvent
              ? () => openArchiveConfirm(drawerEvent)
              : null
          }
          archiveDisabled={drawerMode === "edit" ? drawerEvent?.isActive === false : false}
          isSaving={savingEvent}
          error={drawerError}
          notesHint="Saved to the backend event notes field."
        />

        <EventArchiveDialog
          open={Boolean(archiveTarget)}
          eventName={archiveTarget?.name || "this event"}
          onClose={closeArchiveConfirm}
          onConfirm={confirmArchive}
          isSaving={archiving}
        />
      </div>
    </ProtectedRoute>
  );
}
