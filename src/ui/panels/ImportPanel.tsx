import { useEffect, useRef, useState } from 'react';
import type { Arch } from '../../core/fdi';
import { SCAN_EXTENSIONS, extensionOf } from '../../geometry/io';
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
