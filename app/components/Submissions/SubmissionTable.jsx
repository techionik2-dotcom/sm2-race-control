"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import KeyboardArrowLeftRoundedIcon from "@mui/icons-material/KeyboardArrowLeftRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import SignalCellularAltRoundedIcon from "@mui/icons-material/SignalCellularAltRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import ArchiveRoundedIcon from "@mui/icons-material/ArchiveRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const normalizeStatus = (value) =>
  String(value || "PENDING")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

const firstText = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const getSubmissionNote = (submission) =>
  firstText(
    submission?.raw_text,
    submission?.rawText,
    submission?.payload?.raw_text,
    submission?.payload?.rawText,
    submission?.payload?.notes,
    submission?.data?.notes,
    submission?.analysis_result?.summary,
    submission?.analysis_result?.note,
    submission?.analysis_result?.message,
    "Submission received",
  );

const getTrackLabel = (submission) =>
  firstText(
    submission?.payload?.track,
    submission?.payload?.track_name,
    submission?.data?.track,
    submission?.data?.track_name,
    submission?.analysis_result?.image_analysis?.metadata?.track_text,
    submission?.analysisResult?.image_analysis?.metadata?.track_text,
    submission?.payload?.ocr_review?.metadata?.track_text,
    submission?.event?.track,
    submission?.event?.trackName,
    submission?.event?.track_name,
    "-",
  );

const getRunGroupLabel = (submission) =>
  firstText(
    submission?.runGroup,
    submission?.run_group?.normalized,
    submission?.run_group?.rawText,
    submission?.run_group?.raw_text,
    submission?.analysis_result?.run_group,
    "Not Configured",
  );

const getTimelineLabel = (submission) => {
  const status = normalizeStatus(submission?.status);
  if (status.includes("ARCHIVED")) return "Submission archived";
  if (status.includes("FAILED")) return "Validation failed";
  if (status.includes("VALIDATED") || status.includes("SENT") || status.includes("SYNCED")) {
    return "Submission received";
  }
  return "Submission received";
};

const getStatusMeta = (submission) => {
  const status = normalizeStatus(submission?.status);

  if (status.includes("FAILED")) {
    return {
      label: status.replace(/_/g, " "),
      sx: {
        color: "#ffd6d6",
        backgroundColor: "rgba(128, 20, 20, 0.88)",
        border: "1px solid rgba(255, 120, 120, 0.55)",
      },
      icon: ErrorOutlineRoundedIcon,
    };
  }

  if (status.includes("ARCHIVED")) {
    return {
      label: status.replace(/_/g, " "),
      sx: {
        color: "#d3d7df",
        backgroundColor: "rgba(58, 58, 58, 0.92)",
        border: "1px solid rgba(180, 180, 180, 0.34)",
      },
      icon: ArchiveRoundedIcon,
    };
  }

  if (status.includes("SENT") || status.includes("SYNCED") || status.includes("VALIDATED")) {
    return {
      label: status.replace(/_/g, " "),
      sx: {
        color: "#ffffff",
        background: "linear-gradient(180deg, rgba(56, 132, 67, 0.98) 0%, rgba(38, 105, 52, 0.98) 100%)",
        border: "1px solid rgba(104, 217, 130, 0.42)",
      },
      icon: CheckCircleRoundedIcon,
    };
  }

  if (status.includes("PENDING") || status.includes("REVIEW")) {
    return {
      label: status.replace(/_/g, " "),
      sx: {
        color: "#ffcf93",
        backgroundColor: "rgba(69, 44, 10, 0.92)",
        border: "1px solid rgba(255, 176, 78, 0.52)",
      },
      icon: WarningAmberRoundedIcon,
    };
  }

  return {
    label: status.replace(/_/g, " "),
    sx: {
      color: "#ffffff",
      backgroundColor: "rgba(69, 44, 10, 0.92)",
      border: "1px solid rgba(255, 176, 78, 0.52)",
    },
    icon: SignalCellularAltRoundedIcon,
  };
};

const getRunGroupChipSx = (value) => ({
  height: 28,
  borderRadius: 999,
  fontWeight: 900,
  fontSize: "0.78rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: value === "Not Configured" ? "#ffd6aa" : "#ffb77b",
  backgroundColor: "rgba(58, 31, 10, 0.9)",
  border: "1px solid rgba(255, 156, 73, 0.58)",
});

const getViewButtonSx = {
  height: 38,
  minWidth: 108,
  borderRadius: 2.5,
  borderColor: "rgba(255, 151, 82, 0.7)",
  color: "#ffffff",
  backgroundColor: "rgba(51, 27, 11, 0.92)",
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  "&:hover": {
    borderColor: "rgba(255, 176, 108, 0.95)",
    backgroundColor: "rgba(86, 43, 14, 0.95)",
  },
};

const headerCellSx = {
  py: 2.1,
  px: 2.5,
  backgroundColor: "#fafafa",
  color: "#c1c6d1",
  borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
  fontSize: "0.72rem",
  fontWeight: 900,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
};

const bodyCellSx = {
  py: 2.1,
  px: 2.5,
  backgroundColor: "#070707",
  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  verticalAlign: "middle",
};

export default function SubmissionTable({ submissions = [], loading, onView }) {
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [submissions.length, rowsPerPage]);

  const rows = useMemo(
    () =>
      submissions.map((submission, index) => ({
        ...submission,
        __rowId: submission?.id || submission?.submissionId || index,
        __dateLabel: formatDateTime(submission?.createdAt || submission?.created_at),
        __timelineLabel: getTimelineLabel(submission),
        __note: getSubmissionNote(submission),
        __track: getTrackLabel(submission),
        __runGroup: getRunGroupLabel(submission),
        __statusMeta: getStatusMeta(submission),
      })),
    [submissions],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(
    safePage * rowsPerPage,
    safePage * rowsPerPage + rowsPerPage,
  );

  const isEmpty = rows.length === 0;
  const isRefreshing = loading && rows.length > 0;

  return (
    <Paper
      elevation={0}
      className="submissions-table-panel submissions-feed-panel"
      sx={{
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(180deg, rgba(12, 12, 12, 0.98), rgba(5, 5, 5, 0.98))",
      }}
    >
      <Box
        sx={{
          borderRadius: "18px",
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          backgroundColor: "#060606",
        }}
      >
        <Box sx={{ overflowX: "auto" }}>
          <Table
            size="small"
            sx={{
              minWidth: 1100,
              tableLayout: "fixed",
              "& .MuiTableCell-root": {
                borderBottom: "none",
              },
            }}
          >
            <TableHead>
              <TableRow>
                {["Date", "Submission Note", "Run Group", "Status", "View"].map(
                  (label, index) => (
                    <TableCell
                      key={label}
                      sx={{
                        ...headerCellSx,
                        width:
                          index === 0
                            ? "22%"
                            : index === 1
                              ? "40%"
                              : index === 2
                                ? "14%"
                                : index === 3
                                  ? "14%"
                                  : "10%",
                        "&:first-of-type": {
                          borderTopLeftRadius: "18px",
                        },
                        "&:last-of-type": {
                          borderTopRightRadius: "18px",
                        },
                      }}
                      align={index >= 2 ? "center" : "left"}
                    >
                      {label}
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>

            <TableBody>
              {isEmpty ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ p: 0, backgroundColor: "#070707" }}>
                    <Box
                      sx={{
                        minHeight: 260,
                        display: "grid",
                        placeItems: "center",
                        textAlign: "center",
                        px: 3,
                        py: 5,
                      }}
                    >
                      <Stack spacing={1.5} alignItems="center">
                        <Box
                          sx={{
                            width: 62,
                            height: 62,
                            borderRadius: "18px",
                            display: "grid",
                            placeItems: "center",
                            color: "#ffb27a",
                            backgroundColor: "rgba(255, 152, 70, 0.12)",
                            border: "1px solid rgba(255, 152, 70, 0.2)",
                          }}
                        >
                          <SignalCellularAltRoundedIcon sx={{ fontSize: 30 }} />
                        </Box>
                        <Stack spacing={0.5}>
                          <Typography
                            sx={{
                              color: "#ffffff",
                              fontWeight: 900,
                              fontSize: "1.05rem",
                              letterSpacing: "0.01em",
                            }}
                          >
                            No submissions yet
                          </Typography>
                          <Typography
                            sx={{
                              color: "rgba(241, 241, 241, 0.72)",
                              fontSize: "0.92rem",
                              lineHeight: 1.6,
                              maxWidth: 420,
                            }}
                          >
                            Once a driver submits notes for this event, the feed will
                            appear here in the same row format you see in the reference
                            screenshot.
                          </Typography>
                        </Stack>
                      </Stack>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => {
                  const { label: statusLabel, sx: statusChipSx, icon: StatusIcon } =
                    row.__statusMeta;

                  return (
                    <TableRow
                      key={row.__rowId}
                      hover
                      sx={{
                        "&:last-of-type td": {
                          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                        },
                        "&:hover td": {
                          backgroundColor: "#0e0e0e",
                        },
                      }}
                    >
                      <TableCell sx={bodyCellSx} align="left">
                        <Stack spacing={0.2}>
                          <Typography
                            sx={{
                              color: "#f5f6fa",
                              fontSize: "0.94rem",
                              fontWeight: 800,
                              lineHeight: 1.25,
                            }}
                          >
                            {row.__dateLabel}
                          </Typography>
                          <Typography
                            sx={{
                              color: "#ff9e73",
                              fontSize: "0.68rem",
                              fontWeight: 900,
                              letterSpacing: "0.12em",
                              textTransform: "uppercase",
                              lineHeight: 1.2,
                            }}
                          >
                            {row.__timelineLabel}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell sx={bodyCellSx} align="left">
                        <Stack spacing={0.28}>
                          <Typography
                            title={row.__note}
                            sx={{
                              color: "#f7f7f7",
                              fontSize: "0.96rem",
                              fontWeight: 800,
                              lineHeight: 1.25,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.__note}
                          </Typography>
                          <Typography
                            title={row.__track}
                            sx={{
                              color: "#ff9a66",
                              fontSize: "0.72rem",
                              fontWeight: 900,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              lineHeight: 1.2,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            TRACK: {row.__track}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell sx={bodyCellSx} align="center">
                        <Chip
                          label={row.__runGroup}
                          size="small"
                          sx={getRunGroupChipSx(row.__runGroup)}
                        />
                      </TableCell>

                      <TableCell sx={bodyCellSx} align="center">
                        <Chip
                          label={statusLabel}
                          size="small"
                          icon={<StatusIcon sx={{ fontSize: 14, color: "inherit !important" }} />}
                          sx={{
                            ...statusChipSx,
                            height: 28,
                            px: 0.35,
                            borderRadius: 999,
                            fontWeight: 900,
                            fontSize: "0.72rem",
                            letterSpacing: "0.09em",
                            textTransform: "uppercase",
                            "& .MuiChip-icon": {
                              marginLeft: 0.7,
                              marginRight: -0.25,
                            },
                          }}
                        />
                      </TableCell>

                      <TableCell sx={bodyCellSx} align="center">
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<VisibilityRoundedIcon sx={{ fontSize: 18 }} />}
                          onClick={() => onView?.(row.id || row._id || row.__rowId)}
                          sx={getViewButtonSx}
                        >
                          VIEW
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 1.5,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.75,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            background:
              "linear-gradient(180deg, rgba(10, 10, 10, 0.98), rgba(6, 6, 6, 0.98))",
          }}
        >
          <Typography
            sx={{
              color: "rgba(255, 255, 255, 0.76)",
              fontSize: "0.9rem",
              whiteSpace: "nowrap",
            }}
          >
            Rows per page:
          </Typography>

          <Select
            value={rowsPerPage}
            onChange={(event) => setRowsPerPage(Number(event.target.value))}
            variant="standard"
            disableUnderline
            MenuProps={{
              PaperProps: {
                sx: {
                  backgroundColor: "#101010",
                  color: "#ffffff",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  boxShadow: "0 16px 32px rgba(0, 0, 0, 0.4)",
                  "& .MuiMenuItem-root": {
                    color: "#ffffff",
                  },
                },
              },
            }}
            sx={{
              minWidth: 72,
              color: "#ffffff",
              fontWeight: 800,
              fontSize: "0.9rem",
              "& .MuiSelect-icon": {
                color: "rgba(255, 255, 255, 0.78)",
              },
            }}
          >
            {ROWS_PER_PAGE_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>

          <Typography
            sx={{
              color: "#ffffff",
              fontSize: "0.9rem",
              whiteSpace: "nowrap",
              ml: 0.75,
            }}
          >
            {rows.length === 0
              ? "0-0 of 0"
              : `${safePage * rowsPerPage + 1}-${Math.min(
                  (safePage + 1) * rowsPerPage,
                  rows.length,
                )} of ${rows.length}`}
          </Typography>

          <IconButton
            size="small"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(current - 1, 0))}
            sx={{
              color: safePage === 0 ? "rgba(255,255,255,0.25)" : "#ffffff",
              backgroundColor: "transparent",
              "&:hover": { backgroundColor: "rgba(255,255,255,0.05)" },
            }}
          >
            <KeyboardArrowLeftRoundedIcon />
          </IconButton>

          <IconButton
            size="small"
            disabled={safePage >= pageCount - 1}
            onClick={() =>
              setPage((current) => Math.min(current + 1, pageCount - 1))
            }
            sx={{
              color:
                safePage >= pageCount - 1
                  ? "rgba(255,255,255,0.25)"
                  : "#ffffff",
              backgroundColor: "transparent",
              "&:hover": { backgroundColor: "rgba(255,255,255,0.05)" },
            }}
          >
            <KeyboardArrowRightRoundedIcon />
          </IconButton>
        </Box>
      </Box>

      {isRefreshing ? (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            backgroundColor: "rgba(5, 5, 5, 0.42)",
            backdropFilter: "blur(2px)",
            zIndex: 2,
          }}
        >
          <Stack spacing={1.2} alignItems="center">
            <CircularProgress size={28} sx={{ color: "#ff9a66" }} />
            <Typography
              sx={{
                color: "#ffffff",
                fontSize: "0.9rem",
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              Refreshing submissions...
            </Typography>
          </Stack>
        </Box>
      ) : null}
    </Paper>
  );
}
