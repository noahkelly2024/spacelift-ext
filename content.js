(() => {
  if (window.__smartScreenshotActive__) return;
  window.__smartScreenshotActive__ = true;

  let selectionBox = null;
  let startX = 0, startY = 0;
  let isSelecting = false;

  function onMouseDown(e) {
    if (isSelecting) return;

    isSelecting = true;
    startX = e.pageX;
    startY = e.pageY;

    selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.style.left = `${startX}px`;
    selectionBox.style.top = `${startY}px`;
    document.body.appendChild(selectionBox);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!isSelecting || !selectionBox) return;

    const currentX = e.pageX;
    const currentY = e.pageY;

    selectionBox.style.width = `${Math.abs(currentX - startX)}px`;
    selectionBox.style.height = `${Math.abs(currentY - startY)}px`;
    selectionBox.style.left = `${Math.min(currentX, startX)}px`;
    selectionBox.style.top = `${Math.min(currentY, startY)}px`;
  }

  function onMouseUp(e) {
    if (!isSelecting || !selectionBox) return;

    const rect = selectionBox.getBoundingClientRect();
    selectionBox.remove();
    selectionBox = null;
    isSelecting = false;

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    chrome.runtime.sendMessage({
      type: "areaSelected",
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      },
      dpr: window.devicePixelRatio
    });

    window.__smartScreenshotActive__ = false;
  }

  document.querySelectorAll('.selection-box').forEach(box => box.remove());
  document.addEventListener('mousedown', onMouseDown, { once: true });
})();
