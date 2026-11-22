// Build self-contained pages (all CSS/JS inlined) into dist/.
// Useful for loading the app into a sandboxed preview (e.g. DSH np pages) and for sharing one file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function inline(html) {
  html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (_, href) => {
    const css = read(href).replace(/<\/style/gi, '<\\/style');
    return `<style>\n${css}\n</style>`;
  });
  html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (_, src) => {
    const js = read(src).replace(/<\/script/gi, '<\\/script');
    return `<script>\n${js}\n</script>`;
  });
  return html;
}

for (const page of ['chat.html', 'editor.html']) {
  const html = inline(fs.readFileSync(path.join(root, page), 'utf8'));
  fs.writeFileSync(path.join(dist, page), html);
  console.log('built dist/' + page, (html.length / 1024).toFixed(1) + ' KB');
}

// The shell uses shell.css plus the standalone i18n runtime; inline both so
// dist/index.html keeps working when it is opened outside this folder.
let shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
shell = inline(shell);
fs.writeFileSync(path.join(dist, 'index.html'), shell);
console.log('built dist/index.html', (shell.length / 1024).toFixed(1) + ' KB');
