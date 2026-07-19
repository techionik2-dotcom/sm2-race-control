import {
  Drawer,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Divider,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import SubmissionPreview from "./SubmissionPreview";
import { getSubmissionById } from "../../utils/submissionApi"; // path adjust karo
import Button from "@mui/material/Button";
import DownloadIcon from "@mui/icons-material/Download";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import { downloadSubmissionPDF } from "../../utils/pdfUtils";

export default function SubmissionDrawer({ open, onClose, submissionId }) {
  const router = useRouter();
  const { user, isOwner } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!submissionId || !open) return;

    const fetchSubmission = async () => {
      setLoading(true);
      setError("");
      setData(null);

      try {
        const response = await getSubmissionById(submissionId);
        setData(response);
      } catch (err) {
        setError(err?.message || err?.error || "Failed to load submission");
      } finally {
        setLoading(false);
      }
    };

    fetchSubmission();
  }, [submissionId, open]);
  const previewId = useMemo(
    () => `submission-preview-${submissionId}`,
    [submissionId],
  );
  const currentUserId = String(user?.id || user?._id || user?.userId || "").trim();
  const canEditSubmission = Boolean(
    data &&
        (isOwner() || (currentUserId && String(data?.userId || data?.created_by_id || "") === currentUserId)),
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { overflowY: "auto" },
      }}
    >
      <Box
        sx={{
          width: { xs: "100vw", sm: 600, md: 900, lg: 1000 },
          p: { xs: 2, sm: 3, md: 4 },
          maxWidth: "100vw",
          overflowX: "hidden",
        }}
      >
        <Typography variant="h4" fontWeight={800} align="center">
          Submission Preview
        </Typography>
        <Divider sx={{ my: 2 }} />

        {loading && (
          <Box sx={{ textAlign: "center", mt: 5 }}>
            <CircularProgress />
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {data && data._id && (
          <SubmissionPreview data={data} previewId={previewId} />
        )}
        {data && (
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={() => downloadSubmissionPDF(previewId)}
            >
              Download PDF
            </Button>
            {canEditSubmission ? (
              <Button
                variant="outlined"
                startIcon={<EditRoundedIcon />}
                onClick={() => {
                  const eventId = data?.eventId || data?.event_id || data?.event?.id;
                  if (!eventId) return;
                  const tab = String(data?.submissionMode || data?.analysis_result?.submission_mode || "")
                    .trim()
                    .toLowerCase() === "detail"
                    ? "detail"
                    : "quick";
                  router.push(`/event/${eventId}/notes?submissionId=${data.id || data._id || submissionId}&tab=${tab}`);
                  onClose?.();
                }}
              >
                Overwrite
              </Button>
            ) : null}
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
