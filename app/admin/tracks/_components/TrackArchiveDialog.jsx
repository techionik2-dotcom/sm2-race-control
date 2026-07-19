"use client";

import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { ConfirmDialog } from "../../fleet/_components/ManagementUi";

export default function TrackArchiveDialog({
  open,
  trackName = "this track",
  shortCode = "",
  onClose,
  onConfirm,
  isSaving = false,
}) {
  const label = shortCode ? `${trackName} (${shortCode})` : trackName;

  return (
    <ConfirmDialog
      open={open}
      title="Archive track?"
      message={`Archive ${label}? The record will remain visible in archived filters and keep historical event references intact.`}
      confirmLabel="Archive Track"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onClose}
      busy={isSaving}
      tone="danger"
      icon={WarningAmberOutlinedIcon}
      confirmTitle="Archive the selected track"
    />
  );
}
