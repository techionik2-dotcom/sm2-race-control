"use client";

import { useRouter } from "next/navigation";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";

export default function ScreenBackButton({
  fallbackHref = "/",
  label = "Back",
  className = "",
  title,
}) {
  const router = useRouter();

  const handleClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    if (fallbackHref) {
      router.push(fallbackHref);
      return;
    }

    router.back();
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      title={title || label}
      aria-label={title || label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        alignSelf: "flex-start",
        padding: "0.65rem 0.95rem",
        borderRadius: "14px",
        border: "1px solid rgba(255, 149, 0, 0.32)",
        background:
          "linear-gradient(135deg, rgba(255, 149, 0, 0.12), rgba(240, 83, 35, 0.08))",
        color: "#ffb08c",
        boxShadow: "0 10px 24px rgba(0, 0, 0, 0.18)",
        fontSize: "0.72rem",
        fontWeight: 900,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "transform 180ms ease, border-color 180ms ease, background 180ms ease",
        marginBottom: "0.85rem",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = "translateY(-1px)";
        event.currentTarget.style.borderColor = "rgba(255, 149, 0, 0.48)";
        event.currentTarget.style.background =
          "linear-gradient(135deg, rgba(255, 149, 0, 0.18), rgba(240, 83, 35, 0.12))";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
        event.currentTarget.style.borderColor = "rgba(255, 149, 0, 0.32)";
        event.currentTarget.style.background =
          "linear-gradient(135deg, rgba(255, 149, 0, 0.12), rgba(240, 83, 35, 0.08))";
      }}
    >
      <ArrowBackRoundedIcon fontSize="inherit" />
      <span>{label}</span>
    </button>
  );
}
