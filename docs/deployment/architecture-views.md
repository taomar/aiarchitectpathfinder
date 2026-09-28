# Architecture views and PowerPoint

The recommendation appears first. A separate automatic background request builds
its architecture, flow and SVG image from that exact recommendation. A notification
reports building, ready or failed; image failures have an independent retry and
never remove the recommendation. PowerPoint is enabled when its visual artifact
is ready. Newer recommendations cancel and reject stale image results.

The SVG and PowerPoint use the AI-authored high-level component graph. Mermaid
uses an explicit short flow graph, including decision branches rather than a
forced sequence that puts abstention after a successful answer.
The AI receives the user scenario and an
advisory deterministic draft, then chooses the architecture using Sol at maximum
supported reasoning (`xhigh`). A separate AI judge evaluates the proposal only
when the user requests **AI Review (optional)**. Differences from
the deterministic draft are not a reason for code to reject it.

Code checks output format and graph references, then renders the approved graph.
It does not add, remove, or re-evaluate architecture choices when generating a
diagram. During generation the original page layout shows a readable preliminary
draft and live generation progress. It remains labelled non-final until the AI
recommendation arrives. Tabs, scrolling and text selection are never page-blocked.
Text is available before the
background architecture finishes; full PowerPoint export becomes available with
the visual artifact, without waiting for review. Optional review shows its
own progress, then attaches its findings without replacing the architecture.
The user may choose **Apply review feedback** to generate a new revision.
An initial generation error removes the preliminary preview rather than
substituting it as a final result. Failed refinement/review preserves the prior
AI-generated result.

The architect and reviewer use strict structured outputs, generated from the
same report schema used for validation. This avoids full regeneration merely
because a model misspelled a layer name or omitted a JSON field. Graph references,
size limits are still checked. Independent architectural review is a separate
opt-in operation, not a generation gate. The diagram
schema explicitly supports security/governance nodes, as well as identity,
operations and network dependencies.

The high-level view follows [Microsoft's architecture diagram guidance](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams):
official service icons, directional arrows, labeled relationships, explicit
logical boundaries, and a line-style legend. The reference layout stacks equal-width
horizontal layers top to bottom, with a consistent label column and aligned
service rows. Identity/access is part of the same framework, not a floating box
or a tall empty rail. It does not invent a VNet, subnet, or private endpoint to make
an illustration look more technical.

## The repeatable template

| Layer | Question it answers |
| --- | --- |
| Experience | Where does the user enter through the selected channel or gateway? |
| Identity & access | Which explicit identity, governance or other cross-cutting services are involved? |
| Application & orchestration | Which application, agent or API owns the interaction? |
| AI & grounding | Which model and retrieval services support that application? |
| Data & preparation | Where are authoritative sources and background content preparation? |

Identity, security, readiness, operations, and deployment posture are recorded
separately. Source permissions remain independent: for example, semantic-model
RLS must not be assumed to apply to a separate Lakehouse query.

**Selected** means part of the proposed design, not deployed or verified.
**Microsoft-managed** identifies a managed capability.
**Needs confirmation** marks an unresolved role, access path, or implementation
decision. Confirmation paths must not be treated as already enabled access.

Use **Diagram detail** to switch between high-level integration, entry/orchestration,
models, data access, and background preparation. Zoom controls help inspect the
diagram. Integration arrows carry nearby relationship labels. The Mermaid flow
includes explicit decisions and alternative terminal outcomes, not an inferred
linear sequence through every service. The generator targets 5-8 core diagram
nodes (maximum 12), up to 18 integrations and at most eight flow nodes.
Supporting inventory services
can remain unpictured; their sizing and controls stay in the Technical view.

## Presentation structure

The deck is capped at **15 slides**. It contains the architecture decision,
connected overview and focused diagrams, an editable service inventory with
**Dev / Test / Prod** sizing, and concise security/review conditions.
There is no long appendix or presenter commentary.

Sizing comes from the accepted AI report and is explicitly a proposed starting
configuration. A user count alone is not a capacity plan. Validate request rates,
token usage, corpus/index size, availability, quota, region and service limits.
Microsoft SaaS and external dependencies are identified separately from Azure resources.
Full narrative, assumptions, and supporting references remain on the page.
The cover also states whether independent AI review was completed or found
unresolved issues; unreviewed output is never labelled review-approved.

## Result and review contract

Contract version 5 separates the text recommendation, visual artifact and review
scope. Text responses contain `architecture: null` and a stable `reportId`.
The background artifact carries the same `reportId`, its own `id`, `graph`, `flow`,
rendered `svg` and `mermaid`. Its service references must belong to the recommendation.
`generation` identifies the configured model and actual API reasoning effort.
`review.status` is `not-requested`, `passed`, or `issues-found`; `aiValidated` is
true only for `passed`. `review.scope` distinguishes the recommendation alone
from the recommendation plus a specific architecture artifact. Review findings
do not invalidate the generated recommendation. Concurrent review and image
completion preserve each other's results.

`POST /api/tiebreak` defaults to `operation: "generate"`. An explicit
`operation: "architecture"` requires the current report and returns it with a visual
artifact, without changing its narrative/services. `operation: "review"` returns
review metadata for the supplied snapshot. Neither operation reruns the deterministic
engine. New generation/refinement resets review and visual state.
Older saved report formats must be regenerated rather than relabelled reviewed.

Every slide includes the Microsoft logo and:

> Suggested architecture — requires review and validation before implementation.

The logo does not mean Microsoft has reviewed or approved the generated design.
Architecture, security, data owners, and delivery teams must validate the
proposal before implementation.

## Reproducing a sample

Use **Export as PowerPoint** on the recommendation page. It renders the current
accepted report and profile. The generated document is local output, not source
code; do not add it, screenshots, PDFs, or test artifacts to the public repository.

The model and presentation checks can be run without model calls:

```powershell
node --import tsx scripts\qa\presentation-design-check.ts
npm run test:diagram-layout
```
