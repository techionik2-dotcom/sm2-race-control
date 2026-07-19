"use client"

import { useMemo, useState } from "react"
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined"
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined"
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined"
import StatusBadge from "../../../components/Common/StatusBadge"
import CompactResultSection from "./CompactResultCards"
import {
  COMPARISON_SECTION_ORDER,
  extractComparisonOverview,
  normalizeComparisonText,
} from "./comparisonUtils"

const TAB_ITEMS = [
  { id: "changes", label: "Changed details" },
  { id: "snapshots", label: "Session snapshots" },
  { id: "all", label: "Full table" },
]

const directionMeta = {
  up: { label: "Up", tone: "success" },
  down: { label: "Down", tone: "warning" },
  same: { label: "Same", tone: "neutral" },
  varied: { label: "Changed", tone: "info" },
}

const compactNumber = (value) => {
  const text = normalizeComparisonText(value)
  return text || "Not available"
}

const getDirectionMeta = (direction) => directionMeta[direction] || directionMeta.varied

function ComparisonStatChip({ label, value, tone = "neutral" }) {
  return (
    <div className={`chatbot-comparison-stat chatbot-comparison-stat-${tone}`}>
      <span className="chatbot-comparison-stat-label">{label}</span>
      <span className="chatbot-comparison-stat-value">{value}</span>
    </div>
  )
}

function ComparisonValue({ value }) {
  const text = compactNumber(value)
  const muted = text === "Not available"

  return (
    <span className={muted ? "chatbot-comparison-value chatbot-comparison-value-muted" : "chatbot-comparison-value"}>
      {text}
    </span>
  )
}

function ComparisonTable({ rows = [], includeSection = false }) {
  if (!rows.length) {
    return null
  }

  return (
    <div className="chatbot-comparison-table-wrap">
      <table className="chatbot-comparison-table">
        <thead>
          <tr>
            {includeSection ? <th>Section</th> : null}
            <th>Field</th>
            <th>Previous Value</th>
            <th>Current Value</th>
            <th>Delta</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const direction = getDirectionMeta(row.direction)

            return (
              <tr key={row.id} className={row.changed ? "is-changed" : "is-unchanged"}>
                {includeSection ? <td className="chatbot-comparison-table-section">{row.sectionTitle}</td> : null}
                <td className="chatbot-comparison-table-field">
                  <span className="chatbot-comparison-field-name">{row.field}</span>
                  {row.context ? <span className="chatbot-comparison-field-context">{row.context}</span> : null}
                </td>
                <td>
                  <ComparisonValue value={row.previous} />
                </td>
                <td>
                  <ComparisonValue value={row.current} />
                </td>
                <td>
                  <ComparisonValue value={row.delta || (row.changed ? "Changed" : "Same")} />
                </td>
                <td>
                  <StatusBadge
                    label={direction.label}
                    tone={direction.tone}
                    className="chatbot-comparison-direction-badge"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ComparisonOverviewStrip({ overview }) {
  const eventLabel = overview.eventLabel || ""

  return (
    <section className="chatbot-comparison-overview">
      <header className="chatbot-comparison-overview-header">
        <div className="chatbot-comparison-overview-title-wrap">
          <div className="chatbot-comparison-overview-icon" aria-hidden="true">
            <CompareArrowsOutlinedIcon fontSize="small" />
          </div>
          <div className="chatbot-comparison-overview-copy">
            <div className="chatbot-comparison-overview-eyebrow">Comparison overview</div>
            <h3>Selected sessions at a glance</h3>
            <p>
              Compare the selected sessions first, then open the deeper field-by-field views only
              when you need them.
            </p>
          </div>
        </div>

      </header>

      <div className="chatbot-comparison-overview-sessions">
        <ComparisonStatChip label="Session A" value={overview.sessionALabel} tone="accent" />
        <ComparisonStatChip label="Session B" value={overview.sessionBLabel} tone="info" />
        {eventLabel ? <ComparisonStatChip label="Event" value={eventLabel} tone="neutral" /> : null}
      </div>

      <div className="chatbot-comparison-overview-metrics">
        <ComparisonStatChip
          label="Compared sections"
          value={String(overview.comparedSectionsCount)}
          tone="neutral"
        />
        <ComparisonStatChip label="Changed fields" value={String(overview.changedFieldsCount)} tone="success" />
        <ComparisonStatChip
          label="Unchanged fields"
          value={String(overview.unchangedFieldsCount)}
          tone="neutral"
        />
        <ComparisonStatChip
          label="Missing sections"
          value={String(overview.missingSectionsCount)}
          tone="warning"
        />
      </div>
    </section>
  )
}

function ComparisonSectionCard({ group }) {
  const hasRows = group.rows.length > 0
  let summaryText = "No comparison data available"
  if (hasRows) {
    if (group.changedRows.length) {
      summaryText = `${group.changedRows.length} changed${
        group.unchangedRows.length ? `, ${group.unchangedRows.length} unchanged` : ""
      }${group.missingRows.length ? `, ${group.missingRows.length} missing` : ""}`
    } else if (group.unchangedRows.length) {
      summaryText = `${group.unchangedRows.length} unchanged${
        group.missingRows.length ? `, ${group.missingRows.length} missing` : ""
      }`
    } else if (group.missingRows.length) {
      summaryText = `${group.missingRows.length} missing${group.missingRows.length === 1 ? " value" : " values"}`
    } else {
      summaryText = "No recorded differences"
    }
  }

  return (
    <details className="chatbot-comparison-section">
      <summary className="chatbot-comparison-section-summary">
        <div className="chatbot-comparison-section-summary-main">
          <div className="chatbot-comparison-section-icon" aria-hidden="true">
            <DataObjectOutlinedIcon fontSize="small" />
          </div>
          <div className="chatbot-comparison-section-heading">
            <h4>{group.title}</h4>
            <p>{summaryText}</p>
          </div>
        </div>
        <div className="chatbot-comparison-section-toggle" aria-hidden="true">
          <ExpandMoreOutlinedIcon fontSize="inherit" />
        </div>
      </summary>

      <div className="chatbot-comparison-section-body">
        {group.changedRows.length ? (
          <ComparisonTable rows={group.changedRows} includeSection={false} />
        ) : null}

        {!group.changedRows.length && group.unchangedRows.length ? (
          <div className="chatbot-comparison-muted-line">No changed values were recorded in this section.</div>
        ) : null}

        {group.unchangedRows.length ? (
          <details className="chatbot-comparison-unchanged">
            <summary className="chatbot-comparison-unchanged-summary">
              <span>View unchanged fields</span>
              <span className="chatbot-comparison-unchanged-count">{group.unchangedRows.length}</span>
            </summary>
            <div className="chatbot-comparison-unchanged-body">
              <ComparisonTable rows={group.unchangedRows} includeSection={false} />
            </div>
          </details>
        ) : null}

        {group.rows.length === 0 ? (
          <div className="chatbot-comparison-muted-line">
            No {group.title.toLowerCase()} data was available for this comparison.
          </div>
        ) : null}
      </div>
    </details>
  )
}

function ComparisonSnapshots({ overview }) {
  const sections = [
    { label: "Session A", section: overview.sessionASection },
    { label: "Session B", section: overview.sessionBSection },
  ]

  return (
    <div className="chatbot-comparison-snapshot-grid">
      {sections.map(({ label, section }) => (
        <div className="chatbot-comparison-snapshot" key={label}>
          <div className="chatbot-comparison-snapshot-label">{label}</div>
          {section ? (
            <CompactResultSection section={section} responseKind="compare" />
          ) : (
            <div className="chatbot-comparison-empty-snapshot">No snapshot data was available.</div>
          )}
        </div>
      ))}
    </div>
  )
}

function ComparisonFullTable({ overview }) {
  return (
    <div className="chatbot-comparison-full-table">
      <div className="chatbot-comparison-full-table-head">
        <div>
          <h4>All comparison rows</h4>
          <p>Changed and unchanged fields are shown together for a complete readout.</p>
        </div>
      </div>
      {overview.rows.length ? (
        <ComparisonTable rows={overview.rows} includeSection />
      ) : (
        <div className="chatbot-comparison-muted-line">No comparison rows were available.</div>
      )}
    </div>
  )
}

function ComparisonDetails({ overview }) {
  const visibleGroups = overview.groupedSections.filter((group) => group.rows.length)
  const missingGroups = overview.groupedSections.filter((group) => group.rows.length === 0)

  return (
    <div className="chatbot-comparison-details">
      {visibleGroups.length ? (
        <div className="chatbot-comparison-details-groups">
          {visibleGroups.map((group) => (
            <ComparisonSectionCard key={group.key} group={group} />
          ))}
        </div>
      ) : (
        <div className="chatbot-comparison-muted-line">
          No comparison sections were available for the selected sessions.
        </div>
      )}

      {missingGroups.length ? (
        <div className="chatbot-comparison-missing-note">
          {missingGroups.map((group) => group.title).join(", ")} were not available for this
          comparison.
        </div>
      ) : null}
    </div>
  )
}

function ComparisonTabs({ activeTab, onChange }) {
  return (
    <div className="chatbot-comparison-tabs" role="tablist" aria-label="Comparison views">
      {TAB_ITEMS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`chatbot-comparison-tab ${activeTab === tab.id ? "is-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export default function ComparisonResponseSections({ response, scope = {} }) {
  const overview = useMemo(() => extractComparisonOverview(response, scope), [response, scope])
  const [activeTab, setActiveTab] = useState("changes")

  const topChangedRows = overview.importantChangedRows

  return (
    <div className="chatbot-comparison-shell">
      <ComparisonOverviewStrip overview={overview} />

      <section className="chatbot-comparison-key-changes">
        <div className="chatbot-comparison-key-changes-head">
          <div>
            <div className="chatbot-comparison-key-changes-eyebrow">Key changes</div>
            <h3>Most important differences first</h3>
          </div>
          <div className="chatbot-comparison-key-changes-meta">
            <StatusBadge
              label={`${overview.changedFieldsCount} changed`}
              tone="success"
              className="chatbot-comparison-key-changes-badge"
            />
            <StatusBadge
              label={`${overview.unchangedFieldsCount} unchanged`}
              tone="neutral"
              className="chatbot-comparison-key-changes-badge"
            />
          </div>
        </div>

        {topChangedRows.length ? (
          <>
            <ComparisonTable rows={topChangedRows} includeSection />
            {overview.changedRows.length > topChangedRows.length ? (
              <div className="chatbot-comparison-table-footnote">
                {overview.changedRows.length - topChangedRows.length} more changed fields are available
                in the detailed views below.
              </div>
            ) : null}
          </>
        ) : (
          <div className="chatbot-comparison-muted-line">
            No meaningful differences were recorded in the live data.
          </div>
        )}
      </section>

      <ComparisonTabs activeTab={activeTab} onChange={setActiveTab} />

      <div className="chatbot-comparison-tab-panel" role="tabpanel">
        {activeTab === "changes" ? <ComparisonDetails overview={overview} /> : null}
        {activeTab === "snapshots" ? <ComparisonSnapshots overview={overview} /> : null}
        {activeTab === "all" ? <ComparisonFullTable overview={overview} /> : null}
      </div>
    </div>
  )
}
