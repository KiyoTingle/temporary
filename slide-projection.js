/* Small integration layer. The editor and its dependencies load only in a separate window. */
(function () {
  'use strict';
  let snapshot = null, editorWindow = null;
  function render(win) {
    const host = win?.document.getElementById('slides-view');
    if (!host || !snapshot) return;
    const canvas = host.querySelector('.slide-canvas') || win.document.createElement('div');
    if (!canvas.parentNode) host.append(canvas);
    SlideCore.renderSlide(snapshot.deck.slides[snapshot.index], canvas);
    const fit = () => SlideCore.fitCanvas(canvas, host);
    fit();
    if (!host.__slideObserver && window.ResizeObserver) {
      host.__slideObserver = new ResizeObserver(fit); host.__slideObserver.observe(host);
    }
  }
  function openEditor() {
    editorWindow = window.open(new URL('./slides/index.html', window.location.href).href, 'assembly-slide-editor', 'width=1500,height=950,resizable=yes,scrollbars=yes');
    if (editorWindow) editorWindow.focus();
    else showToast('スライド編集画面を開けません。ポップアップを許可してください。', 'error');
  }
  function show() {
    if (!snapshot) { showToast('スライド編集画面で「投影へ反映」を押してください'); openEditor(); return; }
    checkwindow('slides');
    getProjectionWindows().forEach(render); refreshProjectionConsole();
  }
  function receive(value) {
    const deck = SlideCore.validate(value.deck);
    snapshot = { deck, index: Math.floor(SlideCore.number(value.index, 0, 0, deck.slides.length - 1)) };
    show();
  }
  function navigate(delta) {
    if (!snapshot || currentMode !== 'slides') return;
    snapshot.index = Math.max(0, Math.min(snapshot.deck.slides.length - 1, snapshot.index + delta));
    getProjectionWindows().forEach(render); refreshProjectionConsole();
  }
  function getContext() {
    const row = projectedBible && findBibleRow(projectedBible.book, projectedBible.chapter, projectedBible.verse);
    return { info: readInfoInputs(), bible: row ? { reference: row[3], japanese: row[4], chinese: row[2] } : null };
  }
  window.SlideProjection = { openEditor, show, receive, render, navigate, getContext, blackout: () => toggleBlackout() };
})();
