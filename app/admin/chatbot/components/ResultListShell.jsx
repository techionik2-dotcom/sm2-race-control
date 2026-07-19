"use client"

import { Fragment, useEffect, useMemo, useState } from "react"

export default function ResultListShell({
  items = [],
  getItemKey,
  listTitle,
  listSubtitle,
  detailTitle = "Details",
  detailSubtitle = "Review the selected record first, then expand into the supporting details below.",
  emptyTitle = "No records",
  emptyMessage = "No result rows were available for this response.",
  renderRow,
  renderDetail,
  className = "",
}) {
  const keyedItems = useMemo(
    () =>
      items.map((item, index) => ({
        item,
        key: getItemKey ? getItemKey(item, index) : `${index}`,
      })),
    [getItemKey, items],
  )

  const [selectedKey, setSelectedKey] = useState(keyedItems[0]?.key || "")

  useEffect(() => {
    if (!keyedItems.length) {
      setSelectedKey("")
      return
    }

    if (!keyedItems.some((entry) => entry.key === selectedKey)) {
      setSelectedKey(keyedItems[0].key)
    }
  }, [keyedItems, selectedKey])

  const selectedEntry =
    keyedItems.find((entry) => entry.key === selectedKey) || keyedItems[0] || null

  if (!keyedItems.length) {
    return (
      <section className={`chatbot-result-shell chatbot-result-shell-empty ${className}`.trim()}>
        <div className="chatbot-result-empty">
          <h3>{emptyTitle}</h3>
          <p>{emptyMessage}</p>
        </div>
      </section>
    )
  }

  return (
    <section className={`chatbot-result-shell ${className}`.trim()}>
      <div className="chatbot-result-shell-list">
        <header className="chatbot-result-shell-header">
          <div>
            <h3>{listTitle}</h3>
            {listSubtitle ? <p>{listSubtitle}</p> : null}
          </div>
        </header>

        <div className="chatbot-result-shell-scroll">
          {keyedItems.map((entry, index) => (
            <Fragment key={entry.key}>
              {renderRow?.({
                item: entry.item,
                key: entry.key,
                index,
                selected: entry.key === selectedEntry?.key,
                onSelect: () => setSelectedKey(entry.key),
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="chatbot-result-shell-detail">
        <header className="chatbot-result-shell-header">
          <div>
            <h3>{detailTitle}</h3>
            {detailSubtitle ? <p>{detailSubtitle}</p> : null}
          </div>
        </header>

        <div className="chatbot-result-shell-detail-body">
          {selectedEntry ? renderDetail?.(selectedEntry.item) : null}
        </div>
      </div>
    </section>
  )
}
