"use client"

/* eslint-disable @next/next/no-img-element */

const ASSISTANT_ICON_SRC = "/icons/sm-ai-assistant-icon.png"

export default function AssistantIcon({
  className = "",
  decorative = false,
  alt = "SM Racing AI Assistant",
}) {
  return (
    <img
      src={ASSISTANT_ICON_SRC}
      alt={decorative ? "" : alt}
      aria-hidden={decorative ? "true" : undefined}
      className={className}
      loading="eager"
      decoding="async"
    />
  )
}
