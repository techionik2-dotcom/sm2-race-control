"use client";

import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { DrawerShell } from "../../fleet/_components/ManagementUi";
import {
  normalizeTrackShortCode,
  resolveTrackIsActive,
} from "./trackManagementHelpers";

function TrackFormFooter({
  mode,
  track,
  isSaving,
  onClose,
  onSubmit,
  onEditTrack,
  onArchiveTrack,
}) {
  if (mode === "view") {
    return (
      <>
        <button
          type="button"
          className="fleet-btn fleet-btn-secondary"
          onClick={() => onEditTrack?.(track)}
        >
          Edit Track
        </button>
        {resolveTrackIsActive(track) ? (
          <button
            type="button"
            className="fleet-btn fleet-btn-danger"
            onClick={() => onArchiveTrack?.(track)}
          >
            Archive Track
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
        onClick={onClose}
        disabled={isSaving}
      >
        Cancel
      </button>
      <button
        type="button"
        className="fleet-btn fleet-btn-primary"
        onClick={onSubmit}
        disabled={isSaving}
      >
        {isSaving ? "Saving..." : "Save Track"}
      </button>
    </>
  );
}

export default function TrackFormDrawer({
  open,
  mode,
  track,
  values,
  onChange,
  onClose,
  onSubmit,
  onEditTrack,
  onArchiveTrack,
  isSaving = false,
  error = "",
  countryOptions = [],
}) {
  const readOnly = mode === "view";
  const shortCodeValue = readOnly
    ? track?.shortCode || track?.short_code || "Not configured"
    : normalizeTrackShortCode(values.shortCode) || "Not configured";
  const title =
    mode === "create" ? "Create Track" : mode === "edit" ? "Edit Track" : "Track Details";
  const subtitle =
    mode === "create"
      ? "Create a clean master track record for events and submission workflows."
      : mode === "edit"
        ? "Update the track record, geographic data, and lifecycle state."
        : "Review the master track record and history before making changes.";

  const handleFieldChange = (field, value) => {
    onChange?.(field, value);
  };

  return (
    <DrawerShell
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <TrackFormFooter
          mode={mode}
          track={track}
          isSaving={isSaving}
          onClose={onClose}
          onSubmit={onSubmit}
          onEditTrack={onEditTrack}
          onArchiveTrack={onArchiveTrack}
        />
      }
      wide
    >
      {error ? (
        <div className="fleet-notice fleet-notice-danger" style={{ marginBottom: "1rem" }}>
          <div className="fleet-notice-icon" aria-hidden="true">
            <WarningAmberOutlinedIcon fontSize="small" />
          </div>
          <div className="fleet-notice-copy">
            <p className="fleet-notice-title">Validation issue</p>
            <p className="fleet-notice-message">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="tracks-preview-panel">
        <p className="tracks-preview-label">Normalized Preview</p>
        <div className="tracks-preview-value">{shortCodeValue}</div>
        <p className="tracks-preview-note">
          {shortCodeValue === "Not configured"
            ? "Short codes are normalized to uppercase before saving."
            : `Drivers and filters will reference ${shortCodeValue} in a standardized format.`}
        </p>
      </div>

      <div className="fleet-form-grid">
        <div className="fleet-field fleet-span-2">
          <label className="fleet-label" htmlFor="track-track-name">
            Track Name
          </label>
          <input
            id="track-track-name"
            className="fleet-input"
            value={values.trackName}
            onChange={(event) => handleFieldChange("trackName", event.target.value)}
            placeholder="Enter the official track name"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field fleet-span-2">
          <label className="fleet-label" htmlFor="track-display-name">
            Display Name
          </label>
          <input
            id="track-display-name"
            className="fleet-input"
            value={values.displayName}
            onChange={(event) => handleFieldChange("displayName", event.target.value)}
            placeholder="Enter the display label"
            readOnly={readOnly}
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="track-short-code">
            Short Code
          </label>
          <input
            id="track-short-code"
            className="fleet-input"
            value={values.shortCode}
            onChange={(event) =>
              handleFieldChange("shortCode", normalizeTrackShortCode(event.target.value))
            }
            placeholder="SEB"
            readOnly={readOnly}
          />
          {!readOnly ? (
            <p className="fleet-helper-text">Use a clean uppercase code for filters and future exports.</p>
          ) : null}
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="track-country">
            Country
          </label>
          <input
            id="track-country"
            className="fleet-input"
            value={values.country}
            onChange={(event) => handleFieldChange("country", event.target.value)}
            placeholder="United States"
            readOnly={readOnly}
            list="track-country-options"
          />
          <datalist id="track-country-options">
            {countryOptions.map((country) => (
              <option key={country} value={country} />
            ))}
          </datalist>
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="track-latitude">
            Latitude
          </label>
          <input
            id="track-latitude"
            type="number"
            step="0.000001"
            className="fleet-input"
            value={values.latitude}
            onChange={(event) => handleFieldChange("latitude", event.target.value)}
            placeholder="Optional"
            readOnly={readOnly}
            min="-90"
            max="90"
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="track-longitude">
            Longitude
          </label>
          <input
            id="track-longitude"
            type="number"
            step="0.000001"
            className="fleet-input"
            value={values.longitude}
            onChange={(event) => handleFieldChange("longitude", event.target.value)}
            placeholder="Optional"
            readOnly={readOnly}
            min="-180"
            max="180"
          />
        </div>

        <div className="fleet-field">
          <label className="fleet-label" htmlFor="track-status">
            Status
          </label>
          <select
            id="track-status"
            className="fleet-select"
            value={values.status}
            onChange={(event) => handleFieldChange("status", event.target.value)}
            disabled={readOnly}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="fleet-field fleet-span-2">
          <label className="fleet-label" htmlFor="track-notes">
            Notes
          </label>
          <textarea
            id="track-notes"
            className="fleet-textarea"
            value={values.notes}
            onChange={(event) => handleFieldChange("notes", event.target.value)}
            placeholder="Optional master-data notes"
            readOnly={readOnly}
          />
        </div>
      </div>
    </DrawerShell>
  );
}
