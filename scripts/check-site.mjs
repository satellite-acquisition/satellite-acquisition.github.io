import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const elements = [...html.matchAll(/<([a-z][\w:-]*)\b([^>]*?)>/gi)];
const ids = new Set();
const references = [];

function attributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
      .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]),
  );
}

for (const element of elements) {
  const attrs = attributes(element[2]);
  if (attrs.id) {
    assert(!ids.has(attrs.id), `Duplicate HTML id: ${attrs.id}`);
    ids.add(attrs.id);
  }
  for (const attribute of ['src', 'href']) {
    if (attrs[attribute]) references.push(attrs[attribute]);
  }
  if (element[1].toLowerCase() === 'img') {
    assert('alt' in attrs, `Image needs alt text: ${attrs.src}`);
  }
}

for (const reference of references) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) continue;
  const target = new URL(reference.replaceAll('&amp;', '&'), 'https://site.invalid/');
  const relativePath = decodeURIComponent(target.pathname).replace(/^\/+/, '') || 'index.html';
  const filename = path.resolve(root, relativePath);
  assert(filename.startsWith(root), `Local reference escapes the site: ${reference}`);
  const info = await stat(filename).catch(() => null);
  assert(info, `Missing local target: ${reference}`);
  if (info.isDirectory()) {
    assert(await stat(path.join(filename, 'index.html')).catch(() => null),
      `Directory target has no index.html: ${reference}`);
  }
  if (target.hash && relativePath === 'index.html') {
    const id = decodeURIComponent(target.hash.slice(1));
    assert(ids.has(id), `Missing anchor target: ${reference}`);
  }
}

const resourceNav = [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)]
  .find((match) => match[0].includes('https://github.com/satellite-acquisition/leopt'));
assert(resourceNav, 'Resource navigation must link to the LEOPT repository.');
assert(/bibtex/i.test(resourceNav[0]), 'Resource navigation must include BibTeX.');
assert(/arxiv/i.test(resourceNav[0]) && /forthcoming/i.test(resourceNav[0]),
  'The arXiv control should say it is forthcoming.');
assert(/aria-disabled\s*=\s*["']true["']/i.test(resourceNav[0]),
  'The forthcoming arXiv control should be marked disabled.');
assert(!references.some((reference) => /^https?:\/\/(?:www\.)?arxiv\.org\//i.test(reference)),
  'Do not publish an arXiv link before the paper is available.');

const video = elements.find((element) => {
  const attrs = attributes(element[2]);
  return element[1].toLowerCase() === 'iframe'
    && /^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/CapYyRrfLU8(?:[?/#]|$)/.test(attrs.src ?? '');
});
assert(video, 'The project video must embed YouTube video CapYyRrfLU8.');
assert(attributes(video[2]).title?.trim(), 'The video iframe needs an accessible title.');
assert(video.index > resourceNav.index + resourceNav[0].length,
  'The video should follow the paper, code, and BibTeX controls.');
const abstract = elements.find((element) => attributes(element[2]).id === 'abstract');
assert(abstract && video.index < abstract.index, 'The video should appear before the abstract.');

console.log(`Site checks passed: ${ids.size} unique ids, ${references.length} references, and project resources.`);
