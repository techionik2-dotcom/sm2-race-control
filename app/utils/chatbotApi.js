import axiosInstance from "./axiosInstance"

const HTML_ERROR_MARKERS = [
  "<!DOCTYPE html",
  "<html",
  "This page could not be found",
  "__next_f",
]

const isHtmlLikeError = (value) => {
  if (typeof value !== "string") {
    return false
  }

  const trimmed = value.trim()
  return HTML_ERROR_MARKERS.some((marker) =>
    trimmed.toLowerCase().includes(marker.toLowerCase()),
  )
}

const getErrorDetail = (error) =>
  error?.response?.data?.detail ||
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.data?.detail ||
  error?.data?.message ||
  error?.data?.error ||
  error?.message ||
  error?.error ||
  ""

const formatValidationDetail = (detail) => {
  if (!detail) {
    return ""
  }

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") {
          return item.trim()
        }

        const loc = Array.isArray(item?.loc) ? item.loc.filter(Boolean).join(".") : ""
        const message = item?.msg || item?.message || item?.detail || ""
        const cleanedMessage = String(message || "").trim()

        if (loc && cleanedMessage) {
          return `${loc}: ${cleanedMessage}`
        }

        return loc || cleanedMessage
      })
      .filter(Boolean)

    return parts.join(" • ")
  }

  if (typeof detail === "object") {
    return String(detail?.msg || detail?.message || detail?.detail || "").trim()
  }

  return String(detail).trim()
}

const buildApiError = (error, fallbackMessage) => {
  const status = error?.response?.status ?? error?.status ?? null
  const rawDetail = getErrorDetail(error)
  const detail = formatValidationDetail(rawDetail)
  const message =
    typeof detail === "string" && detail.trim() && !isHtmlLikeError(detail)
      ? detail.trim()
      : fallbackMessage

  return {
    success: false,
    status,
    message,
    error: message,
    data: error?.response?.data ?? error?.data ?? null,
  }
}

export const getChatbotContext = async () => {
  try {
    const response = await axiosInstance.get("/admin/chatbot/context")
    return {
      success: true,
      context: response.data,
    }
  } catch (error) {
    throw buildApiError(error, "Failed to load AI Race Assistant context")
  }
}

export const sendChatbotQuery = async (payload) => {
  try {
    const response = await axiosInstance.post("/admin/chatbot/query", payload)
    return {
      success: true,
      response: response.data,
    }
  } catch (error) {
    throw buildApiError(error, "Failed to query the AI Race Assistant")
  }
}
