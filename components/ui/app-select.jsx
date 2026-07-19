"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const EMPTY_STATE_VALUE = "__APP_SELECT_EMPTY__";

export default function AppSelect({
  id,
  value,
  onValueChange,
  options = [],
  placeholder,
  disabled = false,
  invalid = false,
  title,
  testId,
  ariaLabelledby,
  onBlur,
  triggerClassName,
  contentClassName,
  itemClassName,
  emptyMessage,
}) {
  const resolvedOptions =
    Array.isArray(options) && options.length > 0
      ? options
      : emptyMessage
        ? [{ value: EMPTY_STATE_VALUE, label: emptyMessage, disabled: true }]
        : [];

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        data-testid={testId}
        title={title}
        aria-invalid={invalid || undefined}
        aria-labelledby={ariaLabelledby}
        onBlur={onBlur}
        className={cn("app-select-trigger", invalid && "input-error", triggerClassName)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" align="start" className={cn("app-select-content", contentClassName)}>
        {resolvedOptions.map((option, index) => (
          <SelectItem
            key={`${option.value}-${index}`}
            value={String(option.value)}
            disabled={Boolean(option.disabled)}
            className={cn("app-select-item", itemClassName)}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
