"use client"

import StatusBadge from "../../../components/Common/StatusBadge"
import ResultListShell from "./ResultListShell"
import { getFieldValue, summarizeCard } from "./responseRecordUtils"

const buildSessionItems = (section) =>
  (Array.isArray(section?.cards) ? section.cards : []).map((card) => {
    const item = summarizeCard(card)
    return {
      ...item,
      sessionId: getFieldValue(item.lookup, "session id") || item.title,
      event: getFieldValue(item.lookup, "event"),
      runGroup: getFieldValue(item.lookup, "run group"),
      driver: getFieldValue(item.lookup, "driver"),
      vehicle: getFieldValue(item.lookup, "vehicle"),
      duration: getFieldValue(item.lookup, "duration"),
      tireSet: getFieldValue(item.lookup, "tire set"),
      created: getFieldValue(item.lookup, "created"),
      createdBy: getFieldValue(item.lookup, "created by"),
      type: getFieldValue(item.lookup, "type"),
    }
  })

function SessionDetailPanel({ item }) {
  const detailItems = [
    { label: "Event", value: item.event },
    { label: "Run group", value: item.runGroup },
    { label: "Driver", value: item.driver },
    { label: "Vehicle", value: item.vehicle },
    { label: "Type", value: item.type },
    { label: "Duration", value: item.duration },
    { label: "Tire set", value: item.tireSet },
    { label: "Created", value: item.created },
    { label: "Created by", value: item.createdBy },
    { label: "Session ID", value: item.sessionId },
  ].filter((entry) => entry.value)

  return (
    <div className="chatbot-detail-panel">
      <header className="chatbot-detail-hero">
        <div className="chatbot-detail-hero-copy">
          <div className="chatbot-detail-eyebrow">Session summary</div>
          <h3>{item.title}</h3>
          {item.subtitle ? <p>{item.subtitle}</p> : null}
        </div>
        {item.badge ? <StatusBadge label={item.badge} tone={item.badgeTone} /> : null}
      </header>

      <section className="chatbot-detail-group">
        <h4>Session details</h4>
        <div className="chatbot-detail-grid">
          {detailItems.map((entry) => (
            <article className="chatbot-detail-stat" key={`${item.sessionId}-${entry.label}`}>
              <span className="chatbot-detail-stat-label">{entry.label}</span>
              <span className="chatbot-detail-stat-value">{entry.value}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function SessionRow({ item, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`chatbot-list-row ${selected ? "is-selected" : ""}`.trim()}
      onClick={onSelect}
    >
      <div className="chatbot-list-row-main">
        <div className="chatbot-list-row-title-wrap">
          <strong>{item.title}</strong>
          {item.event ? <span>{item.event}</span> : null}
        </div>
        <div className="chatbot-list-row-subtitle">{item.driver || "Driver unavailable"}</div>
      </div>

      <div className="chatbot-list-row-meta">
        <span>{item.vehicle || "Vehicle unavailable"}</span>
        <span>{item.subtitle || item.created || "Session timing unavailable"}</span>
      </div>

      {item.badge ? <StatusBadge label={item.badge} tone={item.badgeTone} /> : null}
    </button>
  )
}

export default function CompactSessionList({ section }) {
  const items = buildSessionItems(section)

  return (
    <ResultListShell
      items={items}
      getItemKey={(item) => item.sessionId}
      listTitle="Latest sessions"
      listSubtitle="Compact session rows with the selected record expanded alongside the list."
      detailTitle="Session details"
      emptyTitle="No sessions"
      emptyMessage="No session records were available for this response."
      renderRow={({ item, selected, onSelect }) => (
        <SessionRow item={item} selected={selected} onSelect={onSelect} />
      )}
      renderDetail={(item) => <SessionDetailPanel item={item} />}
      className="chatbot-result-shell-sessions"
    />
  )
}
