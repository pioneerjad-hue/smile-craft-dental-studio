import { renameSync } from 'node:fs';
renameSync('dist-builder/viewer-builder.html', 'dist-builder/SimulationViewer.html');
console.log('Simulation viewer builder: dist-builder/SimulationViewer.html');
