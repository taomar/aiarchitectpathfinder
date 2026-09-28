# Architecture views and PowerPoint

The recommendation page, SVG and PowerPoint use the AI-authored high-level
component integration graph. Mermaid draws a separate short journey authored
by the same AI, rather than repeating the full integration/control map.
The AI receives the user scenario and an
advisory deterministic draft, then chooses the architecture using Sol at maximum
supported reasoning (`xhigh`). A separate AI judge evaluates the proposal only
when the user requests **AI Review (optional)**. Differences from
the deterministic draft are not a reason for code to reject it.

Code checks output format and graph references, then renders the approved graph.
It does not add, remove, or re-evaluate architecture choices when generating a
diagram. During generation the original page layout shows a dimmed, inert
preliminary draft and live generation progress. After generation, the architecture
and exports are available without waiting for review. Optional review shows its
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
horizontal workload layers top to bottom. Identity/governance sits in a separate
cross-cutting rail. It does not invent a VNet, subnet, or private endpoint to make
an illustration look more technical.

## The repeatable template

| Layer | Question it answers |
| --- | --- |
| Channels | Where does the user start? |
| Edge & API policies | What governs the approved entry point? |
| Experience & runtime | Who owns the interaction and execution? |
| Models | What provides inference, and which platform hosts it? |
| Grounding & retrieval | How is authorized context obtained? |
| Governed interfaces | How are operational sources accessed safely? |
| Source systems | Where does authoritative data live? |
| Background preparation | What happens before interactive queries? |

Identity, security, readiness, operations, and deployment posture are recorded
separately. Source permissions remain independent: for example, semantic-model
RLS must not be assumed to apply to a separate Lakehouse query.

**Selected** means part of the proposed design, not deployed or verified.
**Microsoft-managed** identifies a managed capability.
**Needs confirmation** marks an unresolved role, access path, or implementation
decision. Confirmation paths must not be treated as already enabled access.

Use **Diagram detail** to switch between high-level integration, entry/orchestration,
models, data access, and background preparation. Zoom controls help inspect the
diagram. Integration arrows carry inline relationship labels. Mermaid's numbered
steps are the main user journey, not an inferred sequence through every service.
The generator targets 6-9 core diagram nodes (maximum 12), up to 18 integration
relationships and at most eight short flow steps. Supporting inventory services
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

Contract version 4 separates generation provenance from review state and includes
an explicit AI-authored `highLevelFlow`.
`generation` identifies the configured model and actual API reasoning effort.
`review.status` is `not-requested`, `passed`, or `issues-found`; `aiValidated` is
true only for `passed`. Review findings do not invalidate the generated artifact.

`POST /api/tiebreak` defaults to `operation: "generate"`. An explicit
`operation: "review"` requires the current report in `previousRecommendation`
and returns that same architecture with review metadata. It does not rerun the
deterministic engine or architect. New generation/refinement resets review state.
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
