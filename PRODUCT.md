# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

OBSERVED: Architecture Pathfinder turns a use-case profile into a proposed
Microsoft AI architecture, with reviewed narrative, architecture diagrams,
and downloadable presentation material.

## Users

INFERRED: Customer decision-makers and solution architects use the presentation
to understand the recommendation and discuss implementation. The current
presentation is concise and executive-first; the full technical detail remains
on the Recommendation page, not in a long slide appendix.

## Capabilities and Constraints

CONFIRMED: On the Recommendation page, AI is authoritative over the deterministic
draft. The use case and draft are given to Sol at maximum supported reasoning
(`xhigh`). Independent AI review is optional and runs only when requested.
Code validates data shape and safe rendering, not
agreement with deterministic architectural choices.

CONFIRMED: Diagrams and exports render the accepted AI graph without rerouting,
merging baseline services, or re-evaluating the architecture. AI failures remain
explicit failures; no deterministic recommendation is substituted on that page.
Model-generated reports are planning guidance, not deployment certification.

CONFIRMED: Preserve the original Recommendation page layout. During initial
generation, a dimmed and inert preliminary draft may be shown, explicitly marked
as non-final. Server events identify generation or explicitly requested review.
A structurally valid AI artifact replaces the preview without mandatory review.
Review findings remain alongside the unchanged architecture; applying them
requires a separate user action. Export review labels must reflect actual state.

OBSERVED: Environment credentials, internal deployment information, and generated
PowerPoint/PDF/Office documents do not belong in the public repository.

## Brand Commitments

CONFIRMED: Include the Microsoft logo and a suggested-architecture/review disclaimer.
PowerPoint is limited to 15 slides, without presenter commentary or a long appendix.
Include the selected Azure services and proposed Dev/Test/Prod sizing in a table.

## Product Principles

- Distinguish proposed components, required controls, and unresolved decisions.
- Preserve full source content without shrinking it into unreadable slides.
- Use one architecture model across the page and its exports.
- Do not imply Microsoft approval or completed deployment validation.
