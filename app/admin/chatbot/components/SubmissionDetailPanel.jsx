"use client"

import SubmissionReviewWorkspace from "../../submissions/_components/SubmissionReviewWorkspace"

export default function SubmissionDetailPanel({ item }) {
  if (!item) {
    return null
  }

  return <SubmissionReviewWorkspace item={item} />
}
