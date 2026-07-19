"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import EmptyState from "../../../components/Common/EmptyState";
import Loader from "../../../components/Common/Loader";
import StatusBadge from "../../../components/Common/StatusBadge";
import EventFormDrawer from "./EventFormDrawer";
import EventArchiveDialog from "./EventArchiveDialog";
import RaceWeekendOperations from "./RaceWeekendOperations";
import {
  archiveEvent,
  updateEvent,
  getEventById,
} from "../../../utils/eventApi";
import {
  getRunGroup,
  setRunGroup,
  updateRunGroup,
} from "../../../utils/runGroupApi";
import {
  createBlankEventFormValues,
  formatDateRange,
  formatDateTime,
  getApiErrorMessage,
  getEventId,
  getEventLifecycle,
  getRunGroupPreview,
  getRunGroupStatus,
  isConflictError,
  isNotFoundError,
  mergeStoredEventNotesList,
  setStoredEventNote,
  toEventFormValues,
} from "./eventManagementHelpers";

export default function EventWorkspace() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const eventId = params?.eventId;
  const isRunGroupRoute = pathname?.endsWith("/run-group");
  const runGroupRef = useRef(null);

  const [event, setEvent] = useState(null);
  const [existingRunGroup, setExistingRunGroup] = useState(null);
  const [runGroupValue, setRunGroupValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);
  const [savingRunGroup, setSavingRunGroup] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerValues, setDrawerValues] = useState(createBlankEventFormValues());
  const [drawerError, setDrawerError] = useState("");
  const [savingEvent, setSavingEvent] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);

  const loadWorkspace = useCallback(async () => {
    if (!eventId) {
      router.push("/admin/events");
      return;
    }

    try {
      setLoading(true);
      setPageError("");

      const eventResponse = await getEventById(eventId);
      const eventData = eventResponse?.event || eventResponse?.data || eventResponse;
      const normalizedEvent = mergeStoredEventNotesList([eventData])[0] || null;

      if (!normalizedEvent) {
        throw new Error("Event not found");
      }

      setEvent(normalizedEvent);

      try {
        const runGroupResponse = await getRunGroup(eventId);
        setExistingRunGroup(runGroupResponse);
        const nextRunGroupValue =
          runGroupResponse?.rawText || runGroupResponse?.normalized || "";
        setRunGroupValue(nextRunGroupValue);
        setDrawerValues({
          ...toEventFormValues(normalizedEvent),
          runGroup: nextRunGroupValue,
        });
      } catch (runGroupError) {
        if (!isNotFoundError(runGroupError)) {
          console.warn("Run group load failed for event detail screen:", runGroupError);
        }

        setExistingRunGroup(null);
        setRunGroupValue("");
        setDrawerValues(toEventFormValues(normalizedEvent));
      }
    } catch (error) {
      setEvent(null);
      setExistingRunGroup(null);
      setRunGroupValue("");
      setPageError(getApiErrorMessage(error, "Could not load this event."));
    } finally {
      setLoading(false);
    }
  }, [eventId, router]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!notice) return undefined;

    const timeout = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (isRunGroupRoute && event && runGroupRef.current) {
      runGroupRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [event, isRunGroupRoute]);

  const eventLifecycle = useMemo(() => getEventLifecycle(event), [event]);
  const runGroupStatus = useMemo(
    () => getRunGroupStatus(existingRunGroup),
    [existingRunGroup],
  );
  const runGroupPreview = useMemo(
    () => getRunGroupPreview(runGroupValue),
    [runGroupValue],
  );

  const syncRunGroup = useCallback(async (targetEventId, rawText) => {
    const payload = {
      eventId: targetEventId,
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

  const closeDrawer = () => {
    if (savingEvent) return;
    setDrawerOpen(false);
    setDrawerError("");
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

  const openEditDrawer = () => {
    if (!event) return;
    setDrawerValues({
      ...toEventFormValues(event),
      runGroup: runGroupValue || existingRunGroup?.rawText || existingRunGroup?.normalized || "",
    });
    setDrawerError("");
    setDrawerOpen(true);
  };

  const saveEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!event) return;

    const name = drawerValues.name.trim();
    const track = drawerValues.track.trim();
    const runGroup = drawerValues.runGroup.trim();
    const startDate = drawerValues.startDate;
    const endDate = drawerValues.endDate;
    const runGroupPreview = getRunGroupPreview(runGroup);

    if (!name || !track || !startDate || !endDate) {
      setDrawerError("Please complete the event name, track, and date range.");
      return;
    }

    if (!runGroupPreview.isValid) {
      setDrawerError(
        "Run group is required and must normalize to RED, BLUE, YELLOW, or GREEN.",
      );
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setDrawerError("Start date must be on or before the end date.");
      return;
    }

    try {
      setSavingEvent(true);

      const payload = {
        name,
        track,
        startDate,
        endDate,
        status: drawerValues.status,
        run_group_raw_text: runGroup,
        notes: drawerValues.notes,
      };

      const response = await updateEvent(getEventId(event), payload);
      const updatedEvent = response.event || response.data || response;
      await syncRunGroup(getEventId(event), runGroup);
      setStoredEventNote(getEventId(event), drawerValues.notes);
      const normalizedEvent =
        mergeStoredEventNotesList([updatedEvent])[0] || updatedEvent;
      setEvent(normalizedEvent);

      try {
        const refreshedRunGroup = await getRunGroup(getEventId(event));
        setExistingRunGroup(refreshedRunGroup);
        setRunGroupValue(
          refreshedRunGroup?.rawText || refreshedRunGroup?.normalized || runGroup,
        );
      } catch (runGroupError) {
        if (!isNotFoundError(runGroupError)) {
          console.warn("Run group refresh failed after event update:", runGroupError);
        }
      }

      setDrawerOpen(false);
      setDrawerError("");
      setNotice({
        type: "success",
        message: "Event updated successfully.",
      });
    } catch (error) {
      setDrawerError(getApiErrorMessage(error, "Failed to update event."));
    } finally {
      setSavingEvent(false);
    }
  };

  const openArchiveConfirm = () => {
    if (!event || event.isActive === false) return;
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
      const response = await archiveEvent(getEventId(archiveTarget));
      const archivedEvent = response.event || response.data || response;
      const normalizedArchivedEvent =
        mergeStoredEventNotesList([archivedEvent])[0] || archivedEvent;

      setEvent(normalizedArchivedEvent);
      if (drawerOpen) {
        setDrawerOpen(false);
        setDrawerError("");
      }
      setArchiveTarget(null);
      setNotice({
        type: "success",
        message: `${archiveTarget.name} was archived successfully.`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: getApiErrorMessage(error, "Failed to archive event."),
      });
    } finally {
      setArchiving(false);
    }
  };

  const handleRunGroupChange = (value) => {
    setRunGroupValue(value);
    setNotice(null);
  };

  const resetRunGroup = () => {
    setRunGroupValue(existingRunGroup?.rawText || "");
  };

  const saveRunGroup = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!event) return;

    if (!runGroupPreview.isValid) {
      setNotice({
        type: "error",
        message: runGroupPreview.hint,
      });
      return;
    }

    if (event.isActive === false && !existingRunGroup) {
      setNotice({
        type: "warning",
        message:
          "Archived events cannot create new run groups. Reactivate the event from Edit Event first.",
      });
      return;
    }

    try {
      setSavingRunGroup(true);

      const payload = {
        eventId: getEventId(event),
        rawText: runGroupValue.trim(),
      };

      const response = existingRunGroup
        ? await updateRunGroup(payload)
        : await setRunGroup(payload);

      const savedRunGroup = response.runGroup || response.data || response;
      setExistingRunGroup(savedRunGroup);
      setRunGroupValue(savedRunGroup?.rawText || runGroupValue);
      setNotice({
        type: "success",
        message:
          existingRunGroup
            ? "Run group updated successfully."
            : "Run group saved successfully.",
      });
    } catch (error) {
      if (isConflictError(error)) {
        setNotice({
          type: "warning",
          message:
            "That run group already exists for this event. Refresh and update the existing value instead.",
        });
      } else {
        setNotice({
          type: "error",
          message: getApiErrorMessage(error, "Failed to save run group."),
        });
      }
    } finally {
      setSavingRunGroup(false);
    }
  };

  const runGroupCreateBlocked =
    event?.isActive === false && !existingRunGroup && !runGroupValue;

  return (
    <ProtectedRoute requireOwner={true}>
      <div className="admin-event-workspace-page">
        <div className="admin-page-shell">
          <header className="admin-page-header">
            <div className="admin-page-header-copy">
              <div className="admin-page-eyebrow">Event Detail Workspace</div>
              <h1 className="admin-page-title">
                {event ? event.name : "Run Group Setup"}
              </h1>
              <p className="admin-page-subtitle">
                Inspect the event, review lifecycle status, and keep the
                driver-facing run group normalized and ready for the race
                weekend.
              </p>
            </div>

            <div className="admin-page-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={openEditDrawer}
                disabled={!event}
              >
                Edit Event
              </button>
              <button
                type="button"
                className={event?.isActive === false ? "btn btn-secondary" : "btn btn-danger"}
                onClick={openArchiveConfirm}
                disabled={!event || event?.isActive === false}
              >
                {event?.isActive === false ? "Archived" : "Archive Event"}
              </button>
            </div>
          </header>

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

          {loading ? (
            <Loader
              fullHeight
              label="Loading event workspace"
              sublabel="Fetching the event details and run-group state from the backend."
            />
          ) : pageError || !event ? (
            <EmptyState
              icon="!"
              title="Unable to open this event"
              description={pageError || "The requested event could not be loaded."}
              actions={
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={loadWorkspace}
                  >
                    Retry
                  </button>
                </>
              }
            />
          ) : (
            <>
            <div className="workspace-layout">
              <div className="workspace-column">
                <section className="workspace-panel highlight">
                  <div className="workspace-panel-header">
                    <div>
                      <div className="admin-page-eyebrow">Event Summary</div>
                      <h2 className="workspace-panel-title">{event.name}</h2>
                      <p className="workspace-panel-subtitle">
                        Event operations should stay visible, audited, and easy
                        to update. This section keeps the core facts aligned for
                        the owner team.
                      </p>
                    </div>

                    <div className="helper-pill-row">
                      <StatusBadge
                        label={eventLifecycle.label}
                        tone={eventLifecycle.tone}
                      />
                      <StatusBadge
                        label={runGroupStatus.label}
                        tone={runGroupStatus.tone}
                      />
                    </div>
                  </div>

                  <div className="workspace-meta-grid">
                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Event Name</span>
                      <span className="workspace-meta-value">{event.name}</span>
                    </div>

                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Track</span>
                      <span className="workspace-meta-value">
                      {event.track || "-"}
                      </span>
                    </div>

                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Start / End Date</span>
                      <span className="workspace-meta-value">
                        {formatDateRange(event.startDate, event.endDate)}
                      </span>
                    </div>

                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Event Status</span>
                      <span className="workspace-meta-value">
                        {eventLifecycle.label}
                      </span>
                    </div>

                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Run Group Status</span>
                      <span className="workspace-meta-value">
                        {runGroupStatus.label}
                      </span>
                    </div>

                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Created / Updated</span>
                      <span className="workspace-meta-value">
                        {formatDateTime(event.updatedAt || event.createdAt)}
                      </span>
                    </div>
                  </div>

                  {event.notes ? (
                    <div className="workspace-callout" style={{ marginTop: "1rem" }}>
                      <strong>Notes:</strong> {event.notes}
                    </div>
                  ) : (
                    <div className="workspace-callout" style={{ marginTop: "1rem" }}>
                      No internal notes have been stored for this event yet.
                    </div>
                  )}
                </section>

                <section className="workspace-panel">
                  <div className="workspace-panel-header">
                    <div>
                      <div className="admin-page-eyebrow">Operational Context</div>
                      <h2 className="workspace-panel-title">Event record</h2>
                      <p className="workspace-panel-subtitle">
                        Keep this screen aligned with the backend so the owner
                        team always works from the same source of truth.
                      </p>
                    </div>
                  </div>

                  <div className="workspace-meta-grid">
                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Created At</span>
                      <span className="workspace-meta-value">
                        {formatDateTime(event.createdAt)}
                      </span>
                    </div>
                    <div className="workspace-meta-item">
                      <span className="workspace-meta-label">Updated At</span>
                      <span className="workspace-meta-value">
                        {formatDateTime(event.updatedAt)}
                      </span>
                    </div>
                  </div>
                </section>
              </div>

              <div className="workspace-column" ref={runGroupRef}>
                <section className="workspace-run-group">
                  <div className="workspace-panel-header">
                    <div>
                      <div className="admin-page-eyebrow">Run Group Management</div>
                      <h2 className="workspace-panel-title">
                        Normalize the driver-facing label
                      </h2>
                      <p className="workspace-panel-subtitle">
                        Enter the raw run-group value, review the uppercase
                        preview, and save it as a properly normalized driver
                        label.
                      </p>
                    </div>

                    <StatusBadge label={runGroupStatus.label} tone={runGroupStatus.tone} />
                  </div>

                  {runGroupCreateBlocked ? (
                    <div className="workspace-callout" style={{ marginBottom: "1rem" }}>
                      Archived events cannot create a brand-new run group. Reactivate
                      the event in Edit Event first, or update an existing run group
                      if one is already configured.
                    </div>
                  ) : null}

                  <form onSubmit={saveRunGroup}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="run-group-value">
                        Run Group
                      </label>
                      <input
                        id="run-group-value"
                        className="input workspace-run-group-input"
                        type="text"
                        placeholder="RED, BLUE, YELLOW, GREEN"
                        value={runGroupValue}
                        onChange={(event) => handleRunGroupChange(event.target.value)}
                        autoComplete="off"
                      />
                      <p className="form-hint">
                        The backend resolves any value containing RED, BLUE,
                        YELLOW, or GREEN into a normalized run-group code.
                      </p>
                    </div>

                    <div className="workspace-preview-card">
                      <div className="workspace-preview-label">
                        Normalized Preview
                      </div>

                      {runGroupPreview.normalized ? (
                        <div className="workspace-preview-value mono-text">
                          {runGroupPreview.normalized}
                        </div>
                      ) : (
                        <div className="workspace-preview-empty">
                          Not Configured
                        </div>
                      )}

                      <div className="event-status-strip">
                        <StatusBadge
                          label={
                            runGroupPreview.resolved ||
                            (runGroupPreview.normalized ? "Needs Validation" : "Missing")
                          }
                          tone={runGroupPreview.isValid ? "success" : "warning"}
                        />
                        {runGroupPreview.normalized ? (
                          <StatusBadge
                            label={runGroupPreview.normalized}
                            tone="accent"
                          />
                        ) : null}
                      </div>

                      <div className="workspace-preview-hint">
                        {runGroupPreview.hint}
                      </div>
                    </div>

                    <div className="detail-action-bar">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={resetRunGroup}
                        disabled={!existingRunGroup && !runGroupValue}
                      >
                        Reset Run Group
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={
                          savingRunGroup ||
                          !runGroupPreview.isValid ||
                          runGroupCreateBlocked
                        }
                      >
                        {savingRunGroup ? "Saving..." : "Save Run Group"}
                      </button>
                    </div>
                  </form>
                </section>

                <section className="workspace-panel">
                  <div className="workspace-panel-header">
                    <div>
                      <div className="admin-page-eyebrow">Owner Notes</div>
                      <h2 className="workspace-panel-title">Operational reminders</h2>
                      <p className="workspace-panel-subtitle">
                        Keep event data and run-group behavior aligned with the
                        backend contract so the owner experience stays reliable.
                      </p>
                    </div>
                  </div>

                  <div className="workspace-callout">
                    The event card grid, status badges, archive flow, and
                    run-group preview are all designed to reflect a real
                    motorsport operations workflow. If the backend adds a
                    description field later, the notes input is already ready to
                    persist it.
                  </div>
                </section>
              </div>
            </div>
            <RaceWeekendOperations
              eventId={getEventId(event)}
              setNotice={setNotice}
            />
            </>
          )}
        </div>

        <EventFormDrawer
          open={drawerOpen}
          mode="edit"
          values={drawerValues}
          onChange={handleDrawerChange}
          onClose={closeDrawer}
          onSubmit={saveEvent}
          onArchive={event ? () => openArchiveConfirm() : null}
          archiveDisabled={event?.isActive === false}
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
