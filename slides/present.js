(() => {
  let snapshot;
  const canvas = document.getElementById('canvas'), host = document.getElementById('output');
  const fit = () => SlideCore.fitCanvas(canvas, host);
  window.SlideShow = {
    apply(value) {
      const deck = SlideCore.validate(value.deck);
      snapshot = { deck, index: Math.floor(SlideCore.number(value.index, 0, 0, deck.slides.length - 1)) };
      SlideCore.renderSlide(deck.slides[snapshot.index], canvas); fit();
    },
    blackout() { document.body.classList.toggle('blackout'); }
  };
  new ResizeObserver(fit).observe(host);
  document.addEventListener('dblclick', () => {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    action?.catch(() => {});
  });
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'b') { window.SlideShow.blackout(); return; }
    const direction = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0;
    if (!direction || !snapshot) return;
    event.preventDefault();
    // Navigate the published snapshot: editing the draft never leaks to output.
    snapshot.index = Math.max(0, Math.min(snapshot.deck.slides.length - 1, snapshot.index + direction));
    SlideCore.renderSlide(snapshot.deck.slides[snapshot.index], canvas); fit();
  });
})();
