// Produces a single self-contained HTML file that runs the whole tool offline.
// Reads the Vite build in dist/, inlines the CSS + JS (ExcelJS and all app logic
// are already bundled into the JS), and writes offline/Authorize_Sales_Entry_Tool.html.
// Double-click that file in any browser — no server, no internet needed.

import fs from 'fs';
import path from 'path';

const dist = 'dist';
const outDir = 'offline';
const outFile = path.join(outDir, 'Authorize_Sales_Entry_Tool.html');

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const assets = fs.readdirSync(path.join(dist, 'assets'));
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (!jsName || !cssName) throw new Error('Could not find built JS/CSS assets in dist/assets.');

const js = fs.readFileSync(path.join(dist, 'assets', jsName), 'utf8');
const css = fs.readFileSync(path.join(dist, 'assets', cssName), 'utf8');

// Escaping so the bundle text can't prematurely close its own tag.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
const safeCss = css.replace(/<\/style>/gi, '<\\/style>');

// Use replacement FUNCTIONS, not strings: a string replacement treats "$" as
// special ($&, $1, $`, $'…) and the minified bundle is full of "$", which would
// corrupt the inlined code.
let out = html
  // Replace the external stylesheet link with an inline <style>
  .replace(
    /<link[^>]*rel="stylesheet"[^>]*>/i,
    () => `<style>\n${safeCss}\n</style>`
  )
  // Replace the external module script with an inline one
  .replace(
    /<script[^>]*src="[^"]*"[^>]*><\/script>/i,
    () => `<script type="module">\n${safeJs}\n</script>`
  );

if (/<script[^>]*src=/i.test(out) || /rel="stylesheet"/i.test(out)) {
  throw new Error('Inlining failed — an external asset reference remains.');
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, out);

const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`Wrote ${outFile} (${kb} KB) — self-contained, works offline.`);
