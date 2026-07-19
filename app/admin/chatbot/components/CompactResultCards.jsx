"use client"

import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined"
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined"
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined"
import EventOutlinedIcon from "@mui/icons-material/EventOutlined"
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined"
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined"
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined"
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined"
import SpeedOutlinedIcon from "@mui/icons-material/SpeedOutlined"
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined"
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined"

import StatusBadge from "../../../components/Common/StatusBadge"

const RESULT_ICON_MAP = {
  event: EventOutlinedIcon,
  session: ScheduleOutlinedIcon,
  pressure: SpeedOutlinedIcon,
  suspension: TuneOutlinedIcon,
  alignment: TrackChangesOutlinedIcon,
  temperature: SpeedOutlinedIcon,
  history: HistoryOutlinedIcon,
  driver: PeopleAltOutlinedIcon,
  vehicle: DirectionsCarOutlinedIcon,
  submission: FactCheckOutlinedIcon,
  mapping: DataObjectOutlinedIcon,
  default: DataObjectOutlinedIcon,
}

const CARD_LAYOUTS = {
  event: {
    columns: 2,
    visibleLabels: ["Track", "Run group", "Start", "End"],
    secondaryLabels: ["Notes"],
    detailsColumns: 2,
  },
  session: {
    columns: 3,
    visibleLabels: ["Event", "Driver", "Vehicle", "Type", "Run group"],
    secondaryLabels: ["Duration", "Created", "Tire set"],
    detailsColumns: 2,
  },
  driver: {
    columns: 2,
    visibleLabels: ["Team", "Vehicles", "Aliases"],
    secondaryLabels: ["License", "Created"],
    detailsColumns: 2,
  },
  vehicle: {
    columns: 2,
    visibleLabels: ["Driver", "Class", "Year"],
    secondaryLabels: ["Registration", "VIN"],
    detailsColumns: 2,
  },
  submission: {
    columns: 3,
    visibleLabels: ["Submission type", "Event", "Run group", "Driver", "Vehicle", "Created"],
    secondaryLabels: ["Structured ingest", "Note", "Error"],
    detailsColumns: 2,
  },
  mapping: {
    columns: 3,
    visibleLabels: ["Session", "Track", "Date", "Time", "Driver", "Vehicle"],
    secondaryLabels: ["Status"],
    detailsColumns: 2,
  },
  default: {
    columns: 2,
    visibleLabels: [],
    secondaryLabels: [],
    detailsColumns: 2,
  },
}

const PLACEHOLDER_VALUES = new Set(["", "not available", "n/a", "na", "none", "unknown"])

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

const isMeaningfulValue = (value) => {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === "number") {
    return true
  }

  const text = normalizeText(value)
  if (!text) {
    return false
  }

  return !PLACEHOLDER_VALUES.has(text.toLowerCase())
}

const getSectionIcon = (iconKey) => RESULT_ICON_MAP[iconKey] || RESULT_ICON_MAP.default

const getCardLayout = (cardType) => CARD_LAYOUTS[cardType] || CARD_LAYOUTS.default

const labelKey = (label) => normalizeText(label).toLowerCase()

const prepareFields = (fields = []) =>
  fields
    .map((field, index) => ({
      ...field,
      _index: index,
      _labelKey: labelKey(field.label),
      _valueText: normalizeText(field.value),
    }))
    .filter((field) => isMeaningfulValue(field.value))

const selectFields = (fields, labels = [], limit = 0) => {
  const remaining = [...fields]
  const selected = []

  labels.forEach((label) => {
    if (limit > 0 && selected.length >= limit) {
      return
    }

    const key = labelKey(label)
    const matchIndex = remaining.findIndex((field) => field._labelKey === key)
    if (matchIndex >= 0) {
      selected.push(remaining.splice(matchIndex, 1)[0])
    }
  })

  if (limit > 0 && selected.length < limit) {
    while (remaining.length && selected.length < limit) {
      selected.push(remaining.shift())
    }
  }

  return {
    selected,
    remaining,
  }
}

const buildCardType = (responseKind, section) => {
  if (responseKind === "events") {
    return "event"
  }

  if (responseKind === "sessions") {
    return "session"
  }

  if (responseKind === "submissions") {
    return "submission"
  }

  if (responseKind === "fleet") {
    if (section?.title === "Drivers") {
      return "driver"
    }

    if (section?.title === "Vehicles") {
      return "vehicle"
    }

    return "mapping"
  }

  if (
    responseKind === "compare" &&
    typeof section?.title === "string" &&
    /session\s+[ab]/i.test(section.title)
  ) {
    return "session"
  }

  return "default"
}

export function CompactStatGrid({ items = [], columns = 2, className = "" }) {
  if (!items.length) {
    return null
  }

  const style = {
    "--compact-stat-columns": String(columns),
  }

  return (
    <div className={`chatbot-compact-stat-grid ${className}`.trim()} style={style}>
      {items.map((item) => (
        <article className="chatbot-compact-stat" key={`${item.label}-${item.value || item._index}`}>
          <span className="chatbot-compact-stat-label">{item.label}</span>
          <span className="chatbot-compact-stat-value">{item._valueText || normalizeText(item.value)}</span>
        </article>
      ))}
    </div>
  )
}

export function SecondaryMetadataRow({ items = [] }) {
  const visibleItems = items.filter((item) => isMeaningfulValue(item.value)).slice(0, 3)

  if (!visibleItems.length) {
    return null
  }

  return (
    <div className="chatbot-compact-meta-row">
      {visibleItems.map((item) => (
        <div className="chatbot-compact-meta-pill" key={`${item.label}-${item.value}`}>
          <span className="chatbot-compact-meta-label">{item.label}</span>
          <span className="chatbot-compact-meta-value">{normalizeText(item.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function ExpandableCardDetails({
  summary = "View details",
  className = "",
  children,
}) {
  if (!children) {
    return null
  }

  return (
    <details className={`chatbot-compact-details ${className}`.trim()}>
      <summary className="chatbot-compact-details-summary">
        <span>{summary}</span>
        <span className="chatbot-compact-details-caret" aria-hidden="true">
          <AutoAwesomeOutlinedIcon fontSize="inherit" />
        </span>
      </summary>
      <div className="chatbot-compact-details-body">{children}</div>
    </details>
  )
}

export function CompactResultCard({ card, cardType, sectionTitle }) {
  const layout = getCardLayout(cardType)
  const Icon = getSectionIcon(card.icon_key || cardType)
  const fields = prepareFields(card.fields)
  const filteredFields = card.badge
    ? fields.filter((field) => field._labelKey !== "status")
    : fields
  const primaryPick = selectFields(filteredFields, layout.visibleLabels, Math.min(layout.columns * 2, 6))
  const secondaryPick = selectFields(primaryPick.remaining, layout.secondaryLabels, 3)
  const detailItems = secondaryPick.remaining
  const badgeLabel = isMeaningfulValue(card.badge) ? normalizeText(card.badge) : ""

  const detailsSummary =
    detailItems.length > 0 ? `${detailItems.length} more field${detailItems.length === 1 ? "" : "s"}` : ""

  return (
    <article className={`chatbot-compact-card chatbot-compact-card-${cardType}`.trim()}>
      <header className="chatbot-compact-card-header">
        <div className="chatbot-compact-card-title-wrap">
          <div className="chatbot-compact-card-icon" aria-hidden="true">
            <Icon fontSize="small" />
          </div>
          <div className="chatbot-compact-card-copy">
            <h4 className="chatbot-compact-card-title">{card.title}</h4>
            {card.subtitle ? <p className="chatbot-compact-card-subtitle">{card.subtitle}</p> : null}
          </div>
        </div>

        {badgeLabel ? (
          <StatusBadge
            label={badgeLabel}
            tone={card.badge_tone || "neutral"}
            className="chatbot-compact-card-badge"
          />
        ) : null}
      </header>

      <CompactStatGrid items={primaryPick.selected} columns={layout.columns} />
      <SecondaryMetadataRow items={secondaryPick.selected} />

      {detailItems.length ? (
        <ExpandableCardDetails summary={detailsSummary}>
          <CompactStatGrid items={detailItems} columns={layout.detailsColumns} />
        </ExpandableCardDetails>
      ) : null}
    </article>
  )
}

function CompactFieldSection({ section }) {
  const Icon = getSectionIcon(section.icon_key)
  const fields = prepareFields(section.fields)
  const primaryPick = selectFields(fields, [], 6)
  const detailItems = primaryPick.remaining
  const detailsSummary =
    detailItems.length > 0 ? `${detailItems.length} more field${detailItems.length === 1 ? "" : "s"}` : ""

  return (
    <section className="chatbot-compact-section chatbot-compact-field-section">
      <header className="chatbot-compact-section-header">
        <div className="chatbot-compact-section-title-wrap">
          <div className="chatbot-compact-section-icon" aria-hidden="true">
            <Icon fontSize="small" />
          </div>
          <div className="chatbot-compact-section-copy">
            <h3 className="chatbot-compact-section-title">{section.title}</h3>
            {section.subtitle ? <p className="chatbot-compact-section-subtitle">{section.subtitle}</p> : null}
          </div>
        </div>
      </header>

      <CompactStatGrid items={primaryPick.selected} columns={3} />

      {detailItems.length ? (
        <ExpandableCardDetails summary={detailsSummary}>
          <CompactStatGrid items={detailItems} columns={2} />
        </ExpandableCardDetails>
      ) : null}
    </section>
  )
}

export default function CompactResultSection({ section, responseKind }) {
  if (!section) {
    return null
  }

  if (section.variant === "fields") {
    return <CompactFieldSection section={section} />
  }

  if (section.variant !== "cards") {
    return null
  }

  const cardType = buildCardType(responseKind, section)
  const SectionIcon = getSectionIcon(section.icon_key)

  return (
    <section className="chatbot-compact-section">
      <header className="chatbot-compact-section-header">
        <div className="chatbot-compact-section-title-wrap">
          <div className="chatbot-compact-section-icon" aria-hidden="true">
            <SectionIcon fontSize="small" />
          </div>
          <div className="chatbot-compact-section-copy">
            <h3 className="chatbot-compact-section-title">{section.title}</h3>
            {section.subtitle ? <p className="chatbot-compact-section-subtitle">{section.subtitle}</p> : null}
          </div>
        </div>
      </header>

      <div className="chatbot-compact-card-grid">
        {section.cards.map((card) => (
          <CompactResultCard
            key={`${section.title}-${card.title}`}
            card={card}
            cardType={cardType}
            sectionTitle={section.title}
          />
        ))}
      </div>
    </section>
  )
}
