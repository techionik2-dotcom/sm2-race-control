"use client"

import StatusBadge from "../../../components/Common/StatusBadge"
import ResultListShell from "./ResultListShell"
import SubmissionDetailPanel from "./SubmissionDetailPanel"
import { getFieldValue, summarizeCard } from "./responseRecordUtils"

const buildSubmissionItems = (section) =>
  (Array.isArray(section?.cards) ? section.cards : []).map((card) => {
    const item = summarizeCard(card)
    return {
      ...item,
      reference: getFieldValue(item.lookup, "submission ref") || item.title,
      session: getFieldValue(item.lookup, "session"),
      type: getFieldValue(item.lookup, "submission type") || getFieldValue(item.lookup, "type"),
      runGroup: getFieldValue(item.lookup, "run group"),
      driver: getFieldValue(item.lookup, "driver"),
      vehicle: getFieldValue(item.lookup, "vehicle"),
      created: getFieldValue(item.lookup, "created"),
      status: item.badge || getFieldValue(item.lookup, "structured ingest"),
    }
  })

function SubmissionRow({ item, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`chatbot-list-row ${selected ? "is-selected" : ""}`.trim()}
      onClick={onSelect}
    >
      <div className="chatbot-list-row-main">
        <div className="chatbot-list-row-title-wrap">
          <strong>{item.reference}</strong>
          {item.session ? <span>{item.session}</span> : null}
        </div>
        <div className="chatbot-list-row-subtitle">{item.driver || "Driver unavailable"}</div>
      </div>

      <div className="chatbot-list-row-meta">
        <span>{item.vehicle || "Vehicle unavailable"}</span>
        <span>{item.created || "Timestamp unavailable"}</span>
        {item.type || item.runGroup ? <span>{[item.type, item.runGroup].filter(Boolean).join(" • ")}</span> : null}
      </div>

      {item.status ? <StatusBadge label={item.status} tone={item.badgeTone} /> : null}
    </button>
  )
}

export default function SubmissionList({ section }) {
  const items = buildSubmissionItems(section)

  return (
    <ResultListShell
      items={items}
      getItemKey={(item) => item.reference}
      listTitle="Latest submissions"
      listSubtitle="Recent records in a compact queue, with the selected submission expanded on the right."
      detailTitle="Session Review"
      detailSubtitle="The selected row opens in the same session review workspace style used across the owner portal."
      emptyTitle="No submissions"
      emptyMessage="No submission records were available for this response."
      renderRow={({ item, selected, onSelect }) => (
        <SubmissionRow item={item} selected={selected} onSelect={onSelect} />
      )}
      renderDetail={(item) => <SubmissionDetailPanel item={item} />}
      className="chatbot-result-shell-submissions"
    />
  )
}
