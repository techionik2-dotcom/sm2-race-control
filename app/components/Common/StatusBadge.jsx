export default function StatusBadge({
  label,
  status,
  tone = "neutral",
  className = "",
  style = {},
  title,
  "aria-label": ariaLabel,
}) {
  const normalizeStatus = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

  const statusLabels = {
    active: "Active",
    inactive: "Inactive",
    archived: "Archived",
    draft: "Draft",
    ready: "Ready",
    open: "Open",
    in_progress: "In Progress",
    submitted: "Submitted",
    completed: "Completed",
    action_required: "Action Required",
    warning: "Warning",
    error: "Error",
    failed: "Failed",
  };

  const statusTones = {
    active: "success",
    ready: "success",
    open: "success",
    completed: "success",
    in_progress: "info",
    submitted: "info",
    draft: "neutral",
    inactive: "neutral",
    archived: "danger",
    action_required: "warning",
    warning: "warning",
    error: "danger",
    failed: "danger",
  };

  const statusKey = normalizeStatus(status || label);
  const resolvedLabel = label || statusLabels[statusKey] || String(status || "Status");
  const resolvedTone = status ? statusTones[statusKey] || tone : tone;

  const palette = {
    neutral: {
      background: "rgba(255, 255, 255, 0.06)",
      border: "var(--border-subtle)",
      color: "var(--text-secondary)",
    },
    success: {
      background: "rgba(52, 199, 89, 0.14)",
      border: "rgba(52, 199, 89, 0.32)",
      color: "#8df0a8",
    },
    warning: {
      background: "rgba(255, 149, 0, 0.14)",
      border: "rgba(255, 149, 0, 0.32)",
      color: "#ffd08a",
    },
    danger: {
      background: "rgba(255, 59, 48, 0.14)",
      border: "rgba(255, 59, 48, 0.32)",
      color: "#ffb1ad",
    },
    info: {
      background: "rgba(0, 122, 255, 0.14)",
      border: "rgba(0, 122, 255, 0.32)",
      color: "#9fd0ff",
    },
    accent: {
      background: "rgba(240, 83, 35, 0.16)",
      border: "rgba(240, 83, 35, 0.35)",
      color: "#ffb08c",
    },
  };

  const colors = palette[resolvedTone] || palette.neutral;

  return (
    <span
      title={title || resolvedLabel}
      aria-label={ariaLabel || title || resolvedLabel}
      className={className}
      data-tone={resolvedTone}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.35rem",
        minHeight: "1.65rem",
        padding: "0.35rem 0.72rem",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        fontSize: "var(--font-size-caption)",
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        lineHeight: 1,
        boxShadow: "0 1px 0 rgba(255, 255, 255, 0.03) inset",
        ...style,
      }}
    >
      {resolvedLabel}
    </span>
  );
}
