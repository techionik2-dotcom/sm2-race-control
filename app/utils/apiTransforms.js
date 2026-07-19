export const toApiDate = (value) => {
  if (!value) {
    return value;
  }

  if (typeof value === "string" && value.includes("T")) {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

export const normalizeUser = (user) => {
  if (!user) return null;

  const id = user.id || user._id || user.user_id || user.userId || null;
  const isActive = user.is_active ?? user.isActive ?? true;
  const approvalStatus = String(
    user.approval_status ||
      user.approvalStatus ||
      (isActive ? "APPROVED" : "PENDING"),
  ).toUpperCase();

  return {
    ...user,
    id,
    _id: id,
    role: user.role || user.userRole || "DRIVER",
    approvalStatus,
    isPendingApproval: approvalStatus === "PENDING",
    isRejected: approvalStatus === "REJECTED",
    isActive,
    lastLoginAt: user.last_login_at || user.lastLoginAt || null,
    lastLogoutAt: user.last_logout_at || user.lastLogoutAt || null,
    approvedAt: user.approved_at || user.approvedAt || null,
    approvedById: user.approved_by_id || user.approvedById || null,
    rejectedAt: user.rejected_at || user.rejectedAt || null,
    rejectedById: user.rejected_by_id || user.rejectedById || null,
    activeEventId: user.active_event_id || user.activeEventId || null,
    createdAt: user.created_at || user.createdAt || null,
    updatedAt: user.updated_at || user.updatedAt || null,
  };
};

export const normalizeEvent = (event) => {
  if (!event) return null;

  const id = event.id || event._id || null;

  return {
    ...event,
    id,
    _id: id,
    startDate: event.start_date || event.startDate || null,
    endDate: event.end_date || event.endDate || null,
    createdById: event.created_by_id || event.createdById || null,
    isActive: event.is_active ?? event.isActive ?? true,
    notes: event.notes || event.description || event.event_notes || null,
    createdAt: event.created_at || event.createdAt || null,
    updatedAt: event.updated_at || event.updatedAt || null,
  };
};

export const normalizeRunGroup = (runGroup) => {
  if (!runGroup) return null;

  const id = runGroup.id || runGroup._id || null;

  return {
    ...runGroup,
    id,
    _id: id,
    eventId: runGroup.event_id || runGroup.eventId || null,
    rawText: runGroup.raw_text || runGroup.rawText || null,
    normalized: runGroup.normalized || null,
    createdById: runGroup.created_by_id || runGroup.createdById || null,
    locked: runGroup.locked ?? false,
    createdAt: runGroup.created_at || runGroup.createdAt || null,
    updatedAt: runGroup.updated_at || runGroup.updatedAt || null,
  };
};

const normalizeStringList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const normalizeStructuredWarnings = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((warning) =>
      warning && typeof warning === "object"
        ? {
            ...warning,
            section: warning.section || "structured_ingest",
            code: warning.code || "STRUCTURED_WARNING",
            message: warning.message || "Structured normalization completed with a warning.",
          }
        : null,
    )
    .filter(Boolean);
};

const normalizeVoiceAttempt = (attempt) => {
  if (!attempt || typeof attempt !== "object") return null;

  return {
    ...attempt,
    id: attempt.id || attempt._id || null,
    voiceSessionId: attempt.voice_session_id || attempt.voiceSessionId || null,
    attemptNumber: attempt.attempt_number || attempt.attemptNumber || null,
    attemptStatus: attempt.attempt_status || attempt.attemptStatus || null,
    provider: attempt.provider || "openai",
    transcriptText: attempt.transcript_text || attempt.transcriptText || null,
    confidence: attempt.confidence ?? null,
    requestId: attempt.request_id || attempt.requestId || null,
    errorCode: attempt.error_code || attempt.errorCode || null,
    errorMessage: attempt.error_message || attempt.errorMessage || null,
  };
};

const normalizeVoiceSession = (voiceSession) => {
  if (!voiceSession) return null;

  const id = voiceSession.id || voiceSession._id || null;
  const attempts = Array.isArray(voiceSession.attempts)
    ? voiceSession.attempts.map(normalizeVoiceAttempt).filter(Boolean)
    : [];

  return {
    ...voiceSession,
    id,
    _id: id,
    submissionId: voiceSession.submission_id || voiceSession.submissionId || null,
    eventId: voiceSession.event_id || voiceSession.eventId || null,
    runGroupId: voiceSession.run_group_id || voiceSession.runGroupId || null,
    createdById: voiceSession.created_by_id || voiceSession.createdById || null,
    clientSessionId: voiceSession.client_session_id || voiceSession.clientSessionId || null,
    status: voiceSession.status || "DRAFT",
    validationStatus: voiceSession.validation_status || voiceSession.validationStatus || "PENDING",
    validationMessage: voiceSession.validation_message || voiceSession.validationMessage || null,
    audioStorageKey: voiceSession.audio_storage_key || voiceSession.audioStorageKey || null,
    audioFileName: voiceSession.audio_file_name || voiceSession.audioFileName || null,
    audioContentType: voiceSession.audio_content_type || voiceSession.audioContentType || null,
    audioSizeBytes: voiceSession.audio_size_bytes || voiceSession.audioSizeBytes || null,
    audioDurationMs: voiceSession.audio_duration_ms || voiceSession.audioDurationMs || null,
    audioChecksum: voiceSession.audio_checksum || voiceSession.audioChecksum || null,
    audioLanguage: voiceSession.audio_language || voiceSession.audioLanguage || null,
    transcriptText: voiceSession.transcript_edited_text || voiceSession.transcriptEditedText || voiceSession.transcript_text || voiceSession.transcriptText || null,
    transcriptEditedText: voiceSession.transcript_edited_text || voiceSession.transcriptEditedText || null,
    transcriptConfidence: voiceSession.transcript_confidence || voiceSession.transcriptConfidence || null,
    transcriptWordCount: voiceSession.transcript_word_count || voiceSession.transcriptWordCount || null,
    transcriptJson: voiceSession.transcript_json || voiceSession.transcriptJson || null,
    transcriptionProvider:
      voiceSession.transcription_provider ||
      voiceSession.transcriptionProvider ||
      voiceSession.deepgram_request_json?.provider ||
      voiceSession.deepgramRequestJson?.provider ||
      "openai",
    openaiRequestId:
      voiceSession.openai_request_id ||
      voiceSession.openaiRequestId ||
      voiceSession.deepgram_request_id ||
      voiceSession.deepgramRequestId ||
      null,
    openaiModel:
      voiceSession.openai_model ||
      voiceSession.openaiModel ||
      voiceSession.deepgram_model ||
      voiceSession.deepgramModel ||
      null,
    deepgramRequestJson: voiceSession.deepgram_request_json || voiceSession.deepgramRequestJson || null,
    deepgramResponseJson: voiceSession.deepgram_response_json || voiceSession.deepgramResponseJson || null,
    deepgramRequestId: voiceSession.deepgram_request_id || voiceSession.deepgramRequestId || null,
    deepgramModel: voiceSession.deepgram_model || voiceSession.deepgramModel || null,
    retryCount: voiceSession.retry_count || voiceSession.retryCount || 0,
    uploadedAt: voiceSession.uploaded_at || voiceSession.uploadedAt || null,
    transcribedAt: voiceSession.transcribed_at || voiceSession.transcribedAt || null,
    confirmedAt: voiceSession.confirmed_at || voiceSession.confirmedAt || null,
    submittedAt: voiceSession.submitted_at || voiceSession.submittedAt || null,
    archivedAt: voiceSession.archived_at || voiceSession.archivedAt || null,
    lastErrorCode: voiceSession.last_error_code || voiceSession.lastErrorCode || null,
    lastErrorMessage: voiceSession.last_error_message || voiceSession.lastErrorMessage || null,
    audioDownloadUrl: voiceSession.audio_download_url || voiceSession.audioDownloadUrl || null,
    attempts,
  };
};

export const normalizeDriver = (driver) => {
  if (!driver) return null;

  const id = driver.id || driver._id || driver.driver_id || driver.driverId || null;
  const firstName = driver.first_name || driver.firstName || "";
  const lastName = driver.last_name || driver.lastName || "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const displayName =
    driver.display_name ||
    driver.displayName ||
    driver.team_name ||
    driver.teamName ||
    "";

  return {
    ...driver,
    id,
    _id: id,
    driverCode: driver.driver_id || driver.driverId || "",
    firstName,
    lastName,
    fullName: fullName || driver.driver_name || driver.driverName || displayName || "",
    driverName: driver.driver_name || driver.driverName || fullName || displayName || "",
    displayName,
    teamName: driver.team_name || driver.teamName || displayName || "",
    licenseNumber: driver.license_number || driver.licenseNumber || "",
    aliases: normalizeStringList(driver.aliases || driver.alias_list || driver.aliasList),
    notes: driver.notes || driver.description || "",
    isActive: driver.is_active ?? driver.isActive ?? true,
    createdById: driver.created_by_id || driver.createdById || null,
    createdAt: driver.created_at || driver.createdAt || null,
    updatedAt: driver.updated_at || driver.updatedAt || null,
  };
};

export const normalizeVehicle = (vehicle) => {
  if (!vehicle) return null;

  const id = vehicle.id || vehicle._id || vehicle.vehicle_id || vehicle.vehicleId || null;

  return {
    ...vehicle,
    id,
    _id: id,
    vehicleCode: vehicle.vehicle_id || vehicle.vehicleId || "",
    driverId: vehicle.driver_id || vehicle.driverId || null,
    make: vehicle.make || "",
    model: vehicle.model || "",
    year: vehicle.year ?? null,
    vin: vehicle.vin || vehicle.vehicle_identification_number || "",
    registrationNumber:
      vehicle.registration_number ||
      vehicle.registrationNumber ||
      vehicle.car_number ||
      vehicle.carNumber ||
      "",
    vehicleClass:
      vehicle.vehicle_class || vehicle.class || vehicle.vehicleClass || "",
    wheelbaseMm: vehicle.wheelbase_mm ?? vehicle.wheelbaseMm ?? null,
    notes: vehicle.notes || vehicle.description || "",
    isActive: vehicle.is_active ?? vehicle.isActive ?? true,
    createdAt: vehicle.created_at || vehicle.createdAt || null,
    updatedAt: vehicle.updated_at || vehicle.updatedAt || null,
  };
};

export const normalizeTrack = (track) => {
  if (!track) return null;

  const id = track.id || track._id || track.track_id || track.trackId || track.name || track.track_name || null;
  const trackName = track.track_name || track.trackName || track.name || "";
  const displayName =
    track.display_name ||
    track.displayName ||
    track.name ||
    trackName;
  const shortCode = track.short_code || track.shortCode || track.code || "";
  const country = track.country || track.country_name || track.countryName || "";
  const isActive =
    track.is_active ??
    track.isActive ??
    track.active ??
    (typeof track.status === "string" ? track.status.toLowerCase() !== "archived" : true);

  return {
    ...track,
    id,
    _id: id,
    trackName,
    displayName: displayName || trackName,
    shortCode: String(shortCode || "").toUpperCase(),
    country,
    latitude: track.latitude ?? track.lat ?? null,
    longitude: track.longitude ?? track.lng ?? track.lon ?? null,
    notes: track.notes || track.description || "",
    status: String(track.status || "").toLowerCase() || (isActive ? "active" : "archived"),
    isActive,
    archivedAt: track.archived_at || track.archivedAt || null,
    createdAt: track.created_at || track.createdAt || null,
    updatedAt: track.updated_at || track.updatedAt || null,
  };
};

export const normalizeSubmission = (submission) => {
  if (!submission) return null;

  const id = submission.id || submission._id || null;
  const runGroup = normalizeRunGroup(submission.run_group || submission.runGroup);
  const event = normalizeEvent(submission.event);
  const payload = submission.payload || submission.data || {};
  const analysisResult = submission.analysis_result || submission.analysisResult || {};
  const voiceSession = normalizeVoiceSession(submission.voice_session || submission.voiceSession);
  const sessionPayload =
    payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
      ? payload.data
      : payload;
  const structuredIngestWarnings = normalizeStructuredWarnings(
    submission.structured_ingest_warnings || submission.structuredIngestWarnings,
  );

  return {
    ...submission,
    id,
    _id: id,
    submissionId: submission.submission_ref || submission.submissionId || id,
    correlationId: submission.correlation_id || submission.correlationId || null,
    eventId: submission.event_id || submission.eventId || event?.id || null,
    runGroup:
      runGroup?.normalized ||
      runGroup?.rawText ||
      submission.runGroup ||
      null,
    run_group: runGroup,
    event,
    driver: normalizeDriver(submission.driver),
    vehicle: normalizeVehicle(submission.vehicle),
    voice_session: voiceSession,
    voiceSession,
    voiceSessionId: submission.voice_session_id || submission.voiceSessionId || voiceSession?.id || null,
    hasVoiceNotes: Boolean(
      analysisResult?.has_voice_notes ||
      analysisResult?.hasVoiceNotes ||
      analysisResult?.voice_input_used ||
      analysisResult?.voiceInputUsed ||
      voiceSession,
    ),
    createdByUser: submission.created_by_user || submission.createdByUser || null,
    userId: submission.created_by_id || submission.userId || null,
    raw_text: submission.raw_text || submission.rawText || "",
    image: submission.image_url || submission.image || null,
    data: sessionPayload,
    payload,
    analysis_result: analysisResult,
    analysisResult,
    submissionMode:
      analysisResult?.submission_mode || analysisResult?.submissionMode || null,
    sourceType:
      analysisResult?.source_type ||
      analysisResult?.sourceType ||
      (voiceSession ? "voice" : null),
    structuredOnly:
      analysisResult?.structured_only ?? analysisResult?.structuredOnly ?? false,
    hasStructuredData:
      analysisResult?.has_structured_data ?? analysisResult?.hasStructuredData ?? false,
    hasRawText:
      analysisResult?.has_raw_text ?? analysisResult?.hasRawText ?? false,
    hasImage:
      analysisResult?.has_image ?? analysisResult?.hasImage ?? false,
    structuredIngestStatus:
      submission.structured_ingest_status ||
      submission.structuredIngestStatus ||
      (structuredIngestWarnings.length ? "saved_with_warnings" : "skipped"),
    structuredIngestWarnings,
    hasStructuredWarnings: structuredIngestWarnings.length > 0,
    confidence:
      analysisResult?.confidence ??
      analysisResult?.confidence_score ??
      submission.confidence ??
      payload?.confidence ??
      null,
    status: submission.status || "PENDING",
    errorMessage: submission.error_message || submission.errorMessage || null,
    createdAt: submission.created_at || submission.createdAt || null,
    updatedAt: submission.updated_at || submission.updatedAt || null,
  };
};

export const normalizeList = (items, normalizer) =>
  Array.isArray(items) ? items.map(normalizer).filter(Boolean) : [];
