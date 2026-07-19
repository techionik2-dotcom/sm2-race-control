import { Box, CircularProgress, Typography } from "@mui/material";

export default function Loader({
  label = "Loading...",
  fullHeight = false,
  sublabel = "",
}) {
  return (
    <Box
      sx={{
        minHeight: fullHeight ? "60vh" : "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 1.5,
        py: fullHeight ? 6 : 3,
        color: "var(--text-primary)",
      }}
    >
      <CircularProgress
        size={42}
        thickness={4}
        sx={{
          color: "var(--brand-primary)",
        }}
      />
      <Typography
        variant="body1"
        sx={{
          fontWeight: 700,
          letterSpacing: 0,
          color: "var(--text-primary)",
          fontSize: "var(--font-size-body)",
          lineHeight: "var(--line-height-tight)",
        }}
      >
        {label}
      </Typography>
      {sublabel ? (
        <Typography
          variant="body2"
          sx={{
            color: "var(--text-secondary)",
            fontSize: "var(--font-size-body-sm)",
            lineHeight: "var(--line-height-base)",
          }}
        >
          {sublabel}
        </Typography>
      ) : null}
    </Box>
  );
}
