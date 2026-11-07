import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { RECORD_SLOTS } from '../model';
import type { PortalCase, RecordFile, RecordSlotDef } from '../model';
import { downloadBlob, getBlob } from '../blobs';
import { usePortal } from '../store';
import { recordsCheck } from '../workflow';
import { Modal, fmtDateTime, fmtSize, useBlobUrl } from './common';

const SILHOUETTE: Record<string, string> = {
  face_profile: '◐',
  face_front: '◯',
  face_smile: '☺',
  io_upper: '⌒',
  io_lower: '⌣',
  io_right: '◖',
  io_front: '▭',
  io_left: '◗',
  xr_pano: '▬',
  xr_ceph: '◩',
  scan_upper: '⬡',
  scan_lower: '⬡',
};

function Slot({ def, rec, editable, caseId, onOpen }: { def: RecordSlotDef; rec?: RecordFile; editable: boolean; caseId: string; onOpen: (r: RecordFile) => void }) {
  const addRecord = usePortal((s) => s.addRecord);
  const removeRecord = usePortal((s) => s.removeRecord);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = useBlobUrl(rec);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    await addRecord(caseId, def.slot, f);
    setBusy(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (editable) void upload(e.dataTransfer.files[0]);
  };
  return (
    <div
      className={`slot kind-${def.kind}${rec ? ' filled' : ''}${drag ? ' drag' : ''}`}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="slot-face"
        onClick={() => (rec ? onOpen(rec) : editable && input.current?.click())}
        disabled={!rec && !editable}
        aria-label={rec ? `View ${def.label}` : `Upload ${def.label}`}
      >
        {url ? <img src={url} alt={def.label} /> : <span className="slot-sil" aria-hidden="true">{SILHOUETTE[def.slot] ?? '▢'}</span>}
        {busy && <span className="slot-busy">Uploading…</span>}
        {!rec && editable && !busy && <span className="slot-add">+ Add</span>}
        {rec && !url && <span className="slot-file">{rec.name}</span>}
      </button>
      <div className="slot-meta">
        <span>
          {def.label}
          {def.required && !rec && <span className="req" title="Required"> *</span>}
        </span>
        {rec && editable && (
          <span className="slot-actions">
            <button type="button" className="link small" onClick={() => input.current?.click()}>
              Replace
            </button>
            <button type="button" className="link small danger" onClick={() => void removeRecord(caseId, rec.id)}>
              Remove
            </button>
          </span>
        )}
      </div>
      <input ref={input} type="file" accept={def.accept} hidden onChange={(e) => (void upload(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}

function Viewer({ rec, onClose }: { rec: RecordFile; onClose: () => void }) {
  const url = useBlobUrl(rec);
  const def = RECORD_SLOTS.find((s) => s.slot === rec.slot);
  const download = async () => {
    const b = await getBlob(rec.id).catch(() => undefined);
    if (b) downloadBlob(b, rec.name);
    else usePortal.getState().notify('This demo record has no file attached.', 'info');
  };
  return (
    <Modal title={def?.label ?? rec.name} onClose={onClose} wide>
      <div className="viewer">
        {url ? (
          <img src={url} alt={def?.label ?? rec.name} />
        ) : (
          <div className="viewer-file">
            <span aria-hidden="true">{rec.kind === 'scan' ? '⬡' : '📄'}</span>
            <strong>{rec.name}</strong>
            <span className="muted">{rec.kind === 'scan' ? 'Intraoral scan – open it in the 3D studio.' : 'Preview not available.'}</span>
          </div>
        )}
        <div className="row between wrap">
          <span className="small muted">
            {rec.name} · {fmtSize(rec.size)} · uploaded {fmtDateTime(rec.uploadedAt)} by {rec.uploadedBy === 'doctor' ? 'doctor' : 'Smile Craft'}
          </span>
          <button onClick={() => void download()}>Download</button>
        </div>
      </div>
    </Modal>
  );
}

export function RecordsGrid({ c, editable }: { c: PortalCase; editable: boolean }) {
  const [open, setOpen] = useState<RecordFile | null>(null);
  const check = recordsCheck(c);
  const bySlot = new Map(c.records.map((r) => [r.slot, r]));
  const groups: [string, RecordSlotDef[]][] = [
    ['Photos', RECORD_SLOTS.filter((s) => s.kind === 'photo')],
    ['Radiographs', RECORD_SLOTS.filter((s) => s.kind === 'xray')],
    [
      'Intraoral scans',
      RECORD_SLOTS.filter((s) => s.kind === 'scan' && !(s.slot === 'scan_upper' && c.rx.arches === 'lower') && !(s.slot === 'scan_lower' && c.rx.arches === 'upper')),
    ],
  ];
  const extras = c.records.filter((r) => !RECORD_SLOTS.some((s) => s.slot === r.slot));
  return (
    <div className="stack">
      <div className={`notice ${check.complete ? 'good' : 'warn'}`}>
        {check.complete ? '✓ Record set complete.' : `Missing: ${check.missing.join(', ')}`}
        <span className="muted small"> · {check.photos}/{check.photosTotal} photos</span>
      </div>
      {groups.map(([title, slots]) => (
        <div key={title}>
          <h3>{title}</h3>
          <div className={`slots ${title === 'Photos' ? 'photos' : ''}`}>
            {slots.map((def) => (
              <Slot key={def.slot} def={def} rec={bySlot.get(def.slot)} editable={editable} caseId={c.id} onOpen={setOpen} />
            ))}
          </div>
        </div>
      ))}
      {extras.length > 0 && (
        <div>
          <h3>Other files</h3>
          <ul className="simple">
            {extras.map((r) => (
              <li key={r.id}>
                <button className="link" onClick={() => setOpen(r)}>
                  {r.name}
                </button>{' '}
                <span className="small muted">
                  {fmtSize(r.size)} · {fmtDateTime(r.uploadedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editable && <p className="small muted">Drag files onto a slot or click to upload. Photos are resized automatically. Scans: STL, PLY or OBJ from any intraoral scanner.</p>}
      {open && <Viewer rec={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
