"use client"

import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined"
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined"
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined"
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined"
import SpeedOutlinedIcon from "@mui/icons-material/SpeedOutlined"
import ThermostatOutlinedIcon from "@mui/icons-material/ThermostatOutlined"
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined"
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined"
import KeyboardArrowDownOutlinedIcon from "@mui/icons-material/KeyboardArrowDownOutlined"

import { ExpandableCardDetails } from "./CompactResultCards"

const PLACEHOLDER_VALUES = new Set(["", "n/a", "na", "none", "null", "unknown", "not available"])

const CORNER_DEFS = [
  { key: "fl", label: "FL", patterns: ["fl", "front left", "front-left", "front_left"] },
  { key: "fr", label: "FR", patterns: ["fr", "front right", "front-right", "front_right"] },
  { key: "rl", label: "RL", patterns: ["rl", "rear left", "rear-left", "rear_left"] },
  { key: "rr", label: "RR", patterns: ["rr", "rear right", "rear-right", "rear_right"] },
]

const SECTION_ICON_MAP = {
  "session-info": ScheduleOutlinedIcon,
  pressures: SpeedOutlinedIcon,
  suspension: TuneOutlinedIcon,
  alignment: TrackChangesOutlinedIcon,
  temperatures: ThermostatOutlinedIcon,
  history: HistoryOutlinedIcon,
  metadata: DataObjectOutlinedIcon,
  default: InfoOutlinedIcon,
}

const SECTION_KIND_ALIASES = {
  "session-info": ["session info", "session overview", "session"],
  pressures: ["pressures", "pressure", "tire pressure", "tire pressures"],
  suspension: ["suspension", "damper", "bump", "rebound", "ride height"],
  alignment: ["alignment", "camber", "toe", "caster"],
  temperatures: ["tire temperatures", "temperatures", "temperature", "tire temp"],
  history: ["tire history", "history", "tire set"],
  metadata: ["metadata", "submission metadata", "system", "audit"],
}

const SECTION_DEFAULT_OPEN = {
  "session-info": true,
  pressures: true,
  suspension: true,
  alignment: true,
  temperatures: true,
  history: false,
  metadata: false,
}

const FRONT_REAR_DEFS = [
  { key: "front", label: "Front", patterns: ["front"] },
  { key: "rear", label: "Rear", patterns: ["rear"] },
]

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

const normalizeKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[_/|\\]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const humanizePart = (part) => {
  const text = normalizeKey(part)
  if (!text) {
    return ""
  }

  const acronyms = new Set(["fl", "fr", "rl", "rr", "id", "vin", "ocr", "rpm", "psi", "lap"])
  if (acronyms.has(text)) {
    return text.toUpperCase()
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

const isMeaningfulValue = (value) => {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  const text = normalizeText(value)
  if (!text) {
    return false
  }

  return !PLACEHOLDER_VALUES.has(text.toLowerCase())
}

const formatValue = (value) => {
  if (!isMeaningfulValue(value)) {
    return ""
  }

  if (Array.isArray(value)) {
    return value.map(formatValue).filter(Boolean).join(" / ")
  }

  if (typeof value === "object") {
    return normalizeText(value?.label || value?.value || value?.name || "")
  }

  return normalizeText(value)
}

const flattenSource = (source, prefix = [], entries = [], depth = 0) => {
  if (!source || depth > 3) {
    return entries
  }

  if (Array.isArray(source)) {
    source.forEach((item, index) => {
      flattenSource(item, [...prefix, String(index + 1)], entries, depth + 1)
    })
    return entries
  }

  if (typeof source === "object" && !(source instanceof Date)) {
    Object.entries(source).forEach(([key, value]) => {
      flattenSource(value, [...prefix, key], entries, depth + 1)
    })
    return entries
  }

  const label = prefix.map(humanizePart).filter(Boolean).join(" ")
  entries.push({
    label: label || "Value",
    value: source,
    searchText: normalizeKey([...prefix, source].join(" ")),
    index: entries.length,
  })
  return entries
}

const buildSectionEntries = (section) => {
  const entries = []

  if (Array.isArray(section?.fields)) {
    section.fields.forEach((field, index) => {
      const label = normalizeText(field?.label || `Field ${index + 1}`)
      const value = field?.value
      if (!isMeaningfulValue(value)) {
        return
      }

      entries.push({
        label,
        value,
        searchText: normalizeKey([label, value].join(" ")),
        index,
      })
    })
  }

  if (Array.isArray(section?.cards)) {
    section.cards.forEach((card, cardIndex) => {
      const cardTitle = normalizeText(card?.title)
      const cardSubtitle = normalizeText(card?.subtitle)
      const cardPrefix = [cardTitle, cardSubtitle].filter(Boolean)

      if (!Array.isArray(card?.fields) || !card.fields.length) {
        return
      }

      card.fields.forEach((field, fieldIndex) => {
        const label = normalizeText(field?.label || `Field ${fieldIndex + 1}`)
        const value = field?.value
        if (!isMeaningfulValue(value)) {
          return
        }

        entries.push({
          label: [...cardPrefix, label].filter(Boolean).join(" "),
          value,
          searchText: normalizeKey([section?.title, ...cardPrefix, label, value].join(" ")),
          index: entries.length || cardIndex * 100 + fieldIndex,
        })
      })
    })
  }

  if (Array.isArray(section?.table_rows)) {
    section.table_rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) {
        return
      }

      const headers = Array.isArray(section?.table_headers) ? section.table_headers : []
      row.forEach((value, cellIndex) => {
        if (!isMeaningfulValue(value)) {
          return
        }

        const header = normalizeText(headers[cellIndex])
        const label = header || `Column ${cellIndex + 1}`
        entries.push({
          label,
          value,
          searchText: normalizeKey([section?.title, label, value].join(" ")),
          index: entries.length || rowIndex * 100 + cellIndex,
        })
      })
    })
  }

  if (!entries.length && section?.data && typeof section.data === "object") {
    flattenSource(section.data, [], entries)
  }

  if (!entries.length && section?.data && typeof section.data === "string") {
    entries.push({
      label: "Value",
      value: section.data,
      searchText: normalizeKey(section.data),
      index: 0,
    })
  }

  return entries
}

const entryMatches = (entry, required = [], optional = []) => {
  const search = entry?.searchText || ""
  if (!search) {
    return false
  }

  if (required.length && !required.every((term) => search.includes(normalizeKey(term)))) {
    return false
  }

  if (optional.length && !optional.some((term) => search.includes(normalizeKey(term)))) {
    return false
  }

  return true
}

const findEntryValueAny = (entries, patterns = [], optional = []) => {
  const match = entries.find((entry) => {
    const search = entry?.searchText || ""
    if (!search) {
      return false
    }

    const requiredMatches =
      patterns.length === 0 || patterns.map(normalizeKey).some((term) => search.includes(term))
    const optionalMatches =
      optional.length === 0 || optional.map(normalizeKey).some((term) => search.includes(term))

    return requiredMatches && optionalMatches
  })

  return formatValue(match?.value)
}

const findEntryValueAll = (entries, required = [], optional = []) => {
  const match = entries.find((entry) => entryMatches(entry, required, optional))
  return formatValue(match?.value)
}

const selectEntriesByPriority = (entries, priorities = [], limit = 8) => {
  const ranked = entries
    .map((entry) => {
      const search = entry.searchText || ""
      let score = priorities.length + 1

      priorities.forEach((term, index) => {
        if (search.includes(normalizeKey(term))) {
          score = Math.min(score, index)
        }
      })

      return {
        ...entry,
        _score: score,
      }
    })
    .sort((a, b) => a._score - b._score || a.index - b.index)

  const selected = ranked.slice(0, limit)
  const remaining = ranked.slice(limit)

  return { selected, remaining }
}

const buildCardValueSummary = (entries, patterns, directions = CORNER_DEFS) => {
  if (!Array.isArray(directions)) {
    return ""
  }

  const pieces = directions
    .map((direction) => {
      const value =
        findEntryValueAll(entries, [...patterns, ...direction.patterns]) ||
        findEntryValueAll(entries, direction.patterns)
      return value ? `${direction.label} ${value}` : ""
    })
    .filter(Boolean)

  return pieces.join(" / ")
}

const buildMetricCards = (entries, definitions, { directions = CORNER_DEFS } = {}) =>
  definitions
    .map((definition) => {
      const directValue = findEntryValueAny(entries, definition.patterns || [])
      const canUseDirectionalSummary = definition.directions !== false && directions !== false
      const directionalValue =
        !canUseDirectionalSummary
          ? ""
          : buildCardValueSummary(entries, definition.patterns || [], definition.directions || directions)

      const value = canUseDirectionalSummary ? directionalValue || directValue : directValue
      if (!value) {
        return null
      }

      const subvalues = Array.isArray(definition.subvalues)
        ? definition.subvalues
            .map((subvalue) => ({
              label: subvalue.label,
              value: findEntryValueAny(entries, subvalue.patterns || [], subvalue.optional || []),
            }))
            .filter((item) => item.value)
        : []

      return {
        title: definition.title,
        subtitle: definition.subtitle || "",
        value,
        subvalues,
        tone: definition.tone || "neutral",
      }
    })
    .filter(Boolean)

export function MissingDataHint({ text }) {
  if (!text) {
    return null
  }

  return (
    <div className="chatbot-setup-missing-hint">
      <InfoOutlinedIcon fontSize="inherit" />
      <span>{text}</span>
    </div>
  )
}

export function SetupMetricCard({ title, subtitle, value, subvalues = [], tone = "neutral" }) {
  const toneClass = tone ? `tone-${tone}` : ""

  return (
    <article className={`chatbot-setup-metric-card ${toneClass}`.trim()}>
      <div className="chatbot-setup-metric-card-head">
        <span className="chatbot-setup-metric-card-label">{title}</span>
        {subtitle ? <span className="chatbot-setup-metric-card-subtitle">{subtitle}</span> : null}
      </div>

      {value ? <div className="chatbot-setup-metric-card-value">{value}</div> : null}

      {subvalues.length ? (
        <div className="chatbot-setup-metric-card-chips">
          {subvalues.map((item) => (
            <span className="chatbot-setup-mini-chip" key={`${title}-${item.label}-${item.value}`}>
              <strong>{item.label}</strong>
              <span>{item.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function SetupMetricGrid({ items = [], columns = 2, className = "" }) {
  if (!items.length) {
    return null
  }

  return (
    <div
      className={`chatbot-setup-metric-grid ${className}`.trim()}
      style={{ "--setup-grid-columns": String(columns) }}
    >
      {items.map((item, index) => (
        <SetupMetricCard
          key={`${item.title}-${item.value || item.subtitle || "metric"}-${index}`}
          title={item.title}
          subtitle={item.subtitle}
          value={item.value}
          subvalues={item.subvalues}
          tone={item.tone}
        />
      ))}
    </div>
  )
}

export function SetupSectionShell({
  title,
  subtitle,
  kind,
  icon: Icon,
  defaultOpen = true,
  meta = [],
  children,
  emptyHint = "",
  subdued = false,
}) {
  const ResolvedIcon = Icon || SECTION_ICON_MAP.default
  const shellClass = [
    "chatbot-setup-section",
    `chatbot-setup-section-${kind || "default"}`,
    subdued ? "chatbot-setup-section-subdued" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <details className={shellClass} open={defaultOpen}>
      <summary className="chatbot-setup-section-summary">
        <div className="chatbot-setup-section-summary-main">
          <div className="chatbot-setup-section-icon" aria-hidden="true">
            <ResolvedIcon fontSize="small" />
          </div>
          <div className="chatbot-setup-section-heading">
            <h4>{title}</h4>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>

        <div className="chatbot-setup-section-summary-meta">
          {meta.slice(0, 3).map((item) => (
            <span className="chatbot-setup-section-chip" key={`${title}-${item}`}>
              {item}
            </span>
          ))}
          <span className="chatbot-setup-section-toggle" aria-hidden="true">
            <KeyboardArrowDownOutlinedIcon fontSize="inherit" />
          </span>
        </div>
      </summary>

      <div className="chatbot-setup-section-body">
        {children || <MissingDataHint text={emptyHint} />}
      </div>
    </details>
  )
}

function buildPressureCards(entries) {
  return CORNER_DEFS.map((corner) => {
    const current =
      findEntryValueAll(entries, ["pressure", ...corner.patterns, "current"]) ||
      findEntryValueAll(entries, [...corner.patterns, "current"]) ||
      findEntryValueAll(entries, [...corner.patterns])

    const cold =
      findEntryValueAll(entries, ["pressure", ...corner.patterns, "cold"]) ||
      findEntryValueAll(entries, [...corner.patterns, "cold"])
    const hot =
      findEntryValueAll(entries, ["pressure", ...corner.patterns, "hot"]) ||
      findEntryValueAll(entries, [...corner.patterns, "hot"])
    const target =
      findEntryValueAll(entries, ["pressure", ...corner.patterns, "target"]) ||
      findEntryValueAll(entries, [...corner.patterns, "target"])

    const subvalues = [
      { label: "Cold", value: cold },
      { label: "Hot", value: hot },
      { label: "Target", value: target },
    ].filter((item) => item.value && item.value !== current)

    return {
      title: corner.label,
      value: current,
      subvalues,
      tone: "accent",
    }
  })
}

function buildTemperatureCards(entries) {
  return CORNER_DEFS.map((corner) => {
    const outer =
      findEntryValueAll(entries, [...corner.patterns, "outer"]) ||
      findEntryValueAll(entries, [...corner.patterns, "out"])
    const middle =
      findEntryValueAll(entries, [...corner.patterns, "middle"]) ||
      findEntryValueAll(entries, [...corner.patterns, "mid"])
    const inner =
      findEntryValueAll(entries, [...corner.patterns, "inner"]) ||
      findEntryValueAll(entries, [...corner.patterns, "in"])

    const value = middle || outer || inner
    const subvalues = [
      { label: "Outer", value: outer },
      { label: "Middle", value: middle },
      { label: "Inner", value: inner },
    ].filter((item) => item.value && item.value !== value)

    return {
      title: corner.label,
      value,
      subvalues,
      tone: "neutral",
    }
  })
}

function buildMetricSet(entries, definitions, options = {}) {
  return buildMetricCards(entries, definitions, options)
}

export function SessionInfoPanel({ section, entries }) {
  const priorities = [
    "session name",
    "session number",
    "session",
    "event",
    "driver",
    "vehicle",
    "run group",
    "session type",
    "type",
    "duration",
    "date",
    "time",
    "status",
    "created",
  ]

  const visible = selectEntriesByPriority(entries, priorities, 8)
  const extraItems = visible.remaining.map((entry) => ({
    title: entry.label,
    value: formatValue(entry.value),
    tone: "neutral",
  }))

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Session Info"}
      subtitle={section.subtitle || "Core session context."}
      kind="session-info"
      icon={SECTION_ICON_MAP["session-info"]}
      defaultOpen={SECTION_DEFAULT_OPEN["session-info"]}
      meta={[`${visible.selected.length} fields`]}
      emptyHint="No session details were recorded."
    >
      <SetupMetricGrid
        items={visible.selected.map((entry) => ({
          title: entry.label,
          value: formatValue(entry.value),
          tone: "neutral",
        }))}
        columns={3}
      />

      {extraItems.length ? (
        <ExpandableCardDetails summary={`${extraItems.length} more details`}>
          <SetupMetricGrid items={extraItems} columns={2} />
        </ExpandableCardDetails>
      ) : null}
    </SetupSectionShell>
  )
}

export function PressureGrid({ section, entries }) {
  const cards = buildPressureCards(entries)
  const hasCards = cards.some((card) => card.value || card.subvalues.length)
  const unit = findEntryValueAny(entries, ["unit"]) || findEntryValueAny(entries, ["psi"])

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Pressures"}
      subtitle={section.subtitle || "Corner-by-corner pressure values."}
      kind="pressures"
      icon={SECTION_ICON_MAP.pressures}
      defaultOpen={SECTION_DEFAULT_OPEN.pressures}
      meta={[unit ? `Unit: ${unit}` : "Corner values"]}
      emptyHint="No pressure data was recorded."
    >
      {hasCards ? (
        <div className="chatbot-setup-corner-grid">
          {cards.map((card) => (
            <SetupMetricCard
              key={`${section.title || "pressures"}-${card.title}`}
              title={card.title}
              value={card.value}
              subvalues={card.subvalues}
              tone={card.tone}
            />
          ))}
        </div>
      ) : null}
    </SetupSectionShell>
  )
}

export function SuspensionGrid({ section, entries }) {
  const definitions = [
    { title: "Rebound", patterns: ["rebound"] },
    { title: "Bump", patterns: ["bump", "compression"] },
    { title: "Ride Height", patterns: ["ride height", "height"] },
    { title: "Spring", patterns: ["spring"] },
    { title: "Sway Bar", patterns: ["sway bar", "arb", "anti roll"] },
    { title: "Wing", patterns: ["wing"] },
  ]

  const cards = buildMetricSet(entries, definitions, { directions: CORNER_DEFS })
  const hasCards = cards.length > 0

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Suspension"}
      subtitle={section.subtitle || "Suspension and damper values."}
      kind="suspension"
      icon={SECTION_ICON_MAP.suspension}
      defaultOpen={SECTION_DEFAULT_OPEN.suspension}
      meta={hasCards ? [`${cards.length} values`] : []}
      emptyHint="No suspension data was recorded."
    >
      {hasCards ? <SetupMetricGrid items={cards} columns={2} /> : null}
    </SetupSectionShell>
  )
}

export function AlignmentGrid({ section, entries }) {
  const definitions = [
    { title: "Camber", patterns: ["camber"] },
    { title: "Toe", patterns: ["toe"], directions: FRONT_REAR_DEFS },
    { title: "Caster", patterns: ["caster"], directions: CORNER_DEFS.slice(0, 2) },
    { title: "Rake", patterns: ["rake"], directions: false },
  ]

  const cards = buildMetricSet(entries, definitions, { directions: CORNER_DEFS })
  const hasCards = cards.length > 0

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Alignment"}
      subtitle={section.subtitle || "Alignment and geometry values."}
      kind="alignment"
      icon={SECTION_ICON_MAP.alignment}
      defaultOpen={SECTION_DEFAULT_OPEN.alignment}
      meta={hasCards ? [`${cards.length} values`] : []}
      emptyHint="No alignment data was recorded."
    >
      {hasCards ? <SetupMetricGrid items={cards} columns={2} /> : null}
    </SetupSectionShell>
  )
}

export function TireTemperatureGrid({ section, entries }) {
  const cards = buildTemperatureCards(entries)
  const hasCards = cards.some((card) => card.value || card.subvalues.length)

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Tire Temperatures"}
      subtitle={section.subtitle || "Corner temperature readings."}
      kind="temperatures"
      icon={SECTION_ICON_MAP.temperatures}
      defaultOpen={SECTION_DEFAULT_OPEN.temperatures}
      meta={hasCards ? ["Outer / Middle / Inner"] : []}
      emptyHint="Temperature data was not recorded."
    >
      {hasCards ? (
        <div className="chatbot-setup-corner-grid">
          {cards.map((card) => (
            <SetupMetricCard
              key={`${section.title || "temps"}-${card.title}`}
              title={card.title}
              value={card.value}
              subvalues={card.subvalues}
              tone={card.tone}
            />
          ))}
        </div>
      ) : null}
    </SetupSectionShell>
  )
}

export function TireHistoryPanel({ section, entries }) {
  const definitions = [
    { title: "Set ID", patterns: ["set id", "tire set", "set"] },
    { title: "Compound", patterns: ["compound"] },
    { title: "Age", patterns: ["age", "heat cycles"] },
    { title: "Mileage", patterns: ["mileage", "track time"] },
    { title: "Laps", patterns: ["laps"] },
    { title: "Condition", patterns: ["condition"] },
    { title: "Notes", patterns: ["notes"] },
  ]

  const cards = buildMetricSet(entries, definitions, { directions: false })
  const hasCards = cards.length > 0

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Tire History"}
      subtitle={section.subtitle || "Tire usage and wear context."}
      kind="history"
      icon={SECTION_ICON_MAP.history}
      defaultOpen={SECTION_DEFAULT_OPEN.history}
      meta={hasCards ? [`${cards.length} fields`] : []}
      emptyHint="No tire history was recorded."
      subdued
    >
      {hasCards ? <SetupMetricGrid items={cards} columns={2} /> : null}
    </SetupSectionShell>
  )
}

export function MetadataPanel({ section, entries }) {
  const definitions = [
    { title: "Submission", patterns: ["submission", "reference", "id"] },
    { title: "Created by", patterns: ["created by", "author", "user"] },
    { title: "Updated at", patterns: ["updated at", "modified at", "processed at"] },
    { title: "Source", patterns: ["source", "channel"] },
    { title: "Link", patterns: ["link", "session link", "record linkage"] },
    { title: "Status", patterns: ["status"] },
  ]

  const cards = buildMetricSet(entries, definitions, { directions: false })
  const visibleCards = cards.slice(0, 4)
  const extraCards = cards.slice(4)
  const hasCards = visibleCards.length > 0

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Metadata"}
      subtitle={section.subtitle || "Administrative source details."}
      kind="metadata"
      icon={SECTION_ICON_MAP.metadata}
      defaultOpen={SECTION_DEFAULT_OPEN.metadata}
      meta={hasCards ? ["Technical details"] : []}
      emptyHint="No metadata was recorded."
      subdued
    >
      {hasCards ? <SetupMetricGrid items={visibleCards} columns={2} /> : null}

      {extraCards.length ? (
        <ExpandableCardDetails summary={`${extraCards.length} more details`}>
          <SetupMetricGrid items={extraCards} columns={2} />
        </ExpandableCardDetails>
      ) : null}
    </SetupSectionShell>
  )
}

export function DefaultSetupPanel({ section, entries }) {
  const priorities = [
    "session",
    "event",
    "driver",
    "vehicle",
    "run group",
    "status",
    "date",
    "time",
  ]

  const visible = selectEntriesByPriority(entries, priorities, 6)
  const extraItems = visible.remaining.map((entry) => ({
    title: entry.label,
    value: formatValue(entry.value),
    tone: "neutral",
  }))

  return (
    <SetupSectionShell
      section={section}
      title={section.title || "Session Details"}
      subtitle={section.subtitle || "Structured session data."}
      kind="session-info"
      icon={SECTION_ICON_MAP["session-info"]}
      defaultOpen
      meta={visible.selected.length ? [`${visible.selected.length} fields`] : []}
      emptyHint="No setup details were recorded."
    >
      {visible.selected.length ? (
        <SetupMetricGrid
          items={visible.selected.map((entry) => ({
            title: entry.label,
            value: formatValue(entry.value),
            tone: "neutral",
          }))}
          columns={3}
        />
      ) : null}

      {extraItems.length ? (
        <ExpandableCardDetails summary={`${extraItems.length} more details`}>
          <SetupMetricGrid items={extraItems} columns={2} />
        </ExpandableCardDetails>
      ) : null}
    </SetupSectionShell>
  )
}

const getSectionKind = (section) => {
  const title = normalizeKey(section?.title)

  for (const [kind, aliases] of Object.entries(SECTION_KIND_ALIASES)) {
    if (aliases.some((alias) => title.includes(normalizeKey(alias)))) {
      return kind
    }
  }

  return "default"
}

const getSectionEntries = (section) => buildSectionEntries(section)

export default function SetupDetailSection({ section }) {
  if (!section) {
    return null
  }

  const entries = getSectionEntries(section)
  const kind = getSectionKind(section)

  if (kind === "session-info") {
    return <SessionInfoPanel section={section} entries={entries} />
  }

  if (kind === "pressures") {
    return <PressureGrid section={section} entries={entries} />
  }

  if (kind === "suspension") {
    return <SuspensionGrid section={section} entries={entries} />
  }

  if (kind === "alignment") {
    return <AlignmentGrid section={section} entries={entries} />
  }

  if (kind === "temperatures") {
    return <TireTemperatureGrid section={section} entries={entries} />
  }

  if (kind === "history") {
    return <TireHistoryPanel section={section} entries={entries} />
  }

  if (kind === "metadata") {
    return <MetadataPanel section={section} entries={entries} />
  }

  return <DefaultSetupPanel section={section} entries={entries} />
}
