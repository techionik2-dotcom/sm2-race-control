"use client"

export default function AssistantLightReply({ summary }) {
  if (!summary) {
    return null
  }

  return (
    <div className="chatbot-light-reply">
      <p>{summary}</p>
    </div>
  )
}
