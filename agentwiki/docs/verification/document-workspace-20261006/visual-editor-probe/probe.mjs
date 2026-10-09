import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createTwoFilesPatch } from 'diff';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Mathematics } from '@tiptap/extension-mathematics';

// Headless Editor evidence covers model/commands, not native GUI or Chinese IME.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key], configurable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const out = process.env.PROBE_OUTPUT || path.resolve('results');
fs.mkdirSync(out, { recursive: true });
const fixturePath = process.env.PROBE_FIXTURES || new URL('./fixtures.json', import.meta.url);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const extensions = [StarterKit.configure({ trailingNode: false }), TableKit, Image, TaskList, TaskItem.configure({ nested: true }), Mathematics];
const manager = new MarkdownManager({ extensions });
const cleanAST = value => {
  if (Array.isArray(value)) return value.map(cleanAST);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'position').map(([key, child]) => [key, cleanAST(child)]));
};
const nodeTypes = json => {
  const types = new Set();
  const walk = node => { types.add(node.type); for (const child of node.content || []) walk(child); };
  walk(json); return [...types].sort();
};
let obsidian;
let rendererSource;
if (process.env.AGENTWIKI_REPO) {
  const file = path.join(process.env.AGENTWIKI_REPO, 'agentwiki/apps/client/src/components/markdown/obsidian.ts');
  obsidian = (await import(pathToFileURL(file).href)).remarkAgentWikiObsidian;
  rendererSource = { file, sha256: sha(fs.readFileSync(file)) };
}
const rendererAST = source => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  if (obsidian) processor.use(obsidian({}));
  processor.use(remarkBreaks);
  const tree = processor.runSync(processor.parse(source));
  if (tree?.type !== 'root') throw new Error('renderer AST is not a root tree');
  return cleanAST(tree);
};
// Compare rendering meaning separately from AST spelling and source offsets.
const rendererMeaning = tree => {
  const definitions = new Map();
  const collect = node => { if (node.type === 'definition') definitions.set(node.identifier, node); for (const child of node.children || []) collect(child); };
  collect(tree);
  const normalize = node => {
    if (Array.isArray(node)) return node.filter(child => child?.type !== 'definition').map(normalize);
    if (!node || typeof node !== 'object') return node;
    if (['linkReference', 'imageReference'].includes(node.type) && definitions.has(node.identifier)) {
      const definition = definitions.get(node.identifier);
      node = node.type === 'linkReference' ? { type: 'link', title: definition.title, url: definition.url, children: node.children } : { type: 'image', title: definition.title, url: definition.url, alt: node.alt };
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'data-markdown-source-offset').map(([key, value]) => [key, normalize(value)]));
  };
  return normalize(tree);
};
const results = [];
for (const fixture of fixtures) {
  const dir = path.join(out, fixture.id); fs.mkdirSync(dir, { recursive: true });
  const input = fixture.input;
  try {
    const parsed = manager.parse(input);
    const serialized = manager.serialize(parsed);
    const reparsed = manager.parse(serialized);
    let documentChanges = 0;
    const editor = new Editor({ element: document.createElement('div'), extensions: [...extensions, Markdown], content: input, contentType: 'markdown', onUpdate: () => documentChanges++ });
    let selectionPos;
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock && selectionPos === undefined) selectionPos = pos + 1; });
    if (selectionPos !== undefined) editor.commands.setTextSelection(selectionPos);
    const editorOutput = editor.getMarkdown();
    // Minimal no-edit save guard: retain original bytes unless a doc-change update occurred.
    const guardOutput = documentChanges === 0 ? input : editor.getMarkdown();
    const originalAST = rendererAST(input);
    const outputAST = rendererAST(serialized);
    const types = nodeTypes(parsed);
    const result = {
      id: fixture.id, note: fixture.note || null,
      inputBytes: Buffer.byteLength(input), outputBytes: Buffer.byteLength(serialized),
      inputSha256: sha(input), outputSha256: sha(serialized),
      byteExact: input === serialized, editorOpenByteExact: input === editorOutput,
      openAndSelectionDocumentChanges: documentChanges,
      noEditGuardByteExact: input === guardOutput,
      tiptapReparseStructureStable: JSON.stringify(parsed) === JSON.stringify(reparsed),
      currentGfmObsidianASTEquivalent: JSON.stringify(originalAST) === JSON.stringify(outputAST),
      currentRendererMeaningEquivalent: JSON.stringify(rendererMeaning(originalAST)) === JSON.stringify(rendererMeaning(outputAST)),
      nodeTypes: types,
      expectedNativeNodesPresent: fixture.expectNodes ? fixture.expectNodes.every(type => types.includes(type)) : null,
    };
    fs.writeFileSync(path.join(dir, 'input.md'), input);
    fs.writeFileSync(path.join(dir, 'output.md'), serialized);
    fs.writeFileSync(path.join(dir, 'editor-output.md'), editorOutput);
    fs.writeFileSync(path.join(dir, 'diff.patch'), createTwoFilesPatch('input.md', 'output.md', input, serialized));
    fs.writeFileSync(path.join(dir, 'tiptap.json'), JSON.stringify(parsed, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'reparsed.json'), JSON.stringify(reparsed, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'renderer-before.json'), JSON.stringify(originalAST, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'renderer-after.json'), JSON.stringify(outputAST, null, 2) + '\n');
    results.push(result); editor.destroy();
  } catch (error) { results.push({ id: fixture.id, error: String(error.stack || error) }); }
}

// Local edit gate: modify the first paragraph, inspect untouched suffix.
const localInput = '# 中文\n\n第一段。\n\n__未编辑段落__\n\n* 保留列表样式\n\n[附件][ref]\n\n[ref]: ../assets/原文.pdf\n';
const localEditor = new Editor({ element: document.createElement('div'), extensions: [...extensions, Markdown], content: localInput, contentType: 'markdown' });
const localBaselineJSON = JSON.stringify(localEditor.getJSON());
let localChanges = 0; localEditor.on('update', () => localChanges++);
let editPos;
localEditor.state.doc.descendants((node, pos) => { if (node.isText && node.text === '第一段。') editPos = pos; });
if (editPos === undefined) throw new Error('local-edit target not found');
localEditor.commands.insertContentAt(editPos, '新增中文');
const localOutput = localEditor.getMarkdown();
const untouchedSuffix = localInput.slice(localInput.indexOf('__未编辑段落__'));
const localEdit = { docChanges: localChanges, insertedTextPresent: localOutput.includes('新增中文第一段。'), untouchedSuffixByteExact: localOutput.endsWith(untouchedSuffix), inputSha256: sha(localInput), outputSha256: sha(localOutput) };
fs.writeFileSync(path.join(out, 'local-edit-input.md'), localInput);
fs.writeFileSync(path.join(out, 'local-edit-output.md'), localOutput);
fs.writeFileSync(path.join(out, 'local-edit.patch'), createTwoFilesPatch('local-edit-input.md', 'local-edit-output.md', localInput, localOutput));
localEditor.commands.undo();
localEdit.undoRestoresInitialEditorJSON = JSON.stringify(localEditor.getJSON()) === localBaselineJSON;
localEdit.undoRestoresSourceBytes = localEditor.getMarkdown() === localInput;
localEdit.baselineJSONGuardAfterUndoRestoresSourceBytes = (localEdit.undoRestoresInitialEditorJSON ? localInput : localEditor.getMarkdown()) === localInput;
localEditor.destroy();

// Model-level editing evidence: table columns, image attributes, task toggle.
const modelEditor = new Editor({ element: document.createElement('div'), extensions: [...extensions, Markdown], content: '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n![图](assets/a.png)\n\n- [ ] 任务', contentType: 'markdown' });
let tablePosition; modelEditor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell' && tablePosition === undefined) tablePosition = pos + 2; });
modelEditor.commands.setTextSelection(tablePosition);
const columnCommand = modelEditor.commands.addColumnAfter();
let imagePos, taskPos; modelEditor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imagePos = pos; if (node.type.name === 'taskItem') taskPos = pos; });
modelEditor.commands.setNodeSelection(imagePos);
const imageCommand = modelEditor.commands.updateAttributes('image', { alt: '改后的中文图', src: 'assets/b.png' });
modelEditor.view.dispatch(modelEditor.state.tr.setNodeMarkup(taskPos, undefined, { ...modelEditor.state.doc.nodeAt(taskPos).attrs, checked: true }));
const modelJSON = modelEditor.getJSON();
const table = modelJSON.content.find(node => node.type === 'table');
const modelEditing = { columnCommand, columnsAfter: table.content[0].content.length, imageCommand, updatedImagePresent: modelEditor.getMarkdown().includes('![改后的中文图](assets/b.png)'), taskCheckedPresent: modelEditor.getMarkdown().includes('- [x] 任务') };
fs.writeFileSync(path.join(out, 'model-edit-output.md'), modelEditor.getMarkdown());
modelEditor.destroy();

const summary = {
  timestamp: new Date().toISOString(), node: process.version, platform: process.platform,
  versions: Object.fromEntries(['markdown', 'core', 'starter-kit', 'extension-table', 'extension-image', 'extension-list', 'extension-mathematics'].map(name => [name, JSON.parse(fs.readFileSync(new URL(`./node_modules/@tiptap/${name}/package.json`, import.meta.url))).version])),
  toolVersions: Object.fromEntries(['jsdom', 'diff', 'unified', 'remark-parse', 'remark-gfm', 'remark-math', 'remark-breaks', 'tsx'].map(name => [name, JSON.parse(fs.readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url))).version])),
  rendererSource, limitations: ['jsdom model and command test only; no native IME, browser drag/drop, scroll restoration, attachment upload, Local Sync or multi-user undo acceptance', 'AST comparison uses current remark-gfm/math/obsidian/breaks; excludes rehype/React rendering and resource resolution'],
  totals: { fixtures: results.length, byteExact: results.filter(r => r.byteExact).length, editorOpenByteExact: results.filter(r => r.editorOpenByteExact).length, noEditGuardByteExact: results.filter(r => r.noEditGuardByteExact).length, structureStable: results.filter(r => r.tiptapReparseStructureStable).length, gfmObsidianEquivalent: results.filter(r => r.currentGfmObsidianASTEquivalent).length, rendererMeaningEquivalent: results.filter(r => r.currentRendererMeaningEquivalent).length, errors: results.filter(r => r.error).length },
  localEdit, modelEditing, results,
};
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ totals: summary.totals, localEdit, modelEditing, results: results.map(({ id, byteExact, currentRendererMeaningEquivalent, tiptapReparseStructureStable, error }) => ({ id, byteExact, currentRendererMeaningEquivalent, tiptapReparseStructureStable, error })) }, null, 2));
