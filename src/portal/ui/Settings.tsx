import { useState } from 'react';
import { usePortal, uid } from '../store';
import { PRODUCTS, TREATMENT_PRODUCTS } from '../model';
import type { ClinicalPreferences, DoctorAccount, Tri } from '../model';
import { downloadBlob } from '../blobs';
import { preferencesToProtocol } from '../workflow';
import { Field, Segmented } from './common';

export function Settings() {
  const db = usePortal((s) => s.db);
  const savePreferences = usePortal((s) => s.savePreferences);
  const saveDoctor = usePortal((s) => s.saveDoctor);
  const resetDemo = usePortal((s) => s.resetDemo);
  const [p, setP] = useState<ClinicalPreferences>(db.preferences);
  const [d, setD] = useState<DoctorAccount>(db.doctor);
  const set = <K extends keyof ClinicalPreferences>(k: K, v: ClinicalPreferences[K]) => setP((x) => ({ ...x, [k]: v }));
  const tri = (k: 'expansion' | 'proclination') => (
    <Segmented<Tri> name={k} value={p[k]} onChange={(v) => set(k, v)} options={[['yes', 'Preferred'], ['as_needed', 'As needed'], ['no', 'Avoid']]} />
  );
  const addr = d.addresses[0] ?? { id: uid(), label: 'Main clinic', line: '', city: '', country: '', phone: '' };
  const setAddr = (patch: Partial<typeof addr>) => setD({ ...d, addresses: [{ ...addr, ...patch }, ...d.addresses.slice(1)] });

  const exportProtocol = () => {
    const proto = preferencesToProtocol(p, d.name);
    downloadBlob(new Blob([JSON.stringify(proto, null, 2)], { type: 'application/json' }), 'clinical-preferences.protocol.json');
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Preferences</h1>
          <p className="muted">Your clinical preferences pre-fill every new prescription and guide the planning team on every case.</p>
        </div>
      </div>

      <section className="panel stack">
        <h2>Clinical preferences</h2>
        <div className="form-grid">
          <Field label="Default product">
            <select value={p.defaultProduct} onChange={(e) => set('defaultProduct', e.target.value as ClinicalPreferences['defaultProduct'])}>
              {TREATMENT_PRODUCTS.map((id) => (
                <option key={id} value={id}>
                  {PRODUCTS[id].name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Wear schedule">
            <select value={p.daysPerAligner} onChange={(e) => set('daysPerAligner', Number(e.target.value))}>
              <option value={7}>7 days per aligner</option>
              <option value={10}>10 days per aligner</option>
              <option value={14}>14 days per aligner</option>
            </select>
          </Field>
          <Field label="Default retention">
            <select value={p.defaultRetention} onChange={(e) => set('defaultRetention', e.target.value as ClinicalPreferences['defaultRetention'])}>
              <option value="vivera_like">Clear retainers</option>
              <option value="fixed_lingual">Fixed lingual retainer</option>
              <option value="both">Both</option>
              <option value="none">Decide per case</option>
            </select>
          </Field>
        </div>

        <div className="rx-grid">
          <div>
            <h3>Attachments</h3>
            <Segmented name="Attachments" value={p.attachmentsAllowed ? 'y' : 'n'} onChange={(v) => set('attachmentsAllowed', v === 'y')} options={[['y', 'Allowed'], ['n', 'Not allowed']]} />
            {p.attachmentsAllowed && (
              <Field label="Place attachments at aligner">
                <select value={p.attachmentStage} onChange={(e) => set('attachmentStage', Number(e.target.value))}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </Field>
            )}
          </div>
          <div>
            <h3>IPR</h3>
            <Segmented name="IPR" value={p.iprAllowed ? 'y' : 'n'} onChange={(v) => set('iprAllowed', v === 'y')} options={[['y', 'Allowed'], ['n', 'Not allowed']]} />
            {p.iprAllowed && (
              <div className="form-grid two">
                <Field label="Max per contact (mm)">
                  <select value={p.iprMaxPerContactMm} onChange={(e) => set('iprMaxPerContactMm', Number(e.target.value))}>
                    {[0.2, 0.3, 0.4, 0.5].map((v) => (
                      <option key={v} value={v}>
                        {v.toFixed(1)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Not before aligner">
                  <select value={p.iprStage} onChange={(e) => set('iprStage', Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>
          <div>
            <h3>Expansion</h3>
            {tri('expansion')}
          </div>
          <div>
            <h3>Proclination</h3>
            {tri('proclination')}
          </div>
          <div>
            <h3>Passive aligners</h3>
            <Segmented name="Passive aligners" value={p.passiveAligners ? 'y' : 'n'} onChange={(v) => set('passiveAligners', v === 'y')} options={[['y', 'Match arches'], ['n', 'No']]} />
          </div>
          <div>
            <h3>Overcorrection</h3>
            <Segmented name="Overcorrection" value={p.overcorrection ? 'y' : 'n'} onChange={(v) => set('overcorrection', v === 'y')} options={[['y', 'Add stages'], ['n', 'No']]} />
          </div>
        </div>
        <Field label="Your treatment rules (sent with every case)">
          <textarea rows={4} value={p.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Never move teeth with crowns or implants. Prefer distalization over IPR for Class II. Keep lower intercanine width." />
        </Field>
        <div className="row end wrap">
          <button onClick={exportProtocol} title="Download a protocol file to load in the 3D studio (Protocol & AI → Import)">
            Download as studio protocol
          </button>
          <button className="primary" onClick={() => savePreferences(p)}>
            Save preferences
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2>Account & shipping</h2>
        <div className="form-grid">
          <Field label="Name">
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <Field label="Practice">
            <input value={d.practice} onChange={(e) => setD({ ...d, practice: e.target.value })} />
          </Field>
          <Field label="Email">
            <input type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input value={addr.phone} onChange={(e) => setAddr({ phone: e.target.value })} />
          </Field>
          <Field label="Shipping address">
            <input value={addr.line} onChange={(e) => setAddr({ line: e.target.value })} />
          </Field>
          <Field label="City">
            <input value={addr.city} onChange={(e) => setAddr({ city: e.target.value })} />
          </Field>
          <Field label="Country">
            <input value={addr.country} onChange={(e) => setAddr({ country: e.target.value })} />
          </Field>
        </div>
        <div className="row end">
          <button className="primary" onClick={() => saveDoctor(d)}>
            Save account
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2>Demo data</h2>
        <p className="muted small">Everything you enter is stored only in this browser. Restore the sample cases at any time.</p>
        <div className="row">
          <button
            className="ghost danger"
            onClick={() => {
              if (confirm('Replace all portal data in this browser with the demo cases?')) void resetDemo();
            }}
          >
            Restore demo data
          </button>
        </div>
      </section>
    </div>
  );
}
