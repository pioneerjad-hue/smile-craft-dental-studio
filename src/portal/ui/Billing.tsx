import { usePortal } from '../store';
import { PRODUCTS, patientName } from '../model';
import { Empty, fmtDate, fmtUsd } from './common';

export function Billing() {
  const role = usePortal((s) => s.role);
  const cases = usePortal((s) => s.db.cases);
  const pay = usePortal((s) => s.payInvoice);
  const rows = cases.flatMap((c) => c.invoices.map((i) => ({ c, i }))).sort((a, b) => b.i.date.localeCompare(a.i.date));
  const due = rows.filter((r) => !r.i.paid).reduce((s, r) => s + r.i.amountUsd, 0);
  const year = new Date().getFullYear();
  const ytd = rows.filter((r) => new Date(r.i.date).getFullYear() === year).reduce((s, r) => s + r.i.amountUsd, 0);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p className="muted">Cases are invoiced when the first treatment plan is approved; retainers when ordered.</p>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi static accent">
          <span className="kpi-n">{fmtUsd(due)}</span>
          <span className="kpi-l">Outstanding</span>
        </div>
        <div className="kpi static">
          <span className="kpi-n">{fmtUsd(ytd)}</span>
          <span className="kpi-l">Invoiced in {year}</span>
        </div>
        <div className="kpi static">
          <span className="kpi-n">{rows.length}</span>
          <span className="kpi-l">Invoices</span>
        </div>
      </div>

      <section className="panel">
        <h2>Invoices</h2>
        {rows.length === 0 ? (
          <Empty title="No invoices yet" />
        ) : (
          <div className="table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Patient</th>
                  <th className="hide-sm">Description</th>
                  <th className="num">Amount</th>
                  <th className="num">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, i }) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.number}</strong>
                      <div className="small muted">{fmtDate(i.date)}</div>
                    </td>
                    <td>
                      <a href={`#/cases/${c.id}/shipping`}>{patientName(c.patient)}</a>
                    </td>
                    <td className="hide-sm small">{i.description}</td>
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
          </div>
        )}
        <p className="small muted">Demo mode: "Pay" only marks the invoice as paid – connect a payment provider before going live.</p>
      </section>

      <section className="panel">
        <h2>Fee schedule</h2>
        <div className="products static">
          {Object.values(PRODUCTS).map((p) => (
            <div key={p.id} className="product">
              <strong>{p.name.replace('Smile Craft ', '')}</strong>
              <span className="price">{fmtUsd(p.priceUsd)}</span>
              <span className="small">{p.description}</span>
              <span className="small muted">{p.refinementsIncluded}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
