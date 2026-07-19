export default function StatusBadge({
  label,
  tone = "neutral",
  className = "",
  style = {},
  title,
}) {
  const palette = {
    neutral: {
      background: "rgba(255, 255, 255, 0.06)",
      border: "rgba(255, 255, 255, 0.08)",
      color: "#d8d8d8",
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

  const colors = palette[tone] || palette.neutral;

  return (
    <span
      title={title || label}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.35rem",
        padding: "0.38rem 0.75rem",
        borderRadius: "999px",
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        fontSize: "0.68rem",
        fontWeight: 800,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        boxShadow: "0 1px 0 rgba(255, 255, 255, 0.03) inset",
        ...style,
      }}
    >
      {label}
    </span>
  );
}
