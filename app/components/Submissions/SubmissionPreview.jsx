"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Paper,
  Grid,
  Stack,
  Modal,
  IconButton,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import CloseIcon from "@mui/icons-material/Close";
import SettingsIcon from "@mui/icons-material/Settings";
import CarIcon from "@mui/icons-material/DirectionsCar";
import PressureIcon from "@mui/icons-material/Compress";
import AlignmentIcon from "@mui/icons-material/Straighten";
import RawTextIcon from "@mui/icons-material/Description";
import TimerIcon from "@mui/icons-material/AccessTime";
import ImageElementIcon from "@mui/icons-material/Image";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import InventoryIcon from "@mui/icons-material/Inventory";

const normalizePreviewText = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  return ["null", "undefined", "nan"].includes(text.toLowerCase()) ? "" : text;
};

const firstPreviewValue = (...values) => {
  for (const value of values) {
    const normalizedValue = normalizePreviewText(value);
    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return "";
};

const formatPairValue = (leftValue, rightValue) => {
  const leftText = normalizePreviewText(leftValue);
  const rightText = normalizePreviewText(rightValue);

  if (!leftText && !rightText) {
    return "-";
  }

  return `${leftText || "-"} / ${rightText || "-"}`;
};

const formatTripleValue = (firstValue, secondValue, thirdValue) => {
  const values = [
    normalizePreviewText(firstValue),
    normalizePreviewText(secondValue),
    normalizePreviewText(thirdValue),
  ];

  if (!values.some(Boolean)) {
    return "-";
  }

  return values.map((value) => value || "-").join("/");
};

const formatValueWithUnit = (value, unit) => {
  const normalizedValue = normalizePreviewText(value);
  return normalizedValue ? `${normalizedValue} ${unit}` : "-";
};

const formatPercentValue = (value) => {
  const normalizedValue = normalizePreviewText(value);
  if (!normalizedValue) {
    return "-";
  }

  return normalizedValue.includes("%") ? normalizedValue : `${normalizedValue}%`;
};

const formatSessionNumber = (value) => {
  const normalizedValue = normalizePreviewText(value);
  return normalizedValue ? `Run #${normalizedValue}` : "-";
};

const formatTimestamp = (dateValue, timeValue) => {
  const dateText = normalizePreviewText(dateValue);
  const timeText = normalizePreviewText(timeValue);
  return [dateText, timeText].filter(Boolean).join(" ") || "-";
};

const joinPreviewText = (...values) =>
  values.map((value) => normalizePreviewText(value)).filter(Boolean).join(" ");

const formatIdentityValue = (primaryValue, secondaryValue) => {
  const primaryText = normalizePreviewText(primaryValue);
  const secondaryText = normalizePreviewText(secondaryValue);

  if (primaryText && secondaryText && primaryText !== secondaryText) {
    return `${primaryText} (${secondaryText})`;
  }

  return primaryText || secondaryText || "";
};

const formatSuspensionCorners = (suspension = {}, baseKey) => {
  const values = [
    suspension?.[`${baseKey}_fl`] ?? suspension?.[`${baseKey}_f`] ?? null,
    suspension?.[`${baseKey}_fr`] ?? suspension?.[`${baseKey}_f`] ?? null,
    suspension?.[`${baseKey}_rl`] ?? suspension?.[`${baseKey}_r`] ?? null,
    suspension?.[`${baseKey}_rr`] ?? suspension?.[`${baseKey}_r`] ?? null,
  ];

  if (!values.some((value) => normalizePreviewText(value))) {
    return "-";
  }

  return values.map((value) => normalizePreviewText(value) || "-").join(" / ");
};

const DataRow = ({ label, value, isMobile }) => (
  <TableRow
    sx={{
      "&:last-child td, &:last-child th": { border: 0 },
      "&:hover": { bgcolor: "rgba(0,0,0,0.01)" },
    }}
  >
    <TableCell
      component="th"
      scope="row"
      sx={{
        fontWeight: 600,
        color: "#666",
        width: "50%",
        fontSize: { xs: "0.7rem", sm: "0.75rem" },
        py: 0.7,
        textAlign: isMobile ? "center" : "left",
      }}
    >
      {label}
    </TableCell>
    <TableCell
      align={isMobile ? "center" : "right"}
      sx={{
        fontWeight: 700,
        fontSize: { xs: "0.7rem", sm: "0.75rem" },
        color: "#111",
        textAlign: isMobile ? "center" : "right",
      }}
    >
      {value === null || value === undefined || value === "" ? "-" : value}
    </TableCell>
  </TableRow>
);

const SectionHeader = ({ icon: Icon, title, isMobile }) => (
  <Box
    sx={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      alignItems: "center",
      justifyContent: isMobile ? "center" : "flex-start",
      gap: 1,
      px: 2,
      py: 1,
      bgcolor: "#f8f9fa",
      borderBottom: "2px solid #F05323",
    }}
  >
    {Icon ? <Icon sx={{ color: "#F05323", fontSize: { xs: 20, sm: 18 } }} /> : null}
    <Typography
      variant="caption"
      fontWeight={800}
      sx={{
        letterSpacing: 0.5,
        color: "#333",
        textTransform: "uppercase",
        fontSize: { xs: "0.7rem", sm: "0.7rem" },
        textAlign: "center",
      }}
    >
      {title}
    </Typography>
  </Box>
);

export default function SubmissionPreview({ data, previewId }) {
  const [openImage, setOpenImage] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  if (!data) return null;

  const { submissionId, eventId, runGroup, raw_text, data: session } = data;
  const ocrReview = data?.payload?.ocr_review || {};
  const analysisImage = data?.analysis_result?.image_analysis || data?.analysisResult?.image_analysis || {};
  const analysisMetadata = analysisImage?.metadata || {};
  const ocrMetadata = ocrReview?.metadata || {};
  const extendedSheetFields =
    session?.extended_setup?.sheet_fields ||
    session?.extended_setup?.sheetFields ||
    analysisImage?.setup?.sheet_fields ||
    analysisImage?.setup?.sheetFields ||
    {};
  const previewImage =
    firstPreviewValue(
      data?.image,
      data?.image_url,
      data?.payload?.image_url,
      data?.payload?.imageUrl,
      Array.isArray(data?.payload?.image_urls) ? data.payload.image_urls[0] : null,
      Array.isArray(data?.payload?.imageUrls) ? data.payload.imageUrls[0] : null,
    ) || null;
  const driverNameDisplay = firstPreviewValue(
    data?.driver?.driverName,
    data?.driver?.driver_name,
    data?.driver?.fullName,
    joinPreviewText(
      data?.driver?.firstName ?? data?.driver?.first_name,
      data?.driver?.lastName ?? data?.driver?.last_name,
    ),
    session?.driver_name,
    session?.driverName,
  );
  const driverCodeDisplay = firstPreviewValue(
    session?.driver_id,
    data?.driver?.driverCode,
    data?.driver?.driver_id,
    data?.driver?.driverId,
    analysisMetadata?.driver_text,
    ocrMetadata?.driver_text,
  );
  const driverDisplay =
    formatIdentityValue(driverNameDisplay, driverCodeDisplay) ||
    firstPreviewValue(analysisMetadata?.driver_text, ocrMetadata?.driver_text);
  const vehicleNameDisplay = firstPreviewValue(
    joinPreviewText(data?.vehicle?.make, data?.vehicle?.model),
    data?.vehicle?.registrationNumber,
    data?.vehicle?.registration_number,
    session?.vehicle_name,
    session?.vehicleName,
  );
  const vehicleCodeDisplay = firstPreviewValue(
    session?.vehicle_id,
    data?.vehicle?.vehicleCode,
    data?.vehicle?.vehicle_id,
    data?.vehicle?.vehicleId,
    analysisMetadata?.vehicle_text,
    ocrMetadata?.vehicle_text,
  );
  const vehicleDisplay = formatIdentityValue(vehicleNameDisplay, vehicleCodeDisplay);
  const trackDisplay = firstPreviewValue(
    session?.track,
    analysisMetadata?.track_text,
    ocrMetadata?.track_text,
    data?.event?.track,
    data?.event?.trackName,
    data?.event?.track_name,
  );
  const timestampDisplay = formatTimestamp(session?.date, session?.time);
  const sessionTypeDisplay = firstPreviewValue(session?.session_type);
  const sessionNumberDisplay = formatSessionNumber(session?.session_number);
  const durationDisplay = formatValueWithUnit(session?.duration_min, "min");
  const pressureTitleUnit = firstPreviewValue(session?.pressures?.unit);
  const pressureTitle = pressureTitleUnit ? `Pressure (${pressureTitleUnit})` : "Pressure";
  const frontPressureDisplay = formatPairValue(session?.pressures?.cold?.fl, session?.pressures?.cold?.fr);
  const rearPressureDisplay = formatPairValue(session?.pressures?.cold?.rl, session?.pressures?.cold?.rr);
  const swayBarDisplay = formatPairValue(session?.suspension?.sway_bar_f, session?.suspension?.sway_bar_r);
  const wingAngleDisplay = formatValueWithUnit(session?.suspension?.wing_angle_deg, "deg");
  const tireTempFrontLeftDisplay = formatTripleValue(
    session?.tire_temperatures?.fl_out,
    session?.tire_temperatures?.fl_mid,
    session?.tire_temperatures?.fl_in,
  );
  const tireTempFrontRightDisplay = formatTripleValue(
    session?.tire_temperatures?.fr_out,
    session?.tire_temperatures?.fr_mid,
    session?.tire_temperatures?.fr_in,
  );
  const camberFrontDisplay = formatPairValue(session?.alignment?.camber_fl, session?.alignment?.camber_fr);
  const camberRearDisplay = formatPairValue(session?.alignment?.camber_rl, session?.alignment?.camber_rr);
  const crossWeightDisplay = formatPercentValue(
    firstPreviewValue(
      session?.alignment?.cross_weight_pct,
      session?.alignment?.cross_weight_percent,
      extendedSheetFields?.cross_weight_percent,
    ),
  );
  const rakeDisplay = formatValueWithUnit(session?.alignment?.rake_mm, "mm");
  const rawTextDisplay = firstPreviewValue(
    raw_text,
    analysisImage?.summary,
    data?.analysis_result?.summary,
    data?.analysisResult?.summary,
  );

  return (
    <Box
      id={previewId}
      sx={{
        width: "100%",
        maxWidth: 950,
        mx: "auto",
        p: { xs: 1.5, sm: 2 },
        bgcolor: "#fff",
      }}
    >
      <Box
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 3,
          borderRadius: "12px",
          background: "linear-gradient(135deg, #F05323 0%, #ff8c00 100%)",
          color: "white",
          boxShadow: "0 4px 15px rgba(240, 83, 35, 0.2)",
          textAlign: isMobile ? "center" : "left",
        }}
      >
        <Stack
          direction={isMobile ? "column" : "row"}
          spacing={isMobile ? 1.5 : 0}
          justifyContent="space-between"
          alignItems="center"
        >
          <Box>
            <Typography
              variant={isMobile ? "h6" : "h5"}
              fontWeight={900}
              sx={{ letterSpacing: -0.5 }}
            >
              SM2 RACING
            </Typography>
          </Box>
          <Box sx={{ textAlign: isMobile ? "center" : "right" }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                mt: 0.5,
              }}
            >
              Run Group: {runGroup || "N/A"}
            </Typography>

            <Typography
              variant="caption"
              sx={{
                display: "block",
                fontWeight: 700,
                opacity: 0.9,
                fontSize: "0.65rem",
              }}
            >
              ID: {submissionId}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Grid container spacing={2}>
        {[
          {
            icon: CarIcon,
            title: "General Details",
            rows: [
              { label: "Event Ref", value: eventId?.slice(-8) || "-" },
              { label: "Driver", value: driverDisplay },
              { label: "Vehicle", value: vehicleDisplay },
              { label: "Track", value: trackDisplay },
            ],
          },
          {
            icon: TimerIcon,
            title: "Session Info",
            rows: [
              { label: "Timestamp", value: timestampDisplay },
              { label: "Type", value: sessionTypeDisplay },
              { label: "Number", value: sessionNumberDisplay },
              { label: "Duration", value: durationDisplay },
            ],
          },
          {
            icon: PressureIcon,
            title: pressureTitle,
            rows: [
              { label: "Front (L/R)", value: frontPressureDisplay },
              { label: "Rear (L/R)", value: rearPressureDisplay },
            ],
          },
          {
            icon: SettingsIcon,
            title: "Suspension",
            rows: [
              {
                label: "Rebound (FL/FR/RL/RR)",
                value: formatSuspensionCorners(session?.suspension, "rebound"),
              },
              {
                label: "Bump (FL/FR/RL/RR)",
                value: formatSuspensionCorners(session?.suspension, "bump"),
              },
              {
                label: "Sway Bar (F/R)",
                value: swayBarDisplay,
              },
              {
                label: "Wing Angle",
                value: wingAngleDisplay,
              },
            ],
          },
          {
            icon: ThermostatIcon,
            title: "Tire Temps",
            rows: [
              {
                label: "Front Left",
                value: tireTempFrontLeftDisplay,
              },
              {
                label: "Front Right",
                value: tireTempFrontRightDisplay,
              },
            ],
          },
          {
            icon: InventoryIcon,
            title: "Tire Inventory",
            rows: [
              { label: "Model", value: firstPreviewValue(session?.tire_inventory?.model) },
              {
                label: "Heat Cycles",
                value: firstPreviewValue(session?.tire_inventory?.heat_cycles),
              },
              { label: "Status", value: firstPreviewValue(session?.tire_inventory?.status) },
            ],
          },
        ].map((section, idx) => (
          <Grid item xs={12} sm={6} key={idx} sx={{ display: "flex" }}>
            <Paper
              variant="outlined"
              sx={{
                borderRadius: 2,
                overflow: "hidden",
                width: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <SectionHeader icon={section.icon} title={section.title} isMobile={isMobile} />
              <Table size="small">
                <TableBody>
                  {section.rows.map((row, rowIndex) => (
                    <DataRow
                      key={rowIndex}
                      label={row.label}
                      value={row.value}
                      isMobile={isMobile}
                    />
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Grid>
        ))}

        <Grid item xs={12}>
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
            <SectionHeader
              icon={AlignmentIcon}
              title="Chassis Alignment & Balance"
              isMobile={isMobile}
            />
            <Grid container>
              <Grid
                item
                xs={12}
                sm={6}
                sx={{
                  borderRight: { sm: "1px solid #eee" },
                  borderBottom: { xs: "1px solid #eee", sm: "none" },
                }}
              >
                <Table size="small">
                  <TableBody>
                    <DataRow label="Camber Front" value={camberFrontDisplay} isMobile={isMobile} />
                    <DataRow label="Cross Weight" value={crossWeightDisplay} isMobile={isMobile} />
                  </TableBody>
                </Table>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Table size="small">
                  <TableBody>
                    <DataRow label="Camber Rear" value={camberRearDisplay} isMobile={isMobile} />
                    <DataRow label="Rake Height" value={rakeDisplay} isMobile={isMobile} />
                  </TableBody>
                </Table>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8} sx={{ display: "flex", order: { xs: 2, md: 1 } }}>
          <Paper
            variant="outlined"
            sx={{
              borderRadius: 2,
              overflow: "hidden",
              width: "100%",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <SectionHeader icon={RawTextIcon} title="Raw Input Verification" isMobile={isMobile} />
            <Box
              sx={{
                p: 2,
                bgcolor: "#fafafa",
                flexGrow: 1,
                textAlign: isMobile ? "center" : "left",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontFamily: "monospace",
                  color: "#666",
                  lineHeight: 1.5,
                  wordBreak: "break-all",
                }}
              >
                {rawTextDisplay || "-"}
              </Typography>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4} sx={{ display: "flex", order: { xs: 1, md: 2 } }}>
          <Paper
            variant="outlined"
            sx={{
              borderRadius: 2,
              overflow: "hidden",
              width: "100%",
              textAlign: "center",
              cursor: previewImage ? "pointer" : "default",
            }}
            onClick={() => previewImage && setOpenImage(true)}
          >
            <SectionHeader icon={ImageElementIcon} title="Proof Attachment" isMobile={isMobile} />
            {previewImage ? (
              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  height: { xs: 200, sm: 130 },
                }}
              >
                <Image
                  src={previewImage}
                  alt="Proof attachment"
                  fill
                  unoptimized
                  sizes="(max-width: 600px) 100vw, 50vw"
                  style={{ objectFit: "cover" }}
                />
              </Box>
            ) : (
              <Box sx={{ py: 4, color: "#ccc" }}>
                <ImageElementIcon sx={{ fontSize: 40 }} />
                <Typography variant="caption" sx={{ display: "block" }}>
                  No Image Uploaded
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Modal
        open={openImage}
        onClose={() => setOpenImage(false)}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 2,
        }}
      >
        <Box sx={{ position: "relative", outline: "none", maxWidth: "100%" }}>
          <IconButton
            onClick={() => setOpenImage(false)}
            sx={{ position: "absolute", top: -45, right: 0, color: "#fff" }}
          >
            <CloseIcon />
          </IconButton>
          <Box sx={{ position: "relative", width: "90vw", maxWidth: "1000px", height: "85vh" }}>
            {previewImage ? (
              <Image
                src={previewImage}
                alt="Proof"
                fill
                unoptimized
                sizes="90vw"
                style={{
                  objectFit: "contain",
                  borderRadius: "8px",
                }}
              />
            ) : null}
          </Box>
        </Box>
      </Modal>
    </Box>
  );
}
