// ---------- the editor's text area ----------
// CodeMirror (vendor/codemirror.min.js), wrapped to look like a <textarea> to editor.html:
// value, selectionStart/End, setSelectionRange, scrollTop, focus, select and addEventListener.
// The text is always plain markdown. Links only *look* folded: [text](url) shows as text plus a
// small link chip until the cursor goes into it, so saving, copying or exporting is unchanged.

function createTextEditor(parent, { placeholder = '' } = {}) {
  const listeners = {};  // 'input' (text changed) and 'select' (cursor moved) come from CodeMirror
  const fire = (type, e) => (listeners[type] || []).forEach(fn => fn(e));
  let showAddresses = false;
  try { showAddresses = localStorage.getItem('easydocs.linkAddresses') === 'shown'; } catch { }
  const refold = CM.StateEffect.define();

  class LinkChip extends CM.WidgetType {
    constructor(url) { super(); this.url = url; }
    eq(other) { return other.url === this.url; }
    toDOM() {
      const chip = document.createElement('span');
      chip.className = 'cm-link-chip';
      chip.innerHTML = icon('link');
      chip.title = `${this.url}\nClick to show the address`;
      return chip;
    }
    ignoreEvent() { return false; }
  }

  /** Fold the "(url)" of every link the cursor isn't in. */
  function foldLinks(view) {
    const { state } = view, sel = state.selection.main, folds = [];
    if (showAddresses) return CM.Decoration.none;
    for (const { from, to } of view.visibleRanges) {
      CM.syntaxTree(state).iterate({ from, to, enter: n => {
        if (n.name !== 'Link') return;
        const link = n.node, url = link.getChild('URL');
        const open = link.getChildren('LinkMark').find(m => state.sliceDoc(m.from, m.to) === '(');
        const inside = sel.from <= link.to && sel.to >= link.from;
        if (url && open && !inside && !folds.some(f => f.from === open.from)) {
          folds.push(CM.Decoration.replace({ widget: new LinkChip(state.sliceDoc(url.from, url.to)) }).range(open.from, link.to));
        }
        return false;
      } });
    }
    return CM.Decoration.set(folds, true);
  }
  const linkFolding = CM.ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = foldLinks(view); }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || CM.syntaxTree(u.startState) !== CM.syntaxTree(u.state)
          || u.transactions.some(tr => tr.effects.some(e => e.is(refold)))) this.decorations = foldLinks(u.view);
    }
  }, {
    decorations: p => p.decorations,
    eventHandlers: {
      // Clicking a chip opens the link up for editing.
      mousedown(e, view) {
        const chip = e.target.closest('.cm-link-chip');
        if (!chip) return false;
        e.preventDefault();
        view.dispatch({ selection: { anchor: view.posAtDOM(chip) + 1 } });
        view.focus();
        return true;
      },
    },
  });

  // ---------- backtick pairing ----------
  // ` types `|`, a second ` makes ``|``, and a third at the start of a line opens a code block:
  // ```|  with the closing ``` on the next line. Typing ` just before a closing tick steps over it.
  const ticksBefore = (doc, pos) => { let n = 0; while (pos - n > 0 && doc.sliceString(pos - n - 1, pos - n) === '`') n++; return n; };
  const ticksAfter = (doc, pos) => { let n = 0; while (pos + n < doc.length && doc.sliceString(pos + n, pos + n + 1) === '`') n++; return n; };

  const backtickPairing = CM.EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '`' || view.composing) return false;
    const { state } = view, sel = state.selection.main;
    if (sel.from !== from || sel.to !== to) return false;
    const doc = state.doc;
    if (from !== to) {  // wrap the selection in ticks
      view.dispatch({ changes: [{ from, insert: '`' }, { from: to, insert: '`' }],
        selection: { anchor: from + 1, head: to + 1 }, userEvent: 'input.type' });
      return true;
    }
    const before = ticksBefore(doc, from), after = ticksAfter(doc, from);
    const line = doc.lineAt(from);
    const lineStart = /^\s*$/.test(doc.sliceString(line.from, from - before));
    const lineEnd = from + after === line.to;
    let changes, anchor;
    if (before === 2 && after === 2 && lineStart && lineEnd) {
      const indent = doc.sliceString(line.from, from - before);
      changes = { from, to: from + after, insert: '`\n' + indent + '```' };
      anchor = from + 1;
    } else if (before === 1 && after === 1) {
      changes = { from, insert: '``' }; anchor = from + 1;
    } else if (after > 0) {
      anchor = from + 1;  // step over the closing tick
    } else if (before === 0 && !/\w/.test(doc.sliceString(from, from + 1))) {
      changes = { from, insert: '``' }; anchor = from + 1;
    } else return false;
    view.dispatch({ changes, selection: { anchor }, scrollIntoView: true, userEvent: 'input.type' });
    return true;
  });

  // Backspace inside an empty pair (`|` or ``|``) removes both halves.
  const deletePair = view => {
    const { state } = view, sel = state.selection.main;
    if (!sel.empty) return false;
    const doc = state.doc, pos = sel.from;
    const before = ticksBefore(doc, pos), after = ticksAfter(doc, pos);
    if (before !== after || before < 1 || before > 2) return false;
    view.dispatch({ changes: { from: pos - 1, to: pos + 1 }, userEvent: 'delete.backward' });
    return true;
  };

  const t = CM.tags;
  const highlight = CM.HighlightStyle.define([
    { tag: t.heading, fontWeight: '700' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: 'var(--accent-text)' },
    { tag: t.url, color: 'var(--text-faint)' },
    { tag: t.monospace, color: 'var(--accent-text)' },
    { tag: t.quote, color: 'var(--text-soft)' },
    { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--text-faint)' },
  ]);

  const extensions = [
    CM.history(),
    CM.search({ top: true }),
    backtickPairing,
    CM.keymap.of([{ key: 'Backspace', run: deletePair }, ...CM.searchKeymap, ...CM.historyKeymap, ...CM.defaultKeymap]),
    CM.markdown({ base: CM.markdownLanguage, addKeymap: false }),
    CM.syntaxHighlighting(highlight),
    CM.EditorView.lineWrapping,
    CM.EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences' }),
    CM.placeholder(placeholder),
    CM.EditorView.theme({}, { dark: true }),
    linkFolding,
    CM.EditorView.updateListener.of(u => {
      if (u.docChanged) fire('input');
      if (u.docChanged || u.selectionSet || u.focusChanged) fire('select');
    }),
  ];
  const view = new CM.EditorView({ parent, state: CM.EditorState.create({ extensions }) });

  // Like a textarea, right-click moves the cursor to the click unless it's inside the selection.
  view.dom.addEventListener('contextmenu', e => {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const { from, to } = view.state.selection.main;
    if (pos != null && (pos < from || pos > to)) view.dispatch({ selection: { anchor: pos } });
  }, true);

  const clamp = n => Math.max(0, Math.min(n, view.state.doc.length));
  return {
    view,
    dom: view.dom,
    get value() { return view.state.doc.toString(); },
    // Replacing the whole text starts a fresh undo history, as with a textarea.
    set value(text) { view.setState(CM.EditorState.create({ doc: text, extensions })); },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    setSelectionRange(start, end = start) { view.dispatch({ selection: { anchor: clamp(start), head: clamp(end) } }); },
    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(px) { view.scrollDOM.scrollTop = px; },
    focus() { view.focus(); },
    select() { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); },
    /** Type text over the selection: one undo step. */
    replaceSelection(text) {
      view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
    },
    get showAddresses() { return showAddresses; },
    set showAddresses(on) {
      showAddresses = on;
      try { localStorage.setItem('easydocs.linkAddresses', on ? 'shown' : 'folded'); } catch { }
      view.dispatch({ effects: refold.of(null) });
    },
    // DOM events are caught on the way in, before CodeMirror's own handlers, so preventDefault()
    // here stops CodeMirror too. Events in the search panel are left alone.
    addEventListener(type, fn) {
      if (type === 'input' || type === 'select') { (listeners[type] ||= []).push(fn); return; }
      view.dom.addEventListener(type, e => {
        if (e.target.closest?.('.cm-panels')) return;
        fn(e);
        if (e.defaultPrevented && (type === 'drop' || type === 'paste')) e.stopPropagation();
      }, true);
    },
  };
}
