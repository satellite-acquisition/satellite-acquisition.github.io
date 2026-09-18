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
assert(!/\barxiv\b/i.test(html), 'Remove the unavailable arXiv resource and its placeholder text.');

const video = elements.find((element) => {
  const attrs = attributes(element[2]);
  return element[1].toLowerCase() === 'iframe'
    && /^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/CapYyRrfLU8(?:[?/#]|$)/.test(attrs.src ?? '');
});
assert(video, 'Embed the LEOPT video in the project page.');
assert(video.index > resourceNav.index + resourceNav[0].length,
  'The video should follow the Code and BibTeX controls.');
const abstract = elements.find((element) => attributes(element[2]).id === 'abstract');
assert(abstract && video.index < abstract.index, 'The video should appear before the abstract.');
assert(!elements.some((element) => element[1].toLowerCase() === 'iframe'
  && /^(?:\.\/)?console\//.test(attributes(element[2]).src ?? '')),
  'The console should open separately, without an embedded copy in the page.');
assert(references.some((reference) => /^https:\/\/(?:youtu\.be\/|www\.youtube\.com\/watch\?v=)CapYyRrfLU8(?:[?&#]|$)/.test(reference)),
  'Keep the project video available as an external fallback link.');

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

const referenceCount = [...documents.values()].reduce((sum, document) => sum + document.references.length, 0);
console.log(`Site checks passed: ${documents.size} HTML documents, ${referenceCount} references, project resources, and console launcher.`);
