import { usePortal } from '../store';
import { patientName } from '../model';
import { unreadCount } from '../workflow';
import { Empty, relTime } from './common';

/** All case conversations, newest first – one thread per case, like the leading portals. */
export function Inbox() {
  const role = usePortal((s) => s.role);
  const cases = usePortal((s) => s.db.cases);
  const threads = cases
    .filter((c) => c.messages.length)
    .map((c) => ({ c, last: c.messages[c.messages.length - 1], unread: unreadCount(c, role) }))
    .sort((a, b) => b.last.at.localeCompare(a.last.at));
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="muted">Every conversation is attached to a case, so the planning team always has the records in front of them.</p>
        </div>
      </div>
      <section className="panel">
        {threads.length === 0 ? (
          <Empty title="No conversations yet">Open a case and use its Messages tab.</Empty>
        ) : (
          <ul className="inbox">
            {threads.map(({ c, last, unread }) => (
              <li key={c.id} className={unread ? 'unread' : ''}>
                <a href={`#/cases/${c.id}/messages`}>
                  <div className="row between">
                    <strong>
                      {patientName(c.patient)} <span className="small muted">{c.number}</span>
                    </strong>
                    <span className="small muted">{relTime(last.at)}</span>
                  </div>
                  <div className="row between">
                    <span className="snippet">
                      <span className="muted">{last.from === role ? 'You: ' : `${last.author}: `}</span>
                      {last.text}
                    </span>
                    {unread > 0 && <span className="pill">{unread}</span>}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
