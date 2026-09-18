'use strict';

const results = document.querySelector('#results');
const resultsTabs = document.querySelector('#results-tabs');

if (results && resultsTabs) {
  const tabs = [...resultsTabs.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.querySelector(`#${tab.getAttribute('aria-controls')}`));

  if (tabs.length && panels.every(Boolean)) {
    const hashSelection = () => window.location.hash === '#results' ? 0
      : panels.findIndex(panel => [
        `#${panel.id}`, `#${panel.id}-title`,
      ].includes(window.location.hash));

    function select(index, focus = false, updateHash = false) {
      tabs.forEach((tab, current) => {
        const active = current === index;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        panels[current].hidden = !active;
      });
      if (focus) tabs[index].focus();
      if (updateHash) window.history.replaceState(window.history.state, '', `#${panels[index].id}`);
    }

    tabs.forEach((tab, index) => {
      panels[index].setAttribute('role', 'tabpanel');
      panels[index].setAttribute('aria-labelledby', tab.id);
      panels[index].tabIndex = 0;
      tab.addEventListener('click', () => select(index, true, true));
      tab.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        let next;
        switch (event.key) {
          case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
          case 'ArrowRight': next = (index + 1) % tabs.length; break;
          case 'Home': next = 0; break;
          case 'End': next = tabs.length - 1; break;
          default: return;
        }
        event.preventDefault();
        select(next, true, true);
      });
    });

    select(Math.max(0, hashSelection()));
    results.classList.add('has-tabs');
    resultsTabs.hidden = false;
    window.addEventListener('hashchange', () => {
      const index = hashSelection();
      if (index >= 0) select(index);
    });
  }
}

const consoleLink = document.querySelector('#launch-console');

if (consoleLink) {
  consoleLink.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const consoleWindow = window.open('about:blank', '_blank', 'popup,width=1280,height=850,resizable=yes,scrollbars=yes');
    if (!consoleWindow) return;
    consoleWindow.opener = null;
    consoleWindow.location.replace(consoleLink.href);
    event.preventDefault();
  });
}

const copyButton = document.querySelector('#copy-citation');
const citation = document.querySelector('#bibtex');
const copyStatus = document.querySelector('#copy-status');

if (copyButton && citation && copyStatus) {
  copyButton.hidden = false;
  let resetStatus;

  copyButton.addEventListener('click', async () => {
    clearTimeout(resetStatus);
    try {
      await navigator.clipboard.writeText(citation.textContent.trim());
      copyStatus.textContent = 'BibTeX copied to clipboard.';
      copyButton.querySelector('span').textContent = 'Copied';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(citation);
      selection.removeAllRanges();
      selection.addRange(range);
      copyStatus.textContent = 'Citation selected. Press Ctrl+C or ⌘C to copy.';
    }
    resetStatus = setTimeout(() => {
      copyStatus.textContent = '';
      copyButton.querySelector('span').textContent = 'Copy BibTeX';
    }, 4000);
  });
}
