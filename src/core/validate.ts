import { archOf, isAnterior, shortLabel, toothType } from './fdi';
import type { StagingResult } from './staging';
import type {
  AttachmentRule,
  ContactReport,
  Issue,
  Movement,
  Protocol,
  TotalLimits,
  TreatmentPlan,
} from './types';
import { isZeroMovement } from './types';

export function totalLimitsFor(protocol: Protocol, id: number): TotalLimits {
  return { ...protocol.totalLimits, ...protocol.totalLimits.overrides[toothType(id)] };
}

function triggerValue(rule: AttachmentRule, m: Movement): number {
  switch (rule.trigger) {
    case 'rotation':
      return Math.abs(m.rotation);
    case 'extrusion':
      return Math.max(0, m.extrusion);
    case 'intrusion':
      return Math.max(0, -m.extrusion);
    case 'tip':
      return Math.abs(m.tip);
    case 'torque':
      return Math.abs(m.torque);
    case 'translation':
      return Math.abs(m.mesial);
  }
}

/** Attachment rules from the protocol that apply to a tooth movement. */
export function triggeredAttachmentRules(protocol: Protocol, id: number, m: Movement): AttachmentRule[] {
  const type = toothType(id);
  return protocol.attachments.rules.filter(
    (r) => r.toothTypes.includes(type) && triggerValue(r, m) >= r.threshold - 1e-9,
  );
}

export function iprLimit(protocol: Protocol, contact: string): number {
  const [a, b] = contact.split('-').map(Number);
  return isAnterior(a) && isAnterior(b) ? protocol.ipr.maxPerContactAnteriorMm : protocol.ipr.maxPerContactMm;
}

/**
 * Check a plan against the protocol. Returns issues sorted by severity.
 * `contacts` (optional) are geometric contact measurements at the final stage.
 */
export function validatePlan(
  protocol: Protocol,
  plan: TreatmentPlan,
  staging: StagingResult | null,
  contacts: ContactReport[] | null,
): Issue[] {
  const issues: Issue[] = [];
  const fmt = (n: number) => n.toFixed(Math.abs(n) < 10 ? 2 : 1);

  for (const tp of Object.values(plan.teeth)) {
    const id = tp.id;
    const m = tp.movement;
    if ((tp.locked || tp.extracted) && !isZeroMovement(m)) {
      issues.push({
        severity: 'error',
        rule: 'LOCKED',
        tooth: id,
        message: `${shortLabel(id)} (${id}) is ${tp.locked ? 'locked' : 'extracted'} but has a planned movement — it will not move.`,
      });
      continue;
    }
    for (const k of tp.lockedAxes ?? []) {
      if (Math.abs(m[k]) > 1e-9) {
        issues.push({ severity: 'error', rule: 'LOCKED-AXIS', tooth: id, message: `${shortLabel(id)} (${id}): ${k} is constrained to 0 but has ${fmt(m[k])}.` });
      }
    }
    const lim = totalLimitsFor(protocol, id);
    const checks: [string, number, number, string][] = [
      ['TOTAL-TRANSLATION', Math.hypot(m.mesial, m.buccal), lim.translationMm, 'mm translation'],
      ['TOTAL-EXTRUSION', Math.max(0, m.extrusion), lim.extrusionMm, 'mm extrusion'],
      ['TOTAL-INTRUSION', Math.max(0, -m.extrusion), lim.intrusionMm, 'mm intrusion'],
      ['TOTAL-TIP', Math.abs(m.tip), lim.tipDeg, '° tip'],
      ['TOTAL-TORQUE', Math.abs(m.torque), lim.torqueDeg, '° torque'],
      ['TOTAL-ROTATION', Math.abs(m.rotation), lim.rotationDeg, '° rotation'],
    ];
    for (const [rule, value, max, unit] of checks) {
      if (value > max + 1e-9) {
        issues.push({
          severity: 'warning',
          rule,
          tooth: id,
          message: `${shortLabel(id)} (${id}): ${fmt(value)} ${unit} exceeds the protocol maximum of ${fmt(max)}. Consider staging a refinement or auxiliaries.`,
        });
      }
    }
    for (const rule of triggeredAttachmentRules(protocol, id, m)) {
      if (!tp.attachments.some((a) => a.type === rule.attachment)) {
        issues.push({
          severity: 'warning',
          rule: rule.id,
          tooth: id,
          message: `${shortLabel(id)} (${id}): ${rule.description}.`,
        });
      }
    }
  }

  const iprByArch: Record<string, number> = { upper: 0, lower: 0 };
  for (const e of plan.ipr) {
    const [a] = e.contact.split('-').map(Number);
    iprByArch[archOf(a)] += e.amountMm;
    const max = iprLimit(protocol, e.contact);
    if (e.amountMm > max + 1e-9) {
      issues.push({
        severity: 'error',
        rule: 'IPR-CONTACT',
        contact: e.contact,
        message: `IPR ${fmt(e.amountMm)} mm at ${e.contact} exceeds the ${fmt(max)} mm per-contact limit.`,
      });
    }
    if (staging && e.stage > staging.totalStages && staging.totalStages > 0) {
      issues.push({
        severity: 'warning',
        rule: 'IPR-STAGE',
        contact: e.contact,
        message: `IPR at ${e.contact} is scheduled at stage ${e.stage}, after the last stage (${staging.totalStages}).`,
      });
    }
  }
  for (const arch of ['upper', 'lower']) {
    if (iprByArch[arch] > protocol.ipr.maxTotalPerArchMm + 1e-9) {
      issues.push({
        severity: 'warning',
        rule: 'IPR-TOTAL',
        message: `Total ${arch} IPR ${fmt(iprByArch[arch])} mm exceeds the ${fmt(protocol.ipr.maxTotalPerArchMm)} mm arch maximum.`,
      });
    }
  }

  if (contacts) {
    for (const c of contacts) {
      const ipr = plan.ipr.filter((e) => e.contact === c.contact).reduce((s, e) => s + e.amountMm, 0);
      const overlap = -c.distanceMm - ipr;
      if (overlap > protocol.ipr.overlapToleranceMm) {
        issues.push({
          severity: 'warning',
          rule: 'COLLISION',
          contact: c.contact,
          message: `Contact ${c.contact} overlaps ${fmt(-c.distanceMm)} mm at stage ${c.stage}${ipr ? ` (IPR planned ${fmt(ipr)} mm)` : ''}. Add IPR, expansion or adjust movements.`,
        });
      }
    }
  }

  if (staging) {
    if (staging.totalStages > protocol.staging.maxStages) {
      issues.push({
        severity: 'warning',
        rule: 'MAX-STAGES',
        message: `Plan needs ${staging.totalStages} stages; protocol maximum is ${protocol.staging.maxStages}.`,
      });
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * IPR needed to resolve measured overlaps, rounded up to the protocol step and capped per contact.
 */
export function suggestIpr(protocol: Protocol, contacts: ContactReport[]): { contact: string; amountMm: number; stage: number; capped: boolean }[] {
  const out: { contact: string; amountMm: number; stage: number; capped: boolean }[] = [];
  const worst = new Map<string, ContactReport>();
  for (const c of contacts) {
    const w = worst.get(c.contact);
    if (!w || c.distanceMm < w.distanceMm) worst.set(c.contact, c);
  }
  const firstOverlap = new Map<string, number>();
  for (const c of contacts) {
    if (-c.distanceMm > protocol.ipr.overlapToleranceMm) {
      firstOverlap.set(c.contact, Math.min(firstOverlap.get(c.contact) ?? Infinity, c.stage));
    }
  }
  for (const [contact, c] of worst) {
    const overlap = -c.distanceMm;
    if (overlap <= protocol.ipr.overlapToleranceMm) continue;
    const step = protocol.ipr.stepMm;
    const raw = Math.ceil((overlap - 1e-9) / step) * step;
    const max = iprLimit(protocol, contact);
    const stage = Math.max(protocol.ipr.defaultStage, (firstOverlap.get(contact) ?? protocol.ipr.defaultStage) - 1);
    out.push({ contact, amountMm: Math.round(Math.min(raw, max) * 100) / 100, stage, capped: raw > max + 1e-9 });
  }
  return out;
}
