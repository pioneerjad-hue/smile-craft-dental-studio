import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { getState, setState, toast } from './store';
import type { View } from './store';
import { studio } from './studio';
import { download, safeName } from './project';

export interface VideoOptions {
  width: number;
  height: number;
  fps: number;
  /** Seconds the animation spends on each aligner stage. */
  secondsPerStage: number;
  /** Pause on the initial and final positions (seconds). */
  holdSeconds: number;
  /** One animated segment per view, in order. */
  views: View[];
  overlay: boolean;
  showInitial: boolean;
}

export const VIEW_LABEL: Record<View, string> = {
  front: 'Frontal',
  right: 'Right buccal',
  left: 'Left buccal',
  upperOcclusal: 'Upper occlusal',
  lowerOcclusal: 'Lower occlusal',
};

const CODECS: { codec: string; mux: 'avc' | 'vp9' }[] = [
  { codec: 'avc1.640034', mux: 'avc' }, // H.264 High@5.2: plays everywhere (QuickTime, PowerPoint, phones)
  { codec: 'avc1.4d0034', mux: 'avc' },
  { codec: 'avc1.42003e', mux: 'avc' },
  { codec: 'vp09.00.40.08', mux: 'vp9' },
];

export function videoSupported(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

async function pickCodec(width: number, height: number, bitrate: number, fps: number) {
  for (const c of CODECS) {
    const config: VideoEncoderConfig = { codec: c.codec, width, height, bitrate, framerate: fps, avc: c.mux === 'avc' ? { format: 'avc' } : undefined };
    try {
      const res = await VideoEncoder.isConfigSupported(config);
      if (res.supported) return { config, mux: c.mux };
    } catch {
      /* try next */
    }
  }
  return null;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * Render the staged treatment as an MP4 (H.264) simulation, one segment per view: hold on the
 * initial position, animate through every aligner, hold on the final position.
 */
export async function exportVideo(opts: VideoOptions) {
  const viewer = studio.viewer;
  if (!viewer) return;
  if (!videoSupported()) {
    toast('This browser cannot encode video. Use a current Chrome, Edge or Safari.', 'error');
    return;
  }
  const s0 = getState();
  const total = s0.staging?.totalStages ?? 0;
  const width = opts.width - (opts.width % 2);
  const height = opts.height - (opts.height % 2);
  const picked = await pickCodec(width, height, Math.round(width * height * opts.fps * 0.12), opts.fps);
  if (!picked) {
    toast('No supported video codec found in this browser.', 'error');
    return;
  }
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: picked.mux, width, height, frameRate: opts.fps },
    fastStart: 'in-memory',
  });
  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e as Error),
  });
  encoder.configure(picked.config);

  // Save viewer state
  const renderer = viewer.renderer;
  const canvas3d = renderer.domElement;
  const prevSettings = s0.settings;
  const prevStage = s0.stage;
  const prevSelected = s0.selectedTooth;
  const camState = { pos: viewer.camera.position.clone(), up: viewer.camera.up.clone(), zoom: viewer.camera.zoom, target: viewer.controls.target.clone() };
  setState({ playing: false, selectedTooth: null, settings: { ...prevSettings, showGhost: opts.showInitial, showAxes: false } });

  const frame2d = document.createElement('canvas');
  frame2d.width = width;
  frame2d.height = height;
  const ctx = frame2d.getContext('2d')!;
  const holdFrames = Math.round(opts.holdSeconds * opts.fps);
  const moveFrames = Math.max(1, Math.round(Math.max(1, total) * opts.secondsPerStage * opts.fps));
  const perView = holdFrames * 2 + moveFrames;
  const totalFrames = perView * opts.views.length;
  let frameNo = 0;

  try {
    renderer.setSize(width, height, false);
    const aspect = width / height;
    for (const view of opts.views) {
      studio.setView(view);
      // setView sizes the camera for the on-screen canvas; refit for the video aspect ratio
      const H = viewer.camera.top - viewer.camera.bottom;
      viewer.camera.left = (-H * aspect) / 2;
      viewer.camera.right = (H * aspect) / 2;
      viewer.camera.updateProjectionMatrix();
      for (let f = 0; f < perView; f++) {
        let stage: number;
        if (f < holdFrames) stage = 0;
        else if (f < holdFrames + moveFrames) stage = ease((f - holdFrames) / moveFrames) * total;
        else stage = total;
        studio.applyStage(stage);
        for (const arch of ['upper', 'lower'] as const) {
          const g = viewer.ghostMeshes[arch];
          if (g) g.visible = opts.showInitial && stage > 0.01 && (arch === 'upper' ? getState().settings.showUpper : getState().settings.showLower);
        }
        renderer.render(viewer.scene, viewer.camera);
        drawFrame(ctx, canvas3d, width, height, stage, total, view, opts.overlay);
        const frame = new VideoFrame(frame2d, { timestamp: Math.round((frameNo * 1e6) / opts.fps), duration: Math.round(1e6 / opts.fps) });
        encoder.encode(frame, { keyFrame: frameNo % (opts.fps * 2) === 0 });
        frame.close();
        frameNo++;
        if (encodeError) throw encodeError;
        if (encoder.encodeQueueSize > 8 || frameNo % 6 === 0) {
          setState({ busy: `Rendering video… ${Math.round((frameNo / totalFrames) * 100)}%` });
          await new Promise((r) => setTimeout(r, 0));
          while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
        }
      }
    }
    setState({ busy: 'Finishing video…' });
    await encoder.flush();
    muxer.finalize();
    const data = new Uint8Array(muxer.target.buffer);
    const c = getState().caseInfo;
    download(data, `${safeName(c.caseId || c.patientName)}_simulation.mp4`, 'video/mp4');
    toast(`Simulation video exported (${(frameNo / opts.fps).toFixed(0)} s, ${picked.mux === 'avc' ? 'H.264' : 'VP9'}).`, 'success');
  } catch (e) {
    toast(`Video export failed: ${(e as Error).message}`, 'error');
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    setState({ busy: null, settings: prevSettings, selectedTooth: prevSelected });
    viewer.camera.position.copy(camState.pos);
    viewer.camera.up.copy(camState.up);
    viewer.camera.zoom = camState.zoom;
    viewer.controls.target.copy(camState.target);
    viewer.resize();
    viewer.controls.update();
    setState({ stage: prevStage });
    studio.applyStage();
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, w: number, h: number, stage: number, total: number, view: View, overlay: boolean) {
  const g = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#1b2a47');
  g.addColorStop(1, '#0b1220');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if (!overlay) return;
  const s = getState();
  const u = h / 1080;
  ctx.fillStyle = 'rgba(230,237,247,0.95)';
  ctx.font = `600 ${Math.round(34 * u)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  const name = [s.caseInfo.patientName, s.caseInfo.caseId].filter(Boolean).join(' · ');
  if (name) ctx.fillText(name, 40 * u, 34 * u);
  ctx.font = `${Math.round(26 * u)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(142,160,191,0.95)';
  ctx.fillText(VIEW_LABEL[view], 40 * u, 80 * u);
  const label = stage <= 0.001 ? 'Initial' : stage >= total - 0.001 ? `Final · ${total} aligners` : `Aligner ${Math.ceil(stage)} / ${total}`;
  ctx.font = `600 ${Math.round(34 * u)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(230,237,247,0.95)';
  ctx.textAlign = 'right';
  ctx.fillText(label, w - 40 * u, 34 * u);
  ctx.textAlign = 'left';
  // progress bar
  const barY = h - 46 * u, barX = 40 * u, barW = w - 80 * u;
  ctx.fillStyle = 'rgba(36,49,77,0.9)';
  ctx.fillRect(barX, barY, barW, 8 * u);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(barX, barY, barW * (total ? stage / total : 0), 8 * u);
}
