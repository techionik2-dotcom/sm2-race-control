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
        color: "var(--color-text)",
      }}
    >
      <CircularProgress
        size={42}
        thickness={4}
        sx={{
          color: "#F05323",
        }}
      />
      <Typography
        variant="body1"
        sx={{
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-text)",
        }}
      >
        {label}
      </Typography>
      {sublabel ? (
        <Typography
          variant="body2"
          sx={{
            color: "var(--color-text-light)",
          }}
        >
          {sublabel}
        </Typography>
      ) : null}
    </Box>
  );
}
