// Builds the plugin into dist/:
//   dist/code.js  the main thread, bundled for Figma's plugin sandbox (ES2017)
//   dist/ui.html  the UI, with its script and styles inlined, since Figma loads
//                 the UI from one HTML string (__html__)
//
// node scripts/build.mjs           one build, minified
// node scripts/build.mjs --watch   rebuilds on every change, not minified

import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const minify = !watch;

await mkdir('dist', { recursive: true });

/** @type {esbuild.BuildOptions} */
const codeOptions = {
  entryPoints: ['src/code.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2017',
  outfile: 'dist/code.js',
  minify,
  legalComments: 'none',
  logLevel: 'info',
};

/** Puts the UI bundle into the HTML template. */
async function writeHtml(result) {
  if (result.errors.length > 0) return;
  const js = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
  const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (/<!--|<script/i.test(js)) {
    throw new Error('The UI bundle contains "<!--" or "<script", which would break the inline script tag.');
  }
  const template = await readFile('src/ui/index.html', 'utf8');
  if (!template.includes('/* styles */') || !template.includes('/* script */')) {
    throw new Error('src/ui/index.html lost its /* styles */ or /* script */ placeholder.');
  }
  const html = template
    .replace('/* styles */', () => css.trim())
    .replace('/* script */', () => js.replace(/<\/script/gi, '<\\/script').trim());
  await writeFile('dist/ui.html', html);
  console.log(`  dist/ui.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)}kb`);
}

/** @type {esbuild.BuildOptions} */
const uiOptions = {
  entryPoints: ['src/ui/main.tsx'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outdir: 'dist/.ui',
  write: false,
  minify,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  legalComments: 'none',
  logLevel: 'info',
  plugins: [
    {
      name: 'inline-html',
      setup(build) {
        build.onEnd(writeHtml);
      },
    },
  ],
};

if (watch) {
  const code = await esbuild.context(codeOptions);
  const ui = await esbuild.context(uiOptions);
  await Promise.all([code.watch(), ui.watch()]);
  console.log('Watching src/ for changes.');
} else {
  await Promise.all([esbuild.build(codeOptions), esbuild.build(uiOptions)]);
}
