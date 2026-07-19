"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EmptyState from "../../../components/Common/EmptyState";
import Loader from "../../../components/Common/Loader";
import StatusBadge from "../../../components/Common/StatusBadge";
import { getDrivers, getVehicles } from "../../../utils/fleetApi";
import {
  addEventParticipant,
  analyzeEventSchedule,
  confirmEventSchedule,
  getEventWeekendWorkspace,
  updateEventRaceSession,
  uploadRaceSessionAttachment,
} from "../../../utils/eventWorkflowApi";

const TABS = ["Overview", "Drivers", "Schedule", "Sessions", "Review"];
const SESSION_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED"];

const stringifyJson = (value) => JSON.stringify(value || {}, null, 2);

const formatDateTime = (value) => {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unscheduled";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const toDateTimeInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const parseFlexibleObject = (value, label) => {
  const text = String(value || "").trim();
  if (!text) return {};
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  }

  return text.split("\n").reduce((acc, rawLine) => {
    const line = rawLine.trim();
    if (!line) return acc;
    const separator = line.includes(":") ? ":" : "=";
    const [rawKey, ...rest] = line.split(separator);
    const key = rawKey?.trim();
    const rawValue = rest.join(separator).trim();
    if (key) {
      acc[key] = rawValue;
    }
    return acc;
  }, {});
};

const parseLapTimes = (value) => {
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("Lap times must be a JSON array or one lap per line.");
    }
    return parsed;
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((lapTime, index) => ({ lap: index + 1, time: lapTime }));
};

const buildBaseline = (driver, vehicle) => ({
  driver: {
    id: driver?.id || null,
    code: driver?.driverCode || "",
    name: driver?.driverName || driver?.fullName || "",
    team: driver?.teamName || "",
  },
  vehicle: vehicle
    ? {
        id: vehicle.id,
        code: vehicle.vehicleCode,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        class: vehicle.vehicleClass,
        registrationNumber: vehicle.registrationNumber,
      }
    : {},
  alignment: {},
  setup: {},
  tire_pressures: {},
  tire_temperatures: {},
});

const formatChangeSummary = (value) => {
  const keys = value && typeof value === "object" ? Object.keys(value) : [];
  if (!keys.length) return "No changes recorded";
  return keys.slice(0, 4).join(", ") + (keys.length > 4 ? ` +${keys.length - 4}` : "");
};

export default function RaceWeekendOperations({ eventId, setNotice }) {
  const [activeTab, setActiveTab] = useState("Overview");
  const [weekend, setWeekend] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [participantForm, setParticipantForm] = useState({
    driverId: "",
    vehicleId: "",
    baselineSetupText: "{}",
    notes: "",
  });

  const [scheduleText, setScheduleText] = useState("");
  const [detectedSessions, setDetectedSessions] = useState([]);
  const [ignoredLines, setIgnoredLines] = useState([]);
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionDraft, setSessionDraft] = useState(null);

  const loadWeekend = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setError("");
      const [weekendData, driverData, vehicleData] = await Promise.all([
        getEventWeekendWorkspace(eventId),
        getDrivers(),
        getVehicles(),
      ]);
      setWeekend(weekendData);
      setDrivers(driverData.drivers || []);
      setVehicles(vehicleData.vehicles || []);
      const firstParticipant = weekendData.participants?.[0];
      if (!selectedParticipantId && firstParticipant) {
        setSelectedParticipantId(firstParticipant.id);
      }
    } catch (loadError) {
      setError(loadError?.message || "Unable to load race weekend workspace.");
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedParticipantId]);

  useEffect(() => {
    loadWeekend();
  }, [loadWeekend]);

  const participants = useMemo(() => weekend?.participants || [], [weekend?.participants]);
  const sessions = useMemo(() => weekend?.sessions || [], [weekend?.sessions]);
  const selectedParticipant = useMemo(
    () => participants.find((participant) => participant.id === selectedParticipantId) || participants[0] || null,
    [participants, selectedParticipantId],
  );
  const participantSessions = useMemo(
    () => selectedParticipant?.sessions || [],
    [selectedParticipant?.sessions],
  );
  const selectedSession = useMemo(
    () =>
      sessions.find((session) => session.id === selectedSessionId) ||
      participantSessions.find((session) => session.id === selectedSessionId) ||
      participantSessions[0] ||
      null,
    [participantSessions, selectedSessionId, sessions],
  );

  useEffect(() => {
    if (!selectedSession) {
      setSessionDraft(null);
      return;
    }

    setSelectedSessionId(selectedSession.id);
    setSessionDraft({
      title: selectedSession.title,
      sessionType: selectedSession.sessionType,
      sessionNumber: selectedSession.sessionNumber,
      scheduledAt: selectedSession.scheduledAt,
      status: selectedSession.status,
      setupChangesText: stringifyJson(selectedSession.setupData?.changes),
      tireChangesText: stringifyJson(selectedSession.tireData?.changes),
      lapTimesText: JSON.stringify(selectedSession.lapTimes || [], null, 2),
      comments: selectedSession.comments || "",
      observations: selectedSession.observations || "",
      adjustments: selectedSession.adjustments || "",
      additionalDataText: stringifyJson(selectedSession.additionalData),
    });
  }, [selectedSession]);

  const selectedDriver = drivers.find((driver) => driver.id === participantForm.driverId) || null;
  const vehicleOptions = selectedDriver
    ? vehicles.filter((vehicle) => !vehicle.driverId || vehicle.driverId === selectedDriver.driverCode)
    : vehicles;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === participantForm.vehicleId) || null;

  const handleDriverSelect = (driverId) => {
    const driver = drivers.find((item) => item.id === driverId) || null;
    const matchingVehicle = driver
      ? vehicles.find((vehicle) => vehicle.driverId === driver.driverCode) || null
      : null;
    setParticipantForm({
      driverId,
      vehicleId: matchingVehicle?.id || "",
      baselineSetupText: stringifyJson(buildBaseline(driver, matchingVehicle)),
      notes: "",
    });
  };

  const handleVehicleSelect = (vehicleId) => {
    const vehicle = vehicles.find((item) => item.id === vehicleId) || null;
    setParticipantForm((current) => ({
      ...current,
      vehicleId,
      baselineSetupText: stringifyJson(buildBaseline(selectedDriver, vehicle)),
    }));
  };

  const handleAddParticipant = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!participantForm.driverId) {
      setNotice({ type: "error", message: "Select a driver first." });
      return;
    }

    try {
      setSaving(true);
      await addEventParticipant(eventId, {
        driverId: participantForm.driverId,
        vehicleId: participantForm.vehicleId || null,
        baselineSetup: parseFlexibleObject(participantForm.baselineSetupText, "Baseline setup"),
        notes: participantForm.notes,
      });
      setParticipantForm({ driverId: "", vehicleId: "", baselineSetupText: "{}", notes: "" });
      await loadWeekend();
      setActiveTab("Drivers");
      setNotice({ type: "success", message: "Driver added to this event." });
    } catch (saveError) {
      setNotice({ type: "error", message: saveError?.message || "Failed to add driver." });
    } finally {
      setSaving(false);
    }
  };

  const handleScheduleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setScheduleText(text);
  };

  const handleAnalyzeSchedule = async () => {
    try {
      setSaving(true);
      const result = await analyzeEventSchedule(eventId, scheduleText);
      setDetectedSessions(result.detectedSessions || []);
      setIgnoredLines(result.ignoredLines || []);
      setNotice({
        type: "success",
        message: `${result.detectedSessions?.length || 0} schedule sessions detected.`,
      });
    } catch (scheduleError) {
      setNotice({ type: "error", message: scheduleError?.message || "Failed to analyze schedule." });
    } finally {
      setSaving(false);
    }
  };

  const updateDetectedSession = (index, field, value) => {
    setDetectedSessions((current) =>
      current.map((session, sessionIndex) =>
        sessionIndex === index ? { ...session, [field]: value } : session,
      ),
    );
  };

  const removeDetectedSession = (index) => {
    setDetectedSessions((current) => current.filter((_, sessionIndex) => sessionIndex !== index));
  };

  const handleConfirmSchedule = async () => {
    try {
      setSaving(true);
      const result = await confirmEventSchedule(eventId, detectedSessions);
      setDetectedSessions([]);
      setScheduleText("");
      await loadWeekend();
      setActiveTab("Sessions");
      setNotice({
        type: "success",
        message: `${result.createdCount} sessions created, ${result.skippedCount} duplicates skipped.`,
      });
    } catch (confirmError) {
      setNotice({ type: "error", message: confirmError?.message || "Failed to confirm schedule." });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSession = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!selectedSession || !sessionDraft) return;

    try {
      setSaving(true);
      await updateEventRaceSession(eventId, selectedSession.id, {
        title: sessionDraft.title,
        sessionType: sessionDraft.sessionType,
        sessionNumber: sessionDraft.sessionNumber,
        scheduledAt: sessionDraft.scheduledAt,
        status: sessionDraft.status,
        setupChanges: parseFlexibleObject(sessionDraft.setupChangesText, "Setup changes"),
        tireChanges: parseFlexibleObject(sessionDraft.tireChangesText, "Tire changes"),
        lapTimes: parseLapTimes(sessionDraft.lapTimesText),
        comments: sessionDraft.comments,
        observations: sessionDraft.observations,
        adjustments: sessionDraft.adjustments,
        additionalData: parseFlexibleObject(sessionDraft.additionalDataText, "Additional data"),
      });
      await loadWeekend();
      setNotice({ type: "success", message: "Race session saved with carry-forward updated." });
    } catch (sessionError) {
      setNotice({ type: "error", message: sessionError?.message || "Failed to save race session." });
    } finally {
      setSaving(false);
    }
  };

  const handleAttachmentUpload = async (file) => {
    if (!file || !selectedSession) return;
    try {
      setSaving(true);
      await uploadRaceSessionAttachment(eventId, selectedSession.id, file);
      await loadWeekend();
      setNotice({ type: "success", message: "Session photo uploaded." });
    } catch (uploadError) {
      setNotice({ type: "error", message: uploadError?.message || "Failed to upload photo." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="admin-section">
        <Loader label="Loading race weekend" sublabel="Opening event-first workspace." />
      </section>
    );
  }

  if (error) {
    return (
      <section className="admin-section">
        <EmptyState
          icon="!"
          title="Race weekend workspace unavailable"
          description={error}
          actions={
            <button type="button" className="btn btn-primary" onClick={loadWeekend}>
              Retry
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section className="admin-section race-weekend-shell">
      <div className="race-weekend-header">
        <div>
          <div className="admin-page-eyebrow">Race Weekend</div>
          <h2 className="workspace-panel-title">Event-first workspace</h2>
        </div>
        <div className="helper-pill-row">
          <StatusBadge label={`${weekend?.summary?.participant_count || 0} Drivers`} tone="accent" />
          <StatusBadge label={`${weekend?.summary?.session_count || 0} Sessions`} tone="info" />
          <StatusBadge label={`${weekend?.summary?.completed_session_count || 0} Complete`} tone="success" />
        </div>
      </div>

      <div className="race-weekend-tabs" role="tablist" aria-label="Race weekend workspace">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "active" : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Overview" ? (
        <div className="race-weekend-grid">
          <div className="workspace-panel">
            <div className="workspace-panel-header">
              <div>
                <div className="admin-page-eyebrow">Weekend Summary</div>
                <h3 className="workspace-panel-title">Drivers and sessions</h3>
              </div>
            </div>
            <div className="race-metric-grid">
              <div className="race-metric"><strong>{participants.length}</strong><span>Participating drivers</span></div>
              <div className="race-metric"><strong>{sessions.length}</strong><span>Driver sessions</span></div>
              <div className="race-metric"><strong>{weekend?.summary?.upcoming_session_count || 0}</strong><span>Open sessions</span></div>
            </div>
          </div>

          <div className="workspace-panel">
            <div className="workspace-panel-header">
              <div>
                <div className="admin-page-eyebrow">Upcoming</div>
                <h3 className="workspace-panel-title">Next sessions</h3>
              </div>
            </div>
            <div className="race-session-list compact">
              {sessions.slice(0, 6).map((session) => (
                <button key={session.id} type="button" onClick={() => { setSelectedParticipantId(session.participantId); setSelectedSessionId(session.id); setActiveTab("Sessions"); }}>
                  <span>{session.title}</span>
                  <small>{formatDateTime(session.scheduledAt)}</small>
                </button>
              ))}
              {!sessions.length ? <div className="workspace-callout">No sessions have been generated yet.</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "Drivers" ? (
        <div className="race-weekend-grid">
          <section className="workspace-panel">
            <div className="workspace-panel-header">
              <div>
                <div className="admin-page-eyebrow">Participants</div>
                <h3 className="workspace-panel-title">Event drivers</h3>
              </div>
            </div>
            <div className="race-driver-grid">
              {participants.map((participant) => (
                <button
                  key={participant.id}
                  type="button"
                  className="race-driver-card"
                  onClick={() => {
                    setSelectedParticipantId(participant.id);
                    setActiveTab("Sessions");
                  }}
                >
                  <strong>{participant.driver?.driverName || "Driver"}</strong>
                  <span>{participant.vehicle ? `${participant.vehicle.make} ${participant.vehicle.model}` : "No vehicle assigned"}</span>
                  <small>{participant.sessions.length} sessions</small>
                </button>
              ))}
              {!participants.length ? <div className="workspace-callout">Add drivers to start building this race weekend.</div> : null}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="workspace-panel-header">
              <div>
                <div className="admin-page-eyebrow">Add Driver</div>
                <h3 className="workspace-panel-title">Vehicle and baseline</h3>
              </div>
            </div>
            <form className="event-first-form" onSubmit={handleAddParticipant}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="event-driver-select">Driver</label>
                  <select id="event-driver-select" className="input" value={participantForm.driverId} onChange={(event) => handleDriverSelect(event.target.value)}>
                    <option value="">Select driver</option>
                    {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.driverName}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="event-vehicle-select">Vehicle</label>
                  <select id="event-vehicle-select" className="input" value={participantForm.vehicleId} onChange={(event) => handleVehicleSelect(event.target.value)}>
                    <option value="">No vehicle</option>
                    {vehicleOptions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleCode} - {vehicle.make} {vehicle.model}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="baseline-setup">Baseline setup</label>
                <textarea id="baseline-setup" className="input event-textarea code-textarea" value={participantForm.baselineSetupText} onChange={(event) => setParticipantForm((current) => ({ ...current, baselineSetupText: event.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="participant-notes">Notes</label>
                <textarea id="participant-notes" className="input event-textarea" value={participantForm.notes} onChange={(event) => setParticipantForm((current) => ({ ...current, notes: event.target.value }))} />
              </div>
              <div className="detail-action-bar">
                <button type="submit" className="btn btn-primary" disabled={saving}>Add Driver</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {activeTab === "Schedule" ? (
        <div className="race-weekend-grid">
          <section className="workspace-panel">
            <div className="workspace-panel-header">
              <div>
                <div className="admin-page-eyebrow">Schedule Upload</div>
                <h3 className="workspace-panel-title">Detected sessions</h3>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="schedule-file">Schedule file</label>
              <input id="schedule-file" className="input" type="file" accept=".txt,.csv,.ics" onChange={(event) => handleScheduleFile(event.target.files?.[0])} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="schedule-text">Schedule text</label>
              <textarea id="schedule-text" className="input event-textarea" value={scheduleText} onChange={(event) => setScheduleText(event.target.value)} />
            </div>
            <div className="detail-action-bar">
              <button type="button" className="btn btn-primary" disabled={saving || !scheduleText.trim()} onClick={handleAnalyzeSchedule}>Analyze Schedule</button>
            </div>
            {ignoredLines.length ? <div className="workspace-callout">{ignoredLines.length} lines ignored during detection.</div> : null}
          </section>

          <section className="workspace-panel">
            <div className="workspace-panel-header">
              <div>
                <div className="admin-page-eyebrow">Review</div>
                <h3 className="workspace-panel-title">Confirm sessions</h3>
              </div>
            </div>
            <div className="schedule-candidate-list">
              {detectedSessions.map((session, index) => (
                <div key={`${session.title}-${index}`} className="schedule-candidate">
                  <input className="input" value={session.title} onChange={(event) => updateDetectedSession(index, "title", event.target.value)} />
                  <input className="input" value={session.sessionType} onChange={(event) => updateDetectedSession(index, "sessionType", event.target.value.toUpperCase())} />
                  <input className="input" type="number" min="1" value={session.sessionNumber} onChange={(event) => updateDetectedSession(index, "sessionNumber", Number(event.target.value || 1))} />
                  <input className="input" type="datetime-local" value={toDateTimeInput(session.scheduledAt)} onChange={(event) => updateDetectedSession(index, "scheduledAt", event.target.value ? new Date(event.target.value).toISOString() : null)} />
                  <button type="button" className="btn btn-secondary" onClick={() => removeDetectedSession(index)}>Remove</button>
                </div>
              ))}
              {!detectedSessions.length ? <div className="workspace-callout">Analyze a schedule to review sessions here.</div> : null}
            </div>
            <div className="detail-action-bar">
              <button type="button" className="btn btn-primary" disabled={saving || !detectedSessions.length || !participants.length} onClick={handleConfirmSchedule}>Confirm Schedule</button>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "Sessions" ? (
        <div className="race-session-workbench">
          <aside className="workspace-panel race-session-sidebar">
            <div className="form-group">
              <label className="form-label" htmlFor="participant-filter">Driver</label>
              <select id="participant-filter" className="input" value={selectedParticipant?.id || ""} onChange={(event) => { setSelectedParticipantId(event.target.value); setSelectedSessionId(""); }}>
                {participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.driver?.driverName || "Driver"}</option>)}
              </select>
            </div>
            <div className="race-session-list">
              {participantSessions.map((session) => (
                <button key={session.id} type="button" className={selectedSession?.id === session.id ? "active" : ""} onClick={() => setSelectedSessionId(session.id)}>
                  <span>{session.title}</span>
                  <small>{formatDateTime(session.scheduledAt)}</small>
                </button>
              ))}
              {!participantSessions.length ? <div className="workspace-callout">No sessions for this driver yet.</div> : null}
            </div>
          </aside>

          <section className="workspace-panel">
            {selectedSession && sessionDraft ? (
              <form className="event-first-form" onSubmit={handleSaveSession}>
                <div className="workspace-panel-header">
                  <div>
                    <div className="admin-page-eyebrow">Session Data</div>
                    <h3 className="workspace-panel-title">{selectedParticipant?.driver?.driverName || "Driver"} - {selectedSession.title}</h3>
                    <p className="workspace-panel-subtitle">{selectedParticipant?.vehicle ? `${selectedParticipant.vehicle.make} ${selectedParticipant.vehicle.model}` : "Vehicle not assigned"} · {formatDateTime(selectedSession.scheduledAt)}</p>
                  </div>
                  <StatusBadge label={selectedSession.status} tone={selectedSession.status === "COMPLETED" ? "success" : "warning"} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="session-title">Session</label>
                    <input id="session-title" className="input" value={sessionDraft.title} onChange={(event) => setSessionDraft((current) => ({ ...current, title: event.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="session-status">Status</label>
                    <select id="session-status" className="input" value={sessionDraft.status} onChange={(event) => setSessionDraft((current) => ({ ...current, status: event.target.value }))}>
                      {SESSION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="setup-changes">Setup changes</label>
                    <textarea id="setup-changes" className="input event-textarea code-textarea" value={sessionDraft.setupChangesText} onChange={(event) => setSessionDraft((current) => ({ ...current, setupChangesText: event.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="tire-changes">Tire pressures and temperatures</label>
                    <textarea id="tire-changes" className="input event-textarea code-textarea" value={sessionDraft.tireChangesText} onChange={(event) => setSessionDraft((current) => ({ ...current, tireChangesText: event.target.value }))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="lap-times">Lap times</label>
                  <textarea id="lap-times" className="input event-textarea code-textarea" value={sessionDraft.lapTimesText} onChange={(event) => setSessionDraft((current) => ({ ...current, lapTimesText: event.target.value }))} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="comments">Comments</label>
                    <textarea id="comments" className="input event-textarea" value={sessionDraft.comments} onChange={(event) => setSessionDraft((current) => ({ ...current, comments: event.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="observations">Observations</label>
                    <textarea id="observations" className="input event-textarea" value={sessionDraft.observations} onChange={(event) => setSessionDraft((current) => ({ ...current, observations: event.target.value }))} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="adjustments">Adjustments</label>
                    <textarea id="adjustments" className="input event-textarea" value={sessionDraft.adjustments} onChange={(event) => setSessionDraft((current) => ({ ...current, adjustments: event.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="additional-data">Other data</label>
                    <textarea id="additional-data" className="input event-textarea code-textarea" value={sessionDraft.additionalDataText} onChange={(event) => setSessionDraft((current) => ({ ...current, additionalDataText: event.target.value }))} />
                  </div>
                </div>
                <div className="session-state-grid">
                  <div>
                    <strong>Starting setup</strong>
                    <pre>{stringifyJson(selectedSession.setupData?.starting)}</pre>
                  </div>
                  <div>
                    <strong>Final setup</strong>
                    <pre>{stringifyJson(selectedSession.setupData?.final)}</pre>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="session-photo">Photos</label>
                  <input id="session-photo" className="input" type="file" accept="image/*" onChange={(event) => handleAttachmentUpload(event.target.files?.[0])} />
                  <div className="attachment-list">
                    {selectedSession.attachments.map((attachment) => <span key={attachment.id}>{attachment.filename}</span>)}
                  </div>
                </div>
                <div className="detail-action-bar">
                  <button type="submit" className="btn btn-primary" disabled={saving}>Save Session</button>
                </div>
              </form>
            ) : (
              <EmptyState icon="SESSION" title="No session selected" description="Generate sessions from the event schedule first." />
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "Review" ? (
        <div className="workspace-panel">
          <div className="workspace-panel-header">
            <div>
              <div className="admin-page-eyebrow">Review</div>
              <h3 className="workspace-panel-title">Weekend comparison</h3>
            </div>
          </div>
          <div className="review-driver-list">
            {participants.map((participant) => (
              <div key={participant.id} className="review-driver-block">
                <h4>{participant.driver?.driverName || "Driver"}</h4>
                <div className="review-session-grid">
                  {participant.sessions.map((session) => (
                    <button key={session.id} type="button" onClick={() => { setSelectedParticipantId(participant.id); setSelectedSessionId(session.id); setActiveTab("Sessions"); }}>
                      <strong>{session.title}</strong>
                      <span>{formatDateTime(session.scheduledAt)}</span>
                      <small>Setup: {formatChangeSummary(session.setupDiff)}</small>
                      <small>Tires: {formatChangeSummary(session.tireDiff)}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!participants.length ? <div className="workspace-callout">Add drivers and sessions to review the weekend.</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
