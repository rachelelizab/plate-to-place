// Bundles engine + frontend into one self-contained page.
//   frontend/dist/index.html     — full document served by `npm start`
//   frontend/dist/artifact.html  — same page without the html/head/body wrapper (static live demo)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ORDER = ['hashmap', 'minheap', 'bst', 'avl', 'kinetic', 'graph', 'city', 'sim', 'bench', 'live'];
const EXPORTS = ['HashMap', 'MinHeap', 'BST', 'AVLTree', 'KineticHeap', 'RoadGraph', 'congestion', 'buildScenario', 'buildCity', 'mulberry32',
  'AREAS', 'WIDTH_KM', 'HEIGHT_KM', 'toXY', 'simulate', 'compare', 'scenarioView', 'fmt', 'STRATEGIES', 'benchTrees', 'benchKinetic', 'LiveDispatcher'];

let engine = '';
for (const f of ORDER) {
  const src = await readFile(path.join(ROOT, 'engine', f + '.js'), 'utf8');
  const names = [...src.matchAll(/^export (?:const|function|class|let) (\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^import .*?;\s*$/gm, '').replace(/^export (const|function|class|let) /gm, '$1 ');
  // each module keeps its own scope; only its exports reach the shared bundle scope
  engine += `\n// ---- engine/${f}.js ----\nconst { ${names.join(', ')} } = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();\n`;
}
engine = `window.P2P = (() => {\n${engine}\nreturn { ${EXPORTS.join(', ')} };\n})();`;

const css = await readFile(path.join(ROOT, 'frontend', 'app.css'), 'utf8');
const html = await readFile(path.join(ROOT, 'frontend', 'app.html'), 'utf8');
const app = await readFile(path.join(ROOT, 'frontend', 'app.js'), 'utf8');

const head = `<title>Plate2Place</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Spoilage-aware surplus-food rescue dispatch for Bengaluru: kinetic heap, AVL tree, time-dependent Dijkstra.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Atkinson+Hyperlegible:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${css}</style>`;
const body = `${html}\n<script>\n${engine}\n</script>\n<script>\n${app}\n</script>\n`;

await mkdir(path.join(ROOT, 'frontend', 'dist'), { recursive: true });
await writeFile(path.join(ROOT, 'frontend', 'dist', 'artifact.html'), head + '\n' + body);
await writeFile(path.join(ROOT, 'frontend', 'dist', 'index.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style>\n</head>\n<body>\n${body}</body>\n</html>\n`);
console.log('built frontend/dist/index.html and artifact.html', ((head.length + body.length) / 1024).toFixed(0) + ' KB');
