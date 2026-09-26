import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const documents = new Map();

function attributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
      .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]),
  );
}

async function readDocument(filename) {
  if (documents.has(filename)) return documents.get(filename);
  const html = await readFile(path.join(root, filename), 'utf8');
  // Preserve offsets while excluding markup inside comments and script text.
  const markup = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi,
    (match) => match.startsWith('<!--') ? ' '.repeat(match.length)
      : match.replace(/(>)[\s\S]*(<\/script>)/i,
        (body, opening, closing) => opening + ' '.repeat(body.length - opening.length - closing.length) + closing));
  const elements = [...markup.matchAll(/<([a-z][\w:-]*)\b([^>]*?)>/gi)];
  const ids = new Set();
  const references = [];

  for (const element of elements) {
    const attrs = attributes(element[2]);
    if (attrs.id) {
      assert(!ids.has(attrs.id), `${filename}: duplicate HTML id ${attrs.id}`);
      ids.add(attrs.id);
    }
    for (const attribute of ['src', 'href']) {
      if (attrs[attribute]) references.push(attrs[attribute]);
    }
    if (element[1].toLowerCase() === 'img') {
      assert('alt' in attrs, `${filename}: image needs alt text (${attrs.src})`);
    }
    if (element[1].toLowerCase() === 'iframe') {
      assert(attrs.title?.trim(), `${filename}: iframe needs an accessible title`);
    }
  }

  const document = { html, elements, ids, references };
  documents.set(filename, document);
  return document;
}

async function findHtml(directory) {
  const filenames = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const filename = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) filenames.push(...await findHtml(filename));
    else if (entry.name.endsWith('.html')) filenames.push(filename);
  }
  return filenames;
}

const filenames = ['index.html', ...await findHtml('console')];
assert(filenames.includes('console/index.html'), 'The browser console needs an index.html.');
await Promise.all(filenames.map(readDocument));

for (const [filename, document] of documents) {
  for (const reference of document.references) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) continue;
    const target = new URL(reference.replaceAll('&amp;', '&'), `https://site.invalid/${filename}`);
    let relativePath = decodeURIComponent(target.pathname).replace(/^\/+/, '') || 'index.html';
    const targetPath = path.resolve(root, relativePath);
    const relativeToRoot = path.relative(root, targetPath);
    assert(!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot),
      `${filename}: local reference escapes the site (${reference})`);
    const info = await stat(targetPath).catch(() => null);
    assert(info, `${filename}: missing local target (${reference})`);
    if (info.isDirectory()) {
      relativePath = path.posix.join(relativePath, 'index.html');
      assert(await stat(path.join(root, relativePath)).catch(() => null),
        `${filename}: directory target has no index.html (${reference})`);
    }
    if (target.hash && relativePath.endsWith('.html')) {
      const targetDocument = await readDocument(relativePath);
      const id = decodeURIComponent(target.hash.slice(1));
      assert(targetDocument.ids.has(id), `${filename}: missing anchor target (${reference})`);
    }
  }
}

const { html, elements, references } = documents.get('index.html');
const resourceNav = [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)]
  .find((match) => match[0].includes('https://github.com/satellite-acquisition/leopt'));
assert(resourceNav, 'Resource navigation must link to the LEOPT repository.');
assert(/bibtex/i.test(resourceNav[0]) && /href=["']#citation["']/.test(resourceNav[0]),
  'Resource navigation must link to the BibTeX citation.');

const headline = [...html.matchAll(/<figure\b([^>]*)>[\s\S]*?<\/figure>/gi)]
  .find(match => attributes(match[1]).id === 'demo');
assert(headline, 'Include the project image sequence in the demo figure.');
assert(headline.index > resourceNav.index + resourceNav[0].length,
  'The project image sequence should follow the Code and BibTeX controls.');
const abstract = elements.find((element) => attributes(element[2]).id === 'abstract');
assert(abstract && headline.index + headline[0].length < abstract.index,
  'The project image sequence should appear before the abstract.');
const headlineImages = [...headline[0].matchAll(/<img\b([^>]*)>/gi)];
assert.deepEqual(headlineImages.map(match => attributes(match[1]).src), [
  'assets/figures/headline-launch.webp',
  'assets/figures/headline-uncertainty.webp',
  'assets/figures/headline-acquisition.webp',
], 'Show launch, orbital uncertainty, and acquisition in that order.');
const caption = headline[0].match(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/i);
assert(caption && caption.index > headlineImages.at(-1).index,
  'Place the photo credits after the image sequence.');
const creditLinks = [...caption[0].matchAll(/<a\b([^>]*)>/gi)]
  .map(match => attributes(match[1]).href);
for (const source of [
  'https://www.flickr.com/photos/spacex/50631643917/',
  'https://creativecommons.org/licenses/by-nc/2.0/',
  'https://www.nasa.gov/image-detail/goldstone-dss14-01/',
  'https://commons.wikimedia.org/wiki/File:ISS-51_CubeSat_deployment_-_A_pair_of_CubeSats.jpg',
]) assert(creditLinks.includes(source), `Missing photo source or license credit: ${source}`);
assert(!elements.some((element) => element[1].toLowerCase() === 'iframe'
  && /^(?:\.\/)?console\//.test(attributes(element[2]).src ?? '')),
  'The console should open separately, without an embedded copy in the page.');

const software = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)]
  .find((match) => /\bid=["']software["']/.test(match[0]));
const launch = elements.find((element) => attributes(element[2]).id === 'launch-console');
assert(software && launch && launch.index > software.index
  && launch.index < software.index + software[0].length,
  'Explore LEOPT must include the console launcher.');
const launchAttrs = attributes(launch[2]);
assert.equal(launch[1].toLowerCase(), 'a', 'The console launcher needs a link fallback.');
assert.equal(launchAttrs.href, 'console/index.html', 'Launch the local browser console.');
assert.equal(launchAttrs.target, '_blank', 'The console should open in a separate window or tab.');
assert(launchAttrs.rel?.split(/\s+/).includes('noopener'), 'The console link must isolate its opener.');

const consoleDocument = documents.get('console/index.html');
assert(consoleDocument.elements.some((element) => element[1].toLowerCase() === 'script'
  && attributes(element[2]).src === 'intro.js'), 'The console must load its intro animation.');
const introSource = await readFile(path.join(root, 'console/intro.js'), 'utf8');
const logoReference = introSource.match(/\bLOGO_SRC\s*=\s*["']([^"']+)["']/)?.[1];
assert(logoReference, 'The intro animation needs a logo source.');
assert((await stat(path.resolve(root, 'console', logoReference)).catch(() => null))?.isFile(),
  'The intro animation logo must exist at its referenced path.');

// Check the launcher handler's fallback decisions without simulating a browser.
let launchHandler;
let popup;
let openCalls = 0;
let navigatedTo;
const consoleUrl = 'https://satellite-acquisition.github.io/console/index.html';
const link = { href: consoleUrl, addEventListener(event, handler) { launchHandler = handler; } };
const launcherContext = vm.createContext({
  document: { querySelector(selector) { return selector === '#launch-console' ? link : null; } },
  window: { open() { openCalls++; return popup; } },
});
vm.runInContext(await readFile(path.join(root, 'site.js'), 'utf8'), launcherContext, { timeout: 1000 });
assert.equal(typeof launchHandler, 'function', 'The console launch link needs a click handler.');
function click(overrides = {}) {
  const event = { button: 0, defaultPrevented: false, ...overrides,
    preventDefault() { this.defaultPrevented = true; } };
  launchHandler(event);
  return event;
}
popup = { opener: {}, location: { replace(url) {
  assert.equal(popup.opener, null, 'Isolate the popup before navigating it.');
  navigatedTo = url;
} } };
assert(click().defaultPrevented, 'Opening the popup should suppress a duplicate tab.');
assert.equal(navigatedTo, consoleUrl, 'The popup should navigate to the console.');
assert.equal(openCalls, 1);
popup = null;
assert(!click().defaultPrevented, 'A blocked popup must leave the normal link fallback available.');
assert.equal(openCalls, 2);
for (const modifier of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
  assert(!click(modifier).defaultPrevented, 'Modified clicks must preserve the native link behavior.');
}
assert.equal(openCalls, 2, 'Modified clicks should not open an extra popup.');

const resultIds = ['single-spacecraft', 'fleet'];
const tabList = elements.find(element => attributes(element[2]).id === 'results-tabs');
assert(tabList && attributes(tabList[2]).role === 'tablist'
  && /(?:^|\s)hidden(?:\s|=|$)/.test(tabList[2]), 'Hide the tab controls until JavaScript initializes them.');
for (const id of resultIds) {
  const panel = elements.find(element => attributes(element[2]).id === id);
  const tab = elements.find(element => attributes(element[2]).id === `${id}-tab`);
  assert(panel && !/(?:^|\s)hidden(?:\s|=|$)/.test(panel[2]), 'Both result sections must remain visible without JavaScript.');
  assert.equal(attributes(panel[2])['aria-labelledby'], `${id}-title`);
  assert(elements.some(element => element[1].toLowerCase() === 'h3' && attributes(element[2]).id === `${id}-title`));
  assert(tab && tab[1].toLowerCase() === 'button' && attributes(tab[2]).role === 'tab');
  assert.equal(attributes(tab[2])['aria-controls'], id);
}

// Exercise tab selection, focus, and history decisions without a layout engine.
function startTabs(hash = '') {
  const focused = [], replaced = [], listeners = {};
  function element(id) {
    return { id, hidden: false, attrs: {}, events: {},
      getAttribute(name) { return this.attrs[name]; },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
      focus() { focused.push(this.id); } };
  }
  const panels = resultIds.map(element);
  const tabs = resultIds.map(id => element(`${id}-tab`));
  tabs.forEach((tab, index) => { tab.attrs['aria-controls'] = resultIds[index]; });
  const classes = new Set();
  const results = { classList: { add(name) { classes.add(name); } } };
  const tablist = { hidden: true, querySelectorAll() { return tabs; } };
  const nodes = new Map([['#results', results], ['#results-tabs', tablist], ...panels.map(panel => [`#${panel.id}`, panel])]);
  const window = { location: { hash },
    history: { state: { existing: true }, replaceState(state, title, fragment) {
      replaced.push(fragment); window.location.hash = fragment;
    } },
    addEventListener(name, handler) { listeners[name] = handler; } };
  vm.runInContext(siteSource, vm.createContext({ window,
    document: { querySelector(selector) { return nodes.get(selector) ?? null; } } }), { timeout: 1000 });
  function selected(index) {
    tabs.forEach((tab, current) => {
      assert.equal(tab.attrs['aria-selected'], String(current === index));
      assert.equal(tab.tabIndex, current === index ? 0 : -1);
      assert.equal(panels[current].hidden, current !== index);
      assert.equal(panels[current].attrs.role, 'tabpanel');
      assert.equal(panels[current].attrs['aria-labelledby'], tab.id);
    });
  }
  function key(index, key) {
    const event = { key, prevented: false, preventDefault() { this.prevented = true; } };
    tabs[index].events.keydown(event);
    return event.prevented;
  }
  assert(classes.has('has-tabs') && !tablist.hidden);
  return { tabs, focused, replaced, window, listeners, selected, key };
}
const siteSource = await readFile(path.join(root, 'site.js'), 'utf8');
const resultsState = startTabs();
resultsState.selected(0);
assert.equal(resultsState.focused.length, 0, 'Initialization must not steal focus.');
assert.equal(resultsState.replaced.length, 0, 'Initialization must preserve the current URL.');
resultsState.tabs[1].events.click();
resultsState.selected(1);
assert.equal(resultsState.focused.at(-1), 'fleet-tab');
assert.equal(resultsState.window.location.hash, '#fleet');
for (const [from, key, to] of [[1, 'ArrowRight', 0], [0, 'ArrowLeft', 1], [1, 'Home', 0], [0, 'End', 1]]) {
  assert(resultsState.key(from, key));
  resultsState.selected(to);
  assert.equal(resultsState.focused.at(-1), `${resultIds[to]}-tab`);
}
assert(!resultsState.key(1, 'ArrowDown'), 'Unrelated keys must retain native behavior.');
const focusCount = resultsState.focused.length;
for (const [hash, selected] of [['#results', 0], ['#fleet-title', 1], ['#citation', 1], ['#single-spacecraft-title', 0]]) {
  resultsState.window.location.hash = hash;
  resultsState.listeners.hashchange();
  resultsState.selected(selected);
}
assert.equal(resultsState.focused.length, focusCount, 'Hash navigation must not steal focus.');
for (const hash of ['#fleet', '#fleet-title']) {
  const deepLink = startTabs(hash);
  deepLink.selected(1);
  assert.equal(deepLink.focused.length, 0);
  assert.equal(deepLink.replaced.length, 0);
}

const referenceCount = [...documents.values()].reduce((sum, document) => sum + document.references.length, 0);
console.log(`Site checks passed: ${documents.size} HTML documents, ${referenceCount} references, project resources, console launcher, and accessible results tabs.`);
