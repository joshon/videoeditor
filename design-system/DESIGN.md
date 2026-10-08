---
version: alpha
name: Untitled
description: "Default Design System"
colors:
  brand: "oklch(37.07% 0 none)"
  on-brand: "oklch(100% 0 0)"
  ui: "oklch(100% 0 0)"
  on-ui: "oklch(29.74% 0 none)"
  subtle: "oklch(66.38% 0 none)"
  on-subtle: "oklch(44.4% 0 none)"
  surfaces-001: "oklch(100% 0 0)"
  on-surfaces-001: "oklch(0% 0 0)"
  surfaces-card: "oklch(100% 0 0)"
  on-surfaces-card: "oklch(44.4% 0 none)"
  surfaces-menu: "oklch(100% 0 0)"
  on-surfaces-menu: "oklch(22.41% 0 none)"
  surfaces-003: "oklch(95.69% 0 none)"
  on-surfaces-003: "oklch(29.74% 0 none)"
  surfaces-002: "oklch(100% 0 0)"
  on-surfaces-002: "oklch(22.41% 0 none)"
  on-surfaces-content: "oklch(0% 0 0)"
  surfaces-plot: "oklch(100% 0 0)"
  on-surfaces-plot: "oklch(29.74% 0 none)"
  utility-disabled: "oklch(81.03% 0 none)"
  on-utility-disabled: "oklch(51.72% 0 none)"
  utility-focus: "oklch(100% 0 0)"
  on-utility-focus: "oklch(72.27% 0.19 149.58deg)"
  utility-error: "oklch(100% 0 0)"
  on-utility-error: "oklch(53.99% 0.22 29.23deg)"
  utility-secondary-text: "oklch(100% 0 0)"
  on-utility-secondary-text: "oklch(59.05% 0 none)"
typography:
  display-large:
    fontFamily: Inter
    fontSize: 72px
    fontWeight: 700
    lineHeight: 1.7
    letterSpacing: -0.04em
  display-medium:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: -0.04em
  display-small:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: -0.04em
  headers-h1:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: -0.03em
  headers-h2:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: -0.03em
  headers-h3:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.03em
  headers-h4:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.03em
  headers-h5:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.03em
  headers-h6:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.03em
  body-large:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: -0.03em
  body-medium:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.03em
  body-small:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.03em
  ui-large:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: -0.02em
  ui-medium:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.02em
  ui-small:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.02em
  code-large:
    fontFamily: "Roboto Mono"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: -0.02em
  code-medium:
    fontFamily: "Roboto Mono"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.02em
  code-small:
    fontFamily: "Roboto Mono"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.02em
  labels-large:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.03em
  labels-medium:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.03em
  labels-small:
    fontFamily: Inter
    fontSize: 8px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.03em
  eyebrow-large:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.04em
  eyebrow-medium:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.04em
  eyebrow-small:
    fontFamily: Inter
    fontSize: 8px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.04em
rounded:
  none: 0px
  xs: 0.25rem
  sm: 0.375rem
  md: 0.5rem
  lg: 0.75rem
  xl: 1rem
  2xl: 1.25rem
  3xl: 1.5rem
  4xl: 1.75rem
  5xl: 2rem
  full: 9999px
spacing:
  none: 0px
  5xs: 1px
  4xs: 2px
  3xs: 4px
  2xs: 6px
  xs: 8px
  sm: 10px
  md: 12px
  lg: 14px
  xl: 16px
  2xl: 18px
  3xl: 24px
  4xl: 36px
  5xl: 48px
  neg-1: -1px
  untitled: 0rem
---

## Overview

Default Design System

Tokens in the frontmatter are resolved for the default mode (light). The system defines 2 modes: light, dark. The accompanying .ds file is the source of truth — regenerate this file after changing it.

## Colors

Semantic color roles rather than raw values: foundational roles (brand, ui, subtle) carry the brand; surfaces (001, card, menu, 003, 002, content, plot) are page and panel backgrounds. Every role has a paired `on-*` token for text and icons sitting on it — always use the pair together to keep contrast intact.

## Typography

Font families: Inter (sans), Roboto Mono (mono). Typography levels are named `{variant}-{size}` (e.g. body-medium, headers-large). Use the defined levels — do not invent intermediate sizes or weights.

## Layout

Spacing uses the scale in the frontmatter (`spacing`). Compose layouts from these steps instead of arbitrary pixel values.

## Shapes

Corner radii come from the `rounded` scale. Components of the same kind share the same radius level — do not mix radii within a component group.

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
## Do's and Don'ts

- Do use color tokens by role (e.g. `brand` + `on-brand`); don't hard-code hex values.
- Do keep every mode in mind: values here are the light mode — other modes resolve from the same roles.
- Do use typography levels as complete sets (family + size + weight + line height); don't remix individual properties.
- Don't introduce new colors, radii or spacing steps without adding them to the design system first.
