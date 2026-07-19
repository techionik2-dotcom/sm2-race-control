# SM-2 Race Control UI Design System

This document is the developer source of truth for production UI work in SM-2 Race Control. New screens should use these tokens and primitives before adding page-specific CSS.

## Design Intent

SM-2 should feel like a premium motorsport operations product: dark, focused, readable, and fast to scan during a race weekend. Orange is the brand accent and should be reserved for primary actions, active states, selected states, and important highlights.

## Global Tokens

Tokens live in `app/globals.css`.

Spacing:
`--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px, `--space-16` 64px.

Layout:
`--page-max-width` is `1440px`. `--page-gutter` controls horizontal page padding and collapses on mobile.

Typography:
Use `--font-family-base`, `--font-family-mono`, `--font-size-page-title`, `--font-size-section-title`, `--font-size-card-title`, `--font-size-body`, `--font-size-body-sm`, `--font-size-label`, and `--font-size-caption`. Avoid new one-off font sizes unless the value is tied to a specific data visualization.

Color:
Use semantic aliases first: `--surface-base`, `--surface-raised`, `--surface-elevated`, `--surface-muted`, `--surface-card`, `--text-primary`, `--text-secondary`, `--text-muted`, `--brand-primary`, `--brand-primary-hover`, `--status-success`, `--status-warning`, `--status-error`, and `--status-info`.

Radius and shadows:
Use `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-pill`, `--shadow-subtle`, `--shadow-raised`, `--shadow-overlay`, and `--shadow-glow`.

Controls:
Use `--control-height`, `--control-height-sm`, `--button-height`, `--button-height-sm`, `--button-height-lg`, and `--table-row-height`.

## Layout Rules

Major pages should use the shared content width strategy:

- Global/default pages: `.container` or `.app-page-shell`.
- Admin event pages: `.admin-page-shell`.
- Fleet pages: `.fleet-page-shell`.

Page title, filters, cards, tables, and drawer content should align to the same left and right gutters. Do not introduce new max widths unless a modal or drawer requires a bounded width.

## Components

Buttons:
Use `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-sm`, and `.btn-lg` where possible. Fleet-specific buttons should keep `.fleet-btn` variants, which now map to the same token system.

Inputs:
Use `.input` and `.app-select-*` primitives. Fleet input, select, textarea, and autocomplete rules map to the same height, focus, radius, and surface tokens.

Cards:
Cards and panels should use tokenized border, radius, background, shadow, and spacing. Avoid nested cards unless the inner card is a repeated item, modal surface, or specific tool surface.

Status:
Use `app/components/Common/StatusBadge.jsx`. It supports both `label` plus `tone`, and legacy `status` values such as `active`, `inactive`, `ready`, `submitted`, `completed`, `warning`, and `error`.

Empty and loading states:
Use `EmptyState` and `Loader` from `app/components/Common`. Empty states should include a clear title, short explanation, and one relevant next action when available.

Tables:
Use consistent header padding, `--table-row-height`, uppercase short metadata headers, and card/list conversion below tablet widths when data is too dense.

## Event-First Workflow

The product navigation should preserve this hierarchy:

Events -> Driver -> Session

Event creation must keep driver selection and schedule intake visible enough for non-technical users. Event workspace tabs should remain scan-friendly on tablet; avoid collapsing them into one column before mobile widths.

## Responsive Breakpoints

Minimum inspection widths:
1920, 1440, 1280, 1024, 768, and mobile below 640.

Rules:
Use grid/flex layouts, not fixed pixel positioning. Long event names, driver names, tracks, vehicles, file names, and session labels must either wrap intentionally or clamp with a tooltip.

## Accessibility

Every interactive element needs visible focus. Icon-only buttons need an accessible name. Form controls need labels, helper text, and readable error states. Color cannot be the only signal for an error, warning, success, or selected state.

## Maintenance Checklist

Before merging UI changes:

- Reuse tokens before adding new values.
- Prefer shared primitives before page-specific styling.
- Keep orange limited to actions, active states, and important highlights.
- Check desktop, laptop, tablet, and mobile layouts.
- Run lint and production build.
- Confirm the event-first flow still works: create/open event, select drivers, upload/review schedule, open driver, open session, save data, and review carry-forward state.
