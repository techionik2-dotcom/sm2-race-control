"use client";

import EventNoteIcon from "@mui/icons-material/EventNote";
import { DrawerShell } from "../../fleet/_components/ManagementUi";
import { getRunGroupPreview } from "./eventManagementHelpers";

export default function EventFormDrawer({
  open,
  mode = "create",
  values,
  onChange,
  onClose,
  onSubmit,
  onArchive = null,
  archiveDisabled = false,
  isSaving = false,
  error = "",
  notesHint = "Optional operational notes for owner reference.",
  drivers = [],
  vehicles = [],
  onOpenWeekendSetup = null,
}) {
  if (!open) return null;

  const title = mode === "edit" ? "Edit Event" : "Create Event";
  const subtitle =
    mode === "edit"
      ? "Update the event details, run group, lifecycle state, and internal notes."
      : "Set up a new race event with the correct track, schedule, run group, and notes.";
  const runGroupPreview = getRunGroupPreview(values.runGroup || "");

  const updateField = (field) => (event) => {
    onChange(field, event.target.value);
  };

  const selectedDriverIds = Array.isArray(values.participantDriverIds)
    ? values.participantDriverIds
    : [];

  const toggleDriver = (driverId) => {
    const nextDriverIds = selectedDriverIds.includes(driverId)
      ? selectedDriverIds.filter((id) => id !== driverId)
      : [...selectedDriverIds, driverId];

    onChange("participantDriverIds", nextDriverIds);
  };

  const getDriverVehicleLabel = (driver) => {
    const vehicle = vehicles.find((item) => item.driverId === driver.driverCode);
    if (!vehicle) return "Vehicle can be assigned later";
    return `${vehicle.vehicleCode || "Car"} - ${vehicle.make || ""} ${vehicle.model || ""}`.trim();
  };

  return (
    <DrawerShell
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={isSaving ? undefined : onClose}
      footer={
        <div className="event-drawer-footer-stack">
          <div className="event-drawer-footer-actions">
            <button
              type="button"
              className="fleet-btn fleet-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            {mode === "edit" && onArchive ? (
              <button
                type="button"
                className="fleet-btn fleet-btn-danger"
                onClick={onArchive}
                disabled={isSaving || archiveDisabled}
              >
                {archiveDisabled ? "Archived" : "Archive Event"}
              </button>
            ) : null}
            <button
              type="submit"
              form="event-form-drawer-form"
              className="fleet-btn fleet-btn-primary"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : mode === "edit" ? "Save Event" : "Create Event"}
            </button>
          </div>
        </div>
      }
    >
      <form id="event-form-drawer-form" className="event-form-drawer-content" onSubmit={onSubmit}>
        <div className="drawer-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="event-name">
              Event Name
            </label>
            <input
              id="event-name"
              className="input"
              type="text"
              placeholder="Spring Championship"
              value={values.name}
              onChange={updateField("name")}
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="event-track">
              Track
            </label>
            <input
              id="event-track"
              className="input"
              type="text"
              placeholder="Circuit de la Sarthe"
              value={values.track}
              onChange={updateField("track")}
              autoComplete="off"
            />
          </div>

          <div className="form-group drawer-span-2">
            <label className="form-label" htmlFor="event-run-group">
              Run Group <span className="required-marker">*</span>
            </label>
            <input
              id="event-run-group"
              className="input"
              type="text"
              placeholder="RED"
              value={values.runGroup}
              onChange={updateField("runGroup")}
              autoComplete="off"
              required
            />
            <div className={`run-group-preview ${runGroupPreview.isValid ? "valid" : "invalid"}`}>
              <div className="run-group-preview-label">Normalized preview</div>
              <div className="run-group-preview-value">
                {runGroupPreview.isValid ? runGroupPreview.resolved : "Not configured yet"}
              </div>
              <p className="form-hint">
                {mode === "edit"
                  ? "Edit the raw label here. The backend keeps the normalized code in sync."
                  : runGroupPreview.hint}
              </p>
            </div>
          </div>

          <div className="form-row drawer-span-2">
            <div className="form-group">
              <label className="form-label" htmlFor="event-start-date">
                Start Date
              </label>
              <input
                id="event-start-date"
                className="input"
                type="date"
                value={values.startDate}
                onChange={updateField("startDate")}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="event-end-date">
                End Date
              </label>
              <input
                id="event-end-date"
                className="input"
                type="date"
                value={values.endDate}
                onChange={updateField("endDate")}
              />
            </div>
          </div>

          <div className="form-group drawer-span-2">
            <label className="form-label" htmlFor="event-status">
              Status
            </label>
            <select
              id="event-status"
              className="input"
              value={values.status}
              onChange={updateField("status")}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
            <p className="form-hint">Completed is derived automatically from the event dates.</p>
          </div>

          <div className="form-group drawer-span-2">
            <label className="form-label" htmlFor="event-notes">
              Notes / Description
            </label>
            <textarea
              id="event-notes"
              className="input event-textarea"
              rows={5}
                placeholder="Optional operational context, weekend notes, or owner-only guidance."
              value={values.notes}
              onChange={updateField("notes")}
            />
            <p className="form-hint">
              <EventNoteIcon
                fontSize="inherit"
                style={{ verticalAlign: "-2px", marginRight: 4 }}
              />
              {notesHint}
            </p>
          </div>

          <div className="drawer-span-2 event-setup-panel">
            <div className="event-setup-header">
              <div>
                <div className="event-setup-step">Step 2</div>
                <h3>Drivers for this event</h3>
              </div>
              <span>{selectedDriverIds.length} selected</span>
            </div>

            {mode === "create" ? (
              <>
                <p className="event-setup-copy">
                  Select the drivers now so the event opens with each driver
                  already organized under the race weekend.
                </p>
                <div className="event-driver-picker">
                  {drivers.map((driver) => (
                    <label key={driver.id} className="event-driver-option">
                      <input
                        type="checkbox"
                        checked={selectedDriverIds.includes(driver.id)}
                        onChange={() => toggleDriver(driver.id)}
                      />
                      <span>
                        <strong>{driver.driverName || driver.fullName || "Driver"}</strong>
                        <small>{getDriverVehicleLabel(driver)}</small>
                      </span>
                    </label>
                  ))}
                  {!drivers.length ? (
                    <div className="workspace-callout">
                      No drivers are available yet. Add drivers from the Drivers
                      page, then return here to build the event roster.
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="event-setup-inline-action">
                <p className="event-setup-copy">
                  Driver selection and session setup live in the event-first
                  workspace so existing event data stays in one place.
                </p>
                {onOpenWeekendSetup ? (
                  <button
                    type="button"
                    className="fleet-btn fleet-btn-secondary"
                    onClick={onOpenWeekendSetup}
                    disabled={isSaving}
                  >
                    Open Drivers & Schedule
                  </button>
                ) : null}
              </div>
            )}
          </div>

          <div className="drawer-span-2 event-setup-panel">
            <div className="event-setup-header">
              <div>
                <div className="event-setup-step">Step 3</div>
                <h3>Weekend schedule</h3>
              </div>
            </div>

            {mode === "create" ? (
              <>
                <p className="event-setup-copy">
                  Paste the schedule here. After the event is created, the
                  system will analyze it and create sessions for the selected
                  drivers.
                </p>
                <textarea
                  id="event-schedule-text"
                  className="input event-textarea"
                  rows={6}
                  placeholder={"Friday 9:00 AM Practice 1\nFriday 1:30 PM Qualifying\nSaturday 10:00 AM Race 1"}
                  value={values.scheduleText || ""}
                  onChange={updateField("scheduleText")}
                />
              </>
            ) : (
              <p className="event-setup-copy">
                Upload or paste the schedule from the event workspace after
                saving any changes on this form.
              </p>
            )}
          </div>
        </div>

        {error ? <div className="error-text">{error}</div> : null}
      </form>
    </DrawerShell>
  );
}
