# Untitled - Design System Guide for AI Assistants

This project uses a custom design system. **Follow these rules strictly.**

## Setup — once per project

Everything this system needs is in `design-system/`. Nothing outside that folder was
changed, and regenerating replaces only that folder.

1. **Import the stylesheet once**, from the app's root stylesheet or entry file:
   `@import "<path to>/design-system/styles.css";` in CSS (in a Tailwind v4 project,
   after `@import "tailwindcss";`), or `import '<path to>/design-system/styles.css';` in
   the root layout or entry. It loads the fonts (`design-system/fonts.css`, as
   `@font-face` rules) and every token. If `fonts.css` still holds an
   `@import url(...)` line (the font host could not be reached when the folder
   was generated), put that address in a `<link rel="stylesheet">` in the
   document head instead: bundlers move an `@import` below other rules, where
   browsers ignore it.
2. **Import components from the folder**: `import { Button } from '<path to>/design-system';`.
   A path alias (`"@ds/*": ["./design-system/*"]` in tsconfig) keeps imports short.
3. **Modes**: set `data-mode` on `<html>` (see Dark Mode below).
4. **The page itself**: the components carry their own fonts, but the page around them
   does not. Set its base text and background from the system, once, in the root stylesheet:
   `body { font-family: var(--typography-body-medium-font-family); font-size: var(--typography-body-medium-font-size); line-height: var(--typography-body-medium-line-height); background: var(--cb-surface-001-bg); color: var(--cb-surface-001-text); }`. Without it, text outside a component falls back to the browser's
   default serif.

## This project

Found when the folder was pulled: no framework detected.

**Wire it in** (once):

1. Import `design-system/styles.css` once from the app's root stylesheet or entry file.
2. The components are React. Without React here, use the tokens (CSS variables) and the typography classes rather than the components.

Re-pull with `npx design-system-studio pull` when the system changes; it replaces `design-system/` and nothing else.

## Components - Use These, Don't Recreate

Always use the provided components from `design-system/`:
- `Icon` — `design-system/components/Icon/Icon.jsx`, `design-system/components/Icon/Icon.css`, `design-system/components/Icon/index.js`
- `Button` — `design-system/components/Button/Button.jsx`, `design-system/components/Button/Button.css`, `design-system/components/Button/index.js`
- `Surface` — `design-system/components/Surface/Surface.jsx`, `design-system/components/Surface/index.js`, `design-system/components/Surface/Surface.module.css`
- `Text` — `design-system/components/Text/Text.jsx`, `design-system/components/Text/index.js`, `design-system/components/Text/Text.module.css`
- `TextField` — `design-system/components/TextField/TextField.jsx`, `design-system/components/TextField/TextField.css`, `design-system/components/TextField/index.js`
- `Checkbox` — `design-system/components/Checkbox/Checkbox.jsx`, `design-system/components/Checkbox/Checkbox.css`, `design-system/components/Checkbox/index.js`
- `Toggle` — `design-system/components/Toggle/Toggle.jsx`, `design-system/components/Toggle/Toggle.css`, `design-system/components/Toggle/index.js`
- `RadioButton` — `design-system/components/RadioButton/RadioButton.jsx`, `design-system/components/RadioButton/RadioButton.css`, `design-system/components/RadioButton/index.js`

**Never create custom button, input, or form components. Always use the design system components.**

## Button Component

### Variants
Available button variants: `primary`, `outline`, `subtle`, `option_menu`

### Sizes
Available sizes: `medium`, `large`

**Use `medium` size by default** unless the user specifically asks for different sizes.

### Usage Examples

```tsx
// Primary button (default variant)
<Button variant="primary">Click me</Button>

// With variant and size
<Button variant="secondary" size="small">Cancel</Button>

// Disabled state
<Button variant="primary" disabled>Submit</Button>

// With loading state
<Button loading>Processing...</Button>

// With icons
<Button leftIcon={<Icon />}>With Icon</Button>
```

## Colors - CSS Variables & Tailwind

This design system uses a **hierarchical color system** with CSS variables:

### 1. Primitive Colors (Static)
Raw color values that don't change between modes:
```css
--primitive-gray-500: oklch(55% 0.02 264);
--primitive-purple-600: oklch(49% 0.2 297);
```

Available in Tailwind as color classes:
- `basics`: basics-core, basics-grayscale
- `datavis`: datavis-diverging, datavis-monochrome, datavis-categorical
- `evaluative`: evaluative-good, evaluative-meh, evaluative-bad

Example: `bg-gray-100`, `text-purple-600`, `border-gray-300`

### 2. Color Blocks (Semantic, Mode-Aware)
Semantic color combinations that automatically change with light/dark mode:

- **Foundational**: `brand`, `ui`, `subtle` (brand, UI colors)
- **Surfaces**: `001`, `card`, `menu`, `003`, `002`, `content`, `plot` (backgrounds, cards)
- **Utility**: `disabled`, `focus`, `error`, `secondary_text` (danger, warning, etc.)

**Color Block CSS Variables:**
```css
/* Rest state (default) */
--cb-brand-bg: oklch(...);      /* Background */
--cb-brand-text: oklch(...);    /* Text/foreground */
--cb-brand-border: oklch(...);  /* Border */

/* Interactive states */
--cb-brand-bg-hover: oklch(...);
--cb-brand-bg-active: oklch(...);
--cb-brand-bg-disabled: oklch(...);
--cb-brand-text-hover: oklch(...);

/* Focus ring */
--cb-focus-ring: oklch(...);
```

### Using Color Blocks in Custom Components
When creating custom components, use the color block CSS variables:

```css
.my-custom-card {
  background: var(--cb-surface-001-bg);
  color: var(--cb-surface-001-text);
  border: 1px solid var(--cb-surface-001-border, transparent);
}

.my-custom-card:hover {
  background: var(--cb-surface-001-bg-hover, var(--cb-surface-001-bg));
}
```

**Do NOT use arbitrary colors like `#3b82f6`, `rgb(59, 130, 246)`, or `bg-[#333]`.**
Only use CSS variables from the design system.

## Typography
Use the predefined type styles:
- **display**: `large`, `medium`, `small`
- **headers**: `h1`, `h2`, `h3`, `h4`, `h5`, `h6`
- **body**: `large`, `medium`, `small`
- **ui**: `large`, `medium`, `small`
- **code**: `large`, `medium`, `small`
- **labels**: `large`, `medium`, `small`
- **eyebrow**: `large`, `medium`, `small`

Use the `<Text>` component for typography:

```tsx
<Text variant="headers-h1">Main Heading</Text>
<Text variant="body-medium">Body text here</Text>
<Text variant="body-small" color="muted">Secondary text</Text>
```

## Surfaces (Containers)

Use `<Surface>` for semantic containers:

```tsx
<Surface variant="surface-001" padding="large" rounded="large" shadow>
  Content goes here
</Surface>
```

## Form Components

### TextField
```tsx
<TextField label="Email" type="email" placeholder="you@example.com" />
<TextField label="Required" required />
<TextField label="With Error" error="This field is required" />
<TextField label="Disabled" disabled />
```

### Checkbox
```tsx
<Checkbox label="Accept terms" />
<Checkbox label="With description" description="Additional info here" />
<Checkbox label="Checked" defaultChecked />
```

### Toggle
```tsx
<Toggle label="Notifications" />
<Toggle label="Small" size="small" />
<Toggle label="On by default" defaultChecked />
```

## Dark Mode (N-Mode Support)

The design system supports multiple color modes using the `data-mode` attribute:
- `data-mode="1"` - light (default)
- `data-mode="2"` - dark

**All color block CSS variables automatically switch** based on the mode attribute.

### Switching Modes

```tsx
// Set mode on document root
document.documentElement.setAttribute('data-mode', '2');
```

### Mode-Aware Custom Styles

```css
/* CSS variables automatically adapt - no need for dark: prefix! */
.my-component {
  background: var(--cb-surface-001-bg); /* Switches automatically */
  color: var(--cb-surface-001-text);
}
```

There is no `dark:` variant to reach for here and no need of one: the
variables above are the mode switch. Read a color through `var(--cb-...)` and
it is already correct in every mode this system defines.

## Creating New Components

When you need to create a new component not in the design system:

1. **Look at existing components first** - Match their patterns for:
   - Padding and spacing (use `var(--spacing-...)`)
   - Border radius (use `var(--radius-...)`)
   - Shadow usage
   - Icon sizing and placement

2. **Use CSS variables for colors** - Reference `design-system/styles.css`

3. **Follow the size system** - Use the same size props (`medium`, `large`)

4. **Support every mode** - Read colors through the CSS variables; they carry every mode already

5. **Use color block base/on_base colors for generic UI** - When creating UI elements not specified in the design system (e.g., increment/decrement arrows in a numeric input, custom icons, dividers), use the `base` and `on_base` colors from the appropriate color block for that context. Match the icon color to similar UI in the same mode.

6. **Style scrollbars consistently** - Use no background on the scrollbar track. For the scrollbar thumb, use the `on_base` color of the scrollable element's color block.

7. **Maintain consistent spacing and alignment** - Always provide sensible and consistent spacing between elements. Follow the spacing scale from the design system. Align elements properly within their containers.

8. **Respect component widths** - Input fields, text fields, and dropdowns have default max-widths defined per size. Don't make them full-width unless specifically needed for the layout. When placing inputs side by side, let them use their natural width. Only use `fullWidth` prop when the input should span its container.

## Charts

Chart types: `bar`, `line`, `area`, `scatter`, `donut`, `sparkline`.

- `bar` (cartesian, bar, vertical) — arrangements: grouped, stacked, stacked_100, horizontal
- `line` (cartesian, line, vertical)
- `area` (cartesian, area, vertical)
- `scatter` (cartesian, point, vertical)
- `donut` (radial, wedge) — arrangements: pie
- `sparkline` (cartesian, line, vertical)

Series color comes from the categorical palette, in order — never from a color
role. There are 8 steps; a chart with more series than that needs more
palette, not a borrowed brand color.

Marks stroke at 2px and bars round at 4px. Grid lines are drawn at 0.1 opacity.
Bar width and spacing are NOT bar properties — a bar gets whatever its band axis
leaves it, so they are set as band padding on the axis.

A cartesian chart names a category axis and a value axis, and its `orientation`
decides which of the two is drawn along x. Do not set an x axis and a y axis
directly; they are derived, so they cannot disagree with the orientation.

Values are in `charts.css` (colors, widths, opacities) and the chart tokens
module (tick counts, curves, scales, band padding). Use both — neither is
complete on its own — and do not hard-code a stroke width or a grid opacity.

## What NOT to Do

❌ Don't use arbitrary colors (`#3b82f6`, `rgb(59, 130, 246)`, `bg-[#333]`)
❌ Don't create custom button, input, or form components
❌ Don't use arbitrary font sizes (`text-[14px]`)
❌ Don't mix component libraries (no MUI, Chakra, shadcn, etc.)
❌ Don't override component styles with custom CSS
❌ Don't use inline styles for colors
❌ Don't hard-code a chart's stroke width, grid opacity or series colors - they are tokens
❌ Don't make inputs full-width by default - let them use their natural max-width from size props

## Quick Reference

```tsx
// ✅ Correct - Using design system components
<Icon />
<Button />
<Surface />
<Text />
<TextField />
<Checkbox />
<Toggle />
<RadioButton />

// ❌ Wrong - Custom button styling
<button className="bg-blue-500 text-white px-4 py-2 rounded">
  Click me
</button>

// ❌ Wrong - Arbitrary colors
<div className="bg-[#f5f5f5]">Content</div>
```

## File Structure

```
design-system/design-system.ds
design-system/AGENTS.md
design-system/DESIGN.md
design-system/styles.css
design-system/components/Button/Button.css   # Button
design-system/components/Button/Button.jsx   # Button
design-system/components/Button/index.js   # Button
design-system/components/Checkbox/Checkbox.css   # Checkbox
design-system/components/Checkbox/Checkbox.jsx   # Checkbox
design-system/components/Checkbox/index.js   # Checkbox
design-system/components/Icon/Icon.css   # Icon
design-system/components/Icon/Icon.jsx   # Icon
design-system/components/Icon/index.js   # Icon
design-system/components/RadioButton/RadioButton.css   # RadioButton
design-system/components/RadioButton/RadioButton.jsx   # RadioButton
design-system/components/RadioButton/index.js   # RadioButton
design-system/components/Surface/Surface.jsx   # Surface
design-system/components/Surface/Surface.module.css   # Surface
design-system/components/Surface/index.js   # Surface
design-system/components/Text/Text.jsx   # Text
design-system/components/Text/Text.module.css   # Text
design-system/components/Text/index.js   # Text
design-system/components/TextField/TextField.css   # TextField
design-system/components/TextField/TextField.jsx   # TextField
design-system/components/TextField/index.js   # TextField
design-system/components/Toggle/Toggle.css   # Toggle
design-system/components/Toggle/Toggle.jsx   # Toggle
design-system/components/Toggle/index.js   # Toggle
```

### Key Files

- **`design-system/styles.css`** - every CSS variable in the system:
  - Primitives: `--primitive-{category}-{group}-{step}`
  - Color blocks: `--cb-{block}-{property}-{state}`
  - Mode-specific overrides: `[data-mode="X"]` selectors
  - Typography utility classes: `.text-{variant}-{size}`
- **`design-system/design-system.ds`** - the source this was generated from. Edit it and
  regenerate rather than editing the CSS, or the next regeneration discards the change.
- **`design-system/components/Icon/Icon.jsx`** - Icon
- **`design-system/components/Button/Button.jsx`** - Button
- **`design-system/components/Surface/Surface.jsx`** - Surface
- **`design-system/components/Text/Text.jsx`** - Text
- **`design-system/components/TextField/TextField.jsx`** - TextField
- **`design-system/components/Checkbox/Checkbox.jsx`** - Checkbox
- **`design-system/components/Toggle/Toggle.jsx`** - Toggle
- **`design-system/components/RadioButton/RadioButton.jsx`** - RadioButton

---

Generated by [Design System Studio](https://design-system.studio)
