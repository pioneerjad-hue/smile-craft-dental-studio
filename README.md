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
| **6 · Export** | Pick stages, enable the model builder, render the video | Zip of binary STLs per arch per stage (+ attachment template), manifest CSV, plan JSON, printable report, MP4 simulation |

**Layers** (☰ in the viewer): per arch gingiva / teeth / model base with visibility, colour and opacity, plus
attachments, initial-position overlay and tooth axes. Translucent gum shows margins and contacts.

**Constraints**: 🔒 locks a single movement axis of a tooth (held at 0), *Fixed / anchor tooth* holds a tooth
completely, and the protocol option *Enforce total limits as hard constraints* clamps values instead of only
warning. Constraints apply to manual edits and to imported AI plans.

**Model builder**: extrudes the scan border to a flat base parallel to the occlusal plane and caps it (plus fills
any scan holes), so each stage exports as one closed, consistently wound solid. A watertight check is shown.

**Simulation video**: H.264 MP4 (Full HD, HD, square or vertical), one animated segment per chosen view with
case name, view and aligner counter. Needs a current Chrome, Edge or Safari (WebCodecs).

Keyboard: `1`–`5` views · `[` `]` stage · `Space` play · `G` initial-position overlay · `M` measure ·
`S`/`B`/`E` segmentation tools · `Ctrl+Z`/`Ctrl+Y` undo/redo · `Ctrl+S` save project.

Try it without patient data: **Demo case (segmented)** or **Demo – segment yourself** on the first screen.

## Doctor portal (`portal.html`)

A web portal for the dentists who send cases to Smile Craft, modelled on what doctors rely on in the
leading aligner portals (Invisalign Doctor Site + ClinCheck, Spark DTX Portal + Approver, ClearCorrect
Doctor Portal + ClearPilot, Angel iOrtho):

| Area | What the doctor gets |
| --- | --- |
| **Dashboard** | "Needs your attention" queue (plans to review, record requests, deliveries, unread messages), KPIs, patients in treatment with aligner progress, shipments in transit, activity feed |
| **New case** | 4-step wizard: patient & product (Comprehensive / Moderate / Lite / Express) → one-page clinical Rx (A-P, overjet, overbite, midline, crossbite, expansion / proclination / IPR, attachments, tooth chart for *do not move* / *no attachments* / *extract*) → records (8 photos, pano, ceph, upper/lower STL; drag & drop) → review & submit. Pre-filled from saved clinical preferences; drafts auto-save |
| **Case page** | Status pipeline (Submitted → Planning → Your review → Manufacturing → Shipped → In treatment → Retention), timeline, Rx, records gallery, per-case messaging, shipments and invoices, refinements, retainers, cancel |
| **Plan review** | Versioned plans; occlusal arch chart coloured by movement with attachments and IPR; click a tooth for its 6-DOF movement and to leave a tooth comment; movement table; IPR schedule; automatic checks against protocol limits, the doctor's Rx (e.g. "do not move" teeth that move) and the product's aligner limit; approve (with confirmation) or request modification |
| **Billing** | Invoices (case fee on first approval, retainers on order), outstanding balance, fee schedule |
| **Preferences** | Clinical preferences (attachments, IPR limits and timing, wear schedule, expansion, passive aligners, overcorrection, retention, free-text rules) – also downloadable as a studio `*.protocol.json`; account and shipping address |

The **Smile Craft team** side (switch with *Demo view* in the sidebar, or sign in as Smile Craft) accepts
records or asks for new ones, uploads the plan exported from the studio (*Export → Plan summary (JSON)*,
optionally with the `.smile` project), sends to manufacturing and ships with tracking. Open the portal in two
tabs (doctor + Smile Craft) to play both sides – tabs stay in sync.

Demo mode keeps all data in the browser (case data in localStorage, files in IndexedDB) with fictional
sample cases; *Preferences → Restore demo data* resets it. Prices in `src/portal/model.ts` are placeholders.
Before real patients: put `src/portal/store.ts` behind an authenticated backend (it is the only data
access layer), add real sign-in, storage and payments, and review data-protection requirements.

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
npm run dev      # studio: http://localhost:5173 · portal: http://localhost:5173/portal.html
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
src/portal/     doctor portal: model, workflow rules, store (data access), seed data, ui/
tests/          vitest suites
```

## Current limits

- Crown-only planning (no roots/CBCT); the centre of rotation is an estimate set in the protocol.
- No text engraving on printed models yet; models are exported in scan orientation.
- Attachments are separate shells (not boolean-merged); most slicers merge them automatically.
- Occlusal contacts between arches are not yet measured (interproximal contacts are).
