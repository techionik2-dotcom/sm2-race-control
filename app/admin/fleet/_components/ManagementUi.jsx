"use client";

import { useEffect, useRef } from "react";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";

export function MetricCard({ icon: Icon, label, value, helper, tone = "accent" }) {
  return (
    <article className={`fleet-metric-card fleet-metric-${tone}`}>
      <div className="fleet-metric-icon" aria-hidden="true">
        {Icon ? <Icon fontSize="small" /> : null}
      </div>
      <div className="fleet-metric-copy">
        <div className="fleet-metric-value">{value}</div>
        <div className="fleet-metric-label">{label}</div>
        {helper ? <div className="fleet-metric-helper">{helper}</div> : null}
      </div>
    </article>
  );
}

export function ActionIconButton({
  icon: Icon,
  label,
  title,
  tone = "neutral",
  onClick,
  disabled = false,
  type = "button",
}) {
  const accessibleLabel = title || label;

  return (
    <button
      type={type}
      className={`fleet-action-icon-button fleet-action-${tone}`}
      onClick={onClick}
      disabled={disabled}
      title={accessibleLabel}
      aria-label={accessibleLabel}
    >
      {Icon ? <Icon fontSize="small" /> : null}
    </button>
  );
}

export function DrawerShell({
  open,
  title,
  subtitle,
  meta = null,
  onClose,
  children,
  footer = null,
  wide = false,
}) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const raf = window.requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fleet-drawer-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section
        className={`fleet-drawer-panel ${wide ? "fleet-drawer-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fleet-drawer-title"
      >
        <div className="fleet-drawer-shell">
          <header className="fleet-drawer-header">
            <div className="fleet-drawer-heading">
            <p className="fleet-drawer-eyebrow">Owner Workspace</p>
              <h2 id="fleet-drawer-title" className="fleet-drawer-title">
                {title}
              </h2>
              {subtitle ? <p className="fleet-drawer-subtitle">{subtitle}</p> : null}
              {meta ? <div className="fleet-drawer-meta">{meta}</div> : null}
            </div>
            <button
              type="button"
              className="fleet-drawer-close"
              onClick={onClose}
              aria-label="Close panel"
            >
              <CloseOutlinedIcon fontSize="small" />
            </button>
          </header>

          <div className="fleet-drawer-body" ref={bodyRef}>
            {children}
          </div>

          {footer ? <footer className="fleet-drawer-footer">{footer}</footer> : null}
        </div>
      </section>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  busy = false,
  tone = "danger",
  icon: Icon = WarningAmberOutlinedIcon,
  confirmTitle = "",
}) {
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onCancel?.();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fleet-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel?.();
        }
      }}
    >
      <section
        className={`fleet-confirm-dialog fleet-confirm-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fleet-confirm-title"
      >
        <div className="fleet-confirm-icon" aria-hidden="true">
          {Icon ? <Icon fontSize="inherit" /> : null}
        </div>

        <h3 id="fleet-confirm-title" className="fleet-confirm-title">
          {title}
        </h3>
        <p className="fleet-confirm-message">{message}</p>

        <div className="fleet-confirm-actions">
          <button
            type="button"
            className="fleet-btn fleet-btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`fleet-btn ${tone === "danger" ? "fleet-btn-danger" : "fleet-btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
            title={confirmTitle || confirmLabel}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function EmptyStatePanel({ icon: Icon, title, description, action = null }) {
  return (
    <div className="fleet-empty-state">
      <div className="fleet-empty-state-icon" aria-hidden="true">
        {Icon ? <Icon fontSize="inherit" /> : null}
      </div>
      <h3 className="fleet-empty-state-title">{title}</h3>
      <p className="fleet-empty-state-description">{description}</p>
      {action ? <div className="fleet-empty-state-actions">{action}</div> : null}
    </div>
  );
}
