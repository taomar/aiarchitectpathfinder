# Architecture views and PowerPoint

The recommendation page, downloaded SVG, service-flow view, and PowerPoint use
one shared architecture model. Their component names, layer assignments, and
confirmation states come from the same source.

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

## Presentation structure

The deck opens with the decision and architecture story, then presents editable
layered component views and required review gates. The appendix preserves the
complete profile, architecture narrative, components, controls, risks, conditions,
and review notes without clipping sentences.

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
```
