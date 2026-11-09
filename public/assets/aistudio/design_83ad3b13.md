# Universal Dashboard Design System Spec
*Inspired by the calm, spacious, bento-grid aesthetic of modern fintech & productivity platforms (e.g., Wise.com).*

---

## 1. Design Philosophy & Core Principles

Modern enterprise and consumer dashboards frequently suffer from information crowding, excessive borders, visual noise, and rigid grids. This design system provides a **calm, spacious, and human-friendly interface** based on five foundational tenets:

1. **Air & Breathing Room Over Density**: Generous whitespace (`32px` to `64px` section gaps, `24px` to `48px` page gutters) lets users scan without cognitive fatigue. Whitespace is a structural element, not wasted space.
2. **Soft Surfaces & Borderless Flow**: Minimize rigid borders. Separate sections through subtle background tints (`#F4F5F5` / `#F8FAFC`), rounded corners (`16px` to `24px`), and hairline dividers (`#F1F5F9` / `#E2E8F0`).
3. **Bento-Grid Visual Hierarchy**: Arrange content into organic, asymmetrical bento clusters (hero cards, 2-column dashed action blocks, grouped list cards) where every cell earns its place.
4. **Pill Geometry & Organic Radii**: Interactive elements (buttons, active navigation items, status badges, metric actions) use friendly pill contours (`border-radius: 9999px`) or soft rectangles (`border-radius: 12px` to `24px`).
5. **Subtle Micro-Interactions**: Use smooth, restrained physics (`140ms`–`220ms` transitions with `cubic-bezier(0.16, 1, 0.3, 1)`) for hover states, accordion expansions, and slide-over panels.

---

## 2. Design Tokens & Palette

### 2.1 Color Palette

```css
:root {
  /* Canvas & Backgrounds */
  --bg-app: #FFFFFF;              /* Primary canvas background */
  --bg-muted: #F8FAFC;            /* Subtle secondary page background */
  --bg-surface: #F4F5F5;          /* Card & grouped container surface */
  --bg-surface-hover: #ECEEEE;    /* Card hover state */
  --bg-scrim: rgba(15, 23, 42, 0.40); /* Modal & drawer backdrop */

  /* Text & Typography */
  --text-primary: #0F172A;        /* Headings & primary values */
  --text-secondary: #475569;      /* Descriptions & body text */
  --text-muted: #64748B;          /* Labels, timestamps, hints */
  --text-disabled: #94A3B8;       /* Inactive placeholders */

  /* Hairlines & Dividers */
  --border-hair: #E2E8F0;         /* Standard subtle border */
  --border-faint: #F1F5F9;        /* Ultra-light row separator */
  --border-dashed: #CBD5E1;       /* Dashed action cards */

  /* Primary Brand / Accent (Official Wise.com Signature Palette) */
  --brand-primary: #9FE870;       /* Iconic Wise Bright Lime Green */
  --brand-primary-hover: #8EE05B; /* Hover green */
  --brand-primary-fg: #163300;    /* Deep Forest Green for high-contrast text & icons on Wise Green */
  --brand-tint: #E8F8DE;          /* Soft Wise green tint */
  --brand-tint-hover: #DCF4CF;    /* Soft tint hover */
  --brand-text: #163300;          /* Deep forest text */
  --brand-dark: #163300;          /* Wise Forest Green */

  /* Pastel Hero Accents (Wise-Style Callout Cards) */
  --accent-hero-yellow: #FEF08A;  /* Cheerful pastel yellow hero card */
  --accent-hero-yellow-fg: #713F12;
  --accent-hero-blue: #DBEAFE;    /* Calming pastel blue */
  --accent-hero-blue-fg: #1E3A8A;
  --accent-hero-purple: #F3E8FF;  /* Pastel purple */
  --accent-hero-purple-fg: #581C87;

  /* Semantic Alerts */
  --danger-bg: #FEF2F2;
  --danger-border: #FECACA;
  --danger-fg: #DC2626;

  --warning-bg: #FEF3C7;
  --warning-border: #FDE68A;
  --warning-fg: #B45309;

  --info-bg: #EFF6FF;
  --info-border: #BFDBFE;
  --info-fg: #1D4ED8;
}
```

### 2.2 Typography Scale

A clean, modern sans-serif font stack (e.g., `Inter`, `Plus Jakarta Sans`, or `system-ui`):

| Token | Size | Weight | Line Height | Tracking | Primary Usage |
|---|---|---|---|---|---|
| `display-hero` | `36px` | `700` | `1.15` | `-0.03em` | Primary balances, top metrics |
| `heading-page` | `26px` | `700` | `1.25` | `-0.02em` | Main page titles |
| `heading-section` | `20px` | `600` | `1.30` | `-0.02em` | Section headers, card group titles |
| `heading-card` | `16px` | `600` | `1.40` | `-0.01em` | Card titles, action titles |
| `body-normal` | `14px` | `400` | `1.55` | `normal` | Standard descriptions, body text |
| `body-medium` | `14px` | `500` | `1.50` | `normal` | Navigation labels, table cell text |
| `caption-bold` | `12px` | `600` | `1.40` | `0.02em` | Badges, tags, auxiliary metadata |
| `label-meta` | `11px` | `600` | `1.30` | `0.05em` | Uppercase category tags, field labels |

### 2.3 Radii & Elevation Tokens

```css
:root {
  --radius-pill: 9999px;   /* Buttons, active navigation pills, status badges */
  --radius-hero: 24px;     /* Large bento cards, hero callout boxes */
  --radius-card: 16px;     /* Dashed action cards, grouped list cards */
  --radius-inner: 12px;    /* Internal nested containers, icon badges */
  --radius-control: 10px;  /* Inputs, small dropdown triggers */

  /* Shadows — Keep extremely soft and diffuse; avoid dark hard shadows */
  --shadow-diffuse: 0 4px 20px -2px rgba(15, 23, 42, 0.04);
  --shadow-floating: 0 16px 36px -8px rgba(15, 23, 42, 0.12);
  --shadow-drawer: -12px 0 40px rgba(15, 23, 42, 0.14);
}
```

---

## 3. Shell Architecture & Layout Grid

```
+------------------------------------------------------------------------------------+
|  [Logo]                                [Search]   [Action Pill]  [User Pill TR >]  |
|                                                                                    |
|  (Home Pill)           Heading / Section Title                                     |
|  Cards                 [Primary Pill]  [Subtle Pill v]                             |
|  Transactions                                                                      |
|  Payments v            +--------------------------+  +--------------------------+  |
|    - Sub-item 1        | Bento Hero Card          |  | Bento Metric Card        |  |
|    - Sub-item 2        | [Pastel Surface, 24px]   |  | Total Balance: 0.00      |  |
|  Team                  +--------------------------+  +--------------------------+  |
|  Recipients                                                                        |
|  Insights              Section: Actions                                            |
|                        +-----------------------+  +-----------------------+        |
|                        | [Dashed Action Card]  |  | [Dashed Action Card]  |        |
|                        | Icon  Title        >  |  | Icon  Title        >  |        |
|                        +-----------------------+  +-----------------------+        |
+------------------------------------------------------------------------------------+
```

### 3.1 Sidebar Navigation
- **Width**: `240px` (or `260px` for wide displays).
- **Position**: Sticky/fixed on the left, full viewport height (`100vh`).
- **Brand Logo**: Clean modern logo mark placed at `padding: 28px 24px 20px`.
- **Nav Item Row**:
  - `height: 44px`, `padding: 0 18px`, `display: flex`, `align-items: center`, `gap: 12px`.
  - Inactive: transparent background, `color: var(--text-secondary)`, `font-weight: 500`.
  - Hover: soft background `rgba(0, 0, 0, 0.04)`, `border-radius: 9999px`.
  - **Active State (Wise Style)**:
    - Background: `var(--bg-surface)` or soft tint `#E8EDE9` / `#E2E8F0`.
    - Border radius: `border-radius: 9999px` (full pill shape).
    - Color: `var(--text-primary)`, `font-weight: 600`.
- **Submenu Accordions**:
  - Toggled by right-hand chevron (`expand_more`).
  - Indented child items (`padding-left: 44px`, `font-size: 13px`, `color: var(--text-secondary)`).

### 3.2 Top Bar / Header
- **Height**: `64px` to `72px`.
- **Background**: Pure white `#FFFFFF` or glass blur (`backdrop-filter: blur(12px)`).
- **Alignment**:
  - Left: Clean breadcrumbs or dynamic page identifier.
  - Right: Action pills ("Send", "Get paid"), notification bell, user avatar badge (`36px` circle with initials, presence dot, name, and disclosure arrow).

### 3.3 Main Content Canvas
- **Maximum Width**: `1200px` to `1240px` centered (`margin: 0 auto`).
- **Gutters & Padding**:
  - Top: `36px` to `48px`.
  - Horizontal: `40px` to `48px`.
  - Bottom: `100px` to `140px` (never cramp the bottom of the page).
- **Section Rhythm**: `gap: 40px` between distinct bento modules.

---

## 4. Bento Grid & Card Components

### 4.1 Card Anatomy Comparison Table

| Card Type | Background | Border | Radius | Primary Purpose |
|---|---|---|---|---|
| **Hero Callout Card** | Pastel tint (`#FEF08A`, `#DBEAFE`) | None | `24px` | Onboarding prompts, primary marketing callout, visual anchors |
| **Bento Metric Card** | Soft neutral (`#F4F5F5`) | None | `24px` | Account balance summaries, multi-currency lists, deep links |
| **Dashed Action Card** | Pure white (`#FFFFFF`) | `1.5px dashed #CBD5E1` | `16px` | Interactive workflows, setup tasks, outgoing/incoming actions |
| **Solid Grouped Row** | Soft neutral (`#F4F5F5`) | None | `16px` | Account details, recent items, horizontal list records |
| **Slide-Over Item** | Pure white (`#FFFFFF`) | None (`1px hairline bottom`) | `0px` | Notification feeds, activity timelines, un-boxed drawers |

---

### 4.2 Component Specification: Hero Callout Card
A prominent, visual anchor card with a friendly pastel background and optional 3D asset or icon.

```html
<div class="bento-hero">
  <div class="bento-hero__content">
    <h3 class="bento-hero__title">Start receiving payments</h3>
    <p class="bento-hero__subtitle">Share your account details or send an invoice in seconds.</p>
  </div>
  <div class="bento-hero__visual">
    <!-- Playful icon or 3D illustration -->
  </div>
</div>
```

```css
.bento-hero {
  background-color: var(--accent-hero-yellow, #FEF08A);
  color: var(--accent-hero-yellow-fg, #713F12);
  border-radius: var(--radius-hero, 24px);
  padding: 32px 36px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  overflow: hidden;
  position: relative;
  transition: transform 180ms ease, box-shadow 180ms ease;
}

.bento-hero:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-diffuse);
}

.bento-hero__title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 8px 0;
}

.bento-hero__subtitle {
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
  opacity: 0.9;
}
```

---

### 4.3 Component Specification: Bento Metric & Account Card
Soft-gray surface card displaying large numeric data, multi-account rows, and action footer.

```html
<div class="bento-account-card">
  <div class="bento-account-card__header">
    <span class="bento-account-card__label">Main account</span>
    <span class="bento-account-card__amount">$12,450.00</span>
  </div>

  <div class="bento-account-card__items">
    <div class="account-subrow">
      <div class="account-subrow__info">
        <span class="currency-flag">🇺🇸</span>
        <span class="currency-code">USD</span>
      </div>
      <span class="account-subrow__balance">$8,200.00</span>
      <span class="material-symbols-outlined chevron">chevron_right</span>
    </div>
    <div class="account-subrow">
      <div class="account-subrow__info">
        <span class="currency-flag">🇪🇺</span>
        <span class="currency-code">EUR</span>
      </div>
      <span class="account-subrow__balance">€3,920.00</span>
      <span class="material-symbols-outlined chevron">chevron_right</span>
    </div>
  </div>

  <div class="bento-account-card__footer">
    <button class="pill-btn pill-btn--outline">
      <span class="material-symbols-outlined">account_balance</span>
      <span>Account details</span>
    </button>
  </div>
</div>
```

```css
.bento-account-card {
  background-color: var(--bg-surface, #F4F5F5);
  border-radius: var(--radius-hero, 24px);
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bento-account-card__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bento-account-card__amount {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  display: block;
  margin-top: 4px;
}

.account-subrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 12px;
  background-color: #FFFFFF;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.account-subrow:hover {
  background-color: #F8FAFC;
}
```

---

### 4.4 Component Specification: Dashed Action Cards
Used in 2-column or 3-column grids for launching workflows, configuration items, and integrations.

```html
<button class="dashed-action-card">
  <div class="dashed-action-card__icon-wrapper">
    <span class="material-symbols-outlined">upload_file</span>
    <span class="plus-badge">+</span>
  </div>
  <div class="dashed-action-card__content">
    <span class="dashed-action-card__title">Pay Invoices</span>
    <span class="dashed-action-card__desc">Upload or email invoices, or sync with accounting tools.</span>
  </div>
  <span class="material-symbols-outlined chevron">chevron_right</span>
</button>
```

```css
.dashed-action-card {
  width: 100%;
  background-color: #FFFFFF;
  border: 1.5px dashed var(--border-dashed, #CBD5E1);
  border-radius: var(--radius-card, 16px);
  padding: 20px 22px;
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  text-align: left;
  transition: border-color 150ms ease, background-color 150ms ease, transform 150ms ease;
}

.dashed-action-card:hover {
  border-color: var(--brand-primary, #9FE870);
  background-color: #F8FAFC;
  transform: translateY(-1px);
}

.dashed-action-card__icon-wrapper {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background-color: var(--bg-muted, #F1F5F9);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
}

.dashed-action-card__icon-wrapper .plus-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: var(--brand-primary, #9FE870);
  color: var(--brand-primary-fg, #163300);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dashed-action-card__content {
  flex: 1;
  min-width: 0;
}

.dashed-action-card__title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 3px;
}

.dashed-action-card__desc {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.dashed-action-card .chevron {
  color: var(--text-muted);
  font-size: 20px;
  flex-shrink: 0;
  transition: transform 140ms ease;
}

.dashed-action-card:hover .chevron {
  transform: translateX(3px);
  color: var(--text-primary);
}
```

---

## 5. Buttons, Pills & Controls

### 5.1 Pill Buttons
All primary and secondary triggers feature friendly, generous pill geometry (`border-radius: 9999px`):

```css
/* Primary Action Pill (Wise.com Signature Green: #9FE870 with Forest Green Text: #163300) */
.pill-btn--primary {
  background-color: var(--brand-primary, #9FE870);
  color: var(--brand-primary-fg, #163300);
  border: none;
  border-radius: 9999px;
  padding: 10px 22px;
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: background-color 140ms ease, transform 140ms ease;
}

.pill-btn--primary:hover {
  background-color: var(--brand-primary-hover, #8EE05B);
  transform: translateY(-1px);
}

/* Secondary Soft Tint Pill (Wise Tint: #E8F8DE with Forest Green Text) */
.pill-btn--soft {
  background-color: var(--brand-tint, #E8F8DE);
  color: var(--brand-text, #163300);
  border: 1px solid rgba(22, 51, 0, 0.14);
  border-radius: 9999px;
  padding: 9px 20px;
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 140ms ease;
}

.pill-btn--soft:hover {
  background-color: var(--brand-tint-hover, #DCF4CF);
}

/* Outline / Neutral Pill */
.pill-btn--outline {
  background-color: #FFFFFF;
  color: var(--text-primary);
  border: 1px solid var(--border-hair, #E2E8F0);
  border-radius: 9999px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 140ms ease;
}

.pill-btn--outline:hover {
  background-color: var(--bg-muted, #F8FAFC);
  border-color: var(--text-muted);
}

/* Circular Action Trigger (Wise Signature Green Plus Button) */
.circle-action-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background-color: var(--brand-primary, #9FE870);
  color: var(--brand-primary-fg, #163300);
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 140ms ease, background-color 140ms ease;
}

.circle-action-btn:hover {
  background-color: var(--brand-primary-hover, #8EE05B);
  transform: scale(1.06);
}
```

---

## 6. Slide-Over Drawers & Notification Panels

To prevent cluttered dashboards, contextual records, alert lists, and transaction details live in **wide, borderless right-hand slide-overs** portaled directly to the viewport body:

### 6.1 Architectural Rules for Drawers
1. **Viewport Mount (`document.body`)**: Never nest fixed drawers inside headers or containers with `backdrop-filter` or `transform` (which traps fixed coordinates).
2. **Generous Width (`540px` to `560px`)**: Prevents awkward text-wrapping and horizontal scrolling.
3. **Pure White Surface (`#FFFFFF`) with Zero Card Boxes**:
   - Do NOT wrap items inside bordered boxes.
   - List items are clean vertical rows separated only by `border-bottom: 1px solid var(--border-faint, #F1F5F9)`.
   - Generous row padding: `padding: 24px 32px`.
4. **Relaxed Typography**: Body text line height `1.6` with subtle icon pills on the left (`42px` width, `10px` radius).

```css
/* Drawer Scrim */
.drawer-scrim {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background-color: var(--bg-scrim, rgba(15, 23, 42, 0.40));
  backdrop-filter: blur(4px);
  z-index: 99998;
  animation: fadeIn 180ms ease;
}

/* Drawer Shell */
.drawer-shell {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 560px;
  max-width: 100vw;
  height: 100vh;
  background-color: #FFFFFF;
  box-shadow: var(--shadow-drawer);
  z-index: 99999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideInRight 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* Drawer Item Row (Borderless & Airy) */
.drawer-item {
  padding: 24px 32px;
  border-bottom: 1px solid var(--border-faint, #F1F5F9);
  background-color: #FFFFFF;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  transition: background-color 120ms ease;
}

.drawer-item:hover {
  background-color: #F8FAFC;
}
```

---

## 7. Modal Dialogs & Sheets

Modals adhere to the same spacious, rounded language:
- **Max Width**: `560px` (standard), `720px` (forms), `960px` (data previews).
- **Corner Radius**: `24px`.
- **Padding**: `36px 40px`.
- **Backdrop**: `background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(6px)`.
- **Dividers**: Clean hairline footer with cancel ghost button and primary pill action.

---

## 8. Micro-Animations & Timing Specifications

All state changes must feel natural, physical, and restrained:

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes scaleInSubtle {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Common Transition Preset */
.transition-smooth {
  transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## 9. Quick Layout Recipe: Full Modern Dashboard Page

Below is a complete, framework-agnostic reference implementation demonstrating how all these pieces unite:

```html
<div class="app-layout">
  <!-- 1. Left Navigation Sidebar -->
  <aside class="app-sidebar">
    <div class="app-sidebar__brand">
      <div class="brand-logo">W</div>
      <span class="brand-name">Platform</span>
    </div>

    <nav class="app-sidebar__nav">
      <a href="#" class="nav-item nav-item--active">
        <span class="material-symbols-outlined">home</span>
        <span>Home</span>
      </a>
      <a href="#" class="nav-item">
        <span class="material-symbols-outlined">credit_card</span>
        <span>Cards</span>
      </a>
      <a href="#" class="nav-item">
        <span class="material-symbols-outlined">receipt_long</span>
        <span>Transactions</span>
      </a>
      <a href="#" class="nav-item">
        <span class="material-symbols-outlined">sync_alt</span>
        <span>Payments</span>
      </a>
      <a href="#" class="nav-item">
        <span class="material-symbols-outlined">insights</span>
        <span>Insights</span>
      </a>
    </nav>
  </aside>

  <!-- 2. Main Workspace -->
  <main class="app-main">
    <!-- Header -->
    <header class="app-header">
      <div class="breadcrumbs">Home / Overview</div>
      <div class="header-actions">
        <button class="pill-btn pill-btn--primary">Send</button>
        <button class="pill-btn pill-btn--soft">Get paid</button>
        <div class="user-badge">
          <div class="avatar">TR</div>
          <span class="user-name">Thejas</span>
        </div>
      </div>
    </header>

    <!-- Content Canvas -->
    <div class="content-canvas">
      <!-- Section 1: Hero Banner -->
      <section class="bento-hero">
        <div>
          <h2 class="bento-hero__title">Start receiving payments</h2>
          <p class="bento-hero__subtitle">Your multi-currency virtual accounts are active and ready.</p>
        </div>
      </section>

      <!-- Section 2: Metric & Actions Bento -->
      <section class="bento-grid">
        <div class="bento-account-card">
          <span class="bento-account-card__label">Total balance</span>
          <span class="bento-account-card__amount">$0.00 USD</span>
          <button class="pill-btn pill-btn--soft" style="align-self: flex-start;">
            <span>Get paid</span>
            <span class="material-symbols-outlined">expand_more</span>
          </button>
        </div>

        <div class="bento-card bento-card--action">
          <h3>Do more with your money</h3>
          <p>Manage, exchange, and schedule transfers seamlessly.</p>
          <div class="circle-action-btn">+</div>
        </div>
      </section>

      <!-- Section 3: Dashed Action Cards (2-Column Grid) -->
      <section class="section-block">
        <h3 class="section-title">Outgoing</h3>
        <div class="grid-two-column">
          <div class="dashed-action-card">
            <div class="dashed-action-card__icon-wrapper">
              <span class="material-symbols-outlined">upload_file</span>
              <span class="plus-badge">+</span>
            </div>
            <div class="dashed-action-card__content">
              <span class="dashed-action-card__title">Pay Invoices</span>
              <span class="dashed-action-card__desc">Upload or email invoices, or sync with accounting software.</span>
            </div>
            <span class="material-symbols-outlined chevron">chevron_right</span>
          </div>

          <div class="dashed-action-card">
            <div class="dashed-action-card__icon-wrapper">
              <span class="material-symbols-outlined">event_repeat</span>
              <span class="plus-badge">+</span>
            </div>
            <div class="dashed-action-card__content">
              <span class="dashed-action-card__title">Scheduled transfers</span>
              <span class="dashed-action-card__desc">Set up a transfer to send automatically at a later date.</span>
            </div>
            <span class="material-symbols-outlined chevron">chevron_right</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</div>
```
