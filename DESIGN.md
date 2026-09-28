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

## Connected Microsoft-style architecture

The main diagram is a connected service architecture, not an inventory of cards.
Official Microsoft service icons are used only for the services they represent;
custom apps, code, and logical capabilities use generic shapes.

`lib/architecture-view.ts` owns component meaning and allowed relationships.
`lib/architecture-layout.ts` applies a pinned deterministic graph layout and
produces the coordinates used by both SVG and editable PowerPoint connectors.
The overview groups client, edge, application, AI, source, preparation, and
control-plane dependencies into explicitly logical boundaries.

Single-ended arrows show the initiating component and its dependency. Solid,
dashed, and dotted styles distinguish requests/queries, background preparation,
hosting, control dependencies, and relationships that need confirmation. Every
connection has a numbered reference and description; numbers are not claimed to
be execution order.

Focused entry, model, data-access, and preparation views provide progressive
detail. The page has zoom controls; PowerPoint includes editable focused diagrams
after complex topology overviews. Do not invent VNets, subnets, or private
endpoints merely to resemble a network diagram.

## Boundaries and review

- Request/query paths and background preparation are distinct.
- Models do not directly access operational sources.
- Permissions belong to each source; one source's policies do not automatically
  govern another.
- Semantic-model readiness is separate from authorization.
- Unknown source roles and retrieval designs remain explicit confirmation items.
- Empty categories do not become fake diagram nodes.

## Verification

`scripts/qa/presentation-design-check.ts` checks repeatability, node/edge
integrity, icon availability, slide bounds, full-source preservation, and logo
and disclaimer presence. Browser replay checks the actual page and download.
`scripts/qa/connected-layout-check.ts` verifies routed connections, non-overlapping
nodes/reference labels, focus variants, and exact SVG relationship coverage.

## Microsoft references

- https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams
- https://learn.microsoft.com/en-us/azure/architecture/icons/
- https://learn.microsoft.com/en-us/azure/architecture/ai-ml/architecture/baseline-microsoft-foundry-chat
