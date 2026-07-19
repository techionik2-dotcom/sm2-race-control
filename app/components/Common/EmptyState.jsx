export default function EmptyState({
  icon = "🏁",
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
        borderRadius: "22px",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background:
          "linear-gradient(135deg, rgba(26, 26, 26, 0.96) 0%, rgba(16, 16, 16, 0.96) 100%)",
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.26)",
        padding: "2rem",
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
          borderRadius: "20px",
          margin: "0 auto 1rem",
          display: "grid",
          placeItems: "center",
          background: "rgba(240, 83, 35, 0.14)",
          border: "1px solid rgba(240, 83, 35, 0.2)",
          fontSize: "1.9rem",
          boxShadow: "0 10px 20px rgba(0, 0, 0, 0.22)",
        }}
      >
        {icon}
      </div>

      <h3
        style={{
          margin: 0,
          color: "#fff",
          fontSize: "1.2rem",
          fontWeight: 800,
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </h3>

      {description ? (
        <p
          style={{
            margin: "0.65rem auto 0",
            maxWidth: "52ch",
            color: "#a9a9a9",
            lineHeight: 1.6,
            fontSize: "0.95rem",
          }}
        >
          {description}
        </p>
      ) : null}

      {actions ? (
        <div
          style={{
            marginTop: "1.25rem",
            display: "flex",
            gap: "0.75rem",
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
