import { useRef, useState } from 'react';
import type { Arch } from '../../core/fdi';
import { compareToReference, parseExportName } from '../../core/reference';
import { setState, toast, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';

interface Picked {
  file: File;
  arch: Arch | null;
  stage: number | null;
}

const stageLabel = (s: number | null) => (s === null ? '?' : s === Number.POSITIVE_INFINITY ? 'final' : s === 0 ? 'initial' : `stage ${s}`);

/**
 * Import a finished setup from other software (e.g. STL exported from Maestro) to use as the plan or
 * as a reference to compare against — the benchmark for AI-proposed plans.
 */
export function ReferencePanel() {
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const reference = useStudio((s) => s.plan.reference);
  const frames = useStudio((s) => s.frames);
  const teethPlan = useStudio((s) => s.plan.teeth);
  const [showAll, setShowAll] = useState(false);

  const choose = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /\.(stl|ply|obj)$/i.test(f.name));
    setPicked(files.map((file) => ({ file, ...parseExportName(file.name) })));
  };
  // final model per arch = highest stage among the picked files of that arch
  const finals = (['upper', 'lower'] as Arch[])
    .map((arch) => picked.filter((p) => p.arch === arch).sort((a, b) => (b.stage ?? -1) - (a.stage ?? -1))[0])
    .filter(Boolean) as Picked[];

  const run = async (apply: boolean) => {
    if (!finals.length) return toast('Assign at least one file to the upper or lower arch.', 'error');
    try {
      const r = await studio.importReferenceSetup(
        await Promise.all(finals.map(async (p) => ({ arch: p.arch!, name: p.file.name, buffer: await p.file.arrayBuffer() }))),
        apply,
      );
      toast(
        r.poor.length
          ? `Fitted ${r.teeth} teeth. Check ${r.poor.join(', ')}: poor fit (different coordinates or segmentation?).`
          : `Fitted ${r.teeth} teeth${apply ? ' and applied the setup as your plan (Ctrl+Z to undo).' : ' — saved as reference.'}`,
        r.poor.length ? 'error' : 'success',
      );
      setPicked([]);
    } catch (e) {
      setState({ busy: null });
      toast(`Import failed: ${(e as Error).message}`, 'error');
    }
  };

  const mine = Object.fromEntries(Object.entries(teethPlan).map(([k, t]) => [k, t.movement]));
  const cmp = reference ? compareToReference(frames, mine, reference.movements) : null;

  return (
    <div className="section">
      <h3>Reference setup (Maestro / other software)</h3>
      <div className="hint small">
        Export the case from the other software as STL — the initial models (load them as your scans and segment
        them) and the final setup. Pick the final files here: each tooth is fitted onto them and converted into
        movements. Use it as your plan, or keep it as a reference to compare your plan (or the AI's) against.
      </div>
      <div className="row wrap">
        <button onClick={() => input.current?.click()}>Choose files…</button>
        <button onClick={() => folder.current?.click()}>Choose export folder…</button>
      </div>
      <input ref={input} type="file" multiple accept=".stl,.ply,.obj" hidden onChange={(e) => (choose(e.target.files), (e.target.value = ''))} />
      <input
        ref={(el) => {
          folder.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        hidden
        onChange={(e) => (choose(e.target.files), (e.target.value = ''))}
      />
      {picked.length > 0 && (
        <div className="card">
          {picked.slice(0, 40).map((p, i) => (
            <div className="row between small" key={i}>
              <span title={p.file.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                {p.file.name}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <select
                  value={p.arch ?? ''}
                  onChange={(e) => setPicked(picked.map((q, j) => (j === i ? { ...q, arch: (e.target.value || null) as Arch | null } : q)))}
                >
                  <option value="">—</option>
                  <option value="upper">Upper</option>
                  <option value="lower">Lower</option>
                </select>
                <span className="muted">{stageLabel(p.stage)}</span>
              </span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 6 }}>
            Will use as final: {finals.map((f) => `${f.arch} ← ${f.file.name}`).join(' · ') || 'none'}
          </div>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <button onClick={() => run(false)}>Compare with my plan</button>
            <button className="primary" onClick={() => confirm('Replace the movements of your plan with this setup? (Ctrl+Z undoes it)') && run(true)}>
              Use as my plan
            </button>
          </div>
        </div>
      )}
      {reference && cmp && (
        <div className="card">
          <div className="row between">
            <b>My plan vs reference</b>
            <button className="icon" title="Remove reference" onClick={() => studio.clearReference()}>
              ✕
            </button>
          </div>
          <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={reference.label}>
            {reference.label}
          </div>
          <div className="stat" style={{ marginTop: 6 }}>
            <div>
              <b>{cmp.meanCrownMm.toFixed(2)}</b>
              <span>mean mm</span>
            </div>
            <div>
              <b>{cmp.meanAngleDeg.toFixed(1)}°</b>
              <span>mean angle</span>
            </div>
            <div>
              <b>{cmp.maxCrownMm.toFixed(2)}</b>
              <span>worst mm</span>
            </div>
          </div>
          <table className="grid" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Tooth</th>
                <th>Δ mm</th>
                <th>Δ °</th>
                <th title="Reference fit RMS">fit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(showAll ? cmp.teeth : cmp.teeth.slice(0, 6)).map((t) => (
                <tr key={t.id} className="click" onClick={() => setState({ selectedTooth: t.id })}>
                  <td>{t.id}</td>
                  <td className={t.crownMm > 0.5 ? 'neg' : ''}>{t.crownMm.toFixed(2)}</td>
                  <td className={t.angleDeg > 3 ? 'neg' : ''}>{t.angleDeg.toFixed(1)}</td>
                  <td className="muted">{reference.fits[t.id]?.rmsMm.toFixed(2)}</td>
                  <td>
                    <button
                      className="icon"
                      title="Copy the reference movement to my plan for this tooth"
                      onClick={(e) => {
                        e.stopPropagation();
                        studio.setMovement(t.id, reference.movements[t.id]);
                      }}
                    >
                      ←
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cmp.teeth.length > 6 && (
            <button className="icon" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${cmp.teeth.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
