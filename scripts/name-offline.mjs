import { renameSync } from 'node:fs';
renameSync('dist-offline/index.html', 'dist-offline/SmileCraftStudio.html');
console.log('Offline app: dist-offline/SmileCraftStudio.html');
