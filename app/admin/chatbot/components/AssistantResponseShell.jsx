"use client"

import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined"
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined"
import StatusBadge from "../../../components/Common/StatusBadge"
import AssistantIcon from "./AssistantIcon"
import AssistantLightReply from "./AssistantLightReply"
import { FollowUpPromptRow } from "./PromptLibrary"
import { ChatLoadingState } from "./ChatSupportStates"
import {
  buildComparisonMetaItems,
  buildComparisonSummary,
} from "./comparisonUtils"

const RESPONSE_STATUS_TONES = {
  success: "success",
  not_found: "warning",
  error: "danger",
  unsupported: "neutral",
  needs_context: "warning",
  validation: "warning",
  loading: "info",
  empty: "neutral",
}

const RESPONSE_STATUS_LABELS = {
  success: "Ready",
  not_found: "No match",
  error: "Error",
  unsupported: "Unsupported",
  needs_context: "Needs detail",
  validation: "Needs context",
  loading: "Thinking",
  empty: "Empty",
}

const RESPONSE_KIND_LABELS = {
  message: "Response",
  empty: "No data",
  events: "Events",
  sessions: "Sessions",
  setup: "Setup sheet",
  compare: "Comparison",
  fleet: "Fleet",
  submissions: "Submissions",
  recommendation: "Recommendation",
  coaching: "Improvement Areas",
}

const humanizeLabel = (value) => {
  if (!value) {
    return ""
  }

  const text = String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!text) {
    return ""
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

const normalizeWhitespace = (value) => String(value || "").replace(/\s+/g, " ").trim()

const VALIDATION_HINT_PATTERNS = [
  /please select/i,
  /include the event name/i,
  /need a specific/i,
  /field required/i,
  /required field/i,
  /message is required/i,
  /provide more details/i,
  /choose the correct/i,
  /missing context/i,
  /multiple .* matching/i,
]

const isValidationMessage = (value) => VALIDATION_HINT_PATTERNS.some((pattern) => pattern.test(value))

const polishValidationText = (value) => {
  const text = normalizeWhitespace(value)
  if (!text || !isValidationMessage(text)) {
    return ""
  }

  if (/please select an event/i.test(text)) {
    return "Please select an event or include the event name before trying again."
  }

  if (/field required|message is required|required field/i.test(text)) {
    return "I need a more specific event, session, driver, or vehicle before I can continue."
  }

  if (/provide more details/i.test(text)) {
    return "I need a little more context before I can continue."
  }

  return text
}

const polishAssistantText = (value) => {
  const text = String(value || "").replace(/\r\n/g, "\n").trim()
  if (!text) {
    return ""
  }

  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/session\(s\)/gi, "sessions")
    .replace(/record\(s\)/gi, "records")
    .replace(/\bFound\s+/g, "I found ")
}

const readScopeValue = (scope, keys) => {
  for (const key of keys) {
    const value = scope?.[key]
    if (value && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ""
}

const getRecordCount = (response) => {
  if (!response) {
    return 0
  }

  if (Array.isArray(response.records_used)) {
    return response.records_used.length
  }

  const count = response.data?.records_used_count
  const normalizedCount = Number(count)
  if (Number.isFinite(normalizedCount)) {
    return normalizedCount
  }

  return 0
}

export const formatAssistantTimestamp = (value) => {
  if (!value) {
    return "Just now"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return "Just now"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

export const getResponseState = (response, loading = false) => {
  if (loading) {
    return "loading"
  }

  const state = response?.status || "empty"
  if (
    state === "error" &&
    isValidationMessage(
      normalizeWhitespace(
        [response?.error_message, response?.error, response?.summary, response?.answer].filter(Boolean).join(" "),
      ),
    )
  ) {
    return "validation"
  }

  return response?.status || "empty"
}

export const getResponseStateLabel = (state) => RESPONSE_STATUS_LABELS[state] || humanizeLabel(state)

export const getResponseStateTone = (state) => RESPONSE_STATUS_TONES[state] || "neutral"

export const getResponseTypeLabel = (response) => {
  if (!response) {
    return ""
  }

  return RESPONSE_KIND_LABELS[response.kind] || humanizeLabel(response.kind)
}

export const buildAssistantSummary = (response, fallbackText = "") => {
  if (!response) {
    return normalizeWhitespace(fallbackText)
  }

  if (response.kind === "compare" && response.status === "success") {
    const comparisonSummary = buildComparisonSummary(response)
    if (comparisonSummary) {
      return comparisonSummary
    }
  }

  const rawSummary =
    response.status === "error"
      ? response.error_message || response.error || response.summary || response.answer || fallbackText
      : response.status === "not_found"
        ? response.no_data_message || response.summary || response.answer || fallbackText
        : response.summary || response.answer || fallbackText

  if (response.status === "error") {
    const validationSummary = polishValidationText(rawSummary)
    if (validationSummary) {
      return validationSummary
    }
  }

  const summary = polishAssistantText(rawSummary)
  if (summary) {
    return summary
  }

  if (response.status === "loading") {
    return normalizeWhitespace(fallbackText) || "Working through the live database now."
  }

  if (response.status === "not_found") {
    return "No matching data was found in the SM2 Racing database."
  }

  if (response.status === "needs_context") {
    return summary || "I need one more detail before I can return the correct SM2 Racing result."
  }

  if (response.status === "unsupported") {
    return "I can help with events, sessions, setup sheets, tire data, submissions, and driver or vehicle records."
  }

  if (response.status === "error") {
    return "The assistant could not reach the live database."
  }

  return normalizeWhitespace(fallbackText) || "Response received."
}

const buildScopeLabel = (scope) => {
  const session = readScopeValue(scope, ["session_label", "sessionLabel"])
  if (session) {
    return `Session: ${session}`
  }

  const event = readScopeValue(scope, ["event_label", "eventLabel"])
  if (event) {
    return `Event: ${event}`
  }

  const driver = readScopeValue(scope, ["driver_label", "driverLabel"])
  if (driver) {
    return `Driver: ${driver}`
  }

  const vehicle = readScopeValue(scope, ["vehicle_label", "vehicleLabel"])
  if (vehicle) {
    return `Vehicle: ${vehicle}`
  }

  return ""
}

export const buildResponseMetaItems = ({ response, scope = {}, recordCount }) => {
  if (response?.kind === "compare") {
    return buildComparisonMetaItems(response, scope)
  }

  const items = []
  const state = getResponseState(response)
  const statusLabel = getResponseStateLabel(state)
  const dataSource = response?.data_source || response?.source_label || "SM2 Racing Database"
  const scopeLabel = buildScopeLabel(scope)
  const intentLabel = response?.intent ? humanizeLabel(response.intent) : ""

  if (["greeting", "help_services", "thanks"].includes(response?.intent)) {
    items.push({ label: "Source", value: dataSource, tone: "accent" })
    items.push({ label: "Status", value: statusLabel, tone: getResponseStateTone(state) })
    return items.slice(0, 4)
  }

  items.push({ label: "Data source", value: dataSource, tone: "accent" })
  items.push({ label: "Records", value: String(recordCount ?? getRecordCount(response)), tone: recordCount > 0 ? "success" : "neutral" })
  items.push({ label: "Status", value: statusLabel, tone: getResponseStateTone(state) })

  if (scopeLabel) {
    items.push({ label: "Scope", value: scopeLabel, tone: "info" })
  } else if (intentLabel) {
    items.push({ label: "Intent", value: intentLabel, tone: "neutral" })
  }

  return items.slice(0, 4)
}

export const buildResponseInsights = ({ response, scope = {}, recordCount }) => {
  if (response?.kind === "compare") {
    return []
  }

  if (["greeting", "help_services", "thanks"].includes(response?.intent)) {
    return []
  }

  if (response?.status && response.status !== "success") {
    return []
  }

  const insights = []
  const scopeItems = [
    {
      label: "Event",
      value: readScopeValue(scope, ["event_label", "eventLabel"]),
      tone: "accent",
    },
    {
      label: "Session",
      value: readScopeValue(scope, ["session_label", "sessionLabel"]),
      tone: "accent",
    },
    {
      label: "Driver",
      value: readScopeValue(scope, ["driver_label", "driverLabel"]),
      tone: "accent",
    },
    {
      label: "Vehicle",
      value: readScopeValue(scope, ["vehicle_label", "vehicleLabel"]),
      tone: "accent",
    },
  ].filter((item) => item.value)

  scopeItems.slice(0, 4).forEach((item) => {
    insights.push(item)
  })

  const sectionsCount = Array.isArray(response?.sections) ? response.sections.length : 0
  const referencedRecords = recordCount ?? getRecordCount(response)

  if (sectionsCount) {
    insights.push({ label: "Sections", value: String(sectionsCount), tone: "neutral" })
  }

  if (referencedRecords) {
    insights.push({ label: "Records used", value: String(referencedRecords), tone: "success" })
  }

  const intentLabel = response?.intent ? humanizeLabel(response.intent) : ""
  if (intentLabel && insights.length < 5) {
    insights.push({ label: "Intent", value: intentLabel, tone: "info" })
  }

  if (response?.kind === "recommendation" && response?.data?.best_session_label && insights.length < 5) {
    insights.push({
      label: "Best option",
      value: response.data.best_session_label,
      tone: "accent",
    })
  }

  if (response?.kind === "coaching" && response?.data?.session_label && insights.length < 5) {
    insights.push({
      label: "Focus session",
      value: response.data.session_label,
      tone: "accent",
    })
  }

  if (response?.data?.missing_sections_count && insights.length < 5) {
    insights.push({
      label: "Missing sections",
      value: String(response.data.missing_sections_count),
      tone: "warning",
    })
  }

  return insights.slice(0, 5)
}

const dedupeSuggestions = (items) => {
  const seen = new Set()
  return items.filter((item) => {
    const key = String(item || "").toLowerCase()
    if (!key || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const buildSuggestedNextSteps = (response, scope, messageText) => {
  if (response?.status === "loading") {
    return []
  }

  const state = getResponseState(response)
  const suggestions = []
  const eventSelected = Boolean(readScopeValue(scope, ["event_label", "eventLabel"]))
  const sessionSelected = Boolean(readScopeValue(scope, ["session_label", "sessionLabel"]))
  const driverSelected = Boolean(readScopeValue(scope, ["driver_label", "driverLabel"]))
  const vehicleSelected = Boolean(readScopeValue(scope, ["vehicle_label", "vehicleLabel"]))

  const add = (items) => {
    suggestions.push(...items)
  }

  add(Array.isArray(response?.follow_up) ? response.follow_up : [])

  if (state === "not_found") {
    add([
      "Show latest sessions",
      "Show latest events",
      "Show driver and vehicle data",
    ])
  } else if (state === "unsupported") {
    add([
      "Show latest sessions",
      "Show latest events",
      "Compare sessions",
    ])
  } else if (state === "validation") {
    add([
      "Show sessions for this event",
      "Show latest sessions",
      "Show driver and vehicle data",
    ])
  } else if (state === "error") {
    add([
      "Show latest sessions",
      "Show latest events",
      "Show driver and vehicle data",
    ])
  }

  if (eventSelected) {
    add(["Show sessions for this event"])
  }

  if (sessionSelected) {
    add(["Show setup for latest session"])
  }

  if (driverSelected) {
    add(["Show sessions for driver Alex"])
  }

  if (vehicleSelected) {
    add(["Show alignment for Car 12"])
  }

  return dedupeSuggestions(suggestions)
}

export const getSuggestedNextSteps = (response, scope = {}, messageText = "", limit = 4) =>
  buildSuggestedNextSteps(response, scope, messageText).slice(0, limit)

export const serializeAssistantResponse = (response, scope = {}) => {
  if (!response) {
    return ""
  }

  const summary = buildAssistantSummary(response)
  const responseTypeLabel = getResponseTypeLabel(response)
  const metaItems = buildResponseMetaItems({ response, scope })
  const insights = buildResponseInsights({ response, scope })
  const sections = Array.isArray(response.sections) ? response.sections : []

  const lines = []

  if (responseTypeLabel) {
    lines.push(`AI Race Assistant - ${responseTypeLabel}`)
  }

  if (summary) {
    lines.push(summary)
  }

  if (metaItems.length) {
    lines.push("")
    lines.push("Response details")
    metaItems.forEach((item) => {
      lines.push(`- ${item.label}: ${item.value}`)
    })
  }

  if (insights.length) {
    lines.push("")
    lines.push("Key insights")
    insights.forEach((item) => {
      lines.push(`- ${item.label}${item.value ? `: ${item.value}` : ""}`)
    })
  }

  if (sections.length) {
    lines.push("")
    lines.push("Details")
    sections.slice(0, 8).forEach((section) => {
      lines.push(section.title)
      if (section.subtitle) {
        lines.push(section.subtitle)
      }

      if (section.variant === "fields" && Array.isArray(section.fields)) {
        section.fields.slice(0, 12).forEach((field) => {
          lines.push(`- ${field.label}: ${field.value}`)
        })
      }

      if (section.variant === "cards" && Array.isArray(section.cards)) {
        section.cards.slice(0, 8).forEach((card) => {
          lines.push(`- ${card.title}${card.subtitle ? ` | ${card.subtitle}` : ""}`)
          if (Array.isArray(card.fields)) {
            card.fields.slice(0, 8).forEach((field) => {
              lines.push(`  - ${field.label}: ${field.value}`)
            })
          }
        })
      }

      if (section.variant === "table" && Array.isArray(section.table_rows)) {
        if (Array.isArray(section.table_headers) && section.table_headers.length) {
          lines.push(section.table_headers.join(" | "))
        }
        section.table_rows.slice(0, 10).forEach((row) => {
          lines.push(row.join(" | "))
        })
      }
    })
  }

  return lines.join("\n")
}

function ResponseStateBadge({ status, label, tone, className = "", title }) {
  const state = status || "empty"
  const resolvedLabel = label || getResponseStateLabel(state)
  const resolvedTone = tone || getResponseStateTone(state)

  return (
    <StatusBadge
      label={resolvedLabel}
      tone={resolvedTone}
      className={className}
      title={title || resolvedLabel}
    />
  )
}

function ResponseCompactChip({ label, value, tone = "neutral", className = "", title }) {
  return (
    <div
      className={`chatbot-response-chip chatbot-response-chip-${tone} ${className}`.trim()}
      title={title || (value ? `${label}: ${value}` : label)}
    >
      <span className="chatbot-response-chip-label">{label}</span>
      {value ? <span className="chatbot-response-chip-value">{value}</span> : null}
    </div>
  )
}

export function ResponseHeader({
  response,
  createdAt,
  onCopy,
  loading = false,
}) {
  const state = getResponseState(response, loading)
  const responseTypeLabel = loading ? "" : getResponseTypeLabel(response)
  const timestamp = formatAssistantTimestamp(createdAt || response?.generated_at)

  return (
    <header className="chatbot-response-header">
      <div className="chatbot-response-header-main">
        <div className="chatbot-response-avatar chatbot-response-avatar-brand" aria-hidden="true">
          <AssistantIcon className="chatbot-response-avatar-image" decorative />
        </div>
        <div className="chatbot-response-heading">
          <div className="chatbot-response-label-row">
            <div className="chatbot-response-label">AI Race Assistant</div>
            {responseTypeLabel ? (
              <ResponseStateBadge label={responseTypeLabel} tone="accent" />
            ) : null}
          </div>
          <div className="chatbot-response-timestamp">{timestamp}</div>
        </div>
      </div>

      <div className="chatbot-response-header-actions">
        <ResponseStateBadge status={state} />
        {onCopy ? (
          <button
            type="button"
            className="chatbot-response-copy"
            onClick={onCopy}
            title="Copy answer"
            aria-label="Copy answer"
          >
            <ContentCopyOutlinedIcon fontSize="inherit" />
          </button>
        ) : null}
      </div>
    </header>
  )
}

export function ResponseSummary({ summary, state }) {
  return <p className={`chatbot-response-summary chatbot-response-summary-${state}`}>{summary}</p>
}

export function ResponseMetaRow({ items }) {
  if (!items.length) {
    return null
  }

  return (
    <div className="chatbot-response-meta-row">
      {items.map((item) => (
        <ResponseCompactChip
          key={`${item.label}-${item.value}`}
          label={item.label}
          value={item.value}
          tone={item.tone || "neutral"}
        />
      ))}
    </div>
  )
}

export function ResponseInsightsRow({ items }) {
  if (!items.length) {
    return null
  }

  return (
    <div className="chatbot-response-insights-row">
      <div className="chatbot-response-insights-label">Key insights</div>
      <div className="chatbot-response-insights-chips">
        {items.map((item) => (
          <ResponseCompactChip
            key={`${item.label}-${item.value || "insight"}`}
            label={item.label}
            value={item.value || ""}
            tone={item.tone || "neutral"}
          />
        ))}
      </div>
    </div>
  )
}

export function ResponseContentSlot({ children }) {
  if (!children) {
    return null
  }

  return <div className="chatbot-response-content-slot">{children}</div>
}

export function SuggestedNextSteps({ suggestions = [], onFollowUp, loading = false }) {
  const visibleSuggestions = suggestions.slice(0, 4)

  if (!visibleSuggestions.length) {
    return null
  }

  return (
    <div className="chatbot-response-next-steps">
      <div className="chatbot-response-next-steps-label">Suggested next steps</div>
      <div className="chatbot-response-next-steps-chips">
        {visibleSuggestions.map((item) => {
          const ActionIcon =
            AutoAwesomeOutlinedIcon

          return (
            <button
              key={item}
              type="button"
              className="chatbot-response-next-step-chip"
              onClick={() => onFollowUp?.(item)}
              disabled={loading}
            >
              <ActionIcon fontSize="inherit" />
              <span>{item}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function AssistantResponseShell({
  response,
  message,
  scope = {},
  onCopy,
  onFollowUp,
  children = null,
  loading = false,
}) {
  const state = getResponseState(response, loading)
  const summary = buildAssistantSummary(response, message?.text || "")
  const hasSections = Array.isArray(response?.sections) && response.sections.length > 0
  const isLightReply =
    !loading &&
    state === "success" &&
    response?.kind === "message" &&
    !hasSections &&
    getRecordCount(response) === 0

  return (
    <div className={`chatbot-response-shell chatbot-response-shell-${state}`}>
      <ResponseHeader
        response={response}
        createdAt={message?.createdAt}
        onCopy={onCopy}
        loading={loading}
      />

      <div className="chatbot-response-shell-body">
        {isLightReply ? (
          <AssistantLightReply summary={summary} />
        ) : (
          <>
            <ResponseSummary summary={summary} state={state} />
          </>
        )}

        {loading ? (
          <ChatLoadingState
            label={summary}
            hint="The assistant is checking the live database before replying."
          />
        ) : hasSections ? (
          <ResponseContentSlot>{children}</ResponseContentSlot>
        ) : (
          children
        )}

        {!loading && state === "success" ? (
          <FollowUpPromptRow
            response={response}
            messageText={message?.text || ""}
            scope={scope}
            onAction={onFollowUp}
            className="chatbot-response-follow-ups"
          />
        ) : null}
      </div>
    </div>
  )
}
