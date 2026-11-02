# Smile Craft Dental Studio

Clear-aligner treatment planning in the browser: import intraoral scans, segment teeth, plan
6-DOF tooth movements, stage them against **your protocol**, check contacts / IPR / attachments, and
export print-ready STL models for every aligner stage.

Everything runs locally in the browser — scans never leave the computer.

## Workflow

| Step | What you do | What the studio does |
| --- | --- | --- |
| **1 · Case & scans** | Enter patient/case ID, drop upper & lower STL/PLY/OBJ (from iTero, TRIOS, Medit, Primescan…) | Merges the mesh, keeps the bite (both arches in scan coordinates) |
| **Prepare** | *Auto-repair* (removes scan debris, fills small holes), trim each arch with a plane parallel to the occlusal plane (preview, then apply) | Exact plane cut; scans are stored back in scanner coordinates so projects reopen correctly |
| **Orient** (in Prepare) | *Auto-orient*, or click 3 landmarks (incisal point, right and left first-molar MB cusps), then fine-tune ±1°/±5° | Both arches move together (bite kept) into patient coordinates: +X right, +Y anterior, +Z up, occlusal plane on the grid |
| **2 · Segment** | Mark missing teeth, *Auto-segment*, check the numbers on the crowns; click a crown to fix its number, brush to fix edges | Auto-seeding along the fitted arch curve (valleys between crowns matched to expected widths), then competitive watershed: teeth and gum meet at the gingival margin and contacts |
| **Axes** | Check each tooth's axes; correct tip / torque / rotation of the axis; adjust root length | Long axis from crown cross-sections (35–90 % height), mesial along the arch, buccal outward. Template roots (1–3 roots by tooth type) from protocol root lengths; centre of resistance at 40 % of root length |
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

**Staging layers**: teeth in layer 2 start when layer 1 has finished (presets: sequential distalization,
anterior first, all together). The full staging table (every tooth, every stage) exports as CSV.

**Extractions and pontics**: a planned extraction becomes a flat gum patch from aligner 1; a pontic fills
a missing tooth with the mirrored contralateral crown and follows its neighbours.

**Production extras**: the case and stage are engraved into each model's base (e.g. `SC-0142 U07`,
watertight), and scalloped aligner trim lines are generated for every stage at a chosen offset from the
teeth and exported as `.pts` point files for CNC/laser trimmers.

**Reference setups** (Plan step → *Reference setup*): load the final-setup STL exported from other
software (e.g. Maestro) — files or a whole export folder; upper/lower and stage numbers are read from
the file names. Every segmented crown is fitted onto it (coarse search + trimmed ICP) and converted to
the tooth's 6-axis movement. *Use as my plan* applies it; *Compare with my plan* keeps it as a reference
and shows, tooth by tooth, how far the plan's final crowns are from it (mm and degrees) — the benchmark
for learning from a lab's setups and for measuring AI-proposed plans. Files must share the coordinate
system of the initial scans (true for exports of the same case).

**Doctor viewer** (Export → *Doctor viewer*): one HTML file for the treating doctor — every aligner
stage in 3D (play, front/side/occlusal views, initial overlay), IPR, attachments, movement table and
occlusion, with **Approve** / **Request changes** buttons that prepare the reply to the lab by email or
WhatsApp. Opens offline in any browser, including phones (≈ 2–10 MB per case). The lab name, email and
WhatsApp number are remembered on the computer.

**Doctor viewer from a Maestro export** (Case & scans → *Doctor viewer from a Maestro export*): pick the
folder of stage models exported from Maestro (STL per stage, upper and lower; add the `.m3d` to fill in
patient and doctor). Arch and stage come from the file names, the models are oriented automatically and
teeth/gum coloured by auto-segmentation, and the same single-file viewer is produced (its 🎬 *Video* button saves a 1080p MP4 simulation: front, right, left, upper and lower views through every aligner) — no segmentation or
planning needed. Stages that share one mesh layout are stored as differences (small files, smooth
animation); otherwise each stage is kept as its own model.

**Occlusion**: overjet, overbite and midline (initial → final) in the analysis panel and report.

**3D navigator** (Plan step): drag the arrows to translate the selected tooth (red mesio-distal, green
bucco-lingual, blue extrusion-intrusion) and the rings to rotate it (cyan rotation, orange tip, violet torque),
in 0.05 mm / 0.5° steps, always in that tooth's own axes. The plan also reports root-apex movement and
warns when neighbouring roots converge.

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

## Simulation Viewer (standalone)

`SimulationViewer.html` is a separate one-file tool (build: `npm run build:viewer` →
`dist-builder/SimulationViewer.html`). Enter the patient and doctor, drop the transition models of a
case (one STL/PLY/OBJ per stage and arch, e.g. exported from Maestro; add the `.m3d` to fill in the
names), and it rebuilds the treatment simulation:

- gingiva pink, teeth white, attachments orange (attachment shells detected by size; teeth and gum split
  automatically when they are one shell)
- step navigator (Initial · 1 · 2 · … · Final), previous/next, arrow keys, play, five views, initial
  overlay, 1080p MP4 export
- patient and doctor in the header; optional Approve / Request changes when a reply email or WhatsApp
  is given
- stages that share a mesh layout are stored as compact differences (a typical case is a few MB)

The result opens in a new tab or saves as one HTML file to send to the doctor.

## Run it

**Offline on your laptop (no internet, no GitHub):** `SmileCraftStudio.html` is the whole studio in one
file. Keep it anywhere (Desktop, Documents) and double-click it to open in Chrome, Edge or Safari. Every
build on GitHub also produces it: Actions → latest run → Artifacts → *SmileCraftStudio-offline*. To build it
yourself: `npm run build:offline` → `dist-offline/SmileCraftStudio.html`.

Hosted: enable **Settings → Pages → Source: GitHub Actions** on this repository; every push to
`main` tests, builds and publishes the studio.

Locally (Node 20+):

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit + geometry tests
npm run build    # static site in dist/
```

**Maestro 3D `.m3d` projects** (Case & scans → *Open .m3d file…*): current Maestro projects are zip archives whose 3D models and setup data are **encrypted**, so they can only be opened in Maestro. The studio recognises them, fills in the case details (patient, doctor, date) and lists the segmented teeth, then asks for an STL export from Maestro. Unencrypted containers holding STL/PLY/OBJ are read directly.

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
- No text engraving on printed models yet; models are exported in scan orientation.
- Attachments are separate shells (not boolean-merged); most slicers merge them automatically.
- Occlusal contacts between arches are not yet measured (interproximal contacts are).
