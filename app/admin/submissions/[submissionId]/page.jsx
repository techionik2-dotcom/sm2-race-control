"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Loader from "../../../components/Common/Loader";

export default function LegacySubmissionDetailRedirectPage() {
  const router = useRouter();
  const params = useParams();

  useEffect(() => {
    const rawId = params?.submissionId;
    const idValue = Array.isArray(rawId) ? rawId[0] || null : rawId || null;

    if (!idValue) {
      router.replace("/admin/submissions");
      return;
    }

    router.replace(`/admin/submissions/report/${encodeURIComponent(String(idValue))}`);
  }, [params?.submissionId, router]);

  return (
    <Loader
      label="Opening detailed report"
      sublabel="Redirecting to the new professional report screen."
      fullHeight
    />
  );
}
