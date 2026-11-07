/**
 * Portal state + data access. Demo mode keeps everything in this browser (localStorage for case data,
 * IndexedDB for files) and syncs between tabs, so a "doctor" tab and a "Smile Craft lab" tab can work
 * the same case. Swap `load`/`persist` for API calls to run it against a real backend.
 */
import { create } from 'zustand';
import { clearBlobs, deleteBlob, prepareImage, putBlob } from './blobs';
import { PRODUCTS, RECORD_SLOTS, patientName } from './model';
import type { ClinicalPreferences, DoctorAccount, Patient, PlanSummary, PortalCase, PortalDb, Prescription, Role, ToothComment } from './model';
import { seedDb } from './seed';
import { nextStatus, productForStages, recordsCheck } from './workflow';
import type { ActionId } from './workflow';

const KEY = 'smilecraft-portal-v1';
const SESSION = 'smilecraft-portal-session';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const now = () => new Date().toISOString();

function load(): PortalDb {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const db = JSON.parse(raw) as PortalDb;
      if (db.schema === 1 && Array.isArray(db.cases)) return db;
    }
  } catch {
    /* fall through to seed */
  }
  return seedDb();
}

function persist(db: PortalDb) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    usePortal.getState().notify('Could not save in this browser (storage full or blocked).', 'error');
  }
}

interface Session {
  signedIn: boolean;
  role: Role;
}

function loadSession(): Session {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null') as Session | null;
    if (s) return s;
  } catch {
    /* ignore */
  }
  return { signedIn: false, role: 'doctor' };
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface PortalState extends Session {
  db: PortalDb;
  toasts: Toast[];
  signIn(role: Role): void;
  signOut(): void;
  setRole(role: Role): void;
  notify(text: string, kind?: Toast['kind']): void;

  createCase(patient: Patient, rx: Prescription): string;
  updateCase(id: string, patch: Partial<Pick<PortalCase, 'patient' | 'rx' | 'currentAligner' | 'starred'>>): void;
  addRecord(caseId: string, slot: string, file: File): Promise<void>;
  removeRecord(caseId: string, recordId: string): Promise<void>;
  act(caseId: string, action: ActionId, note?: string): void;
  publishPlan(caseId: string, summary: PlanSummary, labNotes: string, project?: File): Promise<void>;
  decidePlan(caseId: string, decision: 'approve' | 'modify', comment: string, toothComments: ToothComment[]): void;
  ship(caseId: string, carrier: string, tracking: string, contents: string): void;
  orderRetainers(caseId: string, note: string, sets?: number): void;
  sendMessage(caseId: string, text: string): void;
  markRead(caseId: string): void;
  payInvoice(caseId: string, invoiceId: string): void;
  savePreferences(p: ClinicalPreferences): void;
  saveDoctor(d: DoctorAccount): void;
  resetDemo(): Promise<void>;
}

let toastSeq = 0;

export const usePortal = create<PortalState>((set, get) => {
  /** Apply a mutation to one case, stamp it, log an event and persist. */
  const mutate = (caseId: string, fn: (c: PortalCase) => PortalCase | void, event?: string) => {
    const { db, role } = get();
    const cases = db.cases.map((c) => {
      if (c.id !== caseId) return c;
      const copy: PortalCase = structuredClone(c);
      const out = fn(copy) ?? copy;
      out.updatedAt = now();
      if (event) out.events = [...out.events, { at: now(), by: role, text: event }];
      return out;
    });
    const next = { ...db, cases };
    persist(next);
    set({ db: next });
  };
  const author = () => (get().role === 'doctor' ? get().db.doctor.name : 'Smile Craft planning team');
  const invoiceNo = (db: PortalDb) => `INV-${new Date().getFullYear()}-${String(db.cases.reduce((n, c) => n + c.invoices.length, 0) + 200).padStart(4, '0')}`;

  return {
    ...loadSession(),
    db: load(),
    toasts: [],

    signIn(role) {
      sessionStorage.setItem(SESSION, JSON.stringify({ signedIn: true, role }));
      set({ signedIn: true, role });
    },
    signOut() {
      sessionStorage.removeItem(SESSION);
      set({ signedIn: false });
    },
    setRole(role) {
      sessionStorage.setItem(SESSION, JSON.stringify({ signedIn: true, role }));
      set({ role });
    },
    notify(text, kind = 'info') {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
    },

    createCase(patient, rx) {
      const db = get().db;
      const counter = db.counter + 1;
      const c: PortalCase = {
        id: uid(),
        number: `SC-${new Date().getFullYear()}-${String(counter).padStart(4, '0')}`,
        createdAt: now(),
        updatedAt: now(),
        status: 'draft',
        patient,
        rx,
        records: [],
        plans: [],
        messages: [],
        shipments: [],
        invoices: [],
        events: [{ at: now(), by: 'doctor', text: 'Draft created' }],
        refinements: 0,
      };
      const next = { ...db, counter, cases: [c, ...db.cases] };
      persist(next);
      set({ db: next });
      return c.id;
    },

    updateCase(id, patch) {
      mutate(id, (c) => Object.assign(c, patch));
    },

    async addRecord(caseId, slot, file) {
      const def = RECORD_SLOTS.find((s) => s.slot === slot);
      const kind = def?.kind ?? 'file';
      const blob = kind === 'photo' ? await prepareImage(file) : file;
      const id = uid();
      try {
        await putBlob(id, blob);
      } catch {
        get().notify('This browser blocked file storage – the file could not be kept.', 'error');
        return;
      }
      const old = get().db.cases.find((c) => c.id === caseId)?.records.filter((r) => r.slot === slot && slot !== 'other') ?? [];
      for (const r of old) if (r.hasBlob) void deleteBlob(r.id).catch(() => undefined);
      mutate(
        caseId,
        (c) => {
          c.records = [
            ...c.records.filter((r) => slot === 'other' || r.slot !== slot),
            { id, slot, kind, name: file.name, size: blob.size, mime: blob.type || file.type, uploadedAt: now(), uploadedBy: get().role, hasBlob: true },
          ];
        },
        c0(caseId)?.status === 'draft' ? undefined : `Record uploaded: ${def?.label ?? file.name}`,
      );
    },

    async removeRecord(caseId, recordId) {
      await deleteBlob(recordId).catch(() => undefined);
      mutate(caseId, (c) => {
        c.records = c.records.filter((r) => r.id !== recordId);
      });
    },

    act(caseId, action, note) {
      const { role } = get();
      const c = c0(caseId);
      if (!c) return;
      if (action === 'submit' || action === 'resubmit_records') {
        const rc = recordsCheck(c);
        if (!rc.complete) {
          get().notify(`Missing records: ${rc.missing.join(', ')}`, 'error');
          return;
        }
      }
      const to = nextStatus(c.status, action, role);
      const text: Record<ActionId, string> = {
        submit: 'Case submitted',
        resubmit_records: 'Records updated and resubmitted',
        start_planning: c.status === 'refinement' ? 'Refinement planning started' : 'Records accepted – planning started',
        flag_records: `New records requested${note ? `: ${note}` : ''}`,
        publish_plan: 'Treatment plan published',
        approve: 'Treatment plan approved',
        request_modification: 'Modification requested',
        start_manufacturing: 'Manufacturing started',
        ship: 'Aligners shipped',
        start_treatment: 'Aligners delivered – treatment started',
        order_refinement: `Refinement ${c.refinements + 1} ordered${note ? `: ${note}` : ''}`,
        finish_treatment: 'Active treatment finished – retention',
        complete: 'Case closed',
        cancel: `Case cancelled${note ? `: ${note}` : ''}`,
      };
      mutate(
        caseId,
        (x) => {
          x.status = to;
          if (action === 'start_treatment') {
            x.currentAligner = x.currentAligner ?? 1;
            x.shipments = x.shipments.map((s) => ({ ...s, delivered: true }));
          }
          if (action === 'order_refinement') x.refinements += 1;
          if (note && (action === 'flag_records' || action === 'order_refinement' || action === 'cancel')) {
            x.messages.push({ id: uid(), at: now(), from: role, author: author(), text: note, readBy: [role] });
          }
        },
        text[action],
      );
      get().notify(text[action], 'success');
    },

    async publishPlan(caseId, summary, labNotes, project) {
      let projectFileId: string | undefined;
      if (project) {
        projectFileId = uid();
        await putBlob(projectFileId, project);
      }
      const c = c0(caseId);
      if (!c) return;
      mutate(
        caseId,
        (x) => {
          x.plans = x.plans.map((p) => (p.status === 'pending' ? { ...p, status: 'superseded' } : p));
          if (projectFileId) {
            x.records.push({ id: projectFileId, slot: 'project', kind: 'file', name: project!.name, size: project!.size, mime: 'application/zip', uploadedAt: now(), uploadedBy: 'lab', hasBlob: true });
          }
          x.plans.push({
            id: uid(),
            version: x.plans.length + 1,
            createdAt: now(),
            designer: 'Smile Craft planning team',
            summary,
            labNotes,
            status: 'pending',
            projectFileId,
            phase: x.refinements,
          });
          x.status = nextStatus(x.status, 'publish_plan', 'lab');
        },
        `Treatment plan v${c.plans.length + 1} published (${summary.stages.upper} upper / ${summary.stages.lower} lower aligners)`,
      );
      get().notify('Plan published to the doctor', 'success');
    },

    decidePlan(caseId, decision, comment, toothComments) {
      const c = c0(caseId);
      const pending = c?.plans.find((p) => p.status === 'pending');
      if (!c || !pending) return;
      const action: ActionId = decision === 'approve' ? 'approve' : 'request_modification';
      mutate(
        caseId,
        (x) => {
          x.status = nextStatus(x.status, action, 'doctor');
          x.plans = x.plans.map((p) =>
            p.id === pending.id ? { ...p, status: decision === 'approve' ? 'approved' : 'modification_requested', decidedAt: now(), doctorComment: comment, toothComments } : p,
          );
          const stages = Math.max(pending.summary.stages.upper, pending.summary.stages.lower);
          if (decision === 'approve' && stages > PRODUCTS[x.rx.product].maxStages) {
            x.rx = { ...x.rx, product: productForStages(stages) };
            x.events.push({ at: now(), by: 'doctor', text: `Product changed to ${PRODUCTS[x.rx.product].name} (${stages} aligners)` });
          }
          if (decision === 'approve' && pending.phase === 0) {
            const product = PRODUCTS[x.rx.product];
            x.invoices.push({ id: uid(), number: invoiceNo(get().db), date: now(), description: `${product.name} – treatment plan approved`, amountUsd: product.priceUsd, paid: false });
          }
          if (comment) x.messages.push({ id: uid(), at: now(), from: 'doctor', author: author(), text: `${decision === 'approve' ? 'Approved' : 'Modification request'} – plan v${pending.version}: ${comment}`, readBy: ['doctor'] });
        },
        decision === 'approve' ? `Treatment plan v${pending.version} approved` : `Modification requested on plan v${pending.version}`,
      );
      get().notify(decision === 'approve' ? 'Plan approved – sent to manufacturing' : 'Modification request sent to the planning team', 'success');
    },

    ship(caseId, carrier, tracking, contents) {
      mutate(
        caseId,
        (x) => {
          x.status = nextStatus(x.status, 'ship', 'lab');
          x.shipments.push({ id: uid(), createdAt: now(), carrier, tracking, contents, delivered: false });
        },
        `Shipped via ${carrier}${tracking ? ` (${tracking})` : ''}`,
      );
      get().notify('Shipment created', 'success');
    },

    orderRetainers(caseId, note, sets = 1) {
      mutate(
        caseId,
        (x) => {
          x.invoices.push({ id: uid(), number: invoiceNo(get().db), date: now(), description: `${PRODUCTS.retainers.name} × ${sets}`, amountUsd: PRODUCTS.retainers.priceUsd * sets, paid: false });
          x.messages.push({ id: uid(), at: now(), from: 'doctor', author: author(), text: `Retainer order${note ? `: ${note}` : ''}`, readBy: ['doctor'] });
        },
        'Retainers ordered',
      );
      get().notify('Retainers ordered', 'success');
    },

    sendMessage(caseId, text) {
      const role = get().role;
      mutate(caseId, (x) => {
        x.messages.push({ id: uid(), at: now(), from: role, author: author(), text, readBy: [role] });
      });
    },

    markRead(caseId) {
      const role = get().role;
      const c = c0(caseId);
      if (!c || !c.messages.some((m) => !m.readBy.includes(role))) return;
      const db = get().db;
      const next = { ...db, cases: db.cases.map((x) => (x.id === caseId ? { ...x, messages: x.messages.map((m) => (m.readBy.includes(role) ? m : { ...m, readBy: [...m.readBy, role] })) } : x)) };
      persist(next);
      set({ db: next });
    },

    payInvoice(caseId, invoiceId) {
      mutate(caseId, (x) => {
        x.invoices = x.invoices.map((i) => (i.id === invoiceId ? { ...i, paid: true } : i));
      }, 'Invoice paid');
      get().notify('Payment recorded', 'success');
    },

    savePreferences(p) {
      const next = { ...get().db, preferences: p };
      persist(next);
      set({ db: next });
      get().notify('Clinical preferences saved', 'success');
    },

    saveDoctor(d) {
      const next = { ...get().db, doctor: d };
      persist(next);
      set({ db: next });
      get().notify('Account saved', 'success');
    },

    async resetDemo() {
      await clearBlobs().catch(() => undefined);
      const db = seedDb();
      persist(db);
      set({ db });
      get().notify('Demo data restored', 'success');
    },
  };
});

function c0(id: string): PortalCase | undefined {
  return usePortal.getState().db.cases.find((c) => c.id === id);
}

export function useCase(id: string | undefined): PortalCase | undefined {
  return usePortal((s) => s.db.cases.find((c) => c.id === id));
}

export function caseTitle(c: PortalCase) {
  return `${patientName(c.patient)} · ${c.number}`;
}

/* Keep tabs in sync: a doctor tab and a lab tab see each other's changes immediately. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      try {
        usePortal.setState({ db: JSON.parse(e.newValue) as PortalDb });
      } catch {
        /* ignore */
      }
    }
  });
}
