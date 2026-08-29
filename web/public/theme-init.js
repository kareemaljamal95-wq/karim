// Applies the stored theme before first paint so a dark-mode user never sees a
// white flash. It lives in its own file rather than inline in index.html
// because the production Content-Security-Policy allows scripts from 'self'
// only — an inline block is refused and the flash comes back.
(function () {
  try {
    var stored = localStorage.getItem('ai-ceo-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    /* storage unavailable — fall back to the light theme */
  }
})();
