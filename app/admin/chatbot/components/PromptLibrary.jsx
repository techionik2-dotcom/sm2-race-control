"use client"

import { useMemo, useState } from "react"
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined"
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined"
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined"
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined"
import EventOutlinedIcon from "@mui/icons-material/EventOutlined"
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined"
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined"
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined"
import { PROMPT_LIBRARY_SECTIONS, buildFeaturedPrompts, buildFollowUpPrompts, dedupePromptItems, normalizePromptItem, normalizePromptItems } from "./promptLibraryData"

const CATEGORY_ICON_MAP = {
  events: EventOutlinedIcon,
  sessions: ScheduleOutlinedIcon,
  setup: TuneOutlinedIcon,
  comparison: CompareArrowsOutlinedIcon,
  summaries: AutoAwesomeOutlinedIcon,
  submissions: DescriptionOutlinedIcon,
  fleet: DirectionsCarOutlinedIcon,
}

function getCategoryIcon(key) {
  return CATEGORY_ICON_MAP[key] || AutoAwesomeOutlinedIcon
}

function PromptRow({
  label,
  prompts = [],
  scope = {},
  response = null,
  messageText = "",
  onAction,
  loading = false,
  className = "",
  maxItems = 5,
}) {
  const resolvedPrompts = useMemo(() => {
    const providedPrompts = normalizePromptItems(prompts)
    const fallbackPrompts = response || messageText ? buildFollowUpPrompts({
      response,
      messageText,
      scope,
      limit: maxItems,
    }) : buildFeaturedPrompts(scope)

    return dedupePromptItems(providedPrompts.length ? providedPrompts : fallbackPrompts).slice(0, maxItems)
  }, [prompts, response, messageText, scope, maxItems])

  if (!resolvedPrompts.length) {
    return null
  }

  return (
    <div className={`chatbot-prompt-row ${className}`.trim()}>
      {label ? <div className="chatbot-prompt-row-label">{label}</div> : null}
      <div className="chatbot-prompt-chip-row">
        {resolvedPrompts.map((prompt) => (
          <PromptChip key={`${prompt.label}-${prompt.text}`} prompt={prompt} onAction={onAction} loading={loading} />
        ))}
      </div>
    </div>
  )
}

export function PromptChip({ prompt, onAction, loading = false, className = "" }) {
  const item = normalizePromptItem(prompt)
  if (!item?.label) {
    return null
  }

  const mode = item.mode === "fill" ? "fill" : "send"
  const disabled = loading || item.disabled
  const title = item.hint || (mode === "fill" ? "Populate the composer with this prompt." : "Send this prompt immediately.")

  return (
    <button
      type="button"
      className={`chatbot-prompt-chip chatbot-prompt-chip-${mode} ${className}`.trim()}
      onClick={() => onAction?.(item)}
      disabled={disabled}
      title={title}
      aria-label={`${mode === "fill" ? "Populate" : "Send"} prompt: ${item.label}`}
      data-mode={mode}
    >
      <span className="chatbot-prompt-chip-label">{item.label}</span>
    </button>
  )
}

export function FeaturedPromptRow({
  prompts = [],
  scope = {},
  onAction,
  loading = false,
  label = "Featured starter prompts",
  className = "",
  maxItems = 5,
}) {
  return (
    <PromptRow
      label={label}
      prompts={prompts}
      scope={scope}
      onAction={onAction}
      loading={loading}
      className={`chatbot-featured-prompt-row ${className}`.trim()}
      maxItems={maxItems}
    />
  )
}

export function FollowUpPromptRow({
  prompts = [],
  response = null,
  scope = {},
  messageText = "",
  onAction,
  loading = false,
  label = "Suggested next steps",
  className = "",
  maxItems = 4,
}) {
  return (
    <PromptRow
      label={label}
      prompts={prompts}
      response={response}
      scope={scope}
      messageText={messageText}
      onAction={onAction}
      loading={loading}
      className={`chatbot-follow-up-row ${className}`.trim()}
      maxItems={maxItems}
    />
  )
}

export function BetterPromptHelper({
  title = "Better prompting",
  description = "Best results come from specific questions like Action + Data + Scope + Format.",
  examples = [
    "Show latest sessions for Sebring in short form",
    "Compare Session 1 vs Session 2 and highlight only major changes",
    "Summarize this session in 3 bullets",
  ],
  className = "",
}) {
  const exampleItems = normalizePromptItems(examples).slice(0, 3)

  return (
    <div className={`chatbot-prompt-helper ${className}`.trim()}>
      <div className="chatbot-prompt-helper-eyebrow">Prompt guidance</div>
      <div className="chatbot-prompt-helper-title">{title}</div>
      <p className="chatbot-prompt-helper-description">{description}</p>

      {exampleItems.length ? (
        <div className="chatbot-prompt-helper-examples" aria-label="Prompt examples">
          {exampleItems.map((item) => (
            <div key={item.label} className="chatbot-prompt-helper-example">
              {item.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PromptCategory({
  section,
  onAction,
  loading = false,
  defaultOpen = false,
  className = "",
}) {
  const resolvedSection = section || {}
  const items = useMemo(
    () => dedupePromptItems(resolvedSection.prompts || []),
    [resolvedSection.prompts],
  )
  const [open, setOpen] = useState(defaultOpen)
  const [showAll, setShowAll] = useState(false)

  if (!items.length) {
    return null
  }

  const Icon = getCategoryIcon(resolvedSection.iconKey)
  const visibleItems = open ? items.slice(0, showAll ? items.length : 3) : []
  const canExpand = items.length > 3

  return (
    <section className={`chatbot-prompt-category ${className}`.trim()}>
      <button
        type="button"
        className="chatbot-prompt-category-header"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div className="chatbot-prompt-category-header-main">
          <div className="chatbot-prompt-category-icon" aria-hidden="true">
            <Icon fontSize="small" />
          </div>
          <div className="chatbot-prompt-category-copy">
            <div className="chatbot-prompt-category-title-row">
              <h3 className="chatbot-prompt-category-title">{resolvedSection.title}</h3>
              <span className="chatbot-prompt-category-count">{items.length}</span>
            </div>
            {resolvedSection.description ? (
              <p className="chatbot-prompt-category-description">{resolvedSection.description}</p>
            ) : null}
          </div>
        </div>

        <span className="chatbot-prompt-category-toggle" aria-hidden="true">
          <ExpandMoreOutlinedIcon
            fontSize="small"
            className={`chatbot-prompt-category-toggle-icon ${open ? "chatbot-prompt-category-toggle-icon-open" : ""}`.trim()}
          />
        </span>
      </button>

      {open ? (
        <div className="chatbot-prompt-category-body">
          <div className="chatbot-prompt-chip-row">
            {visibleItems.map((prompt) => (
              <PromptChip
                key={`${resolvedSection.key || resolvedSection.title}-${prompt.label}`}
                prompt={prompt}
                onAction={onAction}
                loading={loading}
              />
            ))}
          </div>

          {canExpand ? (
            <button
              type="button"
              className="chatbot-prompt-category-more"
              onClick={() => setShowAll((current) => !current)}
              disabled={loading}
            >
              {showAll ? "Show less" : "View more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function PromptLibrary({
  scope = {},
  prompts = [],
  sections = PROMPT_LIBRARY_SECTIONS,
  onAction,
  loading = false,
  className = "",
}) {
  return (
    <section className={`chatbot-sidebar-card chatbot-prompt-library ${className}`.trim()}>
      <div className="chatbot-sidebar-card-head chatbot-prompt-library-head">
        <div className="chatbot-sidebar-card-icon" aria-hidden="true">
          <AutoAwesomeOutlinedIcon fontSize="small" />
        </div>
        <div className="chatbot-prompt-library-copy">
          <h2>Routing Library</h2>
          <p>Use supported deterministic lookups or AI-only comparison prompts.</p>
        </div>
      </div>

      <BetterPromptHelper className="chatbot-prompt-library-helper" />

      <FeaturedPromptRow
        label="Supported starter prompts"
        prompts={prompts}
        scope={scope}
        onAction={onAction}
        loading={loading}
        className="chatbot-prompt-library-featured"
      />

      <div className="chatbot-prompt-library-sections">
        {sections.map((section, index) => (
          <PromptCategory
            key={section.key}
            section={section}
            onAction={onAction}
            loading={loading}
            defaultOpen={index === 0}
          />
        ))}
      </div>
    </section>
  )
}
