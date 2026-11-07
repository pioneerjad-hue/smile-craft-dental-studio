import { useState } from 'react';
import { usePortal, useCase } from '../store';
import { PRODUCTS, TREATMENT_PRODUCTS, emptyRx, patientName } from '../model';
import type { Patient, Prescription, Tri } from '../model';
import { recordsCheck } from '../workflow';
import { Field, Segmented, ToothPicker, go } from './common';
import { RecordsGrid } from './Records';
import { RxSummary } from './RxSummary';

const STEPS = ['Patient & product', 'Prescription', 'Records', 'Review & submit'];

type ToothMode = 'doNotMove' | 'noAttachments' | 'extract';

export function CaseWizard({ caseId }: { caseId?: string }) {
  const prefs = usePortal((s) => s.db.preferences);
  const createCase = usePortal((s) => s.createCase);
  const updateCase = usePortal((s) => s.updateCase);
  const act = usePortal((s) => s.act);
  const notify = usePortal((s) => s.notify);
  const existing = useCase(caseId);
  const [id, setId] = useState<string | undefined>(caseId);
  const saved = useCase(id);
  const [step, setStep] = useState(caseId && existing?.status === 'records_issue' ? 2 : 0);
  const [patient, setPatient] = useState<Patient>(existing?.patient ?? { firstName: '', lastName: '', dob: '', sex: 'F', chartNumber: '' });
  const [rx, setRx] = useState<Prescription>(existing?.rx ?? emptyRx(prefs));
  const [toothMode, setToothMode] = useState<ToothMode>('doNotMove');

  if (caseId && !existing) return <p>Case not found.</p>;
  if (existing && existing.status !== 'draft' && existing.status !== 'records_issue') {
    return (
      <div className="panel">
        <p>This case was already submitted and can no longer be edited.</p>
        <a href={`#/cases/${existing.id}`}>Back to case</a>
      </div>
    );
  }
  const locked = existing?.status === 'records_issue';

  const set = <K extends keyof Prescription>(k: K, v: Prescription[K]) => setRx((r) => ({ ...r, [k]: v }));
  const patientOk = patient.firstName.trim() && patient.lastName.trim() && patient.dob;

  /** Save the draft (creating it on first save) so records can be attached to it. */
  const save = (): string => {
    if (id) {
      if (!locked) updateCase(id, { patient, rx });
      return id;
    }
    const nid = createCase(patient, rx);
    setId(nid);
    history.replaceState(null, '', `#/cases/${nid}/edit`);
    return nid;
  };

  const next = () => {
    if (step === 0 && !patientOk) {
      notify('Enter first name, last name and date of birth.', 'error');
      return;
    }
    save();
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = () => {
    const cid = save();
    const c = usePortal.getState().db.cases.find((x) => x.id === cid)!;
    const rc = recordsCheck(c);
    if (!rc.complete) {
      notify(`Missing records: ${rc.missing.join(', ')}`, 'error');
      setStep(2);
      return;
    }
    act(cid, locked ? 'resubmit_records' : 'submit');
    go(`cases/${cid}`);
  };

  const toggleTooth = (tid: number) => {
    setRx((r) => {
      const list = r[toothMode];
      return { ...r, [toothMode]: list.includes(tid) ? list.filter((x) => x !== tid) : [...list, tid] };
    });
  };
  const marks: Record<number, string | undefined> = {};
  for (const t of rx.doNotMove) marks[t] = 'm-dnm';
  for (const t of rx.noAttachments) marks[t] = (marks[t] ? marks[t] + ' ' : '') + 'm-noatt';
  for (const t of rx.extract) marks[t] = 'm-ext';

  const tri = (v: Tri, k: 'expand' | 'procline' | 'ipr') => (
    <Segmented<Tri> name={k} value={v} onChange={(x) => set(k, x)} options={[['yes', 'Yes'], ['as_needed', 'As needed'], ['no', 'No']]} />
  );

  return (
    <div className="stack-lg wizard">
      <div className="page-head">
        <div>
          <a href={id ? `#/cases/${id}` : '#/cases'} className="small">
            ← {id ? 'Back to case' : 'Cases'}
          </a>
          <h1>{locked ? 'Update records' : existing || id ? `Prescription – ${patientName(patient)}` : 'New case'}</h1>
          {saved && <p className="muted small">{saved.number} · draft saved automatically when you continue</p>}
        </div>
      </div>

      <ol className="wsteps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <button type="button" disabled={(!id && i > 0) || (locked && i < 2)} onClick={() => (id && !locked && save(), setStep(i))}>
              <span className="dot">{i < step ? '✓' : i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="panel stack">
          <h2>Patient</h2>
          <div className="form-grid">
            <Field label="First name *">
              <input value={patient.firstName} onChange={(e) => setPatient({ ...patient, firstName: e.target.value })} autoFocus />
            </Field>
            <Field label="Last name *">
              <input value={patient.lastName} onChange={(e) => setPatient({ ...patient, lastName: e.target.value })} />
            </Field>
            <Field label="Date of birth *">
              <input type="date" value={patient.dob} onChange={(e) => setPatient({ ...patient, dob: e.target.value })} />
            </Field>
            <Field label="Sex">
              <select value={patient.sex} onChange={(e) => setPatient({ ...patient, sex: e.target.value as Patient['sex'] })}>
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="X">Other / not stated</option>
              </select>
            </Field>
            <Field label="Chart number" hint="Optional – your practice software ID">
              <input value={patient.chartNumber} onChange={(e) => setPatient({ ...patient, chartNumber: e.target.value })} />
            </Field>
          </div>

          <h2>Product</h2>
          <div className="products">
            {TREATMENT_PRODUCTS.map((p) => (
              <label key={p} className={`product${rx.product === p ? ' on' : ''}`}>
                <input type="radio" name="product" checked={rx.product === p} onChange={() => set('product', p)} />
                <strong>{PRODUCTS[p].name.replace('Smile Craft ', '')}</strong>
                <span className="small">{PRODUCTS[p].description}</span>
                <span className="small muted">{PRODUCTS[p].refinementsIncluded}</span>
              </label>
            ))}
          </div>
          <p className="small muted">Not sure? Choose Comprehensive – if the approved plan needs fewer aligners we will suggest a smaller product before you approve.</p>

          <h2>Arches to treat</h2>
          <Segmented name="Arches" value={rx.arches} onChange={(v) => set('arches', v)} options={[['both', 'Both arches'], ['upper', 'Upper only'], ['lower', 'Lower only']]} />
        </section>
      )}

      {step === 1 && (
        <section className="panel stack">
          <div className="row between wrap">
            <h2>Clinical prescription</h2>
            <span className="small muted">
              Pre-filled from your <a href="#/settings">clinical preferences</a>
            </span>
          </div>
          <Field label="Chief complaint / treatment goals">
            <textarea rows={3} value={rx.chiefComplaint} onChange={(e) => set('chiefComplaint', e.target.value)} placeholder="What does the patient want to change?" />
          </Field>

          <div className="rx-grid">
            <div>
              <h3>A-P relationship – right</h3>
              <Segmented name="AP right" value={rx.apRight} onChange={(v) => set('apRight', v)} options={[['maintain', 'Maintain'], ['improve', 'Improve'], ['class1', 'Class I canine']]} />
            </div>
            <div>
              <h3>A-P relationship – left</h3>
              <Segmented name="AP left" value={rx.apLeft} onChange={(v) => set('apLeft', v)} options={[['maintain', 'Maintain'], ['improve', 'Improve'], ['class1', 'Class I canine']]} />
            </div>
            <div>
              <h3>Overjet</h3>
              <Segmented name="Overjet" value={rx.overjet} onChange={(v) => set('overjet', v)} options={[['maintain', 'Maintain'], ['improve', 'Improve'], ['ideal', 'Ideal']]} />
            </div>
            <div>
              <h3>Overbite</h3>
              <Segmented name="Overbite" value={rx.overbite} onChange={(v) => set('overbite', v)} options={[['maintain', 'Maintain'], ['correct_deep', 'Correct deep bite'], ['correct_open', 'Correct open bite']]} />
            </div>
            <div>
              <h3>Midline</h3>
              <Segmented
                name="Midline"
                value={rx.midline}
                onChange={(v) => set('midline', v)}
                options={[['maintain', 'Maintain'], ['improve_upper', 'Move upper'], ['improve_lower', 'Move lower'], ['improve_both', 'Both']]}
              />
            </div>
            <div>
              <h3>Posterior crossbite</h3>
              <Segmented name="Crossbite" value={rx.posteriorCrossbite} onChange={(v) => set('posteriorCrossbite', v)} options={[['none', 'None'], ['correct', 'Correct'], ['maintain', "Don't correct"]]} />
            </div>
          </div>

          <h3>Resolve crowding / spacing by</h3>
          <div className="rx-grid">
            <div>
              <span className="field-label">Expansion</span>
              {tri(rx.expand, 'expand')}
            </div>
            <div>
              <span className="field-label">Proclination</span>
              {tri(rx.procline, 'procline')}
            </div>
            <div>
              <span className="field-label">IPR</span>
              {tri(rx.ipr, 'ipr')}
            </div>
            <div>
              <span className="field-label">Attachments</span>
              <Segmented name="Attachments" value={rx.attachmentsAllowed ? 'y' : 'n'} onChange={(v) => set('attachmentsAllowed', v === 'y')} options={[['y', 'Allowed'], ['n', 'Not allowed']]} />
            </div>
          </div>

          <h3>Tooth instructions</h3>
          <Segmented<ToothMode>
            name="Tooth instruction"
            value={toothMode}
            onChange={setToothMode}
            options={[['doNotMove', 'Do not move (crowns, implants…)'], ['noAttachments', 'No attachments'], ['extract', 'Extract / missing']]}
          />
          <ToothPicker
            marks={marks}
            onToggle={toggleTooth}
            legend={
              <>
                <span className="lg m-dnm" /> Do not move ({rx.doNotMove.length}) <span className="lg m-noatt" /> No attachments ({rx.noAttachments.length}) <span className="lg m-ext" /> Extract (
                {rx.extract.length})
              </>
            }
          />

          <Field label="Additional instructions for the planning team">
            <textarea rows={3} value={rx.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Keep 16 and 26 as anchorage, overcorrect 12 rotation, pontic for 35…" />
          </Field>
        </section>
      )}

      {step === 2 && saved && (
        <section className="panel">
          <RecordsGrid c={saved} editable />
        </section>
      )}

      {step === 3 && saved && (
        <section className="panel stack">
          <h2>Review</h2>
          <RxSummary c={{ ...saved, patient, rx }} />
          {(() => {
            const rc = recordsCheck(saved);
            return rc.complete ? (
              <div className="notice good">✓ All required records uploaded.</div>
            ) : (
              <div className="notice warn">
                Missing records: {rc.missing.join(', ')}.{' '}
                <button className="link" onClick={() => setStep(2)}>
                  Upload now
                </button>
              </div>
            );
          })()}
          <p className="small muted">
            By submitting you confirm the records belong to this patient and that you have their consent to share them with Smile Craft for treatment planning.
          </p>
        </section>
      )}

      <div className="wizard-foot">
        <button onClick={() => (step === 0 ? go(id ? `cases/${id}` : 'cases') : setStep(step - 1))} disabled={locked && step === 2}>
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        <div className="grow" />
        {id && step < 3 && !locked && (
          <button
            onClick={() => {
              save();
              notify('Draft saved', 'success');
            }}
          >
            Save draft
          </button>
        )}
        {step < 3 ? (
          <button className="primary" onClick={next}>
            Continue
          </button>
        ) : (
          <button className="primary" onClick={submit}>
            {locked ? 'Resubmit records' : 'Submit case to Smile Craft'}
          </button>
        )}
      </div>
    </div>
  );
}
