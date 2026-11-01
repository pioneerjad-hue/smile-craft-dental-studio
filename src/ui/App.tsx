import { useEffect, useRef } from 'react';
import { getState, setState, useStudio } from '../engine/store';
import type { Step } from '../engine/store';
import { studio } from '../engine/studio';
import { loadProjectZip, saveProject, scheduleAutosave } from '../engine/project';
import { Toast } from './common';
import { Viewport } from './Viewport';
import { ImportPanel } from './panels/ImportPanel';
import { SegmentPanel } from './panels/SegmentPanel';
import { OrientPanel } from './panels/OrientPanel';
import { AxesPanel } from './panels/AxesPanel';
import { PlanPanel, ToothInspector } from './panels/PlanPanel';
import { StagePanel } from './panels/StagePanel';
import { ProtocolPanel } from './panels/ProtocolPanel';
import { ExportPanel } from './panels/ExportPanel';
import { RightPanel } from './panels/RightPanel';
import { toast } from '../engine/store';

const STEPS: [Step, string][] = [
  ['import', 'Case & scans'],
  ['orient', 'Orient'],
  ['segment', 'Segment'],
  ['axes', 'Axes'],
  ['plan', 'Plan'],
  ['stage', 'Stage & check'],
  ['protocol', 'Protocol & AI'],
  ['export', 'Export'],
];

export function goToStep(step: Step) {
  const tool = step === 'segment' ? 'seed' : step === 'import' || step === 'orient' ? 'orbit' : 'select';
  setState({ step, tool, playing: false, orientPoints: 0 });
  if (step === 'segment' || step === 'orient' || step === 'axes') setState({ stage: 0 });
}

export function App() {
  const step = useStudio((s) => s.step);
  const teeth = useStudio((s) => s.teeth);
  const arches = useStudio((s) => s.arches);
  const caseInfo = useStudio((s) => s.caseInfo);
  const openRef = useRef<HTMLInputElement>(null);
  const hasScan = !!(arches.upper || arches.lower);

  useEffect(() => {
    const unsub = useStudio.subscribe((s, p) => {
      if (s.plan !== p.plan || s.teeth !== p.teeth || s.protocol !== p.protocol || s.caseInfo !== p.caseInfo) scheduleAutosave();
    });
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const s = getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) studio.redo();
        else studio.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        studio.redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject();
      } else if (!mod) {
        const views = ['front', 'right', 'left', 'upperOcclusal', 'lowerOcclusal'] as const;
        if (e.key >= '1' && e.key <= '5') studio.setView(views[+e.key - 1]);
        else if (e.key === '[') studio.setStage(s.stage - 1);
        else if (e.key === ']') studio.setStage(s.stage + 1);
        else if (e.key === 'Home') studio.setStage(0);
        else if (e.key === 'End') studio.setStage(s.staging?.totalStages ?? 0);
        else if (e.key === ' ' && s.step !== 'segment' && s.step !== 'import') {
          e.preventDefault();
          setState({ playing: !s.playing });
        } else if (e.key === 'Escape') setState({ selectedTooth: null, tool: s.step === 'segment' ? 'seed' : 'select' });
        else if (e.key.toLowerCase() === 'm') setState({ tool: s.tool === 'measure' ? 'select' : 'measure' });
        else if (e.key.toLowerCase() === 'g') setState({ settings: { ...s.settings, showGhost: !s.settings.showGhost } });
        else if (e.key.toLowerCase() === 'u') setState({ settings: { ...s.settings, showUpper: !s.settings.showUpper } });
        else if (e.key.toLowerCase() === 'l') setState({ settings: { ...s.settings, showLower: !s.settings.showLower } });
        else if (s.step === 'segment' && e.key.toLowerCase() === 'b') setState({ tool: 'brushAdd' });
        else if (s.step === 'segment' && e.key.toLowerCase() === 'e') setState({ tool: 'brushErase' });
        else if (s.step === 'segment' && e.key.toLowerCase() === 's') setState({ tool: 'seed' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unsub();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const oriented = useStudio((s) => s.oriented);
  const stepEnabled = (st: Step) => st === 'import' || (st === 'segment' || st === 'orient' ? hasScan : teeth.length > 0);
  const stepDone = (st: Step) => (st === 'import' ? hasScan : st === 'orient' ? oriented : st === 'segment' ? teeth.length > 0 : false);

  const openProject = async (file: File) => {
    try {
      setState({ busy: 'Opening project…' });
      await new Promise((r) => setTimeout(r, 0));
      loadProjectZip(new Uint8Array(await file.arrayBuffer()));
      toast(`Opened ${file.name}`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setState({ busy: null });
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span style={{ fontSize: 20 }}>🦷</span> Smile Craft <small>Dental Studio</small>
        </div>
        <nav className="steps">
          {STEPS.map(([st, label], i) => (
            <button key={st} className={`${step === st ? 'active' : ''} ${stepDone(st) ? 'done' : ''}`} disabled={!stepEnabled(st)} onClick={() => goToStep(st)}>
              <span className="num">{stepDone(st) ? '✓' : i + 1}</span>
              <span className="label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="case" title={caseInfo.notes}>
          {caseInfo.patientName || 'No patient'} {caseInfo.caseId && <span>· {caseInfo.caseId}</span>}
        </div>
        <button className="icon" title="Undo (Ctrl+Z)" onClick={() => studio.undo()}>
          ↶
        </button>
        <button className="icon" title="Redo (Ctrl+Y)" onClick={() => studio.redo()}>
          ↷
        </button>
        <button onClick={() => openRef.current?.click()}>Open</button>
        <button className="primary" onClick={saveProject} disabled={!hasScan}>
          Save
        </button>
        <input
          ref={openRef}
          type="file"
          accept=".smile,.zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openProject(f);
            e.target.value = '';
          }}
        />
      </header>
      <div className="main">
        <aside className="side">
          {step === 'import' && <ImportPanel />}
          {step === 'orient' && <OrientPanel />}
          {step === 'segment' && <SegmentPanel />}
          {step === 'axes' && <AxesPanel />}
          {step === 'plan' && <PlanPanel />}
          {step === 'stage' && <StagePanel />}
          {step === 'protocol' && <ProtocolPanel />}
          {step === 'export' && <ExportPanel />}
        </aside>
        <Viewport />
        <aside className="side right">{step === 'plan' ? <ToothInspector /> : <RightPanel />}</aside>
      </div>
      <Toast />
    </div>
  );
}
