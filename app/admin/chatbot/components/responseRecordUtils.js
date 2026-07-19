"use client"

export const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

export const createFieldLookup = (fields = []) =>
  fields.reduce((lookup, field) => {
    const label = normalizeText(field?.label).toLowerCase()
    if (!label) {
      return lookup
    }

    lookup[label] = normalizeText(field?.value)
    return lookup
  }, {})

export const getFieldValue = (lookup, ...labels) => {
  for (const label of labels) {
    const value = lookup?.[normalizeText(label).toLowerCase()]
    if (value) {
      return value
    }
  }

  return ""
}

export const compactList = (items = [], limit = items.length) =>
  items
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, limit)

export const summarizeCard = (card, extra = {}) => {
  const fields = Array.isArray(card?.fields) ? card.fields : []
  const lookup = createFieldLookup(fields)
  return {
    title: normalizeText(card?.title),
    subtitle: normalizeText(card?.subtitle),
    badge: normalizeText(card?.badge),
    badgeTone: card?.badge_tone || "neutral",
    iconKey: card?.icon_key || "",
    fields,
    lookup,
    ...extra,
  }
}
