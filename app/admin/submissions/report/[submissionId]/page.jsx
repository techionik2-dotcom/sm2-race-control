"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";

import ProtectedRoute from "../../../../components/ProtectedRoute";
import Loader from "../../../../components/Common/Loader";
import { getAllSubmissions, getSubmissionById } from "../../../../utils/submissionApi";
import { getApiErrorMessage } from "../../../fleet/_components/fleetManagementHelpers";
import {
  getSubmissionId,
  mockSubmissions,
} from "../../_components/submissionReviewHelpers";
import SubmissionDetailScreen from "../../_components/SubmissionDetailScreen";
import "../../../fleet/fleetManagement.css";
import "../../SubmissionReview.css";

const findSubmissionById = (items = [], submissionId) =>
  items.find((item) => String(getSubmissionId(item)) === String(submissionId)) || null;

export default function SubmissionDetailReportPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedSubmissionId = useMemo(() => {
    const rawId = params?.submissionId;
    const idValue = Array.isArray(rawId) ? rawId[0] || null : rawId || null;
    if (!idValue) return null;

    try {
      return decodeURIComponent(idValue);
    } catch {
      return idValue;
    }
  }, [params?.submissionId]);

  const startInEditMode = useMemo(() => {
    const editParam = searchParams?.get("edit");
    const modeParam = searchParams?.get("mode");
    return editParam === "1" || editParam === "true" || modeParam === "edit";
  }, [searchParams]);

  const [submission, setSubmission] = useState(null);
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewTone, setPreviewTone] = useState("warning");

  const loadSubmission = useCallback(async () => {
    if (!resolvedSubmissionId) {
      setPageError("Missing submission ID in route.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError("");
    setPreviewMessage("");
    setPreviewTone("warning");

    const [detailResult, listResult] = await Promise.allSettled([
      getSubmissionById(resolvedSubmissionId),
      getAllSubmissions(),
    ]);

    const list =
      listResult.status === "fulfilled"
        ? Array.isArray(listResult.value)
          ? listResult.value
          : listResult.value?.submissions || []
        : [];

    let selected =
      detailResult.status === "fulfilled" ? detailResult.value : null;

    if (!selected) {
      selected = findSubmissionById(list, resolvedSubmissionId);
    }

    if (!selected) {
      selected = findSubmissionById(mockSubmissions, resolvedSubmissionId);
      if (selected) {
        setPreviewTone("warning");
        setPreviewMessage(
          "Preview mode: this submission was loaded from local demo data because the API record was unavailable.",
        );
      }
    }

    if (!selected) {
      const detailError =
        detailResult.status === "rejected"
          ? getApiErrorMessage(detailResult.reason, "")
          : "";
      const listError =
        listResult.status === "rejected"
          ? getApiErrorMessage(listResult.reason, "")
          : "";

      const combined = [detailError, listError]
        .filter(Boolean)
        .join(" | ");

      setPageError(
        combined ||
          "Submission not found. It may have been deleted or your API is currently unavailable.",
      );
      setLoading(false);
      return;
    }

    if (detailResult.status === "rejected" || listResult.status === "rejected") {
      setPreviewTone("warning");
      setPreviewMessage(
        "Partial API availability detected. The screen is loaded with fallback data where needed.",
      );
    }

    setSubmission(selected);
    setAllSubmissions(list.length ? list : [selected]);
    setLoading(false);
  }, [resolvedSubmissionId]);

  useEffect(() => {
    loadSubmission();
  }, [loadSubmission]);

  return (
    <ProtectedRoute allowedRoles={["OWNER"]}>
      {loading ? (
        <Loader
          label="Loading detailed submission report"
          sublabel="Fetching raw, parsed, validation, and audit data."
          fullHeight
        />
      ) : pageError ? (
        <div className="submission-detail-empty-shell">
          <div className="submission-monitor-error">{pageError}</div>
          <button
            type="button"
            className="fleet-btn fleet-btn-secondary"
            onClick={() => router.push("/admin/submissions")}
          >
            <ArrowBackOutlinedIcon fontSize="inherit" />
            Back
          </button>
        </div>
      ) : (
        <SubmissionDetailScreen
          submission={submission}
          allSubmissions={allSubmissions}
          previewMessage={previewMessage}
          previewTone={previewTone}
          initialEditMode={startInEditMode}
        />
      )}
    </ProtectedRoute>
  );
}
