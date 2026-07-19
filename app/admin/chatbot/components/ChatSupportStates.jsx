"use client"

/* eslint-disable @next/next/no-img-element */

import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined"
import AssistantIcon from "./AssistantIcon"
import { FollowUpPromptRow } from "./PromptLibrary"

function renderStateIcon(Icon) {
  if (!Icon) {
    return <AssistantIcon className="chatbot-support-state-avatar-image" decorative />
  }

  if (Icon === AssistantIcon) {
    return <AssistantIcon className="chatbot-support-state-avatar-image" decorative />
  }

  return <Icon fontSize="small" />
}

function normalizeAction(item) {
  if (typeof item === "string") {
    return { label: item }
  }

  return item || {}
}

export function AssistantThinkingIndicator({ className = "", label = "Thinking" }) {
  return (
    <div className={`chatbot-thinking-indicator ${className}`.trim()} aria-hidden="true">
      <span />
      <span />
      <span />
      <span className="chatbot-thinking-indicator-label">{label}</span>
    </div>
  )
}

export function ActionChipGroup({
  label = "Suggested next steps",
  items = [],
  onAction,
  loading = false,
  className = "",
}) {
  const visibleItems = items.slice(0, 5)

  if (!visibleItems.length) {
    return null
  }

  return (
    <div className={`chatbot-action-chip-group ${className}`.trim()}>
      {label ? <div className="chatbot-action-chip-group-label">{label}</div> : null}
      <div className="chatbot-action-chip-group-actions">
        {visibleItems.map((rawItem) => {
          const item = normalizeAction(rawItem)
          const Icon = item.icon || AutoAwesomeOutlinedIcon
          const disabled = loading || item.disabled

          return (
            <button
              key={item.label}
              type="button"
              className="chatbot-action-chip"
              onClick={() => onAction?.(item.label)}
              disabled={disabled}
              title={item.title || item.label}
            >
              <Icon fontSize="inherit" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SupportStateCard({
  eyebrow,
  title,
  message,
  tone = "neutral",
  icon = AssistantIcon,
  children = null,
  className = "",
}) {
  return (
    <section className={`chatbot-support-state chatbot-support-state-${tone} ${className}`.trim()}>
      <div className="chatbot-support-state-header">
        <div className="chatbot-support-state-avatar" aria-hidden="true">
          {renderStateIcon(icon)}
        </div>
        <div className="chatbot-support-state-copy">
          {eyebrow ? <div className="chatbot-support-state-eyebrow">{eyebrow}</div> : null}
          <h3 className="chatbot-support-state-title">{title}</h3>
          {message ? <p className="chatbot-support-state-message">{message}</p> : null}
        </div>
      </div>

      {children ? <div className="chatbot-support-state-body">{children}</div> : null}
    </section>
  )
}

export function ChatLoadingState({
  label = "Checking the SM2 Racing database...",
  hint = "Please wait a moment while the assistant reviews the live data.",
}) {
  return (
    <SupportStateCard
      eyebrow="Loading"
      title={label}
      message={hint}
      tone="info"
      icon={AssistantIcon}
      className="chatbot-support-state-loading"
    >
      <AssistantThinkingIndicator label="Working" />
    </SupportStateCard>
  )
}

export function ChatEmptyState({
  title = "AI Race Assistant",
  description = "Ask about sessions, events, setup data, submissions, comparisons, or performance guidance.",
  scope = {},
  loading = false,
  onAction,
}) {
  return (
    <section className="chatbot-empty-state">
      <div className="chatbot-empty-hero">
        <div className="chatbot-empty-icon" aria-hidden="true">
          <AssistantIcon className="chatbot-empty-icon-image assistant-icon-spin" decorative />
        </div>
        <div className="chatbot-empty-copy">
          <div className="chatbot-empty-eyebrow">SM Racing Database</div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      {loading ? (
        <div className="chatbot-empty-loading">
          <AssistantThinkingIndicator label="Loading live context" />
          <span>Connecting to the latest database filters.</span>
        </div>
      ) : null}
    </section>
  )
}

export function ChatNotFoundState({
  title = "No matching data was found in the SM2 Racing database.",
  message = "Try narrowing the event, session, driver, or vehicle, then ask again.",
  suggestions = [],
  loading = false,
  onAction,
}) {
  return (
    <SupportStateCard
      eyebrow="No match"
      title={title}
      message={message}
      tone="warning"
      icon={AssistantIcon}
    >
      <FollowUpPromptRow
        prompts={suggestions}
        onAction={onAction}
        loading={loading}
        className="chatbot-support-state-prompts"
      />
    </SupportStateCard>
  )
}

export function ChatUnsupportedState({
  title = "I can help with race data lookups, setup reviews, comparisons, and performance guidance.",
  message = "Try a supported SM Racing query or use one of the guided next steps below.",
  suggestions = [],
  loading = false,
  onAction,
}) {
  return (
    <SupportStateCard
      eyebrow="Unsupported"
      title={title}
      message={message}
      tone="neutral"
      icon={AssistantIcon}
    >
      <FollowUpPromptRow
        prompts={suggestions}
        onAction={onAction}
        loading={loading}
        className="chatbot-support-state-prompts"
      />
    </SupportStateCard>
  )
}

export function ChatValidationState({
  title = "I need a more specific filter before I can continue.",
  message = "Select an event, session, driver, or vehicle, then try the request again.",
  suggestions = [],
  loading = false,
  onAction,
}) {
  return (
    <SupportStateCard
      eyebrow="Needs context"
      title={title}
      message={message}
      tone="warning"
      icon={AssistantIcon}
    >
      <FollowUpPromptRow
        prompts={suggestions}
        onAction={onAction}
        loading={loading}
        className="chatbot-support-state-prompts"
      />
    </SupportStateCard>
  )
}

export function NeedsContextState(props) {
  return <ChatValidationState {...props} />
}

export function ChatErrorState({
  title = "The assistant could not reach the live database.",
  message = "Try again in a moment or refresh the context from the sidebar.",
  suggestions = [],
  loading = false,
  onAction,
}) {
  return (
    <SupportStateCard
      eyebrow="Database issue"
      title={title}
      message={message}
      tone="danger"
      icon={AssistantIcon}
    >
      <FollowUpPromptRow
        prompts={suggestions}
        onAction={onAction}
        loading={loading}
        className="chatbot-support-state-prompts"
      />
    </SupportStateCard>
  )
}
