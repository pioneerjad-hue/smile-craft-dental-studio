import { useRef, useState } from 'react';
import type { Arch } from '../../core/fdi';
import { parseExportName } from '../../core/reference';
import { readM3d } from '../../geometry/m3d';
import { exportSeriesViewer } from '../../engine/exporter';
import { saveLab, setState, toast, useStudio } from '../../engine/store';
import { Check } from '../common';

interface Item {
  file: File;
  arch: Arch | null;
  stage: number | null;
}

const show = (s: number | null) => (s === null ? '' : s === Number.POSITIVE_INFINITY ? 'final' : String(s));

/**
 * Doctor viewer straight from a folder of stage models exported by other software (e.g. Maestro):
 * no segmentation or planning — pick the folder, check arch/stage, create the viewer.
 */
export function SeriesViewerPanel() {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState('');
  const [colorize, setColorize] = useState(true);
  const lab = useStudio((s) => s.lab);
  const busy = useStudio((s) => s.busy);
  const setLab = (patch: Partial<typeof lab>) => {
    const next = { ...lab, ...patch };
    setState({ lab: next });
    saveLab(next);
  };

  const choose = async (list: FileList | null) => {
    const all = Array.from(list ?? []);
    // case details from a Maestro project in the same folder (only the readable part)
    const m3d = all.find((f) => /\.m3d$/i.test(f.name));
    if (m3d) {
      const info = readM3d(await m3d.arrayBuffer(), m3d.name).info;
      const ci = useStudio.getState().caseInfo;
      setState({ caseInfo: { ...ci, patientName: ci.patientName || info.patientName || '', clinician: ci.clinician || info.doctorName || '' } });
    }
    setItems(all.filter((f) => /\.(stl|ply|obj)$/i.test(f.name)).map((file) => ({ file, ...parseExportName(file.name) })));
  };
  const ready = items.filter((i) => i.arch && i.stage !== null);
  const count = (a: Arch) => ready.filter((i) => i.arch === a).length;

  const create = async () => {
    if (!ready.length) return toast('Set upper/lower and a stage number for the files.', 'error');
    // "final" goes after the highest numbered stage of its arch
    const files = await Promise.all(
      ready.map(async (i) => ({ arch: i.arch!, stage: i.stage!, name: i.file.name, buffer: await i.file.arrayBuffer() })),
    );
    await exportSeriesViewer(files, notes, colorize);
  };

  return (
    <div className="section">
      <h3>Doctor viewer from a Maestro export</h3>
      <div className="hint small">
        In Maestro, export every stage (upper and lower) as STL into one folder — add the .m3d to the folder to fill in
        the patient and doctor. Pick the folder: each file's arch and stage are read from its name. No segmentation or
        planning needed.
      </div>
      <div className="row wrap">
        <button onClick={() => folder.current?.click()}>Choose export folder…</button>
        <button onClick={() => files.current?.click()}>Choose files…</button>
      </div>
      <input ref={files} type="file" multiple accept=".stl,.ply,.obj,.m3d" hidden onChange={(e) => (void choose(e.target.files), (e.target.value = ''))} />
      <input
        ref={(el) => {
          folder.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        hidden
        onChange={(e) => (void choose(e.target.files), (e.target.value = ''))}
      />
      {items.length > 0 && (
        <div className="card">
          <div className="small muted" style={{ marginBottom: 6 }}>
            {count('upper')} upper · {count('lower')} lower stages ready
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {items.map((it, i) => (
              <div className="row between small" key={i}>
                <span title={it.file.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                  {it.file.name}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <select value={it.arch ?? ''} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, arch: (e.target.value || null) as Arch | null } : x)))}>
                    <option value="">—</option>
                    <option value="upper">Upper</option>
                    <option value="lower">Lower</option>
                  </select>
                  <input
                    type="text"
                    style={{ width: 52 }}
                    value={show(it.stage)}
                    placeholder="stage"
                    onChange={(e) => {
                      const v = e.target.value.trim().toLowerCase();
                      const stage = v === '' ? null : v.startsWith('f') ? Number.POSITIVE_INFINITY : Number.isFinite(+v) ? Math.max(0, Math.round(+v)) : null;
                      setItems(items.map((x, j) => (j === i ? { ...x, stage } : x)));
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          <label style={{ marginTop: 6, display: 'block' }}>Notes for the doctor (IPR, attachments, instructions…)</label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. IPR 0.2 mm 12-11 before aligner 3; attachments on 13, 23" />
          {!lab.email && !lab.whatsapp && (
            <>
              <div className="field">
                <label>Lab name</label>
                <input type="text" value={lab.name} onChange={(e) => setLab({ name: e.target.value })} />
              </div>
              <div className="field">
                <label>Reply email</label>
                <input type="text" value={lab.email} onChange={(e) => setLab({ email: e.target.value })} />
              </div>
              <div className="field">
                <label>WhatsApp</label>
                <input type="text" value={lab.whatsapp} onChange={(e) => setLab({ whatsapp: e.target.value })} />
              </div>
            </>
          )}
          <Check checked={colorize} onChange={setColorize}>
            Colour teeth and gum automatically
          </Check>
          <button className="primary" disabled={!!busy || !ready.length} onClick={() => void create()}>
            Create doctor viewer
          </button>
        </div>
      )}
    </div>
  );
}
