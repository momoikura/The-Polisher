/**
 * One design rulebook, distilled (rewritten, not copied) from three sources:
 *   - Impeccable 4.8 by Paul Bakaus (Apache-2.0): craft floor, refusals, modes
 *   - frontend-design by Anthropic (Apache-2.0): default-look calibration, typography, copy
 *   - ui-ux-pro-max: priority-ordered UX rules (accessibility, interaction, motion, forms)
 * Rules tagged with `enforcedBy` are also checked deterministically in slop/design-checks.ts.
 */

export type DesignSource = "impeccable" | "frontend-design" | "ui-ux-pro-max";
export type DesignArea = "direction" | "type" | "color" | "layout" | "motion" | "a11y" | "states" | "copy" | "tells";

export interface DesignRule {
  id: string;
  area: DesignArea;
  sources: DesignSource[];
  rule: string;
  enforcedBy?: string;
}

export const DESIGN_RULES: DesignRule[] = [
  // ── Direction ────────────────────────────────────────────────────────────
  { id: "brief-wins", area: "direction", sources: ["impeccable", "frontend-design"], rule: "The brief's explicit look, fonts and palette always win, even over these rules. Only spend free choices on avoiding defaults." },
  { id: "subject-first", area: "direction", sources: ["frontend-design"], rule: "Derive the look from the subject's own world (its materials, vernacular, audience), not from the category. A tool for analysts and a toy for children must not look alike." },
  { id: "plan-then-check", area: "direction", sources: ["frontend-design"], rule: "Before building, fix 4-6 named hex colors, the typefaces and their roles, and a layout concept; replace any part you would have produced for any similar page." },
  { id: "one-bold-thing", area: "direction", sources: ["frontend-design", "impeccable"], rule: "Spend boldness in one place. One memorable element; everything around it quiet. Remove one accessory before shipping." },
  { id: "mode", area: "direction", sources: ["impeccable"], rule: "Match ambition to the surface: persuasion pages (landing, pricing) commit hard to a point of view; task UI (dashboards, settings) earns brand through precision and familiar patterns." },
  { id: "hero-choice", area: "direction", sources: ["frontend-design"], rule: "Open with the most characteristic thing in the subject's world. The big-number-small-label-stats-plus-accent hero is a default, not a choice." },

  // ── Typography ───────────────────────────────────────────────────────────
  { id: "families", area: "type", sources: ["frontend-design", "ui-ux-pro-max"], rule: "One or two type families, clearly distinct if two. Pick them deliberately for this subject, not the family you would use anywhere.", enforcedBy: "type_basics" },
  { id: "body-size", area: "type", sources: ["ui-ux-pro-max"], rule: "Body text at least 16px with line-height 1.5-1.75 (a little more for serif body).", enforcedBy: "type_basics" },
  { id: "measure", area: "type", sources: ["impeccable", "frontend-design", "ui-ux-pro-max"], rule: "Body line length 60-75 characters (under 80). Display type no larger than 6rem, tracking no tighter than -0.04em." },
  { id: "scale", area: "type", sources: ["frontend-design", "ui-ux-pro-max"], rule: "A clear type scale with obvious size and weight steps: bold headings (600-700), regular body, medium labels." },
  { id: "headline-accent", area: "type", sources: ["frontend-design"], rule: "Do not accent a single word of a headline with italic, bold or a different color. Do not set labels in all caps." },
  { id: "tabular", area: "type", sources: ["ui-ux-pro-max", "impeccable"], rule: "Use tabular figures for prices, timers and data columns." },

  // ── Color ────────────────────────────────────────────────────────────────
  { id: "palette", area: "color", sources: ["frontend-design", "ui-ux-pro-max"], rule: "A small named palette as tokens (CSS custom properties), not raw hex scattered through rules.", enforcedBy: "palette_discipline" },
  { id: "contrast", area: "color", sources: ["impeccable", "ui-ux-pro-max"], rule: "Body text and placeholders at least 4.5:1, large text 3:1. On colored surfaces tint secondary text from that hue, never plain gray." },
  { id: "color-meaning", area: "color", sources: ["ui-ux-pro-max"], rule: "Never convey meaning by color alone; pair it with text or an icon." },
  { id: "theme-from-scene", area: "color", sources: ["impeccable"], rule: "Choose light or dark from where and how the page is used, not from the category." },

  // ── Layout ───────────────────────────────────────────────────────────────
  { id: "spacing-scale", area: "layout", sources: ["ui-ux-pro-max", "impeccable"], rule: "Spacing on a 4px scale. Tight within groups, generous between them, more space above a heading than below it.", enforcedBy: "spacing_scale" },
  { id: "no-card-grid", area: "layout", sources: ["impeccable", "frontend-design"], rule: "Do not build the page from same-size cards of icon + heading + text. Never nest cards. One radius and one soft gray shadow on everything is the SaaS-kit default." },
  { id: "structure-is-information", area: "layout", sources: ["frontend-design", "impeccable"], rule: "Borders, numbering, dividers and labels must encode real information. Numbers like 01/02/03 only for an actual sequence.", enforcedBy: "template_tells" },
  { id: "responsive", area: "layout", sources: ["ui-ux-pro-max", "impeccable"], rule: "Works at 375px with no horizontal scroll; run the real copy at every breakpoint and fix overflow." },

  // ── Motion ───────────────────────────────────────────────────────────────
  { id: "one-moment", area: "motion", sources: ["frontend-design", "impeccable"], rule: "At most one authored motion moment. Fade-and-slide-up on every section and hover effects on every card read as generated." },
  { id: "motion-mechanics", area: "motion", sources: ["ui-ux-pro-max"], rule: "150-300ms for micro-interactions, ease-out on enter, animate transform and opacity only, never `transition: all`.", enforcedBy: "motion_hygiene" },
  { id: "reduced-motion", area: "motion", sources: ["ui-ux-pro-max", "impeccable", "frontend-design"], rule: "Respect prefers-reduced-motion whenever anything moves.", enforcedBy: "motion_hygiene" },

  // ── Accessibility & states ───────────────────────────────────────────────
  { id: "focus", area: "a11y", sources: ["ui-ux-pro-max", "impeccable", "frontend-design"], rule: "Visible keyboard focus on every interactive element, styled from the palette. Never remove outlines without a replacement.", enforcedBy: "focus_states" },
  { id: "targets", area: "a11y", sources: ["ui-ux-pro-max"], rule: "Touch targets at least 44x44px with 8px between them." },
  { id: "labels", area: "a11y", sources: ["ui-ux-pro-max"], rule: "Every input has a visible label (not placeholder-only); errors appear next to the field and say how to fix it." },
  { id: "states", area: "states", sources: ["impeccable", "ui-ux-pro-max"], rule: "Design hover, focus, disabled, loading, error and empty states, plus success feedback after an action." },
  { id: "browser-surfaces", area: "states", sources: ["impeccable"], rule: "Theme the parts browsers draw: text selection, caret, focus ring, underline offset, scrollbars where shown." },

  // ── Copy ─────────────────────────────────────────────────────────────────
  { id: "plain-copy", area: "copy", sources: ["frontend-design"], rule: "Copy describes what something is or does in the user's words; it does not sell. Sentence case, active voice, no filler." },
  { id: "cta-names-action", area: "copy", sources: ["frontend-design", "impeccable"], rule: "Buttons name exactly what happens (\"Save changes\", not \"Submit\") and the same action keeps the same name across the flow." },
  { id: "errors", area: "copy", sources: ["frontend-design"], rule: "Errors say what went wrong and how to recover, without apologizing. Empty states invite the next action." },

  // ── Known generated-design tells (calibration) ───────────────────────────
  { id: "tell-cream-terracotta", area: "tells", sources: ["frontend-design"], rule: "Warm cream background (~#F4F1EA) with a high-contrast serif display and a terracotta accent (~#D97757).", enforcedBy: "default_look" },
  { id: "tell-dark-acid", area: "tells", sources: ["frontend-design"], rule: "Near-black background with one bright acid-green or vermilion accent.", enforcedBy: "default_look" },
  { id: "tell-chrome", area: "tells", sources: ["frontend-design", "impeccable"], rule: "Template chrome: uppercase eyebrow labels above headings, meta strings joined with middle dots, 'WORD — fragment' labels, a '→' appended to buttons, monospace as a costume for small labels.", enforcedBy: "template_tells" },
  { id: "tell-surfaces", area: "tells", sources: ["impeccable"], rule: "Gradient text, decorative glass/blur, colored side borders thicker than 1px on cards or callouts, zero-blur offset shadows outside a deliberately brutalist look, emoji or unicode glyphs as icons.", enforcedBy: "template_tells" },
];

export function rulesForAreas(areas: DesignArea[]): DesignRule[] {
  return DESIGN_RULES.filter((r) => areas.includes(r.area));
}

/** Compact rulebook text for prompts. */
export function formatRules(rules: DesignRule[]): string {
  const byArea = new Map<DesignArea, string[]>();
  for (const r of rules) byArea.set(r.area, [...(byArea.get(r.area) ?? []), `- ${r.rule}`]);
  return [...byArea.entries()].map(([area, lines]) => `${area.toUpperCase()}\n${lines.join("\n")}`).join("\n\n");
}

export const UI_RULEBOOK = formatRules(DESIGN_RULES.filter((r) => r.area !== "copy"));
export const COPY_RULEBOOK = formatRules(rulesForAreas(["copy"]));
