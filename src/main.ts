import './style.css'
import ICONS from './icons.json'
import { registerPlugin } from '@capacitor/core'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { history, defaultKeymap, historyKeymap, indentMore, undo, cursorLineUp, cursorLineDown, cursorCharLeft, cursorCharRight } from '@codemirror/commands'
import { bracketMatching, indentOnInput, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { closeBrackets } from '@codemirror/autocomplete'
import { search, SearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll, openSearchPanel, closeSearchPanel } from '@codemirror/search'
import { tags as tg } from '@lezer/highlight'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { abbreviationTracker, expandAbbreviation } from '@emmetio/codemirror6-plugin'

type Entry = { name: string; uri: string; isDir: boolean; size?: number }
type F = Entry & { path: string }
const Saf = registerPlugin<{
  pickFolder(): Promise<{ uri: string }>
  list(o: { uri: string }): Promise<{ entries: Entry[] }>
  read(o: { uri: string }): Promise<{ text: string }>
  readBase64(o: { uri: string }): Promise<{ data: string }>
  writeBase64(o: { uri: string; data: string }): Promise<void>
  pickFile(): Promise<{ uri: string; name: string; size: number }>
  write(o: { uri: string; text: string }): Promise<void>
}>('Saf')
type Tab = { uri: string; name: string; state: EditorState; dirty: boolean }

const $ = (s: string) => document.querySelector(s) as HTMLElement
const svg = (d: string, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
const IC = {
  menu: 'M4 6h16M4 12h16M4 18h16', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', run: 'M7 5l12 7-12 7z',
  cmd: 'M9 9V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z', folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6', chev: 'M9 6l6 6-6 6', x: 'M6 6l12 12M18 6L6 18', tab: 'M3 12h13M12 7l5 5-5 5M21 5v14',
  up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', more: 'M5 12h.01M12 12h.01M19 12h.01', fwd: 'M6 6l6 6-6 6M12 6l6 6-6 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
}
$('#menu').innerHTML = svg(IC.menu); $('#search').innerHTML = svg(IC.search); $('#run').innerHTML = svg(IC.run)
$('#more').innerHTML = svg(IC.more); $('#psearch').innerHTML = svg(IC.search); $('#refresh').innerHTML = svg(IC.refresh); $('#open').innerHTML = svg(IC.folder); $('#assets').innerHTML = svg(IC.image)

// ---------- settings ----------
const S = { efs: Math.round(Math.min(innerWidth, 480) / 1080 * 38 * 10) / 10, ui: 1, wrap: true, tab: 2, auto: true, ...JSON.parse(localStorage.getItem('set') || '{}') }
const applySet = () => {
  const r = document.documentElement.style
  r.setProperty('--ui', String(S.ui)); r.setProperty('--efs', S.efs + 'px'); localStorage.setItem('set', JSON.stringify(S))
}
applySet()

// ---------- icons / languages ----------
const ALIAS: Record<string, string> = { htm: 'html', mjs: 'js', cjs: 'js', yml: 'yaml', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', ico: 'image', markdown: 'md' }
const iconKey = (n: string) => {
  const l = n.toLowerCase()
  if (l.startsWith('package') && l.endsWith('.json')) return 'npm'
  if (l.startsWith('.git')) return 'git'
  if (l.includes('eslint')) return 'eslint'
  if (l.startsWith('vite.config')) return 'vite'
  const e = l.split('.').pop()!
  return ALIAS[e] || e
}
const I = ICONS as Record<string, string>
const badge = (n: string) => { const b = document.createElement('span'); b.className = 'fi'; b.innerHTML = I[iconKey(n)] || I.default || ''; return b }
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
const LN: Record<string, string> = { html: 'HTML', htm: 'HTML', css: 'CSS', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX', json: 'JSON', md: 'Markdown' }

// ---------- editor ----------
let tabs: Tab[] = []
let cur: Tab | null = null
let root = ''
let timer: any
const parent = new Map<string, string>(), nameOf = new Map<string, string>()
const tabKey = (v: EditorView) => expandAbbreviation(v) || indentMore(v)

const hl = HighlightStyle.define([
  { tag: [tg.tagName, tg.standard(tg.tagName)], color: '#5aa9ff' }, { tag: [tg.angleBracket, tg.bracket, tg.punctuation, tg.separator], color: '#aab4c6' },
  { tag: tg.attributeName, color: '#9edcff' }, { tag: [tg.string, tg.attributeValue], color: '#d7d98b' },
  { tag: [tg.number, tg.bool, tg.null, tg.atom, tg.unit], color: '#b48cf2' }, { tag: tg.propertyName, color: '#7fe0c6' },
  { tag: [tg.keyword, tg.operatorKeyword, tg.controlKeyword], color: '#c792ea' }, { tag: [tg.comment, tg.lineComment, tg.blockComment], color: '#667089', fontStyle: 'italic' },
  { tag: [tg.variableName, tg.name], color: '#e4e7ee' }, { tag: [tg.function(tg.variableName), tg.function(tg.propertyName)], color: '#82aaff' },
  { tag: [tg.className, tg.typeName], color: '#ffcb6b' }, { tag: [tg.heading, tg.link], color: '#5aa9ff' },
])
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', color: '#e4e7ee', fontSize: 'var(--efs)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: '#fff' }, '.cm-cursor': { borderLeftColor: '#fff' },
  '.cm-gutters': { backgroundColor: 'transparent', border: '0', color: '#555d70' },
  '.cm-activeLine': { backgroundColor: '#ffffff0a' }, '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#9aa3b5' },
  '&.cm-focused': { outline: 'none' },
  '.cm-searchMatch': { backgroundColor: '#e2b34a44' }, '.cm-searchMatch-selected': { backgroundColor: '#e2b34a99' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)', borderBottom: '1px solid var(--line)' },
}, { dark: true })

function findPanel(v: EditorView) {
  const dom = document.createElement('div'); dom.className = 'fp'
  dom.innerHTML = '<div class="fr"><input class="f" placeholder="Find" autocapitalize="off" spellcheck="false"><button data-a="c">Aa</button><button data-a="p"></button><button data-a="n"></button><button data-a="x"></button></div><div class="fr"><input class="r" placeholder="Replace" autocapitalize="off" spellcheck="false"><button class="t" data-a="r">Replace</button><button class="t" data-a="all">All</button></div>'
  const f = dom.querySelector('.f') as HTMLInputElement, r = dom.querySelector('.r') as HTMLInputElement
  let cs = false
  const push = () => v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: f.value, replace: r.value, caseSensitive: cs })) })
  f.oninput = r.oninput = push
  f.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findNext(v) } }
  const ic = (a: string, d: string) => ((dom.querySelector(`[data-a=${a}]`) as HTMLElement).innerHTML = svg(d, 22))
  ic('p', IC.up); ic('n', IC.down); ic('x', IC.x)
  dom.querySelectorAll('button').forEach(b => {
    b.onpointerdown = e => e.preventDefault()
    b.onclick = () => {
      const a = b.dataset.a
      if (a === 'c') { cs = !cs; b.classList.toggle('on', cs); push() }
      else if (a === 'p') findPrevious(v)
      else if (a === 'n') findNext(v)
      else if (a === 'r') replaceNext(v)
      else if (a === 'all') { replaceAll(v); toast('Replaced all') }
      else closeSearchPanel(v)
    }
  })
  return { dom, top: true, mount: () => f.focus() }
}

const emptyState = () => EditorState.create({ doc: '', extensions: [theme, EditorState.readOnly.of(true)] })
function mkState(doc: string, name: string) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(), highlightActiveLine(), history(), bracketMatching(), closeBrackets(), indentOnInput(),
      theme, syntaxHighlighting(hl), langFor(name), abbreviationTracker(), search({ top: true, createPanel: findPanel }),
      S.wrap ? EditorView.lineWrapping : [], EditorState.tabSize.of(S.tab),
      Prec.highest(keymap.of([{ key: 'Tab', run: tabKey }, { key: 'Mod-s', run: () => { save(false); return true } }])),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of(u => {
        if (u.focusChanged) document.body.classList.toggle('typing', u.view.hasFocus)
        if (u.docChanged && cur) {
          if (!cur.dirty) { cur.dirty = true; drawTabs() }
          if (S.auto) { clearTimeout(timer); timer = setTimeout(() => save(true), 1200) }
        }
        if (u.docChanged || u.selectionSet) status()
      }),
    ],
  })
}
const view = new EditorView({ parent: $('#editor'), state: emptyState() })

function status() {
  if (!cur) { $('#pos').textContent = ''; $('#meta').textContent = ''; return }
  const s = view.state, p = s.selection.main.head, l = s.doc.lineAt(p), e = cur.name.split('.').pop()!.toLowerCase()
  $('#pos').textContent = `Ln ${l.number}, Col ${p - l.from + 1}`
  $('#meta').textContent = `Sp: ${S.tab}   ${LN[e] || e.toUpperCase()}   LF   UTF-8`
}
function toast(m: string) {
  const el = $('#toast'); el.textContent = m; el.classList.add('on')
  clearTimeout((toast as any).h); (toast as any).h = setTimeout(() => el.classList.remove('on'), 1800)
}
function drawTabs() {
  const bar = $('#tabs'); bar.replaceChildren()
  for (const tb of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tb === cur ? ' on' : '') + (tb.dirty ? ' dirty' : '')
    const n = document.createElement('span'); n.className = 'nm'; n.textContent = tb.name
    const x = document.createElement('button'); x.className = 'x'; x.innerHTML = svg(IC.x, 16); x.setAttribute('aria-label', 'Close ' + tb.name)
    el.onclick = () => activate(tb)
    x.onclick = ev => { ev.stopPropagation(); closeTab(tb) }
    el.append(badge(tb.name), n, x); bar.append(el)
    if (tb === cur) requestAnimationFrame(() => el.scrollIntoView({ inline: 'nearest', block: 'nearest' }))
  }
  const cf = $('#cfile'); cf.replaceChildren(); $('#sep').hidden = !cur
  const par = cur ? nameOf.get(parent.get(cur.uri) ?? '') : ''
  $('#fname').textContent = cur ? par || nameOf.get(root) || '' : nameOf.get(root) || 'Open a folder'
  if (cur) { $('#sep').innerHTML = svg(IC.chev, 20); cf.append(badge(cur.name), document.createTextNode(cur.name)) }
}
function activate(tb: Tab | null) {
  if (cur) { cur.state = view.state; if (cur.dirty && S.auto) saveTab(cur, view.state.doc.toString(), true) }
  cur = tb
  view.setState(tb ? tb.state : emptyState())
  drawTabs(); status()
}
function closeTab(tb: Tab) {
  if (tb.dirty && !S.auto && !confirm(`Close ${tb.name} without saving?`)) return
  const i = tabs.indexOf(tb); if (tb === cur && tb.dirty && S.auto) saveTab(tb, view.state.doc.toString(), true)
  tabs.splice(i, 1)
  if (cur === tb) { cur = null; activate(tabs[i] || tabs[i - 1] || null) } else drawTabs()
}
async function saveTab(tb: Tab, text: string, silent: boolean) {
  try {
    await Saf.write({ uri: tb.uri, text })
    if ((tb === cur ? view.state.doc : tb.state.doc).toString() === text) tb.dirty = false
    drawTabs(); if (!silent) toast(`Saved ${tb.name}`)
  } catch (e: any) { toast(`Could not save: ${e?.message ?? e}`) }
}
const save = (silent: boolean) => { if (cur) saveTab(cur, view.state.doc.toString(), silent) }
async function openFile(e: Entry) {
  let tb = tabs.find(x => x.uri === e.uri)
  if (!tb) {
    try {
      const { text } = await Saf.read({ uri: e.uri })
      tb = { uri: e.uri, name: e.name, state: mkState(text, e.name), dirty: false }; tabs.push(tb)
    } catch (err: any) { toast(`Could not open ${e.name}: ${err?.message ?? err}`); return }
  }
  activate(tb); drawer(false)
}
function rebuild() {
  if (cur) cur.state = view.state
  for (const tb of tabs) tb.state = mkState(tb.state.doc.toString(), tb.name)
  if (cur) view.setState(cur.state)
}

// ---------- file tree ----------
let selRow: HTMLElement | null = null
async function renderDir(uri: string, box: HTMLElement, d: number) {
  const { entries } = await Saf.list({ uri })
  entries.sort((a, b) => +b.isDir - +a.isDir || a.name.localeCompare(b.name))
  const frag = document.createDocumentFragment()
  for (const e of entries) {
    parent.set(e.uri, uri); nameOf.set(e.uri, e.name)
    const row = document.createElement('div'); row.className = 'row'
    row.style.paddingLeft = `calc(var(--u) * ${28 + 45 * d})`
    const sl = document.createElement('span'); sl.className = 'sl'
    const nm = document.createElement('span'); nm.textContent = e.name
    if (e.isDir) sl.innerHTML = svg(IC.chev, 16); else sl.append(badge(e.name))
    row.append(sl, nm); frag.append(row)
    if (!e.isDir) {
      if (/\.html?$/i.test(e.name)) {
        const pl = document.createElement('span'); pl.className = 'play'; pl.innerHTML = svg(IC.run, 18)
        pl.style.left = `calc(var(--u) * ${-7 + 45 * d})`
        pl.onclick = async ev => { ev.stopPropagation(); await openFile(e); preview() }
        row.append(pl)
      }
      row.onclick = () => { if (IMG.test(e.name)) { drawer(false); compare(e); return } selRow?.classList.remove('sel'); (selRow = row).classList.add('sel'); openFile(e) }
      continue
    }
    const kids = document.createElement('div'); kids.className = 'kids'; kids.hidden = true
    kids.style.setProperty('--gx', String(78 + 45 * d))
    row.onclick = async () => {
      if (kids.hidden && !kids.childElementCount) await renderDir(e.uri, kids, d + 1)
      kids.hidden = !kids.hidden; row.classList.toggle('open', !kids.hidden)
    }
    frag.append(kids)
  }
  box.append(frag)
}
async function loadFolder(uri: string) {
  fileIndex = null; const tree = $('#tree'); tree.replaceChildren()
  const name = decodeURIComponent(uri.split('/tree/')[1] || 'Folder').split(/[:/]/).pop() || 'Folder'
  nameOf.set(uri, name); $('#pname').textContent = name
  try {
    await renderDir(uri, tree, 0); root = uri; localStorage.setItem('folder', uri); drawTabs()
  } catch {
    localStorage.removeItem('folder')
    tree.innerHTML = '<div class="msg">This folder is no longer accessible. Tap the folder icon below to open it again.</div>'
  }
}

// ---------- key bars ----------
const mk = (id: string, items: [string, (v: EditorView) => void, string?, boolean?][]) => {
  for (const [label, fn, aria, nofocus] of items) {
    const b = document.createElement('button')
    if (label.startsWith('M')) b.innerHTML = svg(label, 24); else b.textContent = label
    if (aria) b.setAttribute('aria-label', aria)
    b.onpointerdown = ev => { ev.preventDefault(); fn(view); if (!nofocus) view.focus() }
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
  [IC.right, cursorCharRight, 'Right'], [IC.undo, undo, 'Undo'], [IC.cmd, () => { palette() }, 'Commands', true],
  [IC.fwd, () => document.body.classList.toggle('more'), 'More keys', true]])

// ---------- drawer ----------
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
document.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; drag = false; armed = isOpen || sx < 22 }, { passive: true })
document.addEventListener('touchmove', e => {
  if (!armed) return
  const p = e.touches[0], dx = p.clientX - sx, dy = p.clientY - sy
  if (!drag) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) drag = true; else return }
  setX(Math.min(0, Math.max(-W(), (isOpen ? 0 : -W()) + dx)), false)
}, { passive: true })
document.addEventListener('touchend', () => { if (drag) { drag = false; drawer(x > -W() / 2) } })

// ---------- file index, sheets ----------
let fileIndex: F[] | null = null
const SKIP = /^(node_modules|\.git|dist|build|\.next|\.cache)$/
const BIN = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp[34]|zip|pdf|apk|so|lock|map)$/i
async function files(): Promise<F[]> {
  if (fileIndex) return fileIndex
  const out: F[] = []
  const go = async (uri: string, path: string): Promise<void> => {
    const { entries } = await Saf.list({ uri })
    await Promise.all(entries.map(async e => {
      parent.set(e.uri, uri); nameOf.set(e.uri, e.name)
      if (!e.isDir) out.push({ ...e, path: path + e.name })
      else if (!SKIP.test(e.name)) await go(e.uri, path + e.name + '/')
    }))
  }
  await go(root, '')
  return (fileIndex = out.sort((a, b) => a.path.localeCompare(b.path)))
}
function sheet(ph?: string, title = '') {
  const el = document.createElement('div'); el.className = 'sheet'
  el.innerHTML = '<div class="sh"><button aria-label="Back"></button></div><div class="sb"></div>'
  const sh = el.firstChild as HTMLElement, body = el.lastChild as HTMLElement, bk = sh.firstChild as HTMLElement
  bk.innerHTML = svg(IC.left, 24)
  let input: HTMLInputElement | null = null
  if (ph) { input = document.createElement('input'); input.placeholder = ph; input.spellcheck = false; input.autocapitalize = 'off'; sh.append(input) }
  else { const s = document.createElement('span'); s.textContent = title; sh.append(s) }
  document.body.append(el); requestAnimationFrame(() => el.classList.add('on'))
  const close = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 230) }
  bk.onclick = close
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

// ---------- project-wide search + replace ----------
async function searchUI() {
  if (!root) return toast('Open a folder first')
  const s = sheet('Search in all files'); s.input!.enterKeyHint = 'search'
  let run = 0
  s.input!.onkeydown = async ev => {
    if (ev.key !== 'Enter') return
    const raw = s.input!.value.trim(); if (!raw) return
    const q = raw.toLowerCase(), id = ++run, matched = new Map<string, F>()
    s.body.innerHTML = '<div class="msg">Searching…</div>'
    const list = (await files()).filter(f => !BIN.test(f.name))
    const out = document.createElement('div'); let hits = 0
    for (let i = 0; i < list.length && hits < 200 && id === run; i += 8) {
      await Promise.all(list.slice(i, i + 8).map(async f => {
        let text = ''; try { text = (await Saf.read({ uri: f.uri })).text } catch { return }
        const lines = text.split('\n')
        for (let n = 0; n < lines.length && hits < 200; n++) {
          if (!lines[n].toLowerCase().includes(q)) continue
          hits++; matched.set(f.uri, f)
          addRow(out, lines[n].trim().slice(0, 140), async () => { s.close(); await openFile(f); goLine(n + 1) }, f.name, `${f.path}:${n + 1}`)
        }
      }))
    }
    if (id !== run) return
    if (!hits) { s.body.innerHTML = '<div class="msg">No matches.</div>'; return }
    const rp = document.createElement('div'); rp.className = 'rp'
    rp.innerHTML = '<input placeholder="Replace with" autocapitalize="off" spellcheck="false"><button>Replace all</button>'
    const ri = rp.firstChild as HTMLInputElement, rb = rp.lastChild as HTMLElement
    rb.onclick = async () => {
      const rep = ri.value
      if (!confirm(`Replace “${raw}” with “${rep}” in ${matched.size} file(s)?`)) return
      const re = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      let n = 0, skipped = 0
      for (const f of matched.values()) {
        const tb = tabs.find(z => z.uri === f.uri)
        if (tb && tb.dirty) { skipped++; continue }
        try {
          const out2 = (await Saf.read({ uri: f.uri })).text.replace(re, () => rep)
          await Saf.write({ uri: f.uri, text: out2 }); n++
          if (tb) { tb.state = mkState(out2, tb.name); if (cur === tb) view.setState(tb.state) }
        } catch { skipped++ }
      }
      s.body.innerHTML = `<div class="msg">Replaced in ${n} file(s)${skipped ? `, skipped ${skipped} (unsaved or unreadable)` : ''}.</div>`
    }
    s.body.replaceChildren(rp, out); s.input!.blur()
  }
}

// ---------- command palette ----------
function palette() {
  const s = sheet('Type a command or file name')
  const cmds: [string, () => void][] = [
    ['Find in file', () => cur && openSearchPanel(view)], ['Search in all files', searchUI], ['Live preview', preview], ['Save file', () => save(false)],
    ['Assets', assets], ['Settings', settings], ['Open folder', pick], ['Go to line…', () => { const n = parseInt(prompt('Line number') || ''); if (n) goLine(n) }],
    ['Close tab', () => cur && closeTab(cur)], ['Next tab', () => step(1)], ['Previous tab', () => step(-1)], ['Refresh files', () => root && loadFolder(root)],
  ]
  let id = 0
  const draw = async () => {
    const q = s.input!.value.trim().toLowerCase(), me = ++id, out = document.createElement('div')
    for (const [n, fn] of cmds) if (n.toLowerCase().includes(q)) addRow(out, n, () => { s.close(); setTimeout(fn, 240) })
    if (root && q) for (const f of (await files()).filter(z => z.path.toLowerCase().includes(q)).slice(0, 40))
      addRow(out, f.name, () => { s.close(); openFile(f) }, f.name, f.path)
    if (me === id) s.body.replaceChildren(out)
  }
  s.input!.oninput = draw; draw()
}

// ---------- settings screen ----------
function settings() {
  const s = sheet(undefined, 'Settings')
  const draw = () => {
    const out = document.createElement('div')
    const row = (label: string, val: string, a: () => void, b?: () => void) => {
      const r = document.createElement('div'); r.className = 'set'
      const l = document.createElement('span'); l.textContent = label
      const c = document.createElement('div'); c.className = 'c'
      const btn = (t: string, f: () => void) => { const x2 = document.createElement('button'); x2.textContent = t; x2.onclick = () => { f(); applySet(); draw() }; return x2 }
      const v = document.createElement('span'); v.textContent = val
      if (b) c.append(btn('−', a), v, btn('+', b)); else c.append(btn(val, a))
      r.append(l, c); out.append(r)
    }
    row('Editor font size', S.efs + ' px', () => (S.efs = Math.max(8, Math.round((S.efs - 0.5) * 10) / 10)), () => (S.efs = Math.min(30, Math.round((S.efs + 0.5) * 10) / 10)))
    row('App size', Math.round(S.ui * 100) + '%', () => (S.ui = Math.max(0.7, Math.round((S.ui - 0.05) * 100) / 100)), () => (S.ui = Math.min(1.6, Math.round((S.ui + 0.05) * 100) / 100)))
    row('Word wrap', S.wrap ? 'On' : 'Off', () => { S.wrap = !S.wrap; rebuild() })
    row('Tab size', String(S.tab), () => { S.tab = S.tab === 2 ? 4 : 2; rebuild(); status() })
    row('Auto-save', S.auto ? 'On' : 'Off', () => { S.auto = !S.auto })
    s.body.replaceChildren(out)
  }
  draw()
}

// ---------- live preview ----------
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' }
async function resolve(dir: string, p: string): Promise<Entry | null> {
  const segs = p.split(/[?#]/)[0].split('/').filter(z => z && z !== '.')
  let d = p.startsWith('/') ? root : dir
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === '..') { d = parent.get(d) ?? d; continue }
    const { entries } = await Saf.list({ uri: d }), cd = d
    entries.forEach(e => { parent.set(e.uri, cd); nameOf.set(e.uri, e.name) })
    const e = entries.find(z => z.name === decodeURIComponent(segs[i])); if (!e) return null
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
    const ix = (await files()).find(z => z.name === 'index.html')
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

// ---------- assets browser + compare/replace ----------
const IMG = /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i
const RES = /\.(woff2?|ttf|otf|eot|mp[34]|wav|ogg|m4a|webm|mov|pdf)$/i
const MIME2: Record<string, string> = { ...MIME, avif: 'image/avif', bmp: 'image/bmp' }
const cache = new Map<string, string>()
const ext = (n: string) => n.split('.').pop()!.toLowerCase().replace('jpeg', 'jpg')
const fmt = (n?: number) => (n == null ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
async function dataUri(e: Entry) {
  const hit = cache.get(e.uri); if (hit) return hit
  const { data } = await Saf.readBase64({ uri: e.uri })
  const u = `data:${MIME2[ext(e.name)] || 'application/octet-stream'};base64,${data}`
  if (cache.size > 120) cache.delete(cache.keys().next().value!)
  cache.set(e.uri, u); return u
}
let active = 0; const waiting: (() => void)[] = []
const limit = <T,>(fn: () => Promise<T>) => new Promise<T>((res, rej) => {
  const run = () => { active++; fn().then(res, rej).finally(() => { active--; waiting.shift()?.() }) }
  active < 4 ? run() : waiting.push(run)
})
const lazy = (root2: HTMLElement) => new IntersectionObserver((es, ob) => es.forEach(en => {
  if (!en.isIntersecting) return
  const im = en.target as HTMLImageElement; ob.unobserve(im)
  limit(() => dataUri((im as any)._e)).then(u => { im.src = u }).catch(() => { im.alt = '!' })
}), { root: root2, rootMargin: '400px' })
function thumb(e: Entry, obs: IntersectionObserver) {
  const d = document.createElement('div'); d.className = 'im'
  if (IMG.test(e.name) && (e.size ?? 0) < 4e6) { const im = document.createElement('img'); (im as any)._e = e; im.alt = ''; d.append(im); obs.observe(im) }
  else d.append(badge(e.name))
  return d
}
async function walkAny(uri: string): Promise<F[]> {
  const out: F[] = []
  const go = async (u: string, path: string): Promise<void> => {
    const { entries } = await Saf.list({ uri: u })
    await Promise.all(entries.map(async e => {
      if (!e.isDir) out.push({ ...e, path: path + e.name })
      else if (!SKIP.test(e.name)) await go(e.uri, path + e.name + '/')
    }))
  }
  await go(uri, ''); return out
}
async function assets() {
  if (!root) return toast('Open a folder first')
  const s = sheet('Filter assets'); s.body.innerHTML = '<div class="msg">Scanning…</div>'
  const all = (await files()).filter(f => IMG.test(f.name) || RES.test(f.name)), obs = lazy(s.body)
  const draw = () => {
    const q = s.input!.value.trim().toLowerCase(), list = all.filter(f => f.path.toLowerCase().includes(q)).slice(0, 400)
    const tools = document.createElement('div'); tools.className = 'tools'
    const info = document.createElement('span'); info.textContent = `${list.length} of ${all.length} assets`
    const mb = document.createElement('button'); mb.textContent = 'Match from folder'; mb.onclick = () => matchFolder(all)
    tools.append(info, mb)
    const grid = document.createElement('div'); grid.className = 'grid'
    for (const f of list) {
      const t2 = document.createElement('div'); t2.className = 'tile'
      const b = document.createElement('b'); b.textContent = f.name
      const sm = document.createElement('small'); sm.textContent = f.path.slice(0, -f.name.length) || '/'
      t2.append(thumb(f, obs), b, sm); t2.onclick = () => compare(f); grid.append(t2)
    }
    s.body.replaceChildren(tools, grid)
  }
  s.input!.oninput = draw; draw()
}
async function compare(f: Entry & { path?: string }) {
  const s = sheet(undefined, f.name)
  const pane = (label: string) => { const p = document.createElement('div'); p.className = 'pane'; p.innerHTML = `<b>${label}</b><div class="im"></div><small></small>`; return p }
  const cmp = document.createElement('div'); cmp.className = 'cmp'
  const a = pane('Current'), b = pane('New'); cmp.append(a, b)
  const note = document.createElement('div'); note.className = 'note'
  const show = async (p: HTMLElement, e: Entry) => {
    const bx = p.children[1] as HTMLElement, inf = p.lastChild as HTMLElement; bx.replaceChildren()
    if (IMG.test(e.name)) {
      const im = document.createElement('img'); bx.append(im)
      im.onload = () => { inf.textContent = `${im.naturalWidth}×${im.naturalHeight} · ${fmt(e.size)}` }
      try { im.src = await dataUri(e) } catch { inf.textContent = 'Could not load' }
    } else { bx.append(badge(e.name)); inf.textContent = fmt(e.size) }
  }
  let neu: { uri: string; name: string; size: number } | null = null, old: { data: string; size?: number } | null = null
  const btn = (t2: string, alt = false) => { const x2 = document.createElement('button'); x2.textContent = t2; if (alt) x2.className = 'alt'; return x2 }
  const choose = btn('Choose replacement'), rb = btn('Replace'), undoB = btn('Undo', true)
  rb.disabled = true; undoB.hidden = true
  const acts = document.createElement('div'); acts.className = 'acts'; acts.append(choose, rb, undoB)
  choose.onclick = async () => {
    try {
      neu = await Saf.pickFile(); await show(b, neu); rb.disabled = false
      note.classList.toggle('warn', ext(neu.name) !== ext(f.name))
      note.textContent = ext(neu.name) !== ext(f.name) ? `Different format: new file is .${ext(neu.name)}, this one is .${ext(f.name)}. It will be saved under the existing name as-is.` : ''
    } catch { /* cancelled */ }
  }
  rb.onclick = async () => {
    if (!neu || !confirm(`Replace ${f.name} with the new file?`)) return
    try {
      old = { data: (await Saf.readBase64({ uri: f.uri })).data, size: f.size }
      await Saf.writeBase64({ uri: f.uri, data: (await Saf.readBase64({ uri: neu.uri })).data })
      cache.delete(f.uri); f.size = neu.size; await show(a, f); undoB.hidden = false; toast('Replaced')
    } catch (e: any) { toast(`Could not replace: ${e?.message ?? e}`) }
  }
  undoB.onclick = async () => {
    if (!old) return
    try { await Saf.writeBase64({ uri: f.uri, data: old.data }); cache.delete(f.uri); f.size = old.size; old = null; undoB.hidden = true; await show(a, f); toast('Restored') }
    catch (e: any) { toast(`Could not restore: ${e?.message ?? e}`) }
  }
  s.body.append(cmp, note, acts); show(a, f)
}
async function matchFolder(all: F[]) {
  let uri: string
  try { uri = (await Saf.pickFolder()).uri } catch { return }
  const s = sheet(undefined, 'Match by filename'); s.body.innerHTML = '<div class="msg">Scanning…</div>'
  const reps = (await walkAny(uri)).filter(r => IMG.test(r.name) || RES.test(r.name))
  const byName = new Map<string, F>(); for (const r of reps) if (!byName.has(r.name.toLowerCase())) byName.set(r.name.toLowerCase(), r)
  const pairs = all.map(x => ({ a: x, b: byName.get(x.name.toLowerCase()) })).filter(p => p.b) as { a: F; b: F }[]
  const used = new Set(pairs.map(p => p.b.uri))
  if (!pairs.length) { s.body.innerHTML = '<div class="msg">No files in that folder share a name with your project assets.</div>'; return }
  const obs = lazy(s.body), checks: HTMLInputElement[] = []
  const note = document.createElement('div'); note.className = 'note'
  note.textContent = `${pairs.length} matched · ${all.length - pairs.length} project assets without a replacement · ${reps.filter(r => !used.has(r.uri)).length} new files without a match`
  const rb = document.createElement('button'), acts = document.createElement('div'); acts.className = 'acts'; acts.append(rb)
  const count = () => { const n = checks.filter(c => c.checked).length; rb.textContent = `Replace selected (${n})`; rb.disabled = !n }
  const list = document.createElement('div'); list.className = 'pairs'
  for (const p of pairs) {
    const row = document.createElement('div'); row.className = 'pair'
    const ck = document.createElement('input'); ck.type = 'checkbox'; ck.checked = true; ck.onchange = count; checks.push(ck)
    const mid = document.createElement('div'); mid.className = 'mid'
    const nm = document.createElement('b'); nm.textContent = p.a.name
    const sm = document.createElement('small'); sm.textContent = `${p.a.path} · ${fmt(p.a.size)} → ${fmt(p.b.size)}`
    mid.append(nm, sm); row.append(ck, thumb(p.a, obs), thumb(p.b, obs), mid)
    row.onclick = ev => { if (ev.target !== ck) { ck.checked = !ck.checked; count() } }
    list.append(row)
  }
  count()
  rb.onclick = async () => {
    const sel = pairs.filter((_, i) => checks[i].checked)
    if (!confirm(`Replace ${sel.length} file(s) in your project with the new versions? Bulk replace cannot be undone.`)) return
    let n = 0, fail = 0
    for (const p of sel) {
      try { await Saf.writeBase64({ uri: p.a.uri, data: (await Saf.readBase64({ uri: p.b.uri })).data }); cache.delete(p.a.uri); n++ } catch { fail++ }
      rb.textContent = `Replacing… ${n + fail}/${sel.length}`
    }
    s.body.innerHTML = `<div class="msg">Replaced ${n} file(s)${fail ? `, ${fail} failed` : ''}.</div>`
  }
  s.body.replaceChildren(acts, note, list)
}

// ---------- wiring ----------
$('#menu').onclick = () => drawer(true)
scrim.onclick = () => drawer(false)
$('#search').onclick = () => { if (cur) openSearchPanel(view); else toast('Open a file first') }
$('#run').onclick = preview
$('#psearch').onclick = () => { drawer(false); setTimeout(searchUI, 120) }
$('#refresh').onclick = () => root && loadFolder(root)
$('#open').onclick = pick
$('#assets').onclick = () => { drawer(false); setTimeout(assets, 120) }
$('#more').onclick = () => { drawer(false); setTimeout(settings, 120) }
const last = localStorage.getItem('folder')
if (last) loadFolder(last)
