"use client"

const COMPARISON_SECTION_ORDER = [
  { key: "session-info", title: "Session Info", iconKey: "session" },
  { key: "pressures", title: "Pressures", iconKey: "pressure" },
  { key: "suspension", title: "Suspension", iconKey: "suspension" },
  { key: "alignment", title: "Alignment", iconKey: "alignment" },
  { key: "tire-temperatures", title: "Tire Temperatures", iconKey: "temperature" },
  { key: "tire-history", title: "Tire History", iconKey: "history" },
  { key: "metadata", title: "Metadata", iconKey: "default" },
]

const PLACEHOLDER_VALUES = new Set([
  "",
  "-",
  "--",
  "na",
  "n/a",
  "none",
  "null",
  "not available",
  "unknown",
])

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

const normalizeLower = (value) => normalizeText(value).toLowerCase()

const isMissingValue = (value) => PLACEHOLDER_VALUES.has(normalizeLower(value))

const isMeaningfulValue = (value) => !isMissingValue(value)

const extractText = (value) => {
  if (isMissingValue(value)) {
    return ""
  }

  return normalizeText(value)
}

const isNumericValue = (value) => {
  const text = normalizeText(value)
  if (!text || text.includes(":")) {
    return false
  }

  return /^[-+]?\d+(?:\.\d+)?(?:\s*[a-z%/]+)?$/i.test(text)
}

const parseNumericValue = (value) => {
  if (!isNumericValue(value)) {
    return null
  }

  const parsed = Number.parseFloat(normalizeText(value))
  return Number.isFinite(parsed) ? parsed : null
}

const formatNumericValue = (value) => {
  if (!Number.isFinite(value)) {
    return ""
  }

  const rounded = Math.abs(value) % 1 === 0 ? String(Math.abs(value)) : String(Math.abs(value).toFixed(2))
  return value >= 0 ? `+${rounded}` : `-${rounded}`
}

const formatList = (items) => {
  const values = items.filter(Boolean)

  if (!values.length) {
    return ""
  }

  if (values.length === 1) {
    return values[0]
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`
}

const sameComparisonValue = (left, right) => {
  const leftNumeric = parseNumericValue(left)
  const rightNumeric = parseNumericValue(right)

  if (leftNumeric !== null && rightNumeric !== null) {
    return leftNumeric === rightNumeric
  }

  return normalizeLower(left) === normalizeLower(right)
}

const getSectionIconKey = (sectionKey) =>
  COMPARISON_SECTION_ORDER.find((item) => item.key === sectionKey)?.iconKey || "default"

const inferComparisonSection = (metric, context) => {
  const text = `${normalizeLower(metric)} ${normalizeLower(context)}`

  if (
    text.includes("pressure") ||
    text.includes("psi") ||
    text.includes("cold") ||
    text.includes("hot")
  ) {
    return "pressures"
  }

  if (
    text.includes("suspension") ||
    text.includes("rebound") ||
    text.includes("bump") ||
    text.includes("wing") ||
    text.includes("sway") ||
    text.includes("damper")
  ) {
    return "suspension"
  }

  if (
    text.includes("camber") ||
    text.includes("toe") ||
    text.includes("caster") ||
    text.includes("ride height") ||
    text.includes("wheelbase") ||
    text.includes("cross weight") ||
    text.includes("rake") ||
    text.includes("alignment")
  ) {
    return "alignment"
  }

  if (text.includes("temperature") || text.includes("temp")) {
    return "tire-temperatures"
  }

  if (
    text.includes("history") ||
    text.includes("heat cycle") ||
    text.includes("heat cycles") ||
    text.includes("mileage") ||
    text.includes("compound") ||
    text.includes("tire set") ||
    text.includes("usage date") ||
    text.includes("tire")
  ) {
    return "tire-history"
  }

  if (
    text.includes("submission") ||
    text.includes("metadata") ||
    text.includes("created") ||
    text.includes("status") ||
    text.includes("reference") ||
    text.includes("id") ||
    text.includes("source") ||
    text.includes("validation") ||
    text.includes("confidence") ||
    text.includes("note") ||
    text.includes("error")
  ) {
    return "metadata"
  }

  return "session-info"
}

const getSectionRowWeight = (sectionKey, metric) => {
  const sectionWeights = {
    "session-info": 2,
    pressures: 5,
    suspension: 5,
    alignment: 4,
    "tire-temperatures": 5,
    "tire-history": 3,
    metadata: 1,
  }

  const metricText = normalizeLower(metric)
  const numericBoost = isNumericValue(metricText) ? 0 : 0
  return (sectionWeights[sectionKey] || 1) * 1000 + numericBoost
}

const getSectionByTitle = (sections, title) =>
  sections.find((section) => normalizeLower(section?.title) === normalizeLower(title)) || null

const getFirstCard = (section) => {
  if (!section || !Array.isArray(section.cards) || !section.cards.length) {
    return null
  }

  return section.cards[0] || null
}

const getCardFieldValue = (card, labels) => {
  if (!card || !Array.isArray(card.fields)) {
    return ""
  }

  const matchers = labels.map((label) => normalizeLower(label))
  for (const field of card.fields) {
    const label = normalizeLower(field?.label)
    if (matchers.some((matcher) => label === matcher || label.includes(matcher))) {
      const value = extractText(field?.value)
      if (value) {
        return value
      }
    }
  }

  return ""
}

const getSessionSnapshotLabel = (section, fallback) => {
  const card = getFirstCard(section)
  const title = extractText(card?.title)
  if (title) {
    return title
  }

  const sectionTitle = extractText(section?.title)
  if (sectionTitle) {
    return sectionTitle
  }

  return fallback
}

const getSharedEventLabel = (scope, sessionASection, sessionBSection) => {
  const scopeEvent = extractText(scope?.event_label || scope?.eventLabel)
  if (scopeEvent) {
    return scopeEvent
  }

  const cardA = getFirstCard(sessionASection)
  const cardB = getFirstCard(sessionBSection)
  const eventA = getCardFieldValue(cardA, ["Event"])
  const eventB = getCardFieldValue(cardB, ["Event"])

  if (eventA && eventA === eventB) {
    return eventA
  }

  return eventA || eventB || ""
}

const getScopeLabel = (scope) => {
  const values = [
    scope?.event_label || scope?.eventLabel,
    scope?.session_label || scope?.sessionLabel,
    scope?.driver_label || scope?.driverLabel,
    scope?.vehicle_label || scope?.vehicleLabel,
  ]

  for (const value of values) {
    const text = extractText(value)
    if (text) {
      return text
    }
  }

  return ""
}

export function extractComparisonOverview(response, scope = {}) {
  const sections = Array.isArray(response?.sections) ? response.sections : []
  const sessionASection = getSectionByTitle(sections, "Session A") || sections[0] || null
  const sessionBSection = getSectionByTitle(sections, "Session B") || sections[1] || null
  const comparisonSection = getSectionByTitle(sections, "Comparison")
  const sessionALabel = getSessionSnapshotLabel(sessionASection, "Session A")
  const sessionBLabel = getSessionSnapshotLabel(sessionBSection, "Session B")
  const eventLabel = getSharedEventLabel(scope, sessionASection, sessionBSection)

  const rawRows = Array.isArray(comparisonSection?.table_rows) ? comparisonSection.table_rows : []
  const tableHeaders = Array.isArray(comparisonSection?.table_headers) ? comparisonSection.table_headers : []

  const comparisonRows = rawRows
    .map((row, index) => {
      if (!Array.isArray(row)) {
        return null
      }

      const field = extractText(row[0]) || `Field ${index + 1}`
      const previous = extractText(row[1])
      const current = extractText(row[2])
      const context = extractText(row[3])
      const sectionKey = inferComparisonSection(field, context)
      const sectionMeta = COMPARISON_SECTION_ORDER.find((item) => item.key === sectionKey) || COMPARISON_SECTION_ORDER[0]
      const changed = !sameComparisonValue(previous, current)
      const missing = isMissingValue(previous) || isMissingValue(current)
      const previousNumeric = parseNumericValue(previous)
      const currentNumeric = parseNumericValue(current)
      const deltaValue =
        previousNumeric !== null && currentNumeric !== null ? currentNumeric - previousNumeric : null
      const delta = deltaValue !== null ? formatNumericValue(deltaValue) : ""
      const direction = deltaValue === null
        ? changed
          ? "varied"
          : "same"
        : deltaValue > 0
          ? "up"
          : deltaValue < 0
            ? "down"
            : "same"

      return {
        id: `${sectionKey}-${field}-${index}`,
        sectionKey,
        sectionTitle: sectionMeta.title,
        sectionIconKey: sectionMeta.iconKey,
        field,
        previous: previous || "Not available",
        current: current || "Not available",
        context: context || "",
        changed,
        unchanged: !changed,
        missing,
        delta,
        direction,
        importance: getSectionRowWeight(sectionKey, field) + (deltaValue !== null ? Math.abs(deltaValue) * 100 : 0),
        rowIndex: index,
      }
    })
    .filter(Boolean)

  const groupedSections = COMPARISON_SECTION_ORDER.map((sectionMeta) => {
    const rows = comparisonRows.filter((row) => row.sectionKey === sectionMeta.key)
    const changedRows = rows.filter((row) => row.changed)
    const unchangedRows = rows.filter((row) => row.unchanged && !row.missing)
    const missingRows = rows.filter((row) => row.missing)

    return {
      ...sectionMeta,
      rows,
      changedRows,
      unchangedRows,
      missingRows,
    }
  })

  const changedRows = comparisonRows.filter((row) => row.changed).sort((left, right) => right.importance - left.importance)
  const unchangedRows = comparisonRows.filter((row) => row.unchanged && !row.missing)
  const importantChangedRows = (changedRows.filter((row) => row.sectionKey !== "session-info").length
    ? changedRows.filter((row) => row.sectionKey !== "session-info")
    : changedRows
  ).slice(0, 5)

  const comparedSectionsCount = groupedSections.filter((section) => section.rows.length).length
  const missingSectionsCount = Math.max(0, COMPARISON_SECTION_ORDER.length - comparedSectionsCount)

  return {
    sections,
    sessionASection,
    sessionBSection,
    comparisonSection,
    sessionALabel,
    sessionBLabel,
    eventLabel,
    tableHeaders,
    rows: comparisonRows,
    groupedSections,
    changedRows,
    unchangedRows,
    importantChangedRows,
    comparedSectionsCount,
    changedFieldsCount: changedRows.length,
    unchangedFieldsCount: unchangedRows.length,
    missingSectionsCount,
  }
}

export function buildComparisonSummary(response, scope = {}) {
  const overview = extractComparisonOverview(response, scope)
  const lead =
    overview.sessionALabel && overview.sessionBLabel
      ? `Here are the most important differences between ${overview.sessionALabel} and ${overview.sessionBLabel}.`
      : "Here are the most important differences between the selected sessions."

  const focusFields = overview.importantChangedRows
    .filter((row) => row.sectionKey !== "session-info")
    .map((row) => row.field)
    .slice(0, 3)

  const summaryParts = [lead]

  if (focusFields.length) {
    summaryParts.push(`The main changes are in ${formatList(focusFields)}.`)
  } else if (overview.changedFieldsCount > 0) {
    summaryParts.push("The recorded values changed in a few areas.")
  } else {
    summaryParts.push("The recorded values are broadly similar.")
  }

  if (overview.missingSectionsCount > 0) {
    summaryParts.push("Some sections were only partially available, so the comparison focuses on recorded values.")
  }

  return summaryParts.join(" ")
}

export function buildComparisonMetaItems(response, scope = {}) {
  const overview = extractComparisonOverview(response, scope)
  const dataSource = response?.data_source || response?.source_label || "SM2 Racing Database"
  const state = response?.status || "empty"
  const statusLabel = state === "success" ? "Ready" : state === "not_found" ? "No match" : state === "error" ? "Error" : "Needs detail"

  const items = [
    { label: "Data source", value: dataSource, tone: "accent" },
  ]

  items.push({ label: "Status", value: statusLabel, tone: state === "success" ? "success" : state === "not_found" ? "warning" : state === "error" ? "danger" : "neutral" })

  const scopeLabel = getScopeLabel(scope)
  if (scopeLabel && scopeLabel !== overview.eventLabel) {
    items.push({ label: "Scope", value: scopeLabel, tone: "neutral" })
  }

  return items.slice(0, 4)
}

export {
  COMPARISON_SECTION_ORDER,
  extractText as normalizeComparisonText,
  getSectionIconKey,
  isMeaningfulValue,
  isMissingValue as isComparisonMissingValue,
}
