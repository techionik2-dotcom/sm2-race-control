export default function EmptyState({
  icon = "SM-2",
  title,
  description,
  actions = null,
  className = "",
  style = {},
}) {
  return (
    <div
      className={className}
      style={{
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
        boxShadow: "var(--shadow-raised)",
        padding: "var(--space-8)",
        textAlign: "center",
        maxWidth: "760px",
        margin: "0 auto",
        ...style,
      }}
    >
      <div
        style={{
          width: "68px",
          height: "68px",
          borderRadius: "var(--radius-lg)",
          margin: "0 auto var(--space-4)",
          display: "grid",
          placeItems: "center",
          background: "rgba(240, 83, 35, 0.14)",
          border: "1px solid rgba(240, 83, 35, 0.2)",
          color: "var(--color-text)",
          fontSize: typeof icon === "string" && icon.length > 4 ? "0.82rem" : "1.2rem",
          fontWeight: 900,
          letterSpacing: "0.04em",
          boxShadow: "var(--shadow-subtle)",
        }}
      >
        {icon}
      </div>

      <h3
        style={{
          margin: 0,
          color: "var(--text-primary)",
          fontSize: "var(--font-size-section-title)",
          fontWeight: 800,
          letterSpacing: 0,
          lineHeight: "var(--line-height-tight)",
        }}
      >
        {title}
      </h3>

      {description ? (
        <p
          style={{
            margin: "var(--space-3) auto 0",
            maxWidth: "52ch",
            color: "var(--text-secondary)",
            lineHeight: "var(--line-height-relaxed)",
            fontSize: "var(--font-size-body)",
          }}
        >
          {description}
        </p>
      ) : null}

      {actions ? (
        <div
          style={{
            marginTop: "var(--space-5)",
            display: "flex",
            gap: "var(--space-3)",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
