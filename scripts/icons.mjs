// Extracts a small set of VS Code-style file icons into src/icons.json at build time
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const set = JSON.parse(fs.readFileSync(require.resolve('@iconify-json/vscode-icons/icons.json'), 'utf8'))
const find = n => set.icons[n] || (set.aliases?.[n] && set.icons[set.aliases[n].parent])
const WANT = {
  html: ['file-type-html'], js: ['file-type-js-official', 'file-type-js'], ts: ['file-type-typescript-official', 'file-type-typescript'],
  jsx: ['file-type-reactjs'], tsx: ['file-type-reactts'], json: ['file-type-json'], css: ['file-type-css'], scss: ['file-type-scss'],
  md: ['file-type-markdown'], svg: ['file-type-svg'], npm: ['file-type-npm'], git: ['file-type-git'], eslint: ['file-type-eslint'],
  vite: ['file-type-vite'], image: ['file-type-image'], yaml: ['file-type-yaml'], php: ['file-type-php'], py: ['file-type-python'],
  txt: ['file-type-text'], default: ['default-file'],
}
const out = {}
for (const [k, names] of Object.entries(WANT)) {
  const n = names.find(find)
  if (!n) { console.warn('icon missing:', k); continue }
  const d = find(n), w = d.width || set.width || 16, h = d.height || set.height || 16
  out[k] = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${d.body}</svg>`
}
fs.writeFileSync('src/icons.json', JSON.stringify(out))
console.log('icons:', Object.keys(out).length)
