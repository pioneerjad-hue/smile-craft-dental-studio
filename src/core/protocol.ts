import type { Protocol } from './types';

/**
 * Default clear-aligner protocol. Every value is editable in the Protocol panel and is saved with
 * the case, so the same rules drive manual planning, validation and (later) the AI planner.
 */
export function defaultProtocol(): Protocol {
  return {
    name: 'Smile Craft standard aligner protocol',
    version: 1,
    description: 'Conservative per-aligner limits for thermoformed aligners worn 22 h/day.',
    staging: {
      mode: 'synchronized',
      limits: {
        translationMm: 0.25,
        extrusionMm: 0.2,
        intrusionMm: 0.2,
        tipDeg: 2,
        torqueDeg: 1.5,
        rotationDeg: 2,
        crownDisplacementMm: 0.35,
      },
      overrides: {
        canine: { rotationDeg: 1.5 },
        firstPremolar: { rotationDeg: 1.5 },
        secondPremolar: { rotationDeg: 1.5 },
        firstMolar: { translationMm: 0.2, rotationDeg: 1 },
        secondMolar: { translationMm: 0.2, rotationDeg: 1 },
        thirdMolar: { translationMm: 0.2, rotationDeg: 1 },
      },
      syncArches: true,
      daysPerStage: 7,
      maxStages: 60,
    },
    biomechanics: {
      pivotApicalMm: {
        centralIncisor: 10,
        lateralIncisor: 9.5,
        canine: 12,
        firstPremolar: 9,
        secondPremolar: 9,
        firstMolar: 7,
        secondMolar: 7,
        thirdMolar: 6,
      },
      axisMode: 'crown',
      // Average root lengths (Wheeler's Dental Anatomy averages), teeth 1–8
      rootLengthMm: {
        upper: [13, 13, 17, 14, 14, 13, 12, 11],
        lower: [12.5, 14, 16, 14, 14.5, 14, 13, 11],
      },
      centerOfResistanceRatio: 0.4,
    },
    totalLimits: {
      translationMm: 4,
      extrusionMm: 2.5,
      intrusionMm: 3,
      tipDeg: 15,
      torqueDeg: 15,
      rotationDeg: 35,
      overrides: {
        canine: { rotationDeg: 25, extrusionMm: 1.5 },
        firstPremolar: { rotationDeg: 25, extrusionMm: 1 },
        secondPremolar: { rotationDeg: 25, extrusionMm: 1 },
        firstMolar: { rotationDeg: 15, extrusionMm: 0.5, intrusionMm: 1 },
        secondMolar: { rotationDeg: 15, extrusionMm: 0.5, intrusionMm: 1 },
      },
    },
    ipr: {
      maxPerContactMm: 0.5,
      maxPerContactAnteriorMm: 0.4,
      maxTotalPerArchMm: 4,
      stepMm: 0.1,
      defaultStage: 1,
      overlapToleranceMm: 0.15,
    },
    attachments: {
      defaultStage: 0,
      rules: [
        {
          id: 'ATT-ROT',
          description: 'Rotation ≥ 15° on canines/premolars needs a vertical rectangular attachment',
          trigger: 'rotation',
          toothTypes: ['canine', 'firstPremolar', 'secondPremolar'],
          threshold: 15,
          attachment: 'rectangularVertical',
        },
        {
          id: 'ATT-EXT',
          description: 'Extrusion ≥ 0.5 mm needs a gingivally beveled attachment',
          trigger: 'extrusion',
          toothTypes: ['centralIncisor', 'lateralIncisor', 'canine', 'firstPremolar', 'secondPremolar'],
          threshold: 0.5,
          attachment: 'beveledGingival',
        },
        {
          id: 'ATT-BODILY',
          description: 'Mesio-distal translation ≥ 1.5 mm on canines/premolars/molars needs root control',
          trigger: 'translation',
          toothTypes: ['canine', 'firstPremolar', 'secondPremolar', 'firstMolar', 'secondMolar'],
          threshold: 1.5,
          attachment: 'rectangularVertical',
        },
        {
          id: 'ATT-TIP',
          description: 'Tip ≥ 8° needs a vertical rectangular attachment',
          trigger: 'tip',
          toothTypes: ['canine', 'firstPremolar', 'secondPremolar', 'firstMolar'],
          threshold: 8,
          attachment: 'rectangularVertical',
        },
      ],
    },
    constraints: { enforceTotalLimits: false },
    clinicalNotes: [
      'Prefer expansion and proclination limits before IPR; IPR only on contacts mesial of first molars.',
      'Do not move teeth marked as locked (implants, bridges).',
      'Sequence: resolve rotations and alignment first, intrusion of anteriors after leveling.',
      'Overcorrect rotations of canines and premolars by 2°.',
    ].join('\n'),
  };
}

/** Deep-merge a partial protocol onto the defaults (used when loading older/partial files). */
export function normalizeProtocol(p: Partial<Protocol> | undefined): Protocol {
  const d = defaultProtocol();
  if (!p) return d;
  return {
    ...d,
    ...p,
    staging: {
      ...d.staging,
      ...p.staging,
      limits: { ...d.staging.limits, ...p.staging?.limits },
      overrides: p.staging?.overrides ?? d.staging.overrides,
    },
    biomechanics: {
      ...d.biomechanics,
      ...p.biomechanics,
      pivotApicalMm: { ...d.biomechanics.pivotApicalMm, ...p.biomechanics?.pivotApicalMm },
      rootLengthMm: { ...d.biomechanics.rootLengthMm, ...p.biomechanics?.rootLengthMm },
    },
    totalLimits: { ...d.totalLimits, ...p.totalLimits, overrides: p.totalLimits?.overrides ?? d.totalLimits.overrides },
    ipr: { ...d.ipr, ...p.ipr },
    attachments: { ...d.attachments, ...p.attachments, rules: p.attachments?.rules ?? d.attachments.rules },
    constraints: { ...d.constraints, ...p.constraints },
  };
}
