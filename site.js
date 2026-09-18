'use strict';

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
