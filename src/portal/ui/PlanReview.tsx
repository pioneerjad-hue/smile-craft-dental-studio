import { useEffect, useState } from 'react';
import { shortLabel, toothName } from '../../core/fdi';
import { ATTACHMENT_LABEL, MOVEMENT_KEYS, MOVEMENT_META } from '../../core/types';
import { usePortal } from '../store';
import { PRODUCTS } from '../model';
import type { PlanVersion, PortalCase, ToothComment } from '../model';
import { downloadBlob, getBlob } from '../blobs';
import { formatMovement, reviewPlan, treatmentWeeks } from '../workflow';
import { Empty, fmtDate, fmtDateTime } from './common';
import { ArchChart } from './ArchChart';

const VERSION_STATUS: Record<PlanVersion['status'], [string, string]> = {
  pending: ['Awaiting your review', 'action'],
  approved: ['Approved', 'good'],
  modification_requested: ['Changes requested', 'warn'],
  superseded: ['Superseded', 'neutral'],
};

export function PlanReviewTab({ c, onUpload }: { c: PortalCase; onUpload: () => void }) {
  const role = usePortal((s) => s.role);
  const prefs = usePortal((s) => s.db.preferences);
  const decide = usePortal((s) => s.decidePlan);
  const notify = usePortal((s) => s.notify);
  const latest = c.plans[c.plans.length - 1];
  const [vid, setVid] = useState<string | undefined>(latest?.id);
  const [sel, setSel] = useState<number | null>(null);
  const [comments, setComments] = useState<ToothComment[]>([]);
  const [general, setGeneral] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [draftText, setDraftText] = useState('');

  useEffect(() => setVid(latest?.id), [latest?.id]);

  if (!c.plans.length) {
    return (
      <section className="panel">
        <Empty title={role === 'lab' ? 'No plan uploaded yet' : 'Your treatment plan is being designed'}>
          {role === 'lab' ? (
            <>
              Design the setup in the 3D studio, export <em>Plan summary (JSON)</em> and upload it here.
              {(c.status === 'planning' || c.status === 'modification_requested') && (
                <div style={{ marginTop: 12 }}>
                  <button className="primary" onClick={onUpload}>
                    Upload plan
                  </button>
                </div>
              )}
            </>
          ) : c.status === 'draft' || c.status === 'records_issue' ? (
            'Planning starts once the case is submitted with complete records.'
          ) : (
            'You will be notified here as soon as the plan is ready for review – usually within 2–3 working days.'
          )}
        </Empty>
      </section>
    );
  }

  const plan = c.plans.find((p) => p.id === vid) ?? latest;
  const s = plan.summary;
  const review = reviewPlan(s, c);
  const canDecide = role === 'doctor' && plan.status === 'pending' && c.status === 'plan_ready';
  const shownComments = canDecide ? comments : plan.toothComments ?? [];
  const commentSet = new Set(shownComments.map((t) => t.tooth));
  const flagged = new Set(review.flags.filter((f) => f.severity === 'warning').map((f) => f.tooth));
  const selTooth = sel != null ? s.teeth.find((t) => t.id === sel) : undefined;
  const maxArch = Math.max(s.stages.upper, s.stages.lower);
  const [statusLabel0, tone] = VERSION_STATUS[plan.status];
  const statusLabel = role === 'lab' && plan.status === 'pending' ? 'Awaiting doctor review' : statusLabel0;

  const pick = (id: number) => {
    setSel(id);
    setDraftText(comments.find((t) => t.tooth === id)?.text ?? '');
  };
  const saveToothComment = () => {
    if (sel == null) return;
    const rest = comments.filter((t) => t.tooth !== sel);
    setComments(draftText.trim() ? [...rest, { tooth: sel, text: draftText.trim() }] : rest);
  };

  const openProject = async () => {
    if (!plan.projectFileId) return;
    const b = await getBlob(plan.projectFileId).catch(() => undefined);
    if (!b) return notify('Project file not found in this browser.', 'error');
    downloadBlob(b, `${c.number}_plan-v${plan.version}.smile`);
    notify('Project downloaded – open it in the 3D studio with "Open project".', 'info');
  };

  return (
    <div className="stack-lg">
      {c.plans.length > 1 && (
        <div className="chips" role="tablist" aria-label="Plan versions">
          {c.plans.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === plan.id} className={`chip${p.id === plan.id ? ' on' : ''}`} onClick={() => setVid(p.id)}>
              v{p.version}
              {p.phase > 0 ? ` · refinement ${p.phase}` : ''} · {VERSION_STATUS[p.status][0]}
            </button>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="row between wrap">
          <div>
            <h2>
              Treatment plan v{plan.version} <span className={`badge tone-${tone}`}>{statusLabel}</span>
            </h2>
            <p className="small muted">
              {plan.designer} · {fmtDateTime(plan.createdAt)}
              {s.protocolName && ` · ${s.protocolName}`}
            </p>
          </div>
          <div className="row wrap">
            {plan.projectFileId && <button onClick={() => void openProject()}>Download 3D project</button>}
            <a className="btn" href="./index.html" target="_blank" rel="noreferrer">
              Open 3D studio ↗
            </a>
          </div>
        </div>

        <div className="kpis compact">
          <div className="kpi static">
            <span className="kpi-n">
              {s.stages.upper}
              <small>/</small>
              {s.stages.lower}
            </span>
            <span className="kpi-l">Aligners upper / lower</span>
          </div>
          <div className="kpi static">
            <span className="kpi-n">{Math.round(treatmentWeeks(s, prefs.daysPerAligner) / 4.345)}</span>
            <span className="kpi-l">
              Months ({prefs.daysPerAligner}-day wear)
            </span>
          </div>
          <div className="kpi static">
            <span className="kpi-n">{review.moving.length}</span>
            <span className="kpi-l">Teeth moving</span>
          </div>
          <div className="kpi static">
            <span className="kpi-n">{review.attachmentCount}</span>
            <span className="kpi-l">Attachments</span>
          </div>
          <div className="kpi static">
            <span className="kpi-n">
              {review.iprTotal.upper.toFixed(1)}
              <small>/</small>
              {review.iprTotal.lower.toFixed(1)}
            </span>
            <span className="kpi-l">IPR mm upper / lower</span>
          </div>
        </div>

        {!review.fitsProduct && (
          <div className="notice warn">
            This plan needs {maxArch} aligners per arch, more than {PRODUCTS[c.rx.product].name} includes ({PRODUCTS[c.rx.product].maxStages}).{' '}
            {review.suggestedProduct && `Approving will move the case to ${PRODUCTS[review.suggestedProduct].name}, or request a modification to shorten treatment.`}
          </div>
        )}
        {review.fitsProduct && c.rx.product !== 'comprehensive' && <div className="notice good small">✓ Fits {PRODUCTS[c.rx.product].name} (up to {PRODUCTS[c.rx.product].maxStages} aligners).</div>}
        {review.rxConflicts.map((t) => (
          <div key={t} className="notice bad">
            Prescription check: {t}
          </div>
        ))}
      </section>

      <div className="grid-plan">
        <section className="panel">
          <h2>Occlusal overview</h2>
          <ArchChart plan={s} selected={sel} onPick={pick} comments={commentSet} flagged={flagged} />
          <p className="small muted">Click a tooth for details{canDecide ? ' and to leave a comment' : ''}. Red outline = movement beyond the usual predictable range.</p>
        </section>

        <div className="stack">
          <section className="panel">
            {selTooth ? (
              <>
                <h2>
                  {selTooth.id} · {shortLabel(selTooth.id)}
                </h2>
                <p className="small muted">{toothName(selTooth.id)}</p>
                <dl className="kv tight">
                  {MOVEMENT_KEYS.map((k) => (
                    <div key={k} className="kv-row">
                      <dt>{MOVEMENT_META[k].label}</dt>
                      <dd>{formatMovement(selTooth, k) || <span className="muted">—</span>}</dd>
                    </div>
                  ))}
                  <div className="kv-row">
                    <dt>Attachments</dt>
                    <dd>{selTooth.attachments.map((a) => `${ATTACHMENT_LABEL[a.type]} (from aligner ${a.stageFrom || 1})`).join(', ') || '—'}</dd>
                  </div>
                  {selTooth.startStage > 0 && (
                    <div className="kv-row">
                      <dt>Starts moving</dt>
                      <dd>Aligner {selTooth.startStage + 1}</dd>
                    </div>
                  )}
                </dl>
                {review.flags
                  .filter((f) => f.tooth === selTooth.id)
                  .map((f, i) => (
                    <div key={i} className={`notice ${f.severity === 'warning' ? 'warn' : 'info'} small`}>
                      {f.text}
                    </div>
                  ))}
                {canDecide ? (
                  <div className="stack">
                    <textarea rows={2} value={draftText} onChange={(e) => setDraftText(e.target.value)} placeholder={`Comment on ${selTooth.id}, e.g. "no IPR distal", "overcorrect rotation 3°"`} aria-label="Tooth comment" />
                    <div className="row end">
                      <button onClick={saveToothComment}>{commentSet.has(selTooth.id) ? 'Update comment' : 'Add comment'}</button>
                    </div>
                  </div>
                ) : (
                  shownComments
                    .filter((t) => t.tooth === selTooth.id)
                    .map((t) => (
                      <div key={t.tooth} className="notice info small">
                        Doctor comment: {t.text}
                      </div>
                    ))
                )}
              </>
            ) : (
              <>
                <h2>Planning notes</h2>
                <p className="pre">{plan.labNotes || <span className="muted">No notes from the planning team.</span>}</p>
                {s.notes && <p className="pre small muted">{s.notes}</p>}
              </>
            )}
          </section>

          {review.flags.length > 0 && (
            <section className="panel">
              <h2>Clinical checks</h2>
              <ul className="simple plain">
                {review.flags.map((f, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => pick(f.tooth)}>
                      {f.tooth}
                    </button>{' '}
                    <span className={f.severity === 'warning' ? 'warn-text' : 'muted'}>{f.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <section className="panel">
        <h2>Tooth movement table</h2>
        <div className="table-wrap">
          <table className="mini movement">
            <thead>
              <tr>
                <th>Tooth</th>
                {MOVEMENT_KEYS.map((k) => (
                  <th key={k}>{MOVEMENT_META[k].label.split(' (')[0]}</th>
                ))}
                <th>Attach.</th>
              </tr>
            </thead>
            <tbody>
              {review.moving.map((t) => (
                <tr key={t.id} className={sel === t.id ? 'sel' : ''} onClick={() => pick(t.id)}>
                  <td>
                    <strong>{t.id}</strong>
                  </td>
                  {MOVEMENT_KEYS.map((k) => (
                    <td key={k} className="num">
                      {formatMovement(t, k)}
                    </td>
                  ))}
                  <td className="num">{t.attachments.length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {s.ipr.length > 0 && (
        <section className="panel">
          <h2>IPR schedule</h2>
          <table className="mini">
            <thead>
              <tr>
                <th>Contact</th>
                <th className="num">Amount</th>
                <th className="num">Before aligner</th>
              </tr>
            </thead>
            <tbody>
              {[...s.ipr]
                .sort((a, b) => a.stage - b.stage)
                .map((e) => (
                  <tr key={e.contact}>
                    <td>{e.contact.replace('-', ' / ')}</td>
                    <td className="num">{e.amountMm.toFixed(2)} mm</td>
                    <td className="num">{e.stage}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      {canDecide ? (
        <section className="panel decision">
          <h2>Your decision</h2>
          {comments.length > 0 && (
            <ul className="simple plain">
              {comments.map((t) => (
                <li key={t.tooth}>
                  <strong>{t.tooth}</strong> {t.text}{' '}
                  <button className="link small danger" onClick={() => setComments(comments.filter((x) => x.tooth !== t.tooth))}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea rows={3} value={general} onChange={(e) => setGeneral(e.target.value)} placeholder="General comments for the planning team (required to request a modification)" aria-label="General comment" />
          <label className="check">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I have reviewed the tooth movements, IPR and attachments and approve this plan for manufacturing.
          </label>
          <div className="row end wrap">
            <button onClick={() => decide(c.id, 'modify', general.trim(), comments)} disabled={!general.trim() && comments.length === 0}>
              Request modification
            </button>
            <button className="primary" disabled={!reviewed} onClick={() => decide(c.id, 'approve', general.trim(), comments)}>
              Approve plan{!review.fitsProduct && review.suggestedProduct ? ` (${PRODUCTS[review.suggestedProduct].name.replace('Smile Craft ', '')})` : ''}
            </button>
          </div>
        </section>
      ) : (
        plan.decidedAt && (
          <section className="panel">
            <h2>Decision</h2>
            <p>
              {plan.status === 'approved' ? 'Approved' : 'Modification requested'} on {fmtDate(plan.decidedAt)}.
            </p>
            {plan.doctorComment && <p className="pre">“{plan.doctorComment}”</p>}
            {plan.toothComments && plan.toothComments.length > 0 && (
              <ul className="simple plain">
                {plan.toothComments.map((t) => (
                  <li key={t.tooth}>
                    <strong>{t.tooth}</strong> {t.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      )}
    </div>
  );
}
