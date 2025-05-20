(() => {
  if (window.isAreaSelectorActive) {
    console.log("Area selector is already active.");
    return;
  }
  window.isAreaSelectorActive = true;

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.background = 'rgba(0, 0, 0, 0.3)';
  overlay.style.zIndex = '999999998'; // Very high z-index
  overlay.style.cursor = 'crosshair';
  document.body.appendChild(overlay);

  const selectionBox = document.createElement('div');
  selectionBox.style.position = 'absolute';
  selectionBox.style.border = '2px dashed #fff';
  selectionBox.style.background = 'rgba(255, 255, 255, 0.1)';
  selectionBox.style.zIndex = '999999999'; // Above overlay
  selectionBox.style.pointerEvents = 'none'; // Don't capture mouse events itself
  document.body.appendChild(selectionBox);

  let startX, startY, isDragging = false;

  function cleanup() {
    overlay.remove();
    selectionBox.remove();
    window.isAreaSelectorActive = false;
    document.removeEventListener('keydown', handleEscKey);
  }

  function handleEscKey(event) {
    if (event.key === 'Escape') {
      cleanup();
    }
  }

  document.addEventListener('keydown', handleEscKey);

  overlay.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragging = true;
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block'; // Show it
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    const endX = e.clientX;
    const endY = e.clientY;

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    overlay.style.display = 'none';
    selectionBox.style.display = 'none';

    if (width > 0 && height > 0) {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: "captureArea",
          coords: {
            x: x * window.devicePixelRatio,
            y: y * window.devicePixelRatio,
            width: width * window.devicePixelRatio,
            height: height * window.devicePixelRatio,
            devicePixelRatio: window.devicePixelRatio
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("ContentScript: Error sending message to background:", chrome.runtime.lastError.message);
          } else if (response && !response.success) {
            console.error("ContentScript: Screenshot failed:", response.error);
            // Optionally, show a more user-friendly error on the page itself
          } else if (response && response.success) {
            console.log("ContentScript: Screenshot successful message received.");
          }
          cleanup();
        });
      }, 50);
    } else {
      cleanup();
    }
  });
})();