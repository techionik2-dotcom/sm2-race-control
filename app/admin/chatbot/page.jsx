"use client"

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react"
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined"
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined"
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined"
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined"
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined"
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined"
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined"
import EventOutlinedIcon from "@mui/icons-material/EventOutlined"
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined"
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined"
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined"
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined"
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined"
import RecordVoiceOverOutlinedIcon from "@mui/icons-material/RecordVoiceOverOutlined"
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined"
import SendOutlinedIcon from "@mui/icons-material/SendOutlined"
import SpeedOutlinedIcon from "@mui/icons-material/SpeedOutlined"
import ThermostatOutlinedIcon from "@mui/icons-material/ThermostatOutlined"
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined"
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined"
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined"
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined"
import Loader from "../../components/Common/Loader"
import ProtectedRoute from "../../components/ProtectedRoute"
import StatusBadge from "../../components/Common/StatusBadge"
import VoiceInputControl from "../../components/Common/VoiceInputControl"
import { getChatbotContext, sendChatbotQuery } from "../../utils/chatbotApi"
import AssistantIcon from "./components/AssistantIcon"
import {
  ChatEmptyState,
  ChatErrorState,
  ChatNotFoundState,
  ChatUnsupportedState,
  NeedsContextState,
} from "./components/ChatSupportStates"
import CompactSessionList from "./components/CompactSessionList"
import ComparisonResponseSections from "./components/ComparisonResponseSections"
import CompactResultSection from "./components/CompactResultCards"
import SetupDetailSection from "./components/SetupDetailSections"
import SubmissionList from "./components/SubmissionList"
import AssistantResponseShell, {
  buildAssistantSummary,
  serializeAssistantResponse,
} from "./components/AssistantResponseShell"
import {
  buildSupportPromptSuggestions,
  normalizePromptItem,
} from "./components/promptLibraryData"
import "../submissions/SubmissionReview.css"
import "./ChatbotAssistant.css"

const MESSAGE_ICON_MAP = {
  user: AdminPanelSettingsOutlinedIcon,
  system: InfoOutlinedIcon,
  error: ErrorOutlineOutlinedIcon,
}

const SECTION_ICON_MAP = {
  event: EventOutlinedIcon,
  session: ScheduleOutlinedIcon,
  pressure: SpeedOutlinedIcon,
  suspension: TuneOutlinedIcon,
  alignment: TrackChangesOutlinedIcon,
  temperature: ThermostatOutlinedIcon,
  history: HistoryOutlinedIcon,
  compare: CompareArrowsOutlinedIcon,
  driver: PeopleAltOutlinedIcon,
  vehicle: DirectionsCarOutlinedIcon,
  default: DataObjectOutlinedIcon,
}

const COMPACT_RESPONSE_KINDS = new Set(["events", "fleet"])
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
const SETUP_SECTION_TITLES = [
  "session info",
  "pressures",
  "suspension",
  "alignment",
  "tire temperatures",
  "tire history",
  "metadata",
]

const formatTimestamp = (value) => {
  if (!value) return "Just now"

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Just now"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

const createMessage = (role, text, extra = {}) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  text,
  createdAt: new Date().toISOString(),
  ...extra,
})

const CHATBOT_CONVERSATION_STORAGE_KEY = "sm2_chatbot_conversation_id"

const createConversationId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`

const readStoredConversationId = () => {
  if (typeof window === "undefined") {
    return createConversationId()
  }

  try {
    const stored = window.localStorage.getItem(CHATBOT_CONVERSATION_STORAGE_KEY)
    if (stored) {
      return stored
    }
    const nextId = createConversationId()
    window.localStorage.setItem(CHATBOT_CONVERSATION_STORAGE_KEY, nextId)
    return nextId
  } catch {
    return createConversationId()
  }
}

const getSectionIcon = (iconKey) => SECTION_ICON_MAP[iconKey] || SECTION_ICON_MAP.default

const getMessageIcon = (role) => MESSAGE_ICON_MAP[role] || MESSAGE_ICON_MAP.system

const normalizeSectionTitle = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase()

const normalizeSupportText = (value) => String(value || "").replace(/\s+/g, " ").trim()

const isValidationText = (value) => VALIDATION_HINT_PATTERNS.some((pattern) => pattern.test(value))

const buildLoadingCopy = (queryText) => {
  const text = normalizeSupportText(queryText).toLowerCase()

  if (/compare|difference|delta/.test(text)) {
    return "Preparing comparison..."
  }

  if (/setup|pressure|suspension|alignment|temperature|history/.test(text)) {
    return "Reviewing session data..."
  }

  if (/event/.test(text)) {
    return "Checking event records..."
  }

  if (/driver|vehicle|car/.test(text)) {
    return "Checking driver and vehicle data..."
  }

  if (/submission/.test(text)) {
    return "Checking recent submissions..."
  }

  if (/latest sessions/.test(text)) {
    return "Reviewing recent sessions..."
  }

  if (/latest session|summary of this session|summarize this session/.test(text)) {
    return "Summarizing the latest session..."
  }

  return "Checking live SM2 Racing data..."
}

const buildSupportSuggestions = ({ kind, scope = {}, response, queryText = "" }) =>
  buildSupportPromptSuggestions({
    kind,
    scope,
    response,
    queryText,
    limit: 3,
  })

const getSupportState = ({ message, response, scope }) => {
  const status = response?.status || (message?.role === "error" ? "error" : "")
  const queryText = normalizeSupportText(message?.text || "")
  const supportText = normalizeSupportText(
    response?.error_message || response?.error || response?.summary || message?.text,
  )
  const isValidation =
    status === "error" &&
    (message?.errorStatus === 400 ||
      message?.errorStatus === 422 ||
      isValidationText(supportText))

  if (status === "not_found") {
      return {
        variant: "not_found",
        component: ChatNotFoundState,
        props: {
          title: "No matching data was found in the SM2 Racing database.",
          message: "Try narrowing the event, session, driver, or vehicle, then ask again.",
          suggestions: buildSupportSuggestions({
            kind: "not_found",
            scope,
            response,
            queryText,
          }),
        },
      }
  }

  if (status === "unsupported") {
      return {
        variant: "unsupported",
        component: ChatUnsupportedState,
        props: {
          title: "I can help with sessions, events, setup data, comparisons, and summaries.",
          message: "Use one of the supported race-data queries to stay within the current scope.",
          suggestions: buildSupportSuggestions({
            kind: "unsupported",
            scope,
            response,
            queryText,
          }),
        },
      }
  }

  if (status === "needs_context") {
      return {
        variant: "needs_context",
        component: NeedsContextState,
        props: {
          title: "I need one more detail before I can continue.",
          message: supportText || "Select the missing event, session, driver, or vehicle and try again.",
          suggestions: buildSupportSuggestions({
            kind: "needs_context",
            scope,
            response,
            queryText,
          }),
        },
      }
  }

  if (isValidation) {
      return {
        variant: "needs_context",
        component: NeedsContextState,
        props: {
          title: "I need one more detail before I can continue.",
          message: supportText || "Select an event, session, driver, or vehicle, then try again.",
          suggestions: buildSupportSuggestions({
            kind: "needs_context",
            scope,
            response,
            queryText,
          }),
        },
      }
  }

  if (status === "error") {
      return {
        variant: "error",
        component: ChatErrorState,
        props: {
          title: "The assistant could not reach the live database.",
          message:
            supportText ||
            "Try again in a moment or refresh the context from the sidebar.",
          suggestions: buildSupportSuggestions({
            kind: "error",
            scope,
            response,
            queryText,
          }),
        },
      }
  }

  return null
}

const isSetupLikeResponse = (response) =>
  response?.kind === "setup" ||
  (Array.isArray(response?.sections) &&
    response.sections.some((section) =>
      SETUP_SECTION_TITLES.includes(normalizeSectionTitle(section?.title)),
    ))

function ChatbotSection({ section }) {
  const Icon = getSectionIcon(section.icon_key)

  return (
    <section className="chatbot-section">
      <header className="chatbot-section-header">
        <div className="chatbot-section-icon" aria-hidden="true">
          <Icon fontSize="small" />
        </div>
        <div className="chatbot-section-copy">
          <h3 className="chatbot-section-title">{section.title}</h3>
          {section.subtitle ? <p className="chatbot-section-subtitle">{section.subtitle}</p> : null}
        </div>
      </header>

      {section.variant === "fields" ? (
        <div className="chatbot-field-grid">
          {section.fields.map((field) => (
            <article className="chatbot-field-card" key={`${section.title}-${field.label}`}>
              <span className="chatbot-field-label">{field.label}</span>
              <span className="chatbot-field-value">{field.value}</span>
            </article>
          ))}
        </div>
      ) : null}

      {section.variant === "cards" ? (
        <div className="chatbot-card-grid">
          {section.cards.map((card) => {
            const CardIcon = getSectionIcon(card.icon_key || section.icon_key)

            return (
              <article className="chatbot-data-card" key={`${section.title}-${card.title}`}>
                <div className="chatbot-data-card-top">
                  <div className="chatbot-data-card-title-wrap">
                    <div className="chatbot-data-card-icon" aria-hidden="true">
                      <CardIcon fontSize="small" />
                    </div>
                    <div>
                      <h4 className="chatbot-data-card-title">{card.title}</h4>
                      {card.subtitle ? <p className="chatbot-data-card-subtitle">{card.subtitle}</p> : null}
                    </div>
                  </div>
                  {card.badge ? (
                    <StatusBadge
                      label={card.badge}
                      tone={card.badge_tone || "neutral"}
                    />
                  ) : null}
                </div>

                <div className="chatbot-data-card-fields">
                  {card.fields.map((field) => (
                    <div className="chatbot-inline-field" key={`${card.title}-${field.label}`}>
                      <span className="chatbot-inline-field-label">{field.label}</span>
                      <span className="chatbot-inline-field-value">{field.value}</span>
                    </div>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      {section.variant === "table" ? (
        <div className="chatbot-table-wrap">
          <table className="chatbot-table">
            <thead>
              <tr>
                {section.table_headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table_rows.map((row, rowIndex) => (
                <tr key={`${section.title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${section.title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function ChatbotMessage({ message, onCopy, onFollowUp }) {
  const Icon = getMessageIcon(message.role)
  const isAssistant = message.role === "assistant"
  const isSystem = message.role === "system"
  const isError = message.role === "error"
  const response = message.response
  const supportState = getSupportState({
    message,
    response: response || (isError ? { status: "error", error_message: message.text } : null),
    scope: message.scope || {},
  })
  const SupportComponent = supportState?.component
  const useComparisonLayout = Boolean(response && response.kind === "compare")
  const useSessionListLayout = Boolean(response && response.kind === "sessions")
  const useSubmissionListLayout = Boolean(response && response.kind === "submissions")
  const useCompactResultLayout = Boolean(response && COMPACT_RESPONSE_KINDS.has(response.kind))
  const useSetupLayout = isSetupLikeResponse(response)
  const responseSections = Array.isArray(response?.sections) ? response.sections : []
  const showSupportState = Boolean(supportState && supportState.variant !== "not_found")
  const showSupportStateBeforeResults = Boolean(
    showSupportState && supportState?.variant === "needs_context" && responseSections.length,
  )

  if (isAssistant || (isError && response)) {
    const resultsContent = responseSections.length ? (
      <div
        className={`chatbot-response-sections ${
          useCompactResultLayout ? "chatbot-response-sections-compact" : ""
        }`.trim()}
      >
        {useComparisonLayout ? (
          <ComparisonResponseSections response={response} scope={message.scope} />
        ) : useSessionListLayout ? (
          responseSections.map((section) =>
            normalizeSectionTitle(section?.title) === "latest sessions" ? (
              <CompactSessionList key={`${message.id}-${section.title}`} section={section} />
            ) : (
              <CompactResultSection
                key={`${message.id}-${section.title}`}
                section={section}
                responseKind={response?.kind}
              />
            ),
          )
        ) : useSubmissionListLayout ? (
          responseSections.map((section) =>
            normalizeSectionTitle(section?.title) === "submissions" ? (
              <SubmissionList key={`${message.id}-${section.title}`} section={section} />
            ) : (
              <CompactResultSection
                key={`${message.id}-${section.title}`}
                section={section}
                responseKind={response?.kind}
              />
            ),
          )
        ) : (
          responseSections.map((section) =>
            useSetupLayout ? (
              <SetupDetailSection key={`${message.id}-${section.title}`} section={section} />
            ) : useCompactResultLayout ? (
              <CompactResultSection
                key={`${message.id}-${section.title}`}
                section={section}
                responseKind={response?.kind}
              />
            ) : (
              <ChatbotSection key={`${message.id}-${section.title}`} section={section} />
            ),
          )
        )}
      </div>
    ) : null

    const responseContent = showSupportState && !showSupportStateBeforeResults ? (
      <SupportComponent {...supportState.props} onAction={onFollowUp} />
    ) : showSupportStateBeforeResults ? (
      <div className="chatbot-response-stacked-state">
        <SupportComponent {...supportState.props} onAction={onFollowUp} />
        {resultsContent}
      </div>
    ) : (
      resultsContent
    )

    return (
      <article className="chatbot-message chatbot-message-assistant">
        <AssistantResponseShell
          message={message}
          response={response}
          scope={message.scope}
          onCopy={response ? () => onCopy?.(message) : null}
          onFollowUp={onFollowUp}
        >
          {responseContent}
        </AssistantResponseShell>
      </article>
    )
  }

  if (isError && !response) {
    if (SupportComponent) {
      return (
        <article className="chatbot-message chatbot-message-error chatbot-message-support">
          <SupportComponent {...supportState.props} onAction={onFollowUp} />
        </article>
      )
    }

    return (
      <article className="chatbot-message chatbot-message-error chatbot-message-support">
        <p className="chatbot-message-text chatbot-message-text-error">{message.text}</p>
      </article>
    )
  }

  const messageText = response?.answer || response?.summary || message.text

  return (
    <article className={`chatbot-message chatbot-message-${message.role}`}>
      <header className="chatbot-message-header">
        <div className="chatbot-message-avatar" aria-hidden="true">
          <Icon fontSize="small" />
        </div>
        <div className="chatbot-message-meta">
          <div className="chatbot-message-label">
            {message.role === "user" ? "Owner" : message.role === "error" ? "Connection Issue" : "System"}
          </div>
          <div className="chatbot-message-time">{formatTimestamp(message.createdAt)}</div>
        </div>
      </header>

      <div className="chatbot-message-body">
        <p
          className={`chatbot-message-text ${
            isError ? "chatbot-message-text-error" : isSystem ? "chatbot-message-text-system" : ""
          }`}
        >
          {messageText}
        </p>
      </div>
    </article>
  )
}

export default function ChatbotPage() {
  const [contextLoading, setContextLoading] = useState(true)
  const [contextError, setContextError] = useState("")
  const [context, setContext] = useState({
    events: [],
    sessions: [],
    drivers: [],
    vehicles: [],
    default_event_id: null,
    default_session_id: null,
    default_driver_id: null,
    default_vehicle_id: null,
    has_event_data: false,
    has_session_data: false,
    has_driver_data: false,
    has_vehicle_data: false,
    source_label: "SM2 Racing Database",
  })
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState("")
  const [selectedEventId, setSelectedEventId] = useState("")
  const [selectedSessionId, setSelectedSessionId] = useState("")
  const [selectedDriverId, setSelectedDriverId] = useState("")
  const [selectedVehicleId, setSelectedVehicleId] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [notice, setNotice] = useState("")
  const [lastUserQuery, setLastUserQuery] = useState("")
  const [conversationId, setConversationId] = useState(() => readStoredConversationId())
  const listRef = useRef(null)
  const composerRef = useRef(null)

  const loadContext = async () => {
    try {
      setContextLoading(true)
      setContextError("")
      const response = await getChatbotContext()
      setContext(response.context || {
        events: [],
        sessions: [],
        drivers: [],
        vehicles: [],
        default_event_id: null,
        default_session_id: null,
        default_driver_id: null,
        default_vehicle_id: null,
        has_event_data: false,
        has_session_data: false,
        has_driver_data: false,
        has_vehicle_data: false,
        source_label: "SM2 Racing Database",
      })
    } catch (error) {
      setContextError(error.message || "Failed to load AI Race Assistant context.")
      setContext({
        events: [],
        sessions: [],
        drivers: [],
        vehicles: [],
        default_event_id: null,
        default_session_id: null,
        default_driver_id: null,
        default_vehicle_id: null,
        has_event_data: false,
        has_session_data: false,
        has_driver_data: false,
        has_vehicle_data: false,
        source_label: "SM2 Racing Database",
      })
    } finally {
      setContextLoading(false)
    }
  }

  useEffect(() => {
    void loadContext()
  }, [])

  useEffect(() => {
    if (!notice) {
      return undefined
    }

    const timeout = window.setTimeout(() => setNotice(""), 4000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    try {
      window.localStorage.setItem(CHATBOT_CONVERSATION_STORAGE_KEY, conversationId)
    } catch {
      // Ignore storage failures and keep the in-memory conversation id.
    }
  }, [conversationId])

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const selectedEvent = useMemo(
    () => context.events.find((event) => event.value === selectedEventId) || null,
    [context.events, selectedEventId],
  )

  const selectedDriver = useMemo(
    () => context.drivers.find((driver) => driver.value === selectedDriverId) || null,
    [context.drivers, selectedDriverId],
  )

  const selectedVehicle = useMemo(
    () => context.vehicles.find((vehicle) => vehicle.value === selectedVehicleId) || null,
    [context.vehicles, selectedVehicleId],
  )

  const visibleSessions = useMemo(
    () =>
      context.sessions.filter((session) => {
        if (selectedEventId && session.event_id !== selectedEventId) {
          return false
        }

        if (selectedDriverId && session.driver_id !== selectedDriverId) {
          return false
        }

        if (selectedVehicleId && session.vehicle_id !== selectedVehicleId) {
          return false
        }

        return true
      }),
    [context.sessions, selectedDriverId, selectedEventId, selectedVehicleId],
  )

  const selectedSession = useMemo(
    () => visibleSessions.find((session) => session.value === selectedSessionId) || null,
    [selectedSessionId, visibleSessions],
  )

  const promptScope = useMemo(
    () => ({
      eventLabel: selectedEvent?.label || "",
      sessionLabel: selectedSession?.label || "",
      driverLabel: selectedDriver?.label || "",
      vehicleLabel: selectedVehicle?.label || "",
    }),
    [selectedDriver?.label, selectedEvent?.label, selectedSession?.label, selectedVehicle?.label],
  )

  const latestAssistantMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (
        messages[index].role === "assistant" ||
        (messages[index].role === "error" && messages[index].response)
      ) {
        return messages[index]
      }
    }
    return null
  }, [messages])

  useEffect(() => {
    if (!selectedSessionId) {
      return
    }

    if (!visibleSessions.some((session) => session.value === selectedSessionId)) {
      setSelectedSessionId("")
    }
  }, [selectedSessionId, visibleSessions])

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages, isSending])

  useEffect(() => {
    if (context.default_event_id && !selectedEventId) {
      setNotice("Live context loaded from the SM2 Racing Database.")
    }
  }, [context.default_event_id, selectedEventId])

  const appendMessage = (message) => {
    setMessages((current) => [...current, message])
  }

  const runQuery = async (
    queryText,
    { addUserMessage = true, messageText = null, clearDraft = true } = {},
  ) => {
    const trimmed = queryText.trim()
    if (!trimmed || isSending) {
      return
    }

    const scopeSnapshot = {
      event_id: selectedEventId || null,
      event_label: selectedEvent?.label || null,
      session_id: selectedSessionId || null,
      session_label: selectedSession?.label || null,
      driver_id: selectedDriverId || null,
      driver_label: selectedDriver?.label || null,
      vehicle_id: selectedVehicleId || null,
      vehicle_label: selectedVehicle?.label || null,
    }

    if (addUserMessage) {
      appendMessage(createMessage("user", trimmed))
      setLastUserQuery(trimmed)
    } else if (messageText) {
      appendMessage(createMessage("system", messageText))
    }

    setIsSending(true)

    try {
      const response = await sendChatbotQuery({
        message: trimmed,
        query: trimmed,
        conversation_id: conversationId,
        event_id: selectedEventId || null,
        session_id: selectedSessionId || null,
        driver_id: selectedDriverId || null,
        vehicle_id: selectedVehicleId || null,
        limit: 6,
      })

      const assistantResponse = response.response
      const assistantMessageText = buildAssistantSummary(assistantResponse, "Response received.")
      appendMessage(
        createMessage(
          assistantResponse.status === "error" ? "error" : "assistant",
          assistantMessageText,
          {
            response: assistantResponse,
            scope: scopeSnapshot,
          },
        ),
      )
      setNotice("Latest database response loaded.")
    } catch (error) {
      appendMessage(
        createMessage(
          "error",
          error.message || "The AI Race Assistant could not reach the database.",
          {
            errorStatus: error.status ?? null,
            errorData: error.data ?? null,
          },
        ),
      )
    } finally {
      setIsSending(false)
      if (clearDraft) {
        setDraft("")
      }
      composerRef.current?.focus()
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    await runQuery(draft)
  }

  const handleQuickAction = async (prompt) => {
    const item = normalizePromptItem(prompt)
    if (!item?.label) {
      return
    }

    if (item.mode === "fill") {
      setDraft(item.text || item.label)
      composerRef.current?.focus()
      return
    }

    await runQuery(item.text || item.label)
  }

  const handleRefresh = async () => {
    await loadContext()

    if (lastUserQuery) {
      await runQuery(lastUserQuery, {
        addUserMessage: false,
        messageText: "Refreshing the latest data for the current scope.",
        clearDraft: false,
      })
      return
    }

    setNotice("Context refreshed from the live database.")
  }

  const handleClearChat = () => {
    setMessages([])
    setLastUserQuery("")
    setDraft("")
    setNotice("Conversation cleared.")
    setConversationId(createConversationId())
    composerRef.current?.focus()
  }

  const handleCopyMessage = async (message) => {
    const response = message?.response
    if (!response) {
      return
    }

    const text = serializeAssistantResponse(response, message?.scope || {})

    try {
      await navigator.clipboard.writeText(text)
      setNotice("Answer copied to the clipboard.")
    } catch (error) {
      setNotice("Unable to copy the answer.")
    }
  }

  const handleCopyLatest = async () => {
    if (!latestAssistantMessage) {
      return
    }

    await handleCopyMessage(latestAssistantMessage)
  }

  const stopSpeaking = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      return
    }

    window.speechSynthesis.cancel()
    setIsSpeaking(false)
  }

  const handleSpeakLatest = () => {
    if (!latestAssistantMessage?.response) {
      setNotice("There is no assistant answer to read yet.")
      return
    }

    if (
      typeof window === "undefined" ||
      !window.speechSynthesis ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      setNotice("Speech playback is not supported in this browser.")
      return
    }

    const text = buildAssistantSummary(
      latestAssistantMessage.response,
      latestAssistantMessage.text,
    )

    if (!text) {
      setNotice("There is no assistant answer to read yet.")
      return
    }

    stopSpeaking()

    const utterance = new window.SpeechSynthesisUtterance(text)
    utterance.lang = "en-US"
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onend = () => {
      setIsSpeaking(false)
    }
    utterance.onerror = () => {
      setIsSpeaking(false)
      setNotice("Could not read the latest answer aloud.")
    }

    setIsSpeaking(true)
    setNotice("Reading the latest answer aloud.")
    window.speechSynthesis.speak(utterance)
  }

  const handleEventChange = (event) => {
    const nextEventId = event.target.value
    setSelectedEventId(nextEventId)
    setSelectedSessionId("")
  }

  const handleSessionChange = (event) => {
    setSelectedSessionId(event.target.value)
  }

  const handleDriverChange = (event) => {
    const nextDriverId = event.target.value
    setSelectedDriverId(nextDriverId)
    setSelectedSessionId("")
  }

  const handleVehicleChange = (event) => {
    const nextVehicleId = event.target.value
    setSelectedVehicleId(nextVehicleId)
    setSelectedSessionId("")
  }

  const hasMessages = messages.length > 0
  const canCopy = Boolean(latestAssistantMessage?.response)

  return (
    <ProtectedRoute requireOwner>
      <div className="chatbot-page">
      <div className="chatbot-shell">
          <header className="chatbot-hero">
            <div className="chatbot-hero-copy">
              <div className="chatbot-eyebrow">
                <AdminPanelSettingsOutlinedIcon fontSize="inherit" />
                <span>Owner Operations</span>
              </div>
              <div className="chatbot-hero-brand">
                <div className="chatbot-hero-icon" aria-hidden="true">
                  <AssistantIcon
                    className="chatbot-hero-icon-image assistant-icon-spin"
                    alt="SM Racing AI Assistant"
                  />
                </div>
                <div className="chatbot-hero-heading">
                  <h1>AI Race Assistant</h1>
                  <p>
                    Ask questions, compare sessions, and review setup data from the SM2 Racing
                    database.
                  </p>
                </div>
              </div>
            </div>

            <div className="chatbot-hero-tools">
              <div className="chatbot-hero-badges">
                <StatusBadge
                  label={context.source_label || "SM2 Racing Database"}
                  tone={contextLoading ? "warning" : "success"}
                />
                <StatusBadge
                  label={contextError ? "Database unavailable" : "Database ready"}
                  tone={contextError ? "danger" : "success"}
                />
                <StatusBadge
                  label={context.has_driver_data ? "Drivers loaded" : "No drivers"}
                  tone={context.has_driver_data ? "success" : "warning"}
                />
                <StatusBadge
                  label={context.has_vehicle_data ? "Vehicles loaded" : "No vehicles"}
                  tone={context.has_vehicle_data ? "success" : "warning"}
                />
              </div>

              <div className="chatbot-hero-actions">
                <button
                  type="button"
                  className="chatbot-action-button"
                  onClick={handleRefresh}
                  disabled={isSending}
                >
                  <RefreshOutlinedIcon fontSize="small" />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  className="chatbot-action-button"
                  onClick={handleCopyLatest}
                  disabled={!canCopy}
                >
                  <ContentCopyOutlinedIcon fontSize="small" />
                  <span>Copy answer</span>
                </button>
                <button
                  type="button"
                  className={`chatbot-action-button ${isSpeaking ? "voice-active" : ""}`.trim()}
                  onClick={isSpeaking ? stopSpeaking : handleSpeakLatest}
                  disabled={!latestAssistantMessage?.response && !isSpeaking}
                >
                  {isSpeaking ? (
                    <StopCircleOutlinedIcon fontSize="small" />
                  ) : (
                    <RecordVoiceOverOutlinedIcon fontSize="small" />
                  )}
                  <span>{isSpeaking ? "Stop reading" : "Read latest"}</span>
                </button>
                <button
                  type="button"
                  className="chatbot-action-button danger"
                  onClick={handleClearChat}
                  disabled={!hasMessages || isSending}
                >
                  <DeleteSweepOutlinedIcon fontSize="small" />
                  <span>Clear chat</span>
                </button>
              </div>
            </div>
          </header>

          <div className="chatbot-grid">
            <aside className="chatbot-sidebar">
              <section className="chatbot-sidebar-card chatbot-status-card">
                <div className="chatbot-sidebar-card-head">
                  <div className="chatbot-sidebar-card-icon" aria-hidden="true">
                    <AutoAwesomeOutlinedIcon fontSize="small" />
                  </div>
                  <div>
                    <h2>Live context</h2>
                    <p>Realtime filters and source status</p>
                  </div>
                </div>

                <div className="chatbot-metric-grid">
                  <article className="chatbot-metric-card">
                    <span className="chatbot-metric-value">{context.events.length}</span>
                    <span className="chatbot-metric-label">Events</span>
                  </article>
                  <article className="chatbot-metric-card">
                    <span className="chatbot-metric-value">{context.sessions.length}</span>
                    <span className="chatbot-metric-label">Sessions</span>
                  </article>
                  <article className="chatbot-metric-card">
                    <span className="chatbot-metric-value">{context.drivers.length}</span>
                    <span className="chatbot-metric-label">Drivers</span>
                  </article>
                  <article className="chatbot-metric-card">
                    <span className="chatbot-metric-value">{context.vehicles.length}</span>
                    <span className="chatbot-metric-label">Vehicles</span>
                  </article>
                </div>

                {notice ? <div className="chatbot-notice">{notice}</div> : null}
              </section>

              <section className="chatbot-sidebar-card">
                <div className="chatbot-sidebar-card-head">
                  <div className="chatbot-sidebar-card-icon" aria-hidden="true">
                    <FilterAltOutlinedIcon fontSize="small" />
                  </div>
                  <div>
                    <h2>Scope filters</h2>
                    <p>Optional event and session scoping</p>
                  </div>
                </div>

                <div className="chatbot-filter-grid">
                  <div className="chatbot-filter-group">
                    <label className="chatbot-filter-label" htmlFor="event-filter">
                      Event
                    </label>
                    <select
                      id="event-filter"
                      className="chatbot-select"
                      value={selectedEventId}
                      onChange={handleEventChange}
                      disabled={contextLoading}
                    >
                      <option value="">All events</option>
                      {context.events.map((event) => (
                        <option key={event.value} value={event.value}>
                          {event.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="chatbot-filter-group">
                    <label className="chatbot-filter-label" htmlFor="session-filter">
                      Session
                    </label>
                    <select
                      id="session-filter"
                      className="chatbot-select"
                      value={selectedSessionId}
                      onChange={handleSessionChange}
                      disabled={contextLoading || visibleSessions.length === 0}
                    >
                      <option value="">Latest sessions</option>
                      {visibleSessions.map((session) => (
                        <option key={session.value} value={session.value}>
                          {session.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="chatbot-filter-group">
                    <label className="chatbot-filter-label" htmlFor="driver-filter">
                      Driver
                    </label>
                    <select
                      id="driver-filter"
                      className="chatbot-select"
                      value={selectedDriverId}
                      onChange={handleDriverChange}
                      disabled={contextLoading}
                    >
                      <option value="">All drivers</option>
                      {context.drivers.map((driver) => (
                        <option key={driver.value} value={driver.value}>
                          {driver.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="chatbot-filter-group">
                    <label className="chatbot-filter-label" htmlFor="vehicle-filter">
                      Vehicle
                    </label>
                    <select
                      id="vehicle-filter"
                      className="chatbot-select"
                      value={selectedVehicleId}
                      onChange={handleVehicleChange}
                      disabled={contextLoading}
                    >
                      <option value="">All vehicles</option>
                      {context.vehicles.map((vehicle) => (
                        <option key={vehicle.value} value={vehicle.value}>
                          {vehicle.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="chatbot-scope-summary">
                  <div className="chatbot-scope-row">
                    <span>Event scope</span>
                    <strong>{selectedEvent?.label || "All events"}</strong>
                  </div>
                  <div className="chatbot-scope-row">
                    <span>Session scope</span>
                    <strong>{selectedSession?.label || "Latest sessions"}</strong>
                  </div>
                  <div className="chatbot-scope-row">
                    <span>Driver scope</span>
                    <strong>{selectedDriver?.label || "All drivers"}</strong>
                  </div>
                  <div className="chatbot-scope-row">
                    <span>Vehicle scope</span>
                    <strong>{selectedVehicle?.label || "All vehicles"}</strong>
                  </div>
                </div>
              </section>

              {contextLoading ? (
                <div className="chatbot-sidebar-loader">
                  <Loader label="Loading context" sublabel="Fetching the latest database filters." />
                </div>
              ) : null}

              {contextError ? (
                <section className="chatbot-sidebar-card chatbot-error-card">
                  <div className="chatbot-sidebar-card-head">
                    <div className="chatbot-sidebar-card-icon" aria-hidden="true">
                      <ErrorOutlineOutlinedIcon fontSize="small" />
                    </div>
                    <div>
                      <h2>Database unavailable</h2>
                      <p>The assistant can still accept queries, but the backend is failing.</p>
                    </div>
                  </div>
                  <p className="chatbot-error-text">{contextError}</p>
                  <button
                    type="button"
                    className="chatbot-action-button"
                    onClick={handleRefresh}
                    disabled={isSending}
                  >
                    <RefreshOutlinedIcon fontSize="small" />
                    <span>Retry connection</span>
                  </button>
                </section>
              ) : null}
            </aside>

            <section className="chatbot-panel">
              <div className="chatbot-panel-header">
                <div>
                  <h2>Conversation</h2>
                  <p>
                    {contextLoading
                      ? "Connecting to the database and loading live filters."
                      : "Ask in plain language. The assistant will respond with structured race data when available."}
                  </p>
                </div>

                <div className="chatbot-panel-header-badges">
                  <StatusBadge
                    label={context.has_event_data ? "Events loaded" : "No events"}
                    tone={context.has_event_data ? "success" : "warning"}
                  />
                  <StatusBadge
                    label={context.has_session_data ? "Sessions loaded" : "No sessions"}
                    tone={context.has_session_data ? "success" : "warning"}
                  />
                  <StatusBadge
                    label={context.has_driver_data ? "Drivers loaded" : "No drivers"}
                    tone={context.has_driver_data ? "success" : "warning"}
                  />
                  <StatusBadge
                    label={context.has_vehicle_data ? "Vehicles loaded" : "No vehicles"}
                    tone={context.has_vehicle_data ? "success" : "warning"}
                  />
                </div>
              </div>

              <div className="chatbot-message-list" ref={listRef}>
                {!hasMessages ? (
                  <ChatEmptyState
                    scope={promptScope}
                    onAction={handleQuickAction}
                    loading={contextLoading || isSending}
                  />
                ) : (
                  messages.map((message) => (
                    <ChatbotMessage
                      key={message.id}
                      message={message}
                      onCopy={handleCopyMessage}
                      onFollowUp={handleQuickAction}
                    />
                  ))
                )}

                {isSending ? (
                  <article className="chatbot-message chatbot-message-assistant chatbot-typing-message">
                    <AssistantResponseShell
                      message={{
                        createdAt: null,
                        text: buildLoadingCopy(lastUserQuery || draft),
                      }}
                      response={{
                        kind: "message",
                        status: "loading",
                        source_label: context.source_label || "SM2 Racing Database",
                        data_source: context.source_label || "SM2 Racing Database",
                      }}
                      loading
                    />
                  </article>
                ) : null}
              </div>

              <form className="chatbot-composer" onSubmit={handleSubmit}>
                <div className="chatbot-composer-inner">
                  <label className="chatbot-composer-label" htmlFor="chatbot-input">
                    Ask the AI Race Assistant
                  </label>
                  <textarea
                    ref={composerRef}
                    id="chatbot-input"
                    className="chatbot-input"
                    placeholder="Ask about sessions, setup sheets, events, tire pressures, or comparisons..."
                    value={draft}
                    rows={3}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        void handleSubmit(event)
                      }
                    }}
                    disabled={isSending}
                  />

                  <VoiceInputControl
                    className="chatbot-voice-input"
                    mode="assistant"
                    textareaRef={composerRef}
                    onValueChange={setDraft}
                    onTranscriptInserted={() => {
                      setNotice("Voice prompt inserted into the composer.")
                    }}
                    disabled={isSending}
                  />

                  <div className="chatbot-composer-footer">
                    <div className="chatbot-composer-hint">
                      <InfoOutlinedIcon fontSize="inherit" />
                      <span>Press Enter to send. Shift+Enter adds a new line.</span>
                    </div>

                    <button
                      type="submit"
                      className="chatbot-send-button"
                      disabled={!draft.trim() || isSending}
                    >
                      <SendOutlinedIcon fontSize="small" />
                      <span>Send</span>
                    </button>
                  </div>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
