import './style.css'
import { registerPlugin } from '@capacitor/core'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { indentMore, undo, redo } from '@codemirror/commands'
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
let tabs: Tab[] = []
let cur: Tab | null = null

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
const tabKey = (v: EditorView) => expandAbbreviation(v) || indentMore(v)

function status() {
  const s = view.state, p = s.selection.main.head, l = s.doc.lineAt(p)
  $('#status').textContent = cur ? `${cur.name}   Ln ${l.number}, Col ${p - l.from + 1}` : 'Open a folder to start'
}

function mkState(doc: string, name: string) {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup, oneDark, langFor(name), abbreviationTracker(),
      Prec.highest(keymap.of([
        { key: 'Tab', run: tabKey },
        { key: 'Mod-s', run: () => { save(); return true } },
      ])),
      EditorView.updateListener.of(u => {
        if (u.docChanged && cur && !cur.dirty) { cur.dirty = true; drawTabs() }
        if (u.docChanged || u.selectionSet) status()
      }),
      EditorView.theme({ '.cm-scroller': { fontFamily: 'var(--mono)' }, '&': { backgroundColor: '#1e1e1e' } }),
    ],
  })
}
const view = new EditorView({ parent: $('#editor'), state: EditorState.create({ doc: '' }) })

function drawTabs() {
  const bar = $('#tabs'); bar.replaceChildren()
  for (const t of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (t === cur ? ' on' : '') + (t.dirty ? ' dirty' : '')
    const n = document.createElement('span'); n.textContent = t.name
    const x = document.createElement('button'); x.className = 'x'
    x.innerHTML = '<span>✕</span>'; x.setAttribute('aria-label', 'Close ' + t.name)
    el.onclick = () => activate(t)
    x.onclick = ev => { ev.stopPropagation(); closeTab(t) }
    el.append(n, x); bar.append(el)
  }
}
function activate(t: Tab | null) {
  if (cur) cur.state = view.state
  cur = t
  if (t) view.setState(t.state)
  drawTabs(); status()
}
function closeTab(t: Tab) {
  if (t.dirty && !confirm(`Close ${t.name} without saving?`)) return
  const i = tabs.indexOf(t); tabs.splice(i, 1)
  if (cur === t) { cur = null; activate(tabs[i] || tabs[i - 1] || null); if (!cur) view.setState(EditorState.create({ doc: '' })) }
  else drawTabs()
}
async function save() {
  if (!cur) return
  try {
    await Saf.write({ uri: cur.uri, text: view.state.doc.toString() })
    cur.dirty = false; drawTabs()
    $('#status').textContent = `Saved ${cur.name}`
  } catch (e: any) { $('#status').textContent = `Could not save: ${e?.message ?? e}` }
}
async function openFile(e: Entry) {
  let t = tabs.find(x => x.uri === e.uri)
  if (!t) {
    try {
      const { text } = await Saf.read({ uri: e.uri })
      t = { uri: e.uri, name: e.name, state: mkState(text, e.name), dirty: false }
      tabs.push(t)
    } catch (err: any) { $('#status').textContent = `Could not open ${e.name}: ${err?.message ?? err}`; return }
  }
  activate(t); document.body.classList.remove('drawer')
}

async function renderDir(uri: string, box: HTMLElement) {
  const { entries } = await Saf.list({ uri })
  entries.sort((a, b) => +b.isDir - +a.isDir || a.name.localeCompare(b.name))
  for (const e of entries) {
    const row = document.createElement('div')
    row.className = 'row' + (e.isDir ? ' dir' : ''); row.textContent = e.name
    box.append(row)
    if (!e.isDir) { row.onclick = () => openFile(e); continue }
    const kids = document.createElement('div'); kids.className = 'kids'; kids.hidden = true
    row.onclick = async () => {
      if (kids.hidden && !kids.childElementCount) await renderDir(e.uri, kids)
      kids.hidden = !kids.hidden; row.classList.toggle('open', !kids.hidden)
    }
    box.append(kids)
  }
}
async function loadFolder(uri: string) {
  const tree = $('#tree'); tree.replaceChildren()
  try {
    await renderDir(uri, tree)
    localStorage.setItem('folder', uri)
    $('#fname').textContent = decodeURIComponent(uri.split('/tree/')[1] || 'Folder').split(/[:/]/).pop() || 'Folder'
  } catch {
    localStorage.removeItem('folder')
    tree.textContent = 'This folder is no longer accessible. Open it again.'
  }
}

const keys: [string, (v: EditorView) => void][] = [
  ['Tab', tabKey], ['{}', ins('{}')], ['()', ins('()')], ['[]', ins('[]')], ['<>', ins('<>')],
  ['""', ins('""')], ["''", ins("''")], ['/', ins('/')], [';', ins(';')], ['=', ins('=')], [':', ins(':')],
  ['↶', undo], ['↷', redo],
]
function ins(s: string) {
  return (v: EditorView) => {
    const r = v.state.selection.main
    v.dispatch({ changes: { from: r.from, to: r.to, insert: s }, selection: { anchor: r.from + (s.length === 2 ? 1 : s.length) } })
  }
}
for (const [label, fn] of keys) {
  const b = document.createElement('button'); b.textContent = label
  b.onpointerdown = ev => { ev.preventDefault(); fn(view); view.focus() }
  $('#keys').append(b)
}

$('#menu').onclick = () => document.body.classList.toggle('drawer')
$('#scrim').onclick = () => document.body.classList.remove('drawer')
$('#save').onclick = save
$('#open').onclick = async () => {
  try { const { uri } = await Saf.pickFolder(); await loadFolder(uri) } catch { /* cancelled */ }
}
const last = localStorage.getItem('folder')
if (last) loadFolder(last)
else document.body.classList.add('drawer')
