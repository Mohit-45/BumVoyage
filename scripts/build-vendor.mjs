// Builds public/vendor/three.min.js: three.js and two helpers from its examples folder, cut down to the
// names the game uses. The names come from the sources themselves (every `THREE.Name` in the browser code,
// the scripts and the tests), so using a new one only needs a rebuild:
//   npm run build:vendor [-- --out file]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Folders whose files import the bundle (public/vendor holds the output, so it is never scanned).
const CONSUMERS = ['public/js', 'scripts', 'test'];
// Names that three.js keeps out of its main entry point: they live in its examples folder.
const EXAMPLES = {
  mergeGeometries: 'three/examples/jsm/utils/BufferGeometryUtils.js',
  RoomEnvironment: 'three/examples/jsm/environments/RoomEnvironment.js',
};
// Always bundled, so the tests can check which three.js version went in.
const ALWAYS = ['REVISION'];
const IMPORT_LINE = /^import\s+(.*?)\s+from\s+'[^']*three\.min\.js';?\s*$/gm;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(file);
    else if (/\.m?js$/.test(entry.name)) yield file;
  }
}

/** Every three.js name the sources use, sorted. Throws when a file uses the bundle in a way this scan cannot follow. */
export function usedNames(base = root) {
  const names = new Set(ALWAYS);
  for (const dir of CONSUMERS) {
    for (const file of sourceFiles(path.join(base, dir))) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(IMPORT_LINE)];
      if (!imports.length) continue;
      const where = path.relative(base, file);
      const alias = imports.length === 1 ? /^\* as (\w+)$/.exec(imports[0][1])?.[1] : undefined;
      if (!alias) throw new Error(`${where}: import the bundle once, as "import * as THREE from ...", so the build can see which names are used`);
      const code = text
        .replace(IMPORT_LINE, '')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join('\n');
      const stray = new RegExp(`\\b${alias}\\b(?!\\.[A-Za-z_$])`).exec(code);
      if (stray) throw new Error(`${where}: ${alias} is used as a value near "${code.slice(stray.index, stray.index + 30).split('\n')[0]}"; write ${alias}.Name so the build can see which names are used`);
      for (const match of code.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, 'g'))) names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** Bundles the names found by usedNames() into `out`. esbuild is loaded here so that the scan above works without it. */
export async function buildVendor(out = path.join(root, 'public/vendor/three.min.js')) {
  const { build } = await import('esbuild');
  const names = usedNames();
  const entry = [
    `export { ${names.filter((name) => !(name in EXAMPLES)).join(', ')} } from 'three';`,
    ...names.filter((name) => name in EXAMPLES).map((name) => `export { ${name} } from '${EXAMPLES[name]}';`),
  ].join('\n');
  await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'vendor-entry.js' },
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: out,
    logLevel: 'error',
  });
  return names;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--out');
  const out = flag > 0 ? path.resolve(process.argv[flag + 1]) : undefined;
  const names = await buildVendor(out);
  console.log(`${path.relative(process.cwd(), out ?? path.join(root, 'public/vendor/three.min.js'))}: ${names.length} three.js names`);
}
