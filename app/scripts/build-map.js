// Incorpora Leaflet + MarkerCluster nel modello e genera src/mapHtml.ts (la mappa funziona senza scaricare script).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const lf = (...p) => fs.readFileSync(path.join(root, 'vendor', ...p), 'utf8');
let t = fs.readFileSync(path.join(__dirname, 'map.template.html'), 'utf8');
const rep = (k, v) => { t = t.replace(k, () => v); };
rep('/*LEAFLET_CSS*/', lf('leaflet.css'));
rep('/*CLUSTER_CSS*/', lf('MarkerCluster.css') + lf('MarkerCluster.Default.css'));
rep('/*LEAFLET_JS*/', lf('leaflet.js').replace(/<\/script/gi, '<\\/script'));
rep('/*CLUSTER_JS*/', lf('leaflet.markercluster.js').replace(/<\/script/gi, '<\\/script'));
rep('/*ITALIA*/', lf('italia.json'));
fs.writeFileSync(path.join(root, 'src', 'mapHtml.ts'), '// GENERATO da scripts/build-map.js: non modificare a mano.\nexport const MAP_HTML = ' + JSON.stringify(t) + ';\n');
console.log('mapHtml.ts', (t.length / 1024).toFixed(0) + ' KB');
