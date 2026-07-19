"use client";

import { useEffect, useState } from "react";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";

import { fetchVoiceAudioBlob } from "../../../utils/voiceNotesApi";

export default function ProtectedAudioPlayer({
  voiceSessionId = null,
  src = "",
  downloadName = "voice-note.webm",
  className = "",
}) {
  const [audioUrl, setAudioUrl] = useState(src || "");
  const [loading, setLoading] = useState(Boolean(voiceSessionId));
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl = "";

    const loadAudio = async () => {
      if (!voiceSessionId) {
        setAudioUrl(src || "");
        setLoading(false);
        setError("");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const blob = await fetchVoiceAudioBlob(voiceSessionId);
        if (!active) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
        setLoading(false);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setAudioUrl("");
        setLoading(false);
        setError(loadError?.message || "Unable to load the protected audio recording.");
      }
    };

    loadAudio();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [retryKey, src, voiceSessionId]);

  const handleRetry = () => setRetryKey((current) => current + 1);

  return (
    <div className={`submission-protected-audio ${className}`.trim()}>
      {loading ? (
        <div className="submission-image-empty">
          <span>Loading protected audio...</span>
        </div>
      ) : error ? (
        <div className="submission-image-empty">
          <ErrorOutlineOutlinedIcon fontSize="inherit" />
          <span>{error}</span>
          <button type="button" className="fleet-btn fleet-btn-secondary" onClick={handleRetry}>
            <ReplayRoundedIcon fontSize="inherit" />
            Retry
          </button>
        </div>
      ) : audioUrl ? (
        <>
          <audio className="submission-detail-audio" controls src={audioUrl} />
          <a className="fleet-btn fleet-btn-secondary submission-detail-attachment-link" href={audioUrl} download={downloadName}>
            <DownloadOutlinedIcon fontSize="inherit" />
            Download
          </a>
        </>
      ) : (
        <div className="submission-image-empty">
          <span>No audio recording is available.</span>
        </div>
      )}
    </div>
  );
}
