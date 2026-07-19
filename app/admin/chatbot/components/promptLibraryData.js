const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim()

export const normalizePromptItem = (item) => {
  if (typeof item === "string") {
    const text = cleanText(item)
    return text ? { label: text, text } : null
  }

  const source = item || {}
  const text = cleanText(source.text || source.label)
  const label = cleanText(source.label || text)
  if (!text && !label) {
    return null
  }

  const mode = source.mode === "fill" ? "fill" : source.mode === "send" ? "send" : undefined

  return {
    label: label || text,
    text: text || label,
    mode,
    hint: cleanText(source.hint),
    category: cleanText(source.category),
    tone: cleanText(source.tone),
  }
}

export const normalizePromptItems = (items = []) =>
  items.map(normalizePromptItem).filter(Boolean)

export const dedupePromptItems = (items = []) => {
  const seen = new Set()
  return normalizePromptItems(items).filter((item) => {
    const key = `${item.label || item.text}`.toLowerCase()
    if (!key || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const createPrompt = (label, options = {}) =>
  normalizePromptItem({
    label,
    text: options.text || label,
    mode: options.mode,
    hint: options.hint,
    category: options.category,
    tone: options.tone,
  })

export const DETERMINISTIC_PROMPT_BANK = [
  createPrompt("Show latest events", { mode: "send", category: "deterministic" }),
  createPrompt("Show latest sessions", { mode: "send", category: "deterministic" }),
  createPrompt("Show latest submissions", { mode: "send", category: "deterministic" }),
  createPrompt("Show setup for latest session", { mode: "send", category: "deterministic" }),
  createPrompt("Show tire pressures", { mode: "send", category: "deterministic" }),
  createPrompt("Show suspension data", { mode: "send", category: "deterministic" }),
  createPrompt("Show alignment data", { mode: "send", category: "deterministic" }),
  createPrompt("Show tire temperatures", { mode: "send", category: "deterministic" }),
  createPrompt("Show tire history", { mode: "send", category: "deterministic" }),
  createPrompt("Show driver and vehicle data", { mode: "send", category: "deterministic" }),
  createPrompt("Show sessions for this event", { mode: "send", category: "deterministic" }),
  createPrompt("Show sessions for driver Alex", { mode: "fill", category: "deterministic" }),
  createPrompt("Show alignment for Car 12", { mode: "fill", category: "deterministic" }),
]

export const AI_ONLY_PROMPT_BANK = [
  createPrompt("Compare sessions", { mode: "send", category: "ai_only" }),
  createPrompt("Which one is better?", { mode: "send", category: "ai_only" }),
  createPrompt("How can I improve?", { mode: "send", category: "ai_only" }),
  createPrompt("What should I change next?", { mode: "send", category: "ai_only" }),
  createPrompt("What are my weak points?", { mode: "send", category: "ai_only" }),
  createPrompt("Compare with previous session", { mode: "send", category: "ai_only" }),
  createPrompt("Suggest priority changes", { mode: "send", category: "ai_only" }),
  createPrompt("Explain why", { mode: "send", category: "ai_only" }),
]

export const PROMPT_LIBRARY_SECTIONS = [
  {
    key: "deterministic",
    title: "Deterministic queries",
    description: "Known data lookups handled directly from the SM Racing database.",
    iconKey: "events",
    prompts: DETERMINISTIC_PROMPT_BANK,
  },
  {
    key: "ai_only",
    title: "AI comparison & coaching",
    description: "Comparison and guidance prompts that are allowed to use AI analysis.",
    iconKey: "comparison",
    prompts: AI_ONLY_PROMPT_BANK,
  },
]

export const buildFeaturedPrompts = (scope = {}) => {
  const eventLabel = cleanText(scope.eventLabel || scope.event_label || scope.selectedEventLabel)
  const sessionLabel = cleanText(
    scope.sessionLabel || scope.session_label || scope.selectedSessionLabel,
  )
  const driverLabel = cleanText(scope.driverLabel || scope.driver_label || scope.selectedDriverLabel)
  const vehicleLabel = cleanText(
    scope.vehicleLabel || scope.vehicle_label || scope.selectedVehicleLabel,
  )

  const prompts = [
    eventLabel
      ? createPrompt(`Show sessions for ${eventLabel}`, { mode: "send" })
      : createPrompt("Show latest events", { mode: "send" }),
    createPrompt("Show latest sessions", { mode: "send" }),
    sessionLabel
      ? createPrompt(`Show setup for ${sessionLabel}`, { mode: "send" })
      : createPrompt("Show setup for latest session", { mode: "send" }),
    createPrompt("Compare sessions", { mode: "send" }),
    driverLabel
      ? createPrompt(`Show sessions for ${driverLabel}`, { mode: "send" })
      : vehicleLabel
        ? createPrompt("Show alignment for Car 12", { mode: "fill" })
        : createPrompt("Show driver and vehicle data", { mode: "send" }),
  ]

  return dedupePromptItems(prompts).slice(0, 5)
}

const isPromptVague = (queryText) =>
  /recent|latest|today|more|tell me more|show data|show me|summary|anything|help/i.test(queryText)

const hasKeyword = (queryText, pattern) => pattern.test(queryText)

const EVENT_REFINE_PROMPTS = [
  createPrompt("Show latest events", { mode: "send" }),
  createPrompt("Show latest sessions", { mode: "send" }),
  createPrompt("Show sessions for this event", { mode: "send" }),
]

const SESSION_REFINE_PROMPTS = [
  createPrompt("Show latest sessions", { mode: "send" }),
  createPrompt("Show sessions for this event", { mode: "send" }),
  createPrompt("Show setup for latest session", { mode: "send" }),
]

const SETUP_REFINE_PROMPTS = [
  createPrompt("Show setup for latest session", { mode: "send" }),
  createPrompt("Show tire pressures", { mode: "send" }),
  createPrompt("Show alignment for Car 12", { mode: "fill" }),
]

const COMPARISON_REFINE_PROMPTS = [
  createPrompt("Compare sessions", { mode: "send" }),
  createPrompt("Compare with previous session", { mode: "send" }),
  createPrompt("Explain why", { mode: "send" }),
]

const RECOMMENDATION_REFINE_PROMPTS = [
  createPrompt("Which one is better?", { mode: "send" }),
  createPrompt("Show the strongest option", { mode: "send" }),
  createPrompt("Explain why", { mode: "send" }),
]

const COACHING_REFINE_PROMPTS = [
  createPrompt("How can I improve?", { mode: "send" }),
  createPrompt("Show weak points only", { mode: "send" }),
  createPrompt("Suggest priority changes", { mode: "send" }),
]

const SUBMISSION_REFINE_PROMPTS = [
  createPrompt("Show latest submissions", { mode: "send" }),
  createPrompt("Show latest sessions", { mode: "send" }),
  createPrompt("Show setup for latest session", { mode: "send" }),
]

const FLEET_REFINE_PROMPTS = [
  createPrompt("Show driver and vehicle data", { mode: "send" }),
  createPrompt("Show sessions for driver Alex", { mode: "fill" }),
  createPrompt("Show alignment for Car 12", { mode: "fill" }),
]

const DEFAULT_SUPPORT_PROMPTS = [
  createPrompt("Show latest sessions", { mode: "send" }),
  createPrompt("Show latest events", { mode: "send" }),
  createPrompt("Show driver and vehicle data", { mode: "send" }),
]

export const buildSupportPromptSuggestions = ({
  kind = "",
  queryText = "",
  scope = {},
  response = null,
  limit = 3,
}) => {
  const query = cleanText(queryText).toLowerCase()
  const prompts = []
  const add = (items) => {
    prompts.push(...items)
  }

  const hasEvent = hasKeyword(query, /event/)
  const hasSession = hasKeyword(query, /session|run group|rungroup/)
  const hasSetup = hasKeyword(query, /setup|pressure|suspension|alignment|temperature|history|corner/)
  const hasComparison = hasKeyword(query, /compare|difference|delta/)
  const hasSubmission = hasKeyword(query, /submission/)
  const hasFleet = hasKeyword(query, /driver|vehicle|car/)
  const hasRecommendation = hasKeyword(query, /best one|which one is better|strongest option|best setup|best session/)
  const hasCoaching = hasKeyword(query, /how can i improve|what should i improve|what should i change next|weak points|improve/)
  const vague = isPromptVague(query)
  const needsGeneralFallback =
    kind === "not_found" || kind === "unsupported" || kind === "needs_context" || kind === "error"

  if (hasRecommendation || kind === "recommendation") {
    add(RECOMMENDATION_REFINE_PROMPTS)
  } else if (hasCoaching || kind === "coaching") {
    add(COACHING_REFINE_PROMPTS)
  } else if (hasComparison || kind === "compare") {
    add(COMPARISON_REFINE_PROMPTS)
  } else if (hasSetup || kind === "setup") {
    add(SETUP_REFINE_PROMPTS)
  } else if (hasSubmission || kind === "submissions") {
    add(SUBMISSION_REFINE_PROMPTS)
  } else if (hasFleet || kind === "fleet") {
    add(FLEET_REFINE_PROMPTS)
  } else if (hasEvent || kind === "events") {
    add(EVENT_REFINE_PROMPTS)
  } else if (hasSession || kind === "sessions") {
    add(SESSION_REFINE_PROMPTS)
  } else if (vague) {
    add(scope.eventLabel ? EVENT_REFINE_PROMPTS : EVENT_REFINE_PROMPTS.slice(0, 2))
    add(SESSION_REFINE_PROMPTS)
    add(SUBMISSION_REFINE_PROMPTS.slice(0, 2))
  } else {
    add(buildFeaturedPrompts(scope))
  }

  if (needsGeneralFallback) {
    add(DEFAULT_SUPPORT_PROMPTS)
  }

  if (response?.kind === "compare") {
    add(COMPARISON_REFINE_PROMPTS)
  } else if (response?.kind === "recommendation") {
    add(RECOMMENDATION_REFINE_PROMPTS)
  } else if (response?.kind === "coaching") {
    add(COACHING_REFINE_PROMPTS)
  }

  return dedupePromptItems(prompts).slice(0, limit)
}

export const buildFollowUpPrompts = ({
  response = null,
  messageText = "",
  scope = {},
  limit = 4,
}) => {
  const prompts = []
  const add = (items) => {
    prompts.push(...items)
  }

  add(normalizePromptItems(response?.follow_up || []))

  if (response?.kind === "compare") {
    add([
      createPrompt("Which one is better?", { mode: "send" }),
      createPrompt("Compare with previous session", { mode: "send" }),
      createPrompt("Explain why", { mode: "send" }),
    ])
  } else if (response?.kind === "setup") {
    add([
      createPrompt("Show tire pressures", { mode: "send" }),
      createPrompt("Show alignment data", { mode: "send" }),
      createPrompt("Show suspension data", { mode: "send" }),
      createPrompt("Compare with previous session", { mode: "send" }),
    ])
  } else if (response?.kind === "sessions") {
    add([
      createPrompt("Show setup for latest session", { mode: "send" }),
      createPrompt("Show sessions for driver Alex", { mode: "fill" }),
      createPrompt("Compare sessions", { mode: "send" }),
    ])
  } else if (response?.kind === "events") {
    add([
      createPrompt("Show latest sessions", { mode: "send" }),
      createPrompt("Show sessions for this event", { mode: "send" }),
      createPrompt("Show driver and vehicle data", { mode: "send" }),
    ])
  } else if (response?.kind === "submissions") {
    add([
      createPrompt("Show latest sessions", { mode: "send" }),
      createPrompt("Show setup for latest session", { mode: "send" }),
      createPrompt("Show latest events", { mode: "send" }),
    ])
  } else if (response?.kind === "fleet") {
    add([
      createPrompt("Show latest sessions", { mode: "send" }),
      createPrompt("Show latest events", { mode: "send" }),
      createPrompt("Show alignment for Car 12", { mode: "fill" }),
    ])
  } else if (/compare|difference|delta/.test(cleanText(messageText).toLowerCase())) {
    add(COMPARISON_REFINE_PROMPTS)
  } else if (/setup|pressure|suspension|alignment|temperature|history/.test(cleanText(messageText).toLowerCase())) {
    add(SETUP_REFINE_PROMPTS)
  } else if (/submission/.test(cleanText(messageText).toLowerCase())) {
    add(SUBMISSION_REFINE_PROMPTS)
  } else if (/driver|vehicle|car/.test(cleanText(messageText).toLowerCase())) {
    add(FLEET_REFINE_PROMPTS)
  } else if (/event/.test(cleanText(messageText).toLowerCase())) {
    add(EVENT_REFINE_PROMPTS)
  }

  if (scope?.eventLabel && prompts.length < limit) {
    add([createPrompt("Show sessions for this event", { mode: "send" })])
  }

  if (scope?.driverLabel && prompts.length < limit) {
    add([createPrompt(`Show sessions for ${scope.driverLabel}`, { mode: "fill" })])
  }

  if (scope?.vehicleLabel && prompts.length < limit) {
    add([createPrompt(`Show latest session for ${scope.vehicleLabel}`, { mode: "fill" })])
  }

  return dedupePromptItems(prompts).slice(0, limit)
}
