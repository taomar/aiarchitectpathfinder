# Presentation and architecture-view design

This specification covers the generated PowerPoint and the recommendation page's
architecture views. It does not replace the styling of the rest of the app.

## Purpose

Make a proposed architecture understandable to decision-makers while preserving a
complete, readable record for implementation review. Selected components are not
claims of deployed, verified, or Microsoft-approved infrastructure.

## Presentation

- Microsoft logo on the cover and every subsequent slide.
- White content surfaces, deep navy section dividers, Azure-blue emphasis.
- Aptos/Aptos Display: large titles, 18–21 pt primary body text, 14 pt appendix.
- No automatic text shrinking, hidden slides, mid-sentence truncation, or
  “more items” placeholders.
- Executive narrative first; the complete source record in a separated appendix.
- Editable component diagrams rather than a dense screenshot of the webpage.
- The exact disclaimer is shared with the architecture view:
  “Suggested architecture — requires review and validation before implementation.”

## Repeatable layers

The fixed order is Channels; Edge & API policies; Experience & runtime; Models;
Grounding & retrieval; Governed interfaces; Source systems; Background preparation.

`lib/architecture-view.ts` owns the model. The page SVG, Mermaid service flow,
and PowerPoint consume that model; they do not independently reinterpret service
names or invent their own connection rules.

States distinguish selected components, Microsoft-managed capabilities, and
items that need confirmation. Logical capabilities are labelled as such, not
presented as extra Azure deployments.

## Boundaries and review

- Request/query paths and background preparation are distinct.
- Models do not directly access operational sources.
- Permissions belong to each source; one source's policies do not automatically
  govern another.
- Semantic-model readiness is separate from authorization.
- Unknown source roles and retrieval designs remain explicit confirmation items.
- Empty layers remain visible as “No separate component selected,” not fake nodes.

## Verification

`scripts/qa/presentation-design-check.ts` checks repeatability, node/edge
integrity, icon availability, slide bounds, full-source preservation, and logo
and disclaimer presence. Browser replay checks the actual page and download.
