# Smile Craft Dental Studio

Clear-aligner treatment planning in the browser: import intraoral scans, segment teeth, plan
6-DOF tooth movements, stage them against **your protocol**, check contacts / IPR / attachments, and
export print-ready STL models for every aligner stage.

Everything runs locally in the browser — scans never leave the computer.

## Workflow

| Step | What you do | What the studio does |
| --- | --- | --- |
| **1 · Case & scans** | Enter patient/case ID, drop upper & lower STL/PLY/OBJ (from iTero, TRIOS, Medit, Primescan…) | Merges the mesh, keeps the bite (both arches in scan coordinates) |
| **2 · Segment** | Click each crown once (auto-advances 17→27, 47→37). Brush to fix | Competitive watershed: teeth and gum flood the surface and meet at the gingival margin and contacts. Fissures stay inside the crown. Brush strokes are hard constraints |
| **3 · Plan** | Select a tooth, type or step its movement | Live 3D preview, per-movement stage cost, crown displacement, protocol warnings |
| **4 · Stage & check** | Choose staging mode, measure contacts, apply suggested IPR | Stage count from protocol limits, tooth timeline, contact overlap/gap per contact, IPR suggestions |
| **5 · Protocol & AI** | Edit/save your protocol, export the AI planning brief, import an AI plan | Same rules drive manual planning, validation and the AI |
| **6 · Export** | Pick stages | Zip of binary STLs per arch per stage (+ attachment template), manifest CSV, plan JSON, printable report |

Keyboard: `1`–`5` views · `[` `]` stage · `Space` play · `G` initial-position overlay · `M` measure ·
`S`/`B`/`E` segmentation tools · `Ctrl+Z`/`Ctrl+Y` undo/redo · `Ctrl+S` save project.

Try it without patient data: **Demo case (segmented)** or **Demo – segment yourself** on the first screen.

## How the numbers are computed (accuracy)

All units are millimetres and degrees in the original scan coordinates — nothing is rescaled.

- **Tooth frame** – crown centroid is area-weighted. *Occlusal* axis = occlusal-plane normal fitted to
  the crown centroids; *mesial* axis = arch tangent through neighbouring crowns, pointing to the
  midline; *buccal* axis is perpendicular in the occlusal plane, pointing out of the arch.
- **Movements** – total movement per tooth in that frame. Signs are the same in every quadrant:
  `+mesial`, `+buccal`, `+extrusion`, `+tip` = crown mesial, `+torque` = crown buccal,
  `+rotation` = mesial-in. Rotations are about the estimated centre of rotation
  (crown centre shifted apically by the protocol's per-tooth-type distance).
- **Staging** – a tooth needs `max(|movement| / per-aligner limit)` stages over all six DOF, then
  more if any sampled crown point would move more than the *crown step* limit between consecutive
  aligners (exact check with the real rotation pivot). *Synchronized* mode spreads every tooth over the
  arch's full stage count; *max rate* stops each tooth when done. Arches can be synced (passive aligners).
- **Contacts / IPR** – crowns are projected along the contact direction; in each 0.5 mm column the
  gap is "neighbour's surface − this crown's leading surface" at contact height (35–95 % of crown
  height). Negative = overlap. IPR suggestion = overlap rounded up to the protocol step, capped per
  contact, scheduled before the first colliding stage.
- **Widths** – mesio-distal width along the mesial axis at contact height. For rotated teeth use the
  📏 button in the tooth inspector to measure contact-to-contact; measured widths override auto values.
- **Bolton** – anterior 77.2 ± 1.65 %, overall 91.3 ± 1.91 %. **Space analysis** – arch perimeter
  through the estimated contact points, mesial of 6 to mesial of 6, minus the sum of widths.
- **Staged models** – the scan topology is never cut: tooth vertices move rigidly and the gingiva
  within *gum flexibility* mm blends with the nearest teeth. Each exported stage is as closed as the
  original scan, ready for your slicer. Attachments are added as separate shells embedded 0.3 mm in
  the enamel (slicers merge overlapping shells).

The test suite (`npm test`) checks the sign conventions, staging limits, Bolton maths, protocol
validation, segmentation and widths on the demo arches, contact gaps/overlaps after known movements,
and performance at ~450k triangles.

## AI planning according to your protocols (roadmap)

The plan, protocol and case are already structured for an AI planner:

1. **Protocol** (`*.protocol.json`): per-aligner limits, per-tooth-type overrides, total-movement
   warnings, IPR rules, attachment rules, centre-of-rotation estimates, and free-text clinical rules.
2. **Planning brief** (Protocol & AI → *Export planning brief*): every tooth's position, axes, widths,
   contacts, Bolton/space analysis, your protocol, and the exact JSON answer format.
3. **AI plan** (`smile-craft/ai-plan@1`): total movements per tooth, attachments and IPR. Importing it
   re-validates everything against the protocol; you review, edit and approve. Undo restores your plan.

Next step is wiring the brief to the Claude API so the planner runs from one button, then adding
your past approved cases as examples.

## Run it

Hosted: enable **Settings → Pages → Source: GitHub Actions** on this repository; every push to
`main` tests, builds and publishes the studio.

Locally (Node 20+):

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit + geometry tests
npm run build    # static site in dist/
```

Projects are saved as a single `.smile` file (zip with scans, segmentation, plan and protocol). The
last session is also auto-saved in the browser.

## Code map

```
src/core/       pure clinical logic (no 3D): FDI numbering, movement maths, protocol, staging,
                Bolton/space analysis, validation, AI brief/import
src/geometry/   mesh work: scan I/O, watershed segmentation, tooth frames, gum-following
                deformation, contact measurement, attachment solids, demo arches
src/engine/     app state (zustand), three.js viewer, studio orchestrator, project files, export
src/ui/         React panels for each workflow step
tests/          vitest suites
```

## Current limits

- Crown-only planning (no roots/CBCT); the centre of rotation is an estimate set in the protocol.
- No virtual base / text engraving on printed models yet; models are exported in scan orientation.
- Attachments are separate shells (not boolean-merged); most slicers merge them automatically.
- Occlusal contacts between arches are not yet measured (interproximal contacts are).
