import { sortTeeth } from '../../core/fdi';
import { iprLimit, suggestIpr } from '../../core/validate';
import { setState, toast, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { goToStep } from '../App';
import { Check, IssuesList, NumberInput } from '../common';

export function StagePanel() {
  const staging = useStudio((s) => s.staging);
  const protocol = useStudio((s) => s.protocol);
  const plan = useStudio((s) => s.plan);
  const contacts = useStudio((s) => s.contacts);
  const stale = useStudio((s) => s.contactsStale);
  const stage = useStudio((s) => s.stage);
  const issues = useStudio((s) => s.issues);
  const busy = useStudio((s) => s.busy);
  const total = staging?.totalStages ?? 0;
  const ids = sortTeeth(Object.keys(staging?.teeth ?? {}).map(Number)).filter((id) => (staging!.teeth[id].stagesNeeded ?? 0) > 0);
  const setStaging = (patch: Partial<typeof protocol.staging>) => studio.setProtocol({ ...protocol, staging: { ...protocol.staging, ...patch } });

  const initial = new Map((contacts ?? []).filter((c) => c.stage === 0).map((c) => [c.contact, c]));
  const worst = new Map((contacts ?? []).filter((c) => c.stage > 0).map((c) => [c.contact, c]));
  const suggestions = new Map(contacts ? suggestIpr(protocol, [...worst.values()]).map((s) => [s.contact, s]) : []);
  const contactKeys = [...new Set([...initial.keys(), ...plan.ipr.map((e) => e.contact)])];

  return (
    <>
      <div className="stat">
        <div>
          <b>{staging?.archStages.upper ?? 0}</b>
          <span>upper aligners</span>
        </div>
        <div>
          <b>{staging?.archStages.lower ?? 0}</b>
          <span>lower aligners</span>
        </div>
        <div>
          <b>{Math.ceil(staging?.weeks ?? 0)}</b>
          <span>weeks</span>
        </div>
      </div>

      <div className="section">
        <h3>Staging</h3>
        <div className="field">
          <label>Mode</label>
          <select value={protocol.staging.mode} onChange={(e) => setStaging({ mode: e.target.value as 'synchronized' | 'maxRate' })}>
            <option value="synchronized">Synchronized (all finish together)</option>
            <option value="maxRate">Max rate (each tooth stops when done)</option>
          </select>
        </div>
        <div className="field">
          <label>Days / aligner</label>
          <NumberInput value={protocol.staging.daysPerStage} step={1} min={1} digits={0} onChange={(v) => setStaging({ daysPerStage: Math.round(v) })} />
        </div>
        <Check checked={protocol.staging.syncArches} onChange={(v) => setStaging({ syncArches: v })}>
          Same number of aligners in both arches (passive aligners)
        </Check>
        <div className="hint small">Per-stage limits come from the protocol (Protocol & AI tab).</div>
      </div>

      <div className="section">
        <h3>Tooth timeline</h3>
        {ids.length === 0 && <div className="muted small">No movements planned yet.</div>}
        <div className="gantt">
          {ids.map((id) => {
            const t = staging!.teeth[id];
            return (
              <div className="g-row" key={id} onClick={() => setState({ selectedTooth: id })} style={{ cursor: 'pointer' }} title={`${id}: stages ${t.start}–${t.end}, limited by ${t.limitingFactor}`}>
                <span>{id}</span>
                <div className="bar">
                  <i style={{ left: `${(t.start / Math.max(1, total)) * 100}%`, width: `${((t.end - t.start) / Math.max(1, total)) * 100}%` }} />
                  {plan.ipr
                    .filter((e) => e.contact.split('-').map(Number).includes(id))
                    .map((e) => (
                      <b key={e.contact} style={{ left: `${(e.stage / Math.max(1, total)) * 100}%` }} title={`IPR ${e.contact} ${e.amountMm} mm before stage ${e.stage}`} />
                    ))}
                </div>
              </div>
            );
          })}
          {total > 0 && (
            <div className="g-row">
              <span />
              <div className="bar" style={{ background: 'transparent' }}>
                <b style={{ left: `${(stage / total) * 100}%`, background: 'var(--accent)' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Contacts & IPR</h3>
          {contacts && stale && <span className="pill warn">outdated</span>}
        </div>
        <div className="row wrap">
          <button disabled={!!busy} onClick={() => studio.analyzeContacts(false)}>
            Measure (final)
          </button>
          <button disabled={!!busy} onClick={() => studio.analyzeContacts(true)}>
            Measure all stages
          </button>
          <button
            disabled={!contacts}
            onClick={() => {
              const n = studio.applySuggestedIpr();
              toast(n ? `IPR set on ${n} contact(s).` : 'No overlapping contacts — no IPR needed.', n ? 'success' : 'info');
            }}
          >
            Apply suggested IPR
          </button>
        </div>
        {contactKeys.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>Contact</th>
                <th title="Initial gap (+) or overlap (−)">Initial</th>
                <th title="Worst stage after movement">Planned</th>
                <th>IPR mm</th>
                <th>Before</th>
              </tr>
            </thead>
            <tbody>
              {contactKeys.map((key) => {
                const i = initial.get(key);
                const w = worst.get(key);
                const ipr = plan.ipr.find((e) => e.contact === key);
                const sug = suggestions.get(key);
                const residual = w ? -w.distanceMm - (ipr?.amountMm ?? 0) : 0;
                const fmt = (d?: number) => (d === undefined ? '–' : d >= 2.99 ? '>3' : d.toFixed(2));
                return (
                  <tr key={key}>
                    <td>
                      {key}
                      {sug && !ipr && <span className="pill warn" title={`Suggested ${sug.amountMm} mm`}> {sug.amountMm}</span>}
                    </td>
                    <td className={i && i.distanceMm < 0 ? 'neg' : ''}>{fmt(i?.distanceMm)}</td>
                    <td className={residual > protocol.ipr.overlapToleranceMm ? 'neg' : ''} title={w ? `stage ${w.stage}` : ''}>
                      {fmt(w?.distanceMm)}
                    </td>
                    <td>
                      <NumberInput width={52} value={ipr?.amountMm ?? 0} step={protocol.ipr.stepMm} min={0} max={iprLimit(protocol, key) * 2} onChange={(v) => studio.setIpr(key, Math.round(v * 100) / 100)} />
                    </td>
                    <td>
                      <NumberInput width={40} value={ipr?.stage ?? protocol.ipr.defaultStage} step={1} min={0} digits={0} onChange={(v) => ipr && studio.setIpr(key, ipr.amountMm, Math.round(v))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="hint small">
          Distances are crown-surface to crown-surface: negative = overlap that must be resolved by IPR, expansion or
          movement changes. "Measure all stages" also catches collisions in the middle of treatment.
        </div>
      </div>

      <div className="section">
        <h3>Protocol check</h3>
        <IssuesList issues={issues} onPickTooth={(id) => { setState({ selectedTooth: id }); goToStep('plan'); }} />
      </div>
      <button className="primary" onClick={() => goToStep('export')}>
        Export →
      </button>
    </>
  );
}
