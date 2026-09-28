# Presentation and architecture-view design

This specification covers the generated PowerPoint and the recommendation page's
architecture views. It does not replace the styling of the rest of the app.

## Purpose

Make the AI-authored architecture understandable to decision-makers. Full detail
remains on the recommendation page; the presentation is concise. Selected components are not
claims of deployed, verified, or Microsoft-approved infrastructure.

## Recommendation layout and generation

Preserve the original branded hero/toolbar, four descriptive tabs, two-column
Overview with its summary and services/checks sidebar, numbered architecture
narrative, and existing Architecture, Governance and Technical arrangements.
The service-sizing table is an addition to Technical, not a new page layout.

Initial generation shows the same layout with a dimmed, inert preliminary
rules-based preview. Server-driven Sol maximum generation and format-repair
stages provide real progress; elapsed time is not a claimed percentage.
Independent review is an optional button, with its own handoff/review progress.
Reduced motion, manual pause and offscreen/hidden suspension apply.
The AI-generated artifact becomes interactive/exportable without a mandatory
review gate. Review findings do not erase or auto-rewrite it. A separate
Apply review feedback action generates a new revision whose review state resets.
Failure removes the initial preview or retains the prior AI report. No
deterministic inference runs on the AI-authored graph.

## Presentation

- Microsoft logo on the cover and every subsequent slide.
- White content surfaces, deep navy section dividers, Azure-blue emphasis.
- Aptos/Aptos Display: large titles, readable body text and editable sizing tables.
- No automatic text shrinking, hidden slides, mid-sentence truncation, or
  “more items” placeholders.
- Maximum 15 slides, including all architecture and service-sizing tables.
- No long appendix, presenter notes, generation commentary, or repeated narrative slides.
- An editable table lists the AI-selected services and proposed Dev/Test/Prod configurations.
- Sizing is a starting proposal, not measured production capacity; missing load/region inputs stay explicit.
- Editable component diagrams rather than a dense screenshot of the webpage.
- The exact disclaimer is shared with the architecture view:
  “Suggested architecture — requires review and validation before implementation.”

## High-level Microsoft-style architecture

The default SVG is high-level component integration, not an implementation map.
The AI targets 6-9 core components, bounded at 12 nodes and 18 relationships.
Named arrows show integrations directly; there is no numbered connection lookup
or repeated control-text wall below the drawing. Full-width horizontal bands
are stacked in order: experience/access, application/orchestration, AI/grounding,
data/knowledge, and background preparation. Only layers with AI-authored components
are drawn. Identity, security, operations and network dependencies occupy a separate
cross-cutting rail alongside the workload.

Icons and product names sit within the bands rather than a free-form grid of cards.
Orthogonal connections route through reserved clearances, with readable inline
labels. Each component keeps its declared platform label; the bands are logical
reference-architecture layers, not claims of network isolation.

Mermaid is a separate, AI-authored high-level journey of at most eight short
steps. It is not the integration graph with every policy/preparation link.
Detailed end-to-end steps, controls, sizing and open decisions stay on the page.

Official Microsoft service icons are used only for the services they represent;
custom apps, code, and logical capabilities use generic shapes.

On the Recommendation page the accepted AI report owns component meaning and
the high-level flow and all integration relationships. `lib/recommendation-contract.ts` validates shape and
references without comparing against the deterministic draft. `lib/architecture-view.ts`
returns the accepted graph unchanged for AI recommendations; its legacy inference
is confined to preliminary wizard/diagnostic drafts.
`lib/architecture-layout.ts` applies a pinned deterministic graph layout and
produces the coordinates used by both SVG and editable PowerPoint connectors.
The overview groups the AI-provided layer fields into explicitly logical boundaries.

Single-ended arrows show the initiating component and its dependency. Solid,
dashed, and dotted styles distinguish requests/queries, background preparation,
hosting, control dependencies, and relationships that need confirmation. Every
connection has a short inline label. Mermaid step numbers, unlike connection
references, express the AI-authored journey order.

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

`scripts/qa/presentation-design-check.ts` checks exact accepted graph preservation,
node/edge integrity, slide count <=15 even for 32 services and long narratives,
editable Dev/Test/Prod tables, no presenter commentary, and logo
and disclaimer presence. Browser replay checks the actual page and download.
`scripts/qa/connected-layout-check.ts` verifies routed connections, non-overlapping
nodes/reference labels, focus variants, and exact SVG relationship coverage.

## Microsoft references

- https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams
- https://learn.microsoft.com/en-us/azure/architecture/icons/
- https://learn.microsoft.com/en-us/azure/architecture/ai-ml/architecture/baseline-microsoft-foundry-chat
