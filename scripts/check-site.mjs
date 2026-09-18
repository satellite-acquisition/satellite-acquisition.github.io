import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const demo = elements.find((element) => {
  const attrs = attributes(element[2]);
  return element[1].toLowerCase() === 'iframe'
    && /^(?:\.\/)?console\/(?:index\.html)?(?:[?#].*)?$/.test(attrs.src ?? '');
});
assert(demo, 'Embed the local interactive console in the project page.');
assert(demo.index > resourceNav.index + resourceNav[0].length,
  'The console should follow the Code and BibTeX controls.');
const abstract = elements.find((element) => attributes(element[2]).id === 'abstract');
assert(abstract && demo.index < abstract.index, 'The console should appear before the abstract.');
assert(references.some((reference) => /^https:\/\/(?:youtu\.be\/|www\.youtube\.com\/watch\?v=)CapYyRrfLU8(?:[?&#]|$)/.test(reference)),
  'Keep the project video available as an external fallback link.');

const referenceCount = [...documents.values()].reduce((sum, document) => sum + document.references.length, 0);
console.log(`Site checks passed: ${documents.size} HTML documents, ${referenceCount} references, and project resources.`);
