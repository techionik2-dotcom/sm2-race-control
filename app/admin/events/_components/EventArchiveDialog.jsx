"use client";

import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { ConfirmDialog } from "../../fleet/_components/ManagementUi";

export default function EventArchiveDialog({
  open,
  eventName,
  onClose,
  onConfirm,
  isSaving = false,
}) {
  if (!open) return null;

  return (
    <ConfirmDialog
      open={open}
      title="Archive Event"
      message={`Archive ${eventName}? This will deactivate the event without permanently deleting it, so it stays available in the archived filter for audit and recovery. Run group data and submissions remain linked to the event, but new active operations should not be scheduled against archived events.`}
      confirmLabel="Archive Event"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onClose}
      busy={isSaving}
      tone="danger"
      icon={WarningAmberIcon}
    />
  );
}
