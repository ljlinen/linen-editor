import './style.css'
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
  write(o: { uri: string; text: string }): Promise<void>
}>('Saf')
type Tab = { uri: string; name: string; state: EditorState; dirty: boolean }

const $ = (s: string) => document.querySelector(s) as HTMLElement
const svg = (d: string, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
const IC = {
  menu: 'M4 6h16M4 12h16M4 18h16', check: 'M5 12.5l4.5 4.5L19 7.5', folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6', chev: 'M9 6l6 6-6 6', x: 'M6 6l12 12M18 6L6 18', tab: 'M3 12h13M12 7l5 5-5 5M21 5v14',
  up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
}
$('#menu').innerHTML = svg(IC.menu); $('#save').innerHTML = svg(IC.check, 28)
$('#refresh').innerHTML = svg(IC.refresh, 22); $('#open').innerHTML = svg(IC.folder, 24)

const BADGE: Record<string, [string, string]> = {
  html: ['H5', '#e44d26'], htm: ['H5', '#e44d26'], js: ['JS', '#c9a800'], mjs: ['JS', '#c9a800'], jsx: ['JSX', '#0ea5c6'],
  ts: ['TS', '#3178c6'], tsx: ['TSX', '#3178c6'], json: ['{}', '#b8860b'], css: ['#', '#3b82f6'], md: ['M↓', '#64748b'],
  svg: ['SVG', '#e08a00'], lock: ['🔒', '#64748b'],
}
const badge = (n: string) => {
  const [t, c] = BADGE[n.split('.').pop()!.toLowerCase()] ?? ['•', '#475569']
  const b = document.createElement('span'); b.className = 'fi'; b.textContent = t; b.style.background = c
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
  const tree = $('#tree'); tree.replaceChildren()
  try {
    await renderDir(uri, tree); root = uri; localStorage.setItem('folder', uri)
    $('#fname').textContent = decodeURIComponent(uri.split('/tree/')[1] || 'Folder').split(/[:/]/).pop() || 'Folder'
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
  [IC.right, cursorCharRight, 'Right'], [IC.undo, undo, 'Undo'], [IC.redo, redo, 'Redo']] as any)

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
const last = localStorage.getItem('folder')
if (last) loadFolder(last)
