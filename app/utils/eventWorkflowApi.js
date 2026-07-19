import axiosInstance from "./axiosInstance";
import { normalizeDriver, normalizeEvent, normalizeList, normalizeVehicle } from "./apiTransforms";

const unwrapError = (error, fallbackMessage) => {
  console.error("Event workflow API error:", {
    url: error.config?.url,
    status: error.response?.status,
    data: error.response?.data,
  });
  throw {
    status: error.response?.status || null,
    message:
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      fallbackMessage,
    data: error.response?.data || null,
  };
};

const normalizeAttachment = (attachment) => {
  if (!attachment) return null;
  const id = attachment.id || attachment._id || null;
  return {
    ...attachment,
    id,
    _id: id,
    sessionId: attachment.session_id || attachment.sessionId || null,
    filename: attachment.filename || "",
    contentType: attachment.content_type || attachment.contentType || "",
    sizeBytes: attachment.size_bytes ?? attachment.sizeBytes ?? 0,
    createdAt: attachment.created_at || attachment.createdAt || null,
    updatedAt: attachment.updated_at || attachment.updatedAt || null,
  };
};

export const normalizeRaceSession = (session) => {
  if (!session) return null;
  const id = session.id || session._id || null;
  return {
    ...session,
    id,
    _id: id,
    eventId: session.event_id || session.eventId || null,
    participantId: session.participant_id || session.participantId || null,
    title: session.title || "",
    sessionType: session.session_type || session.sessionType || "",
    sessionNumber: session.session_number ?? session.sessionNumber ?? 1,
    scheduledAt: session.scheduled_at || session.scheduledAt || null,
    status: session.status || "PLANNED",
    source: session.source || "schedule",
    setupData: session.setup_data || session.setupData || { starting: {}, changes: {}, final: {} },
    tireData: session.tire_data || session.tireData || { starting: {}, changes: {}, final: {} },
    lapTimes: Array.isArray(session.lap_times || session.lapTimes) ? session.lap_times || session.lapTimes : [],
    comments: session.comments || "",
    observations: session.observations || "",
    adjustments: session.adjustments || "",
    additionalData: session.additional_data || session.additionalData || {},
    carriedFromSessionId: session.carried_from_session_id || session.carriedFromSessionId || null,
    setupDiff: session.setup_diff || session.setupDiff || {},
    tireDiff: session.tire_diff || session.tireDiff || {},
    attachments: normalizeList(session.attachments || [], normalizeAttachment),
    createdAt: session.created_at || session.createdAt || null,
    updatedAt: session.updated_at || session.updatedAt || null,
  };
};

export const normalizeEventParticipant = (participant) => {
  if (!participant) return null;
  const id = participant.id || participant._id || null;
  return {
    ...participant,
    id,
    _id: id,
    eventId: participant.event_id || participant.eventId || null,
    driverId: participant.driver_id || participant.driverId || null,
    vehicleId: participant.vehicle_id || participant.vehicleId || null,
    baselineSetup: participant.baseline_setup || participant.baselineSetup || {},
    notes: participant.notes || "",
    isActive: participant.is_active ?? participant.isActive ?? true,
    driver: normalizeDriver(participant.driver),
    vehicle: normalizeVehicle(participant.vehicle),
    sessions: normalizeList(participant.sessions || [], normalizeRaceSession),
    createdAt: participant.created_at || participant.createdAt || null,
    updatedAt: participant.updated_at || participant.updatedAt || null,
  };
};

const normalizeScheduleCandidate = (candidate) => ({
  title: candidate.title || "",
  sessionType: candidate.session_type || candidate.sessionType || "",
  sessionNumber: candidate.session_number ?? candidate.sessionNumber ?? 1,
  scheduledAt: candidate.scheduled_at || candidate.scheduledAt || null,
  runGroup: candidate.run_group || candidate.runGroup || null,
  rawText: candidate.raw_text || candidate.rawText || "",
});

const toSchedulePayload = (candidate) => ({
  title: candidate.title,
  session_type: candidate.sessionType || candidate.session_type,
  session_number: Number(candidate.sessionNumber || candidate.session_number || 1),
  scheduled_at: candidate.scheduledAt || candidate.scheduled_at || null,
  run_group: candidate.runGroup || candidate.run_group || null,
  raw_text: candidate.rawText || candidate.raw_text || null,
});

export const getEventWeekendWorkspace = async (eventId) => {
  try {
    const response = await axiosInstance.get(`/events/${eventId}/workspace`);
    const data = response.data || {};
    return {
      event: normalizeEvent(data.event),
      participants: normalizeList(data.participants || [], normalizeEventParticipant),
      sessions: normalizeList(data.sessions || [], normalizeRaceSession),
      summary: data.summary || {
        participant_count: 0,
        session_count: 0,
        completed_session_count: 0,
        upcoming_session_count: 0,
      },
    };
  } catch (error) {
    unwrapError(error, "Failed to load race weekend workspace.");
  }
};

export const addEventParticipant = async (eventId, payload) => {
  try {
    const response = await axiosInstance.post(`/events/${eventId}/participants`, {
      driver_id: payload.driverId || payload.driver_id,
      vehicle_id: payload.vehicleId || payload.vehicle_id || null,
      baseline_setup: payload.baselineSetup || payload.baseline_setup || {},
      notes: payload.notes || null,
    });
    return normalizeEventParticipant(response.data);
  } catch (error) {
    unwrapError(error, "Failed to add event participant.");
  }
};

export const analyzeEventSchedule = async (eventId, scheduleText) => {
  try {
    const response = await axiosInstance.post(`/events/${eventId}/schedule/analyze`, {
      schedule_text: scheduleText,
    });
    return {
      detectedSessions: normalizeList(response.data?.detected_sessions || [], normalizeScheduleCandidate),
      ignoredLines: response.data?.ignored_lines || [],
    };
  } catch (error) {
    unwrapError(error, "Failed to analyze event schedule.");
  }
};

export const confirmEventSchedule = async (eventId, candidates) => {
  try {
    const response = await axiosInstance.post(`/events/${eventId}/schedule/confirm`, {
      sessions: candidates.map(toSchedulePayload),
    });
    return {
      createdCount: response.data?.created_count ?? 0,
      skippedCount: response.data?.skipped_count ?? 0,
      sessions: normalizeList(response.data?.sessions || [], normalizeRaceSession),
    };
  } catch (error) {
    unwrapError(error, "Failed to confirm event schedule.");
  }
};

export const updateEventRaceSession = async (eventId, sessionId, payload) => {
  try {
    const response = await axiosInstance.patch(`/events/${eventId}/sessions/${sessionId}`, {
      title: payload.title,
      session_type: payload.sessionType,
      session_number: Number(payload.sessionNumber || 1),
      scheduled_at: payload.scheduledAt || null,
      status: payload.status,
      setup_changes: payload.setupChanges || {},
      tire_changes: payload.tireChanges || {},
      lap_times: Array.isArray(payload.lapTimes) ? payload.lapTimes : [],
      comments: payload.comments || null,
      observations: payload.observations || null,
      adjustments: payload.adjustments || null,
      additional_data: payload.additionalData || {},
    });
    return normalizeRaceSession(response.data);
  } catch (error) {
    unwrapError(error, "Failed to save race session.");
  }
};

export const uploadRaceSessionAttachment = async (eventId, sessionId, file) => {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await axiosInstance.post(
      `/events/${eventId}/sessions/${sessionId}/attachments`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return normalizeAttachment(response.data);
  } catch (error) {
    unwrapError(error, "Failed to upload session attachment.");
  }
};
