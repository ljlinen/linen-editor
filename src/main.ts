import './style.css'
import ICONS from './icons.json'
import { registerPlugin } from '@capacitor/core'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { history, defaultKeymap, historyKeymap, indentMore, undo, redo, cursorLineUp, cursorLineDown, cursorCharLeft, cursorCharRight } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { closeBrackets } from '@codemirror/autocomplete'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { abbreviationTracker, expandAbbreviation } from '@emmetio/codemirror6-plugin'

type Entry = { name: string; uri: string; isDir: boolean }
const Saf = registerPlugin<{
  pickFolder(): Promise<{ uri: string }>
  list(o: { uri: string }): Promise<{ entries: Entry[] }>
  read(o: { uri: string }): Promise<{ text: string }>
  readBase64(o: { uri: string }): Promise<{ data: string }>
  write(o: { uri: string; text: string }): Promise<void>
}>('Saf')
type Tab = { uri: string; name: string; state: EditorState; dirty: boolean }

const $ = (s: string) => document.querySelector(s) as HTMLElement
const svg = (d: string, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
const IC = {
  menu: 'M4 6h16M4 12h16M4 18h16', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', run: 'M7 5l12 7-12 7z', cmd: 'M9 9V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z', check: 'M5 12.5l4.5 4.5L19 7.5', folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6', chev: 'M9 6l6 6-6 6', x: 'M6 6l12 12M18 6L6 18', tab: 'M3 12h13M12 7l5 5-5 5M21 5v14',
  up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
}
$('#menu').innerHTML = svg(IC.menu); $('#search').innerHTML = svg(IC.search); $('#run').innerHTML = svg(IC.run, 26); $('#save').innerHTML = svg(IC.check, 28)
$('#refresh').innerHTML = svg(IC.refresh, 22); $('#open').innerHTML = svg(IC.folder, 24)

const ALIAS: Record<string, string> = { htm: 'html', mjs: 'js', cjs: 'js', yml: 'yaml', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', ico: 'image', markdown: 'md' }
const iconKey = (n: string) => {
  const l = n.toLowerCase()
  if (l.startsWith('package') && l.endsWith('.json')) return 'npm'
  if (l.startsWith('.git')) return 'git'
  if (l.startsWith('eslint') || l.startsWith('.eslint')) return 'eslint'
  if (l.startsWith('vite.config')) return 'vite'
  const e = l.split('.').pop()!
  return ALIAS[e] || e
}
const badge = (n: string) => {
  const b = document.createElement('span'); b.className = 'fi'
  b.innerHTML = (ICONS as Record<string, string>)[iconKey(n)] || (ICONS as Record<string, string>).default || ''
  return b
}
const langFor = (n: string) => {
  const e = n.split('.').pop()!.toLowerCase()
  if (e === 'html' || e === 'htm') return html()
  if (e === 'css') return css()
  if (['js', 'mjs', 'jsx'].includes(e)) return javascript({ jsx: true })
  if (['ts', 'tsx'].includes(e)) return javascript({ typescript: true, jsx: true })
  if (e === 'json') return json()
  if (e === 'md') return markdown()
  return []
}

let tabs: Tab[] = []
let cur: Tab | null = null
let root = ''
const tabKey = (v: EditorView) => expandAbbreviation(v) || indentMore(v)

function toast(m: string) {
  const t = $('#toast'); t.textContent = m; t.classList.add('on')
  clearTimeout((toast as any).h); (toast as any).h = setTimeout(() => t.classList.remove('on'), 1800)
}
function mkState(doc: string, name: string) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(), highlightActiveLine(), history(), bracketMatching(), closeBrackets(), indentOnInput(),
      oneDark, langFor(name), abbreviationTracker(), EditorView.lineWrapping,
      Prec.highest(keymap.of([{ key: 'Tab', run: tabKey }, { key: 'Mod-s', run: () => { save(); return true } }])),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of(u => { if (u.docChanged && cur && !cur.dirty) { cur.dirty = true; drawTabs() } }),
      EditorView.theme({
        '&': { backgroundColor: '#060b16', fontSize: '15px' },
        '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65' },
        '.cm-gutters': { backgroundColor: 'transparent', border: '0', color: '#4b566b' },
        '.cm-activeLine': { backgroundColor: '#111a2e' }, '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8a93a6' },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
  })
}
const view = new EditorView({ parent: $('#editor'), state: EditorState.create({ doc: '' }) })

function drawTabs() {
  const bar = $('#tabs'); bar.replaceChildren()
  for (const t of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (t === cur ? ' on' : '') + (t.dirty ? ' dirty' : '')
    const n = document.createElement('span'); n.className = 'nm'; n.textContent = t.name
    const x = document.createElement('button'); x.className = 'x'; x.innerHTML = svg(IC.x, 16); x.setAttribute('aria-label', 'Close ' + t.name)
    el.onclick = () => activate(t)
    x.onclick = ev => { ev.stopPropagation(); closeTab(t) }
    el.append(badge(t.name), n, x); bar.append(el)
    if (t === cur) requestAnimationFrame(() => el.scrollIntoView({ inline: 'nearest', block: 'nearest' }))
  }
  $('#save').classList.toggle('on', !!cur?.dirty)
  const cf = $('#cfile'); cf.replaceChildren()
  $('#sep').hidden = !cur
  if (cur) { $('#sep').textContent = '›'; cf.append(badge(cur.name), document.createTextNode(cur.name)) }
}
function activate(t: Tab | null) {
  if (cur) cur.state = view.state
  cur = t
  view.setState(t ? t.state : EditorState.create({ doc: '' }))
  drawTabs()
}
function closeTab(t: Tab) {
  if (t.dirty && !confirm(`Close ${t.name} without saving?`)) return
  const i = tabs.indexOf(t); tabs.splice(i, 1)
  if (cur === t) { cur = null; activate(tabs[i] || tabs[i - 1] || null) } else drawTabs()
}
async function save() {
  if (!cur) return
  try {
    await Saf.write({ uri: cur.uri, text: view.state.doc.toString() })
    cur.dirty = false; drawTabs(); toast(`Saved ${cur.name}`)
  } catch (e: any) { toast(`Could not save: ${e?.message ?? e}`) }
}
async function openFile(e: Entry) {
  let t = tabs.find(x => x.uri === e.uri)
  if (!t) {
    try {
      const { text } = await Saf.read({ uri: e.uri })
      t = { uri: e.uri, name: e.name, state: mkState(text, e.name), dirty: false }
      tabs.push(t)
    } catch (err: any) { toast(`Could not open ${e.name}: ${err?.message ?? err}`); return }
  }
  activate(t); drawer(false)
}

let selRow: HTMLElement | null = null
async function renderDir(uri: string, box: HTMLElement) {
  const { entries } = await Saf.list({ uri })
  entries.sort((a, b) => +b.isDir - +a.isDir || a.name.localeCompare(b.name))
  const frag = document.createDocumentFragment()
  for (const e of entries) {
    parent.set(e.uri, uri)
    const row = document.createElement('div'); row.className = 'row'
    const ch = document.createElement('span'); ch.className = 'ch'; ch.innerHTML = e.isDir ? svg(IC.chev, 16) : ''
    const nm = document.createElement('span'); nm.textContent = e.name
    row.append(ch); if (!e.isDir) row.append(badge(e.name)); row.append(nm)
    frag.append(row)
    if (!e.isDir) { row.onclick = () => { selRow?.classList.remove('sel'); (selRow = row).classList.add('sel'); openFile(e) }; continue }
    const kids = document.createElement('div'); kids.className = 'kids'; kids.hidden = true
    row.onclick = async () => {
      if (kids.hidden && !kids.childElementCount) await renderDir(e.uri, kids)
      kids.hidden = !kids.hidden; row.classList.toggle('open', !kids.hidden)
    }
    frag.append(kids)
  }
  box.append(frag)
}
async function loadFolder(uri: string) {
  const tree = $('#tree'); tree.replaceChildren(); fileIndex = null
  const name = decodeURIComponent(uri.split('/tree/')[1] || 'Folder').split(/[:/]/).pop() || 'Folder'
  const row = document.createElement('div'); row.className = 'row open'
  const ch = document.createElement('span'); ch.className = 'ch'; ch.innerHTML = svg(IC.chev, 16)
  const nm = document.createElement('span'); nm.textContent = name; row.append(ch, nm)
  const kids = document.createElement('div'); kids.className = 'kids'
  row.onclick = () => { kids.hidden = !kids.hidden; row.classList.toggle('open', !kids.hidden) }
  tree.append(row, kids)
  try {
    await renderDir(uri, kids); root = uri; localStorage.setItem('folder', uri); $('#fname').textContent = name
  } catch {
    localStorage.removeItem('folder')
    tree.innerHTML = '<div class="msg">This folder is no longer accessible. Tap the folder icon to open it again.</div>'
  }
}

const mk = (id: string, items: [string, (v: EditorView) => void, string?][]) => {
  for (const [label, fn, aria] of items) {
    const b = document.createElement('button')
    if (label.startsWith('M')) b.innerHTML = svg(label, 24); else b.textContent = label
    if (aria) b.setAttribute('aria-label', aria)
    b.onpointerdown = ev => { ev.preventDefault(); fn(view); view.focus() }
    $(id).append(b)
  }
}
const ins = (s: string, back = 0) => (v: EditorView) => {
  const r = v.state.selection.main
  v.dispatch({ changes: { from: r.from, to: r.to, insert: s }, selection: { anchor: r.from + s.length - back }, scrollIntoView: true })
}
mk('#keys1', [['<tag>', ins('<>', 1)], ['div', ins('div')], ['class', ins('class=""', 1)], ['=', ins('=')], ['""', ins('""', 1)],
  ['{}', ins('{}', 1)], ['()', ins('()', 1)], ['[]', ins('[]', 1)], [';', ins(';')], [':', ins(':')], ['/', ins('/')]])
mk('#keys2', [[IC.tab, tabKey, 'Tab'], [IC.up, cursorLineUp, 'Up'], [IC.down, cursorLineDown, 'Down'], [IC.left, cursorCharLeft, 'Left'],
  [IC.right, cursorCharRight, 'Right'], [IC.undo, undo, 'Undo'], [IC.redo, redo, 'Redo'], [IC.cmd, () => { palette() }, 'Commands']] as any)

const side = $('#side'), scrim = $('#scrim')
let isOpen = false, x = -1, armed = false, drag = false, sx = 0, sy = 0
const W = () => side.offsetWidth
function setX(v: number, anim: boolean) {
  x = v
  side.style.transition = anim ? 'transform .22s var(--ease)' : 'none'
  scrim.style.transition = anim ? 'opacity .22s' : 'none'
  side.style.transform = `translateX(${v}px)`
  scrim.style.opacity = String(Math.max(0, 1 + v / W()))
  scrim.style.pointerEvents = v > -W() + 1 ? 'auto' : 'none'
}
function drawer(o: boolean) { isOpen = o; setX(o ? 0 : -W(), true) }
setX(-9999, false)
addEventListener('load', () => drawer(!localStorage.getItem('folder')))
document.addEventListener('touchstart', e => {
  const t = e.touches[0]; sx = t.clientX; sy = t.clientY; drag = false; armed = isOpen || sx < 22
}, { passive: true })
document.addEventListener('touchmove', e => {
  if (!armed) return
  const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy
  if (!drag) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) drag = true; else return }
  setX(Math.min(0, Math.max(-W(), (isOpen ? 0 : -W()) + dx)), false)
}, { passive: true })
document.addEventListener('touchend', () => { if (drag) { drag = false; drawer(x > -W() / 2) } })

$('#menu').onclick = () => drawer(true)
scrim.onclick = () => drawer(false)
$('#save').onclick = save
$('#refresh').onclick = () => root && loadFolder(root)
$('#open').onclick = async () => { try { const { uri } = await Saf.pickFolder(); await loadFolder(uri) } catch { /* cancelled */ } }

// ---------- files, sheets, search, palette, preview ----------
type F = Entry & { path: string }
const parent = new Map<string, string>()
let fileIndex: F[] | null = null
const SKIP = /^(node_modules|\.git|dist|build|\.next|\.cache)$/
const BIN = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp[34]|zip|pdf|apk|so|lock|map)$/i
async function files(): Promise<F[]> {
  if (fileIndex) return fileIndex
  const out: F[] = []
  const go = async (uri: string, path: string): Promise<void> => {
    const { entries } = await Saf.list({ uri })
    await Promise.all(entries.map(async e => {
      parent.set(e.uri, uri)
      if (!e.isDir) out.push({ ...e, path: path + e.name })
      else if (!SKIP.test(e.name)) await go(e.uri, path + e.name + '/')
    }))
  }
  await go(root, '')
  return (fileIndex = out.sort((a, b) => a.path.localeCompare(b.path)))
}
function sheet(ph?: string, title = '') {
  const el = document.createElement('div'); el.className = 'sheet'
  el.innerHTML = '<div class="sh"><button class="bk" aria-label="Back"></button></div><div class="sb"></div>'
  const sh = el.firstChild as HTMLElement, body = el.lastChild as HTMLElement
  ;(sh.firstChild as HTMLElement).innerHTML = svg(IC.left, 24)
  let input: HTMLInputElement | null = null
  if (ph) { input = document.createElement('input'); input.placeholder = ph; input.spellcheck = false; input.autocapitalize = 'off'; sh.append(input) }
  else { const t = document.createElement('span'); t.textContent = title; sh.append(t) }
  document.body.append(el); requestAnimationFrame(() => el.classList.add('on'))
  const close = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 230) }
  ;(sh.firstChild as HTMLElement).onclick = close
  if (input) setTimeout(() => input!.focus(), 80)
  return { el, sh, body, input, close }
}
function addRow(body: HTMLElement, label: string, fn: () => void, icon?: string, sub?: string) {
  const r = document.createElement('div'); r.className = 'row' + (sub ? ' hit' : '')
  if (icon) r.append(badge(icon))
  const a = document.createElement('span'); a.textContent = label; r.append(a)
  if (sub) { const b = document.createElement('small'); b.textContent = sub; r.append(b) }
  r.onclick = fn; body.append(r)
}
const goLine = (n: number) => {
  const l = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)))
  view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) })
}
const step = (d: number) => { if (tabs.length > 1 && cur) activate(tabs[(tabs.indexOf(cur) + d + tabs.length) % tabs.length]) }
const pick = async () => { try { const { uri } = await Saf.pickFolder(); await loadFolder(uri) } catch { /* cancelled */ } }

async function searchUI() {
  if (!root) return toast('Open a folder first')
  const s = sheet('Search in files'); s.input!.enterKeyHint = 'search'
  let run = 0
  s.input!.onkeydown = async ev => {
    if (ev.key !== 'Enter') return
    const q = s.input!.value.trim().toLowerCase(); if (!q) return
    const id = ++run; s.body.innerHTML = '<div class="msg">Searching…</div>'
    const list = (await files()).filter(f => !BIN.test(f.name))
    const out = document.createElement('div'); let hits = 0
    for (let i = 0; i < list.length && hits < 200 && id === run; i += 8) {
      await Promise.all(list.slice(i, i + 8).map(async f => {
        let text = ''; try { text = (await Saf.read({ uri: f.uri })).text } catch { return }
        const lines = text.split('\n')
        for (let n = 0; n < lines.length && hits < 200; n++) {
          if (!lines[n].toLowerCase().includes(q)) continue
          hits++
          addRow(out, lines[n].trim().slice(0, 140), async () => { s.close(); await openFile(f); goLine(n + 1) }, f.name, `${f.path}:${n + 1}`)
        }
      }))
    }
    if (id !== run) return
    s.body.replaceChildren(out); if (!hits) s.body.innerHTML = '<div class="msg">No matches.</div>'
    s.input!.blur()
  }
}

function palette() {
  const s = sheet('Type a command or file name')
  const cmds: [string, () => void][] = [
    ['Save file', save], ['Live preview', preview], ['Search in files', searchUI], ['Open folder', pick],
    ['Go to line…', () => { const n = parseInt(prompt('Line number') || ''); if (n) goLine(n) }],
    ['Close tab', () => cur && closeTab(cur)], ['Next tab', () => step(1)], ['Previous tab', () => step(-1)],
    ['Refresh files', () => root && loadFolder(root)],
  ]
  let id = 0
  const draw = async () => {
    const q = s.input!.value.trim().toLowerCase(), me = ++id, out = document.createElement('div')
    for (const [n, fn] of cmds) if (n.toLowerCase().includes(q)) addRow(out, n, () => { s.close(); setTimeout(fn, 240) })
    if (root && q) for (const f of (await files()).filter(f => f.path.toLowerCase().includes(q)).slice(0, 40))
      addRow(out, f.name, () => { s.close(); openFile(f) }, f.name, f.path)
    if (me === id) s.body.replaceChildren(out)
  }
  s.input!.oninput = draw; draw()
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' }
async function resolve(dir: string, p: string): Promise<Entry | null> {
  const segs = p.split(/[?#]/)[0].split('/').filter(x => x && x !== '.')
  let d = p.startsWith('/') ? root : dir
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === '..') { d = parent.get(d) ?? d; continue }
    const { entries } = await Saf.list({ uri: d }), cd = d
    entries.forEach(e => parent.set(e.uri, cd))
    const e = entries.find(x => x.name === decodeURIComponent(segs[i])); if (!e) return null
    if (i === segs.length - 1) return e
    d = e.uri
  }
  return null
}
async function preview() {
  if (!root) return toast('Open a folder first')
  let f: { uri: string; name: string } | undefined = cur && /\.html?$/i.test(cur.name) ? cur : undefined
  let src = ''
  if (f) src = view.state.doc.toString()
  else {
    const ix = (await files()).find(x => x.name === 'index.html')
    if (!ix) return toast('Open an HTML file or add an index.html')
    f = ix; src = (await Saf.read({ uri: ix.uri })).text
  }
  const dir = parent.get(f.uri) ?? root
  const s = sheet(undefined, f.name + ' · preview'); s.body.style.overflow = 'hidden'
  const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals'); s.body.append(frame)
  const doc = new DOMParser().parseFromString(src, 'text/html'), jobs: Promise<void>[] = []
  const each = (sel: string, attr: string, fn: (el: Element, e: Entry) => Promise<void>) =>
    doc.querySelectorAll(sel).forEach(el => jobs.push((async () => {
      const u = el.getAttribute(attr); if (!u || /^([a-z]+:|\/\/|#)/i.test(u)) return
      const e = await resolve(dir, u); if (e) await fn(el, e)
    })().catch(() => {})))
  each('link[rel~=stylesheet][href]', 'href', async (el, e) => {
    const st = doc.createElement('style'); st.textContent = (await Saf.read({ uri: e.uri })).text; el.replaceWith(st)
  })
  each('script[src]', 'src', async (el, e) => {
    const sc = doc.createElement('script'); const ty = el.getAttribute('type'); if (ty) sc.type = ty
    sc.textContent = (await Saf.read({ uri: e.uri })).text; el.replaceWith(sc)
  })
  each('img[src]', 'src', async (el, e) => {
    const { data } = await Saf.readBase64({ uri: e.uri })
    el.setAttribute('src', `data:${MIME[e.name.split('.').pop()!.toLowerCase()] || 'application/octet-stream'};base64,${data}`)
  })
  await Promise.all(jobs)
  frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML
}

$('#search').onclick = searchUI
$('#run').onclick = preview
$('#open').onclick = pick

const last = localStorage.getItem('folder')
if (last) loadFolder(last)
