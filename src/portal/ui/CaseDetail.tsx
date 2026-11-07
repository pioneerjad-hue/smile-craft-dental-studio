import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { usePortal, useCase } from '../store';
import { PRODUCTS, patientName } from '../model';
import type { PlanSummary, PortalCase } from '../model';
import { availableActions, isMoving, parsePlanJson, recordsCheck, unreadCount } from '../workflow';
import type { ActionId } from '../workflow';
import { Field, Modal, Pipeline, StatusBadge, fmtDate, fmtDateTime, fmtUsd, go, relTime } from './common';
import { RecordsGrid } from './Records';
import { RxSummary } from './RxSummary';
import { PlanReviewTab } from './PlanReview';
import { approvedPlan } from './Dashboard';

const TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['plan', 'Treatment plan'],
  ['records', 'Records'],
  ['messages', 'Messages'],
  ['shipping', 'Shipping & billing'],
];

type Dialog = null | 'note' | 'publish' | 'ship' | 'retainers';

export function CaseDetail({ caseId, tab = 'overview' }: { caseId: string; tab?: string }) {
  const c = useCase(caseId);
  const role = usePortal((s) => s.role);
  const act = usePortal((s) => s.act);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [noteAction, setNoteAction] = useState<ActionId | null>(null);

  if (!c) {
    return (
      <div className="panel">
        <p>Case not found.</p>
        <a href="#/cases">Back to cases</a>
      </div>
    );
  }

  const actions = availableActions(c.status, role);
  const unread = unreadCount(c, role);
  const askNote = (a: ActionId) => {
    setNoteAction(a);
    setDialog('note');
  };

  /** Primary call-to-action buttons for the current status. */
  const buttons: JSX.Element[] = [];
  for (const a of actions) {
    switch (a.action) {
      case 'submit':
        buttons.push(<button key="edit" className="primary" onClick={() => go(`cases/${c.id}/edit`)}>Continue prescription</button>);
        break;
      case 'resubmit_records':
        buttons.push(<button key="rec" className="primary" onClick={() => go(`cases/${c.id}/edit`)}>Upload records</button>);
        break;
      case 'approve':
        if (tab !== 'plan') buttons.push(<button key="rev" className="primary" onClick={() => go(`cases/${c.id}/plan`)}>Review treatment plan</button>);
        break;
      case 'request_modification':
        break;
      case 'publish_plan':
        buttons.push(<button key="pub" className="primary" onClick={() => setDialog('publish')}>{c.status === 'modification_requested' ? 'Upload revised plan' : 'Upload plan'}</button>);
        break;
      case 'ship':
        buttons.push(<button key="ship" className="primary" onClick={() => setDialog('ship')}>Ship aligners</button>);
        break;
      case 'flag_records':
      case 'order_refinement':
      case 'cancel':
        buttons.push(
          <button key={a.action} className={a.action === 'cancel' ? 'ghost danger' : ''} onClick={() => askNote(a.action)}>
            {a.label}
          </button>,
        );
        break;
      default:
        buttons.push(
          <button key={a.action} className={buttons.length ? '' : 'primary'} onClick={() => act(c.id, a.action)}>
            {a.label}
          </button>,
        );
    }
  }
  if (role === 'doctor' && ['in_treatment', 'retention', 'completed'].includes(c.status)) {
    buttons.push(<button key="ret" onClick={() => setDialog('retainers')}>Order retainers</button>);
  }

  return (
    <div className="stack-lg">
      <div className="case-head">
        <a href="#/cases" className="small">
          ← Patients & cases
        </a>
        <div className="row between wrap">
          <div>
            <h1>
              {patientName(c.patient)} <StatusBadge status={c.status} />
            </h1>
            <p className="muted small">
              {c.number} · {PRODUCTS[c.rx.product].name} · {c.rx.arches === 'both' ? 'both arches' : `${c.rx.arches} arch`} · submitted {fmtDate(c.createdAt)}
              {c.refinements > 0 && ` · refinement ${c.refinements}`}
            </p>
          </div>
          <div className="row wrap actions">{buttons}</div>
        </div>
        <Pipeline status={c.status} />
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([t, l]) => (
          <a key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} href={`#/cases/${c.id}/${t}`}>
            {l}
            {t === 'messages' && unread > 0 && <span className="pill">{unread}</span>}
            {t === 'plan' && c.status === 'plan_ready' && role === 'doctor' && <span className="pill">1</span>}
            {t === 'records' && !recordsCheck(c).complete && <span className="pill warn">!</span>}
          </a>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} />}
      {tab === 'plan' && <PlanReviewTab c={c} onUpload={() => setDialog('publish')} />}
      {tab === 'records' && (
        <section className="panel">
          <RecordsGrid c={c} editable={role === 'lab' || c.status === 'draft' || c.status === 'records_issue' || c.status === 'refinement' || c.status === 'in_treatment'} />
        </section>
      )}
      {tab === 'messages' && <Thread c={c} />}
      {tab === 'shipping' && <Shipping c={c} />}

      {dialog === 'note' && noteAction && <NoteDialog c={c} action={noteAction} onClose={() => setDialog(null)} />}
      {dialog === 'publish' && <PublishDialog c={c} onClose={() => setDialog(null)} />}
      {dialog === 'ship' && <ShipDialog c={c} onClose={() => setDialog(null)} />}
      {dialog === 'retainers' && <RetainerDialog c={c} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Overview({ c }: { c: PortalCase }) {
  const role = usePortal((s) => s.role);
  const updateCase = usePortal((s) => s.updateCase);
  const plan = approvedPlan(c);
  const total = plan ? Math.max(plan.summary.stages.upper, plan.summary.stages.lower) : 0;
  return (
    <div className="grid-main">
      <section className="panel">
        <div className="row between">
          <h2>Prescription</h2>
          {c.status === 'draft' && role === 'doctor' && <a href={`#/cases/${c.id}/edit`}>Edit</a>}
        </div>
        <RxSummary c={c} />
      </section>
      <div className="stack">
        {c.status === 'in_treatment' && plan && (
          <section className="panel">
            <h2>Treatment progress</h2>
            <div className="row between">
              <span>
                Aligner <strong>{c.currentAligner ?? 1}</strong> of {total}
              </span>
              {role === 'doctor' && (
                <span className="row">
                  <button className="icon" aria-label="Previous aligner" onClick={() => updateCase(c.id, { currentAligner: Math.max(1, (c.currentAligner ?? 1) - 1) })}>
                    −
                  </button>
                  <button className="icon" aria-label="Next aligner" onClick={() => updateCase(c.id, { currentAligner: Math.min(total, (c.currentAligner ?? 1) + 1) })}>
                    +
                  </button>
                </span>
              )}
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(100, ((c.currentAligner ?? 1) / Math.max(1, total)) * 100)}%` }} />
            </div>
            <p className="small muted">Off-track? Order a refinement with new scans – it is planned from the patient's current tooth positions.</p>
          </section>
        )}
        <section className="panel">
          <h2>Timeline</h2>
          <ol className="timeline">
            {[...c.events].reverse().map((e, i) => (
              <li key={i}>
                <span className={`tl-dot by-${e.by}`} aria-hidden="true" />
                <div>
                  <div>{e.text}</div>
                  <div className="small muted">
                    {fmtDateTime(e.at)} · {e.by === 'doctor' ? 'Doctor' : 'Smile Craft'}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Thread({ c }: { c: PortalCase }) {
  const role = usePortal((s) => s.role);
  const send = usePortal((s) => s.sendMessage);
  const markRead = usePortal((s) => s.markRead);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    markRead(c.id);
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [c.id, c.messages.length, markRead]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(c.id, text.trim());
    setText('');
  };
  return (
    <section className="panel thread">
      <div className="messages">
        {c.messages.length === 0 && <p className="muted">No messages yet. Questions about this case go straight to the {role === 'doctor' ? 'Smile Craft planning team' : 'doctor'}.</p>}
        {c.messages.map((m) => (
          <div key={m.id} className={`msg ${m.from === role ? 'mine' : 'theirs'}`}>
            <div className="msg-meta small">
              <strong>{m.author}</strong> · {relTime(m.at)}
            </div>
            <div className="msg-body pre">{m.text}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message…"
          aria-label="Message"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
          }}
        />
        <button className="primary" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function Shipping({ c }: { c: PortalCase }) {
  const role = usePortal((s) => s.role);
  const pay = usePortal((s) => s.payInvoice);
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Shipments</h2>
        {c.shipments.length === 0 ? (
          <p className="muted">Nothing shipped yet. Aligners ship after the plan is approved and manufactured.</p>
        ) : (
          <ul className="simple">
            {[...c.shipments].reverse().map((s) => (
              <li key={s.id}>
                <div className="row between">
                  <strong>{s.carrier}</strong>
                  <span className={`badge tone-${s.delivered ? 'good' : 'info'}`}>{s.delivered ? 'Delivered' : 'In transit'}</span>
                </div>
                <div className="small">{s.contents}</div>
                <div className="small muted">
                  Tracking {s.tracking || '—'} · sent {fmtDate(s.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h2>Invoices</h2>
        {c.invoices.length === 0 ? (
          <p className="muted">No invoices. The case fee is invoiced when you approve the first treatment plan.</p>
        ) : (
          <table className="mini">
            <tbody>
              {c.invoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.number}</strong>
                    <div className="small muted">
                      {i.description} · {fmtDate(i.date)}
                    </div>
                  </td>
                  <td className="num">{fmtUsd(i.amountUsd)}</td>
                  <td className="num">
                    {i.paid ? (
                      <span className="badge tone-good">Paid</span>
                    ) : role === 'doctor' ? (
                      <button className="small" onClick={() => pay(c.id, i.id)}>
                        Pay
                      </button>
                    ) : (
                      <span className="badge tone-warn">Due</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ dialogs */

function NoteDialog({ c, action, onClose }: { c: PortalCase; action: ActionId; onClose: () => void }) {
  const act = usePortal((s) => s.act);
  const [note, setNote] = useState('');
  const cfg: Partial<Record<ActionId, { title: string; label: string; placeholder: string; required: boolean; button: string }>> = {
    flag_records: { title: 'Request new records', label: 'What is missing or needs to be retaken?', placeholder: 'e.g. Lower scan has a hole distal of 37, please rescan.', required: true, button: 'Send request' },
    order_refinement: {
      title: 'Order refinement',
      label: 'Reason and goals for the refinement',
      placeholder: 'e.g. 12 rotation not tracking, close remaining space 11/21. New scans uploaded today.',
      required: true,
      button: 'Order refinement',
    },
    cancel: { title: 'Cancel case', label: 'Reason (optional)', placeholder: 'e.g. Patient chose another treatment', required: false, button: 'Cancel case' },
  };
  const k = cfg[action]!;
  return (
    <Modal title={k.title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          act(c.id, action, note.trim());
          onClose();
        }}
      >
        <Field label={k.label}>
          <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={k.placeholder} autoFocus />
        </Field>
        {action === 'order_refinement' && (
          <p className="small muted">
            Upload new intraoral scans in the Records tab (replace the upper/lower scan) so the refinement starts from the current tooth positions. Refinements included: {PRODUCTS[c.rx.product].refinementsIncluded}.
          </p>
        )}
        <div className="row end">
          <button type="button" onClick={onClose}>
            Back
          </button>
          <button className={action === 'cancel' ? 'danger-solid' : 'primary'} type="submit" disabled={k.required && !note.trim()}>
            {k.button}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PublishDialog({ c, onClose }: { c: PortalCase; onClose: () => void }) {
  const publish = usePortal((s) => s.publishPlan);
  const [parsed, setParsed] = useState<PlanSummary | null>(null);
  const [planName, setPlanName] = useState('');
  const [project, setProject] = useState<File | undefined>();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lastMod = [...c.plans].reverse().find((p) => p.status === 'modification_requested');
  return (
    <Modal title={c.status === 'modification_requested' ? 'Upload revised treatment plan' : 'Upload treatment plan'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!parsed) return;
          setBusy(true);
          await publish(c.id, parsed, notes.trim(), project);
          setBusy(false);
          onClose();
          go(`cases/${c.id}/plan`);
        }}
      >
        {lastMod && (
          <div className="notice warn">
            <strong>Doctor's request (v{lastMod.version}):</strong> {lastMod.doctorComment || '—'}
            {lastMod.toothComments?.length ? <div className="small">{lastMod.toothComments.map((t) => `${t.tooth}: ${t.text}`).join(' · ')}</div> : null}
          </div>
        )}
        <Field label="Plan file *" hint='From the 3D studio: Export → "Plan summary (JSON)" (or treatment-plan.json inside the stage zip).'>
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setError('');
              setParsed(null);
              setPlanName(f?.name ?? '');
              if (!f) return;
              try {
                setParsed(parsePlanJson(await f.text()));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </Field>
        {error && <div className="notice bad">{error}</div>}
        {parsed && (
          <div className="notice good">
            ✓ {planName}: {parsed.stages.upper} upper / {parsed.stages.lower} lower aligners, {parsed.teeth.filter(isMoving).length} teeth moving,{' '}
            {parsed.ipr.length} IPR contacts.
          </div>
        )}
        <Field label="Studio project (.smile) – optional" hint="Lets the doctor open the plan in the 3D studio.">
          <input type="file" accept=".smile,.zip" onChange={(e) => setProject(e.target.files?.[0])} />
        </Field>
        <Field label="Notes for the doctor">
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Summary of the setup, biomechanics, IPR timing, anything to check…" />
        </Field>
        <div className="row end">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!parsed || busy}>
            {busy ? 'Publishing…' : 'Publish to doctor'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ShipDialog({ c, onClose }: { c: PortalCase; onClose: () => void }) {
  const ship = usePortal((s) => s.ship);
  const plan = approvedPlan(c);
  const [carrier, setCarrier] = useState('DHL Express');
  const [tracking, setTracking] = useState('');
  const [contents, setContents] = useState(
    plan ? `Aligners 1–${Math.max(plan.summary.stages.upper, plan.summary.stages.lower)} (${c.rx.arches === 'both' ? 'upper + lower' : c.rx.arches}), attachment template, case` : 'Aligners',
  );
  return (
    <Modal title="Ship aligners" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          ship(c.id, carrier, tracking.trim(), contents.trim());
          onClose();
        }}
      >
        <div className="form-grid">
          <Field label="Carrier">
            <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              <option>DHL Express</option>
              <option>Aramex</option>
              <option>FedEx</option>
              <option>UPS</option>
              <option>Hand delivery</option>
            </select>
          </Field>
          <Field label="Tracking number">
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </Field>
        </div>
        <Field label="Contents">
          <input value={contents} onChange={(e) => setContents(e.target.value)} />
        </Field>
        <div className="row end">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Create shipment
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RetainerDialog({ c, onClose }: { c: PortalCase; onClose: () => void }) {
  const order = usePortal((s) => s.orderRetainers);
  const [arches, setArches] = useState('Upper + lower');
  const [sets, setSets] = useState('1');
  const [note, setNote] = useState('');
  return (
    <Modal title="Order retainers" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          order(c.id, `${sets} set(s), ${arches}${note ? ` – ${note}` : ''}`, Number(sets));
          onClose();
        }}
      >
        <div className="form-grid">
          <Field label="Arches">
            <select value={arches} onChange={(e) => setArches(e.target.value)}>
              <option>Upper + lower</option>
              <option>Upper only</option>
              <option>Lower only</option>
            </select>
          </Field>
          <Field label="Sets">
            <select value={sets} onChange={(e) => setSets(e.target.value)}>
              <option>1</option>
              <option>2</option>
              <option>3</option>
            </select>
          </Field>
        </div>
        <Field label="Notes" hint="Retainers are made from the final plan position unless you upload new scans.">
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="small muted">
          {PRODUCTS.retainers.name}: {fmtUsd(PRODUCTS.retainers.priceUsd)} per set – {fmtUsd(PRODUCTS.retainers.priceUsd * Number(sets))} invoiced on order.
        </p>
        <div className="row end">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Place order
          </button>
        </div>
      </form>
    </Modal>
  );
}
