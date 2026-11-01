import { useEffect, useRef, useState } from 'react';
import type { Arch } from '../../core/fdi';
import { SCAN_EXTENSIONS, extensionOf, writeBinaryStl } from '../../geometry/io';
import { readM3d } from '../../geometry/m3d';
import type { FoundMesh } from '../../geometry/m3d';
import { loadProjectZip, readAutosave } from '../../engine/project';
import { setState, toast, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { goToStep } from '../App';

function guessArch(name: string): Arch | null {
  const n = name.toLowerCase();
  if (/(upper|maxill|_u[._-]|^u[._-]|oben|sup)/.test(n)) return 'upper';
  if (/(lower|mandib|_l[._-]|^l[._-]|unten|inf)/.test(n)) return 'lower';
  return null;
}

function loadMesh(arch: Arch, mesh: FoundMesh, fileName: string) {
  const g = mesh.geometry;
  const stl = writeBinaryStl([{ positions: g.getAttribute('position').array, index: g.index ? g.index.array : undefined }]);
  studio.loadScanBuffer(arch, stl.buffer as ArrayBuffer, `${fileName.replace(/\.m3d$/i, '')}-${arch}.stl`);
}

/** Open a Maestro 3D .m3d project: auto-assign arches when the names say so, otherwise let the user pick. */
function M3dImport() {
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ file: string; meshes: FoundMesh[]; diagnostics: string } | null>(null);
  const open = async (file: File) => {
    setState({ busy: `Reading ${file.name}…` });
    await new Promise((r) => setTimeout(r, 0));
    try {
      const r = readM3d(await file.arrayBuffer(), file.name);
      if (!r.meshes.length) {
        setFound({ file: file.name, meshes: [], diagnostics: r.diagnostics });
        toast('No 3D models recognised in this .m3d file yet — see the fingerprint below.', 'error');
        return;
      }
      const upper = r.meshes.filter((m) => m.hint === 'upper');
      const lower = r.meshes.filter((m) => m.hint === 'lower');
      if (upper.length === 1 && lower.length === 1) {
        loadMesh('upper', upper[0], file.name);
        loadMesh('lower', lower[0], file.name);
        setFound(null);
        toast(`Loaded upper and lower models from ${file.name}.`, 'success');
      } else setFound({ file: file.name, meshes: r.meshes, diagnostics: r.diagnostics });
    } finally {
      setState({ busy: null });
    }
  };
  return (
    <div className="section">
      <h3>Maestro 3D project (.m3d)</h3>
      <button onClick={() => input.current?.click()}>Open .m3d file…</button>
      <input
        ref={input}
        type="file"
        accept=".m3d"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void open(f);
          e.target.value = '';
        }}
      />
      {found && found.meshes.length > 0 && (
        <div className="card">
          <div className="small" style={{ marginBottom: 6 }}>
            {found.meshes.length} model(s) found in {found.file}. Assign them:
          </div>
          {found.meshes.slice(0, 8).map((m, i) => (
            <div className="row between small" key={i}>
              <span title={m.name}>
                {m.name.slice(-28)} · {(m.triangles / 1000).toFixed(0)}k tris
              </span>
              <span className="row">
                <button onClick={() => loadMesh('upper', m, found.file)}>Upper</button>
                <button onClick={() => loadMesh('lower', m, found.file)}>Lower</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {found && found.meshes.length === 0 && (
        <div className="card small">
          <b>Not recognised yet.</b> Please send this .m3d file (or this fingerprint) so support for its exact
          structure can be added:
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 10.5, margin: '6px 0' }}>{found.diagnostics}</pre>
          <button onClick={() => void navigator.clipboard?.writeText(found.diagnostics)}>Copy fingerprint</button>
        </div>
      )}
      <div className="hint small">
        Reads the models stored inside the Maestro project. Until it is verified on your files, exporting STL from
        Maestro (File → Export) always works.
      </div>
    </div>
  );
}

function ScanDrop({ arch }: { arch: Arch }) {
  const info = useStudio((s) => s.arches[arch]);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const load = async (file: File) => {
    if (!SCAN_EXTENSIONS.includes(extensionOf(file.name))) return toast(`Unsupported file ${file.name}`, 'error');
    setState({ busy: `Loading ${file.name}…` });
    await new Promise((r) => setTimeout(r, 0));
    await studio.loadScanFile(arch, file);
  };
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${info ? 'loaded' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void load(f);
      }}
    >
      <b>{arch === 'upper' ? 'Upper (maxillary)' : 'Lower (mandibular)'}</b>
      <div className="small muted" style={{ marginTop: 4 }}>
        {info ? (
          <>
            {info.fileName} · {(info.faces / 1000).toFixed(0)}k triangles{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                studio.removeArch(arch);
              }}
            >
              remove
            </a>
          </>
        ) : (
          'Drop STL / PLY / OBJ or click to browse'
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept=".stl,.ply,.obj"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function ImportPanel() {
  const caseInfo = useStudio((s) => s.caseInfo);
  const arches = useStudio((s) => s.arches);
  const teeth = useStudio((s) => s.teeth);
  const [autosave, setAutosave] = useState<{ zip: Uint8Array; savedAt: string; label: string } | null>(null);
  useEffect(() => {
    void readAutosave().then(setAutosave);
  }, []);
  const set = (patch: Partial<typeof caseInfo>) => setState({ caseInfo: { ...caseInfo, ...patch } });
  const hasScan = !!(arches.upper || arches.lower);

  const dropBoth = async (files: FileList) => {
    for (const f of Array.from(files)) {
      const arch = guessArch(f.name) ?? (arches.upper ? 'lower' : 'upper');
      setState({ busy: `Loading ${f.name}…` });
      await new Promise((r) => setTimeout(r, 0));
      await studio.loadScanFile(arch, f);
    }
  };

  return (
    <>
      <div className="section">
        <h3>Patient & case</h3>
        <div className="field">
          <label>Patient</label>
          <input type="text" value={caseInfo.patientName} onChange={(e) => set({ patientName: e.target.value })} placeholder="Name" />
        </div>
        <div className="field">
          <label>Case ID</label>
          <input type="text" value={caseInfo.caseId} onChange={(e) => set({ caseId: e.target.value })} placeholder="e.g. SC-2026-0142" />
        </div>
        <div className="field">
          <label>Clinician</label>
          <input type="text" value={caseInfo.clinician} onChange={(e) => set({ clinician: e.target.value })} placeholder="Dr." />
        </div>
        <label>Chief complaint / notes</label>
        <textarea rows={3} value={caseInfo.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Crowding, midline, goals…" />
      </div>

      <div className="section" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
        if ((e.target as HTMLElement).closest('.drop')) return;
        e.preventDefault();
        void dropBoth(e.dataTransfer.files);
      }}>
        <h3>Intraoral scans</h3>
        <ScanDrop arch="upper" />
        <ScanDrop arch="lower" />
        <div className="hint">
          Export from iTero, 3Shape TRIOS, Medit, Primescan… in mm. Keep both arches in the same (occlusion) coordinate
          system so the bite is preserved.
        </div>
      </div>

      <M3dImport />

      <div className="section">
        <h3>Try it</h3>
        <div className="row wrap">
          <button onClick={() => { studio.resetCase(); studio.loadDemo(true); goToStep('plan'); }}>Demo case (segmented)</button>
          <button onClick={() => { studio.resetCase(); studio.loadDemo(false); goToStep('segment'); }}>Demo – segment yourself</button>
        </div>
        {autosave && (
          <button
            onClick={() => {
              try {
                loadProjectZip(autosave.zip);
                toast('Previous session restored.', 'success');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            Restore last session: {autosave.label} ({new Date(autosave.savedAt).toLocaleString()})
          </button>
        )}
      </div>

      <div className="grow" />
      <button className="primary" disabled={!hasScan} onClick={() => goToStep(teeth.length ? 'plan' : 'orient')}>
        {teeth.length ? 'Continue to planning →' : 'Continue: orient the models →'}
      </button>
    </>
  );
}
