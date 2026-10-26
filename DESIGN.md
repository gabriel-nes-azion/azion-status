# DESIGN.md — Azion Community Design System

Framework-independent visual guide for Azion Community apps. It follows the Azion Console look and feel and adds the shared community header, user menu, sign-in and footer. Everything here ships as code in the kit:

| File | URL |
|---|---|
| Stylesheet | `https://community.azion.app/kit/v1/azion-community.css` |
| Script | `https://community.azion.app/kit/v1/azion-community.js` |
| Function session handler | `https://community.azion.app/kit/v1/server/community-auth.js` |
| Logo (light on dark, dark on light) | `/kit/v1/logo.svg`, `/kit/v1/logo-dark.svg` |
| Favicon | `/kit/v1/favicon.svg` |
| Component gallery | `https://community.azion.app/components` |

Use the kit classes (`azc-*`) and tokens. Do not copy hex values into app CSS.

---

## 1. Principles

- **Flat, not skeuomorphic.** Subtle borders replace shadows.
- **The header is always dark.** Content follows the light or dark theme.
- **Orange `#F3652B` is the brand color.** Use it for primary CTAs, focus, hover and active indicators only. Never for body text or large areas.
- **Hierarchy through size and color**, not heavy weight. Never use `font-weight` 700 or above.
- **Dense data in monospace** (IDs, metrics, code). UI in sans-serif.
- **Spacing in multiples of 4px.**

---

## 2. Colors

### Brand

| Name | Hex | Use |
|---|---|---|
| Orange | `#F3652B` | Primary CTA, focus, hover, active indicator |
| Success | `#22C55E` | Green check |

### Header (dark in both themes)

| Token | Hex |
|---|---|
| `--header-bg` | `#111111` |
| `--header-border` | `#3e3e3e` |
| `--header-text` | `#b5b5b5` |
| `--header-hover` | `#f5f5f516` |
| `--header-avatar-bg` | `#363636` |

### Semantic tokens

Always use tokens. Each theme redefines them.

```
--surface-ground       page background
--surface-section      card and section background
--surface-border       default 1px border
--surface-hover        row and item hover
--surface-50..600      neutral scale

--text-primary         main text
--text-secondary       descriptions, metadata
--text-muted           disabled, placeholder
--text-link / --text-link-hover

--status-success / --status-danger / --status-warning / --status-info
```

- **Light:** white or near-white surfaces, near-black text.
- **Dark:** `--surface-ground` `#0A0A0A`, text `#E5E5E5`.

The theme is a class on `<html>` (`theme-light` / `theme-dark`). The kit sets it before the first paint from `localStorage['azion.community.theme']` (`light`, `dark`, or absent for system) and follows `prefers-color-scheme` when set to system.

---

## 3. Typography

| Family | Use |
|---|---|
| **Sora** | All UI: body, titles, buttons, labels |
| **Proto Mono** (fallback JetBrains Mono) | IDs, numbers, code, dense metrics |

The kit stylesheet loads Sora and JetBrains Mono from Google Fonts.

| Size | Where |
|---|---|
| 12px | labels, metadata, captions |
| 14px | UI body, descriptions |
| 16px | default body |
| 18px | breadcrumb, highlighted labels |
| 20px | section titles |
| 24px | page title (H1) |
| 28px | large metrics |

Weights: **400 / 500 / 600**.

```
Page title       24px / 500       h1
Section          20px / 500       h2
Subsection       18px / 600       h3
Label            14px / 500       .azc-label
Description      14px / secondary .azc-description
Metadata         12px / mono      .azc-meta
```

---

## 4. Spacing, radius and borders

- **Scale:** `4, 8, 12, 16, 20, 24, 32` as `--space-1` to `--space-8`.
- **Page padding:** 16px mobile, 32px desktop horizontal. 16px top, 32px bottom.
- **Radius:** `--radius-md` 6px default (buttons, inputs, small cards). 8 to 12px for dialogs, large cards, highlighted areas. `--radius-full` for avatars, pills, tags.
- **Borders:** `1px solid var(--surface-border)`. Shadows only on popovers and dropdowns. No large shadows.

---

## 5. Application layout

```
┌──────────────────────────────────────────────────────────────┐
│ [AZION] community | App name           [nav]  [avatar ▾]     │  header, fixed, 56px, #111111
├────────────────────────────────────────────────┬─────────────┤
│ main.azc-main                                  │ .azc-drawer │
│  ├─ .azc-page-heading                          │ right side  │
│  │   breadcrumb, title, description, actions   │ ~512px      │
│  └─ content                                    │             │
├────────────────────────────────────────────────┴─────────────┤
│ © Azion Community · not supported by Azion       links       │  footer
└──────────────────────────────────────────────────────────────┘
```

- `body` is a flex column with `min-height: 100vh`. `main.azc-main` grows, so the footer stays at the bottom.
- `.azc-main` is centered at `--content-max` (1280px). Add `.azc-main--full` for full-width tools such as canvases.
- The drawer is not main navigation. It holds secondary panels (details, quick create, help).

### Header (kit, do not rebuild)

`AzionCommunity.init()` renders it. Left to right:

| Part | Content | Behavior |
|---|---|---|
| Logo | Azion wordmark SVG followed by `community` in orange | Opens the disclaimer popover |
| Pipe | `\|` in `--header-border` | |
| App name | `appName` option | Links to `appHref` |
| Nav | `nav` option items | Moves into the user menu below 640px |
| Avatar | Initials when signed in, user icon otherwise | Opens the user menu |

Disclaimer text, fixed for every app:

> This app is maintained by an open community that builds its apps on the Azion Platform, not by Azion. This app is not supported by Azion. All of them run on Azion's computing primitives.

### User menu (kit)

In order:

1. Account: name, email, account id and sign-in method, or "Not signed in".
2. Azion Console link (`https://console.azion.com`).
3. App items: the `nav` mirror on phones, then the `menu` option items.
4. Theme: Light, Dark, System.
5. Sign in or Sign out (hidden when `auth: false`).

### Sign-in dialog (kit)

Tabs: **Email** (with a TOTP step when MFA is on), **Personal token**, **azsid cookie**. The dialog posts to the app's own Function (`/api/auth/*`). Secrets never reach JavaScript storage: the Function keeps them in HttpOnly cookies. The cookie and storage names are fixed so all apps share one session:

| Name | Where | Content |
|---|---|---|
| `azsid` | Cookie, HttpOnly | Azion Console session id |
| `azc_pt` | Cookie, HttpOnly | Personal token |
| `azc_rt` | Cookie, HttpOnly | Refresh JWT from email and password |
| `azc_mfa` | Cookie, HttpOnly | MFA step token, 5 min |
| `azion.community.session` | localStorage | `{ method, user }`, no secrets |
| `azion.community.theme` | localStorage | `light` or `dark` |

### Footer (kit)

Left: `© <year> Azion Community. Built on the Azion Platform. Not maintained or supported by Azion.` Right: Community apps, Azion Console, Platform status, then `footer.repository` and `footer.links`. 12px, `--text-secondary`.

---

## 6. Page patterns

### List view

```
[Breadcrumb]
[Title]                                      [Create]
[Description]

[Table with filters, server-side pagination, frozen first column]
```

- The table grows vertically. The page scrolls, not the table.
- The rightmost column holds the row actions menu (Edit, Delete).
- Empty state: `.azc-empty` with a message and a create CTA.

### Create and edit

```
[Breadcrumb]
[Title]
[Description]

[Fields grouped in .azc-form-section, divider between sections]

──────────────────────────────────
[Cancel]                    [Save]   .azc-action-bar, sticky at the bottom
```

- Edit pages may have `.azc-tabs` on top and an `.azc-danger-zone` at the end.

### Drawer create

Quick create without leaving the route: `.azc-drawer` from the right with the same form, actions in `.azc-drawer__footer`.

---

## 7. Components

| Component | Classes |
|---|---|
| Button | `.azc-btn` + `--primary` `--secondary` `--info` `--success` `--warn` `--danger` + `--outlined` `--text` `--link` + `--small` `--large` `--icon` + `.is-loading` |
| Field | `.azc-field` > `.azc-label` (`.azc-required`), `.azc-input` / `.azc-select` / `.azc-textarea`, `.azc-helper`, `.azc-error` |
| Toggles | `.azc-switch`, `.azc-check` |
| Form alert | `.azc-form-alert` |
| Tabs | `.azc-tabs` > `.azc-tab[aria-selected]` |
| Table | `.azc-table-wrap` > `.azc-table`, `.azc-num` for numbers |
| Tag | `.azc-tag` + `--success` `--danger` `--warning` `--info` `--brand` |
| Card | `.azc-card`, `.azc-card--compact`, `.azc-metric`, `.azc-meta` |
| Dialog | `dialog.azc-dialog` (`--wide`) > `__header`, `__body`, `__footer`, `.azc-close` |
| Drawer | `.azc-drawer[data-open]` > `__header`, `__body`, `__footer` |
| Toast | `AzionCommunity.toast(message, { severity })` |
| Danger zone | `.azc-danger-zone` |
| Layout | `.azc-main`, `.azc-page-heading`, `.azc-breadcrumb`, `.azc-section`, `.azc-grid`, `.azc-stack`, `.azc-row`, `.azc-divider` |
| Code | `.azc-code`, `.azc-inline-code`, `.azc-mono` |
| Loading | `.azc-spinner` |

### Buttons

- Severity: primary, secondary, info, success, warn, danger. Style: filled, outlined, text, link. Size: small 32px, medium 40px, large 48px.
- Lists and toolbars use small. Forms use medium.
- Icon left of the label.
- Async submits always show `.is-loading`.
- Destructive actions use danger filled or outlined, never link.

### Fields

```
Label *                                14px / 500
[ input                          ]     6px radius, --surface-border
Helper text                            14px / --text-secondary
Error message (after blur)             --status-danger
```

Validate on blur, then on every input once the field is dirty. Set `aria-invalid` and link the error with `aria-describedby`. Never use a placeholder as the label.

### Table

- Sortable headers use `aria-sort`.
- Server-side pagination with a loading indicator.
- First column frozen on horizontal scroll.
- Status as tags. Long text truncated with a copy tooltip.

### Dialog

- `max-width` 36rem for confirmations, 48rem (`--wide`) for short forms.
- Semi-transparent backdrop. 24px padding.
- Header: title and close. Footer: cancel on the left (outlined or text), confirm on the right (primary or danger).

### Tags

Pill, `2px 8px`, 12px text. Background is the semantic color at low opacity, text in the full color.

### Toast

Top right, below the header. Auto-dismiss after 5s. Left border in the severity color.

### Danger zone

1px border in `--status-danger` at 50% alpha, background at 10% alpha, radius 8px, padding 24px, danger button.

---

## 8. Icons

- One stroke icon set (Lucide style). The kit exposes `AzionCommunity.icon(name)`: `user`, `info`, `alert`, `check`, `x`, `external`, `login`, `logout`, `sun`, `moon`, `monitor`, `console`, `arrowLeft`.
- Size follows `font-size`: 16px in small text, 20px in medium buttons, 24px+ for emphasis.
- Brand marks (logos) stay separate from action icons.
- Mapping: plus create, pencil edit, trash delete, download export, chevron-down dropdown, external-link external, info-circle info, triangle warning, check-circle success, x-circle error.

---

## 9. Motion

| Effect | Value |
|---|---|
| Fade, slide, expand | 220ms ease-in-out (`--ease`) |
| Hover | 150ms ease-out (`--ease-hover`) |
| Spinner | continuous rotation |

No bouncy or elastic easing, no parallax. `prefers-reduced-motion` disables animations.

---

## 10. Accessibility

- AA contrast for all text.
- Visible focus on every interactive element (orange outline).
- Real labels on every field.
- Click targets at least 32×32px.
- State is never conveyed by color alone: add an icon or text.
- The kit adds a skip link to `main`, keyboard tabs (arrow keys) and Escape to close popovers.

---

## 11. Summary

> Use the kit: one stylesheet, one script, `AzionCommunity.init()`. Sora everywhere. Black header with Azion logo, `community`, a pipe and the app name. Orange `#F3652B` only for brand, CTA and hover. Borders instead of shadows. 6px radius by default, 12px on large containers, full on pills. Spacing in multiples of 4. No weight above 600. Status through semantic tokens, never hex. 220ms ease-in-out. Forms validate on blur with inline helper and error. Tables grow and paginate server-side. Simple dialogs, sticky action bar on forms. AA contrast, visible focus, real labels. One shared session through the `azsid`, `azc_pt` and `azc_rt` cookies.
