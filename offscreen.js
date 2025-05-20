// offscreen.js

console.log("[Offscreen] Script loaded.");

// --- Message Listener (from background script) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Offscreen] Received message:", request.action, "(dataUrl length approx:", request.dataUrl?.length, ")");

  if (request.target !== 'offscreen') {
    console.warn("[Offscreen] Message not targeted for offscreen. Ignoring.");
    return false; // Not for us, no async response from this path
  }

  if (request.action === 'cropAndCopy') {
    const { dataUrl, coords } = request;
    console.log("[Offscreen] Action: cropAndCopy. Coords:", coords);

    (async () => {
      try {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
          throw new Error('Invalid or missing dataUrl.');
        }
        if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number' ||
            typeof coords.width !== 'number' || typeof coords.height !== 'number') {
          throw new Error('Invalid or missing coordinates.');
        }
        if (coords.width <= 0 || coords.height <= 0) {
          throw new Error(`Crop dimensions are invalid (width: ${coords.width}, height: ${coords.height}). Must be positive.`);
        }

        console.log("[Offscreen] Attempting to crop image...");
        const blob = await cropImage(dataUrl, coords);
        console.log("[Offscreen] Image cropped. Blob type:", blob.type, "Blob size:", blob.size);

        if (!(blob instanceof Blob)) {
          throw new Error('Cropped result is not a Blob.');
        }
        if (blob.size === 0) {
          console.warn("[Offscreen] Cropped blob size is 0. The resulting image might be empty. This could also happen if crop coordinates were outside the source image.");
        }

        console.log("[Offscreen] Attempting to write to clipboard...");

        // --- BEGIN FOCUS HACK ---
        if (typeof window.focus === 'function') {
            console.log("[Offscreen] Attempting to focus offscreen window.");
            window.focus();
        } else {
            console.warn("[Offscreen] window.focus is not available in this context.");
        }
        // Wait for a microtask tick for focus to potentially apply
        await new Promise(resolve => queueMicrotask(resolve));
        // --- END FOCUS HACK ---

        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type || 'image/png']: blob })
        ]);
        console.log("[Offscreen] Successfully wrote to clipboard.");
        sendResponse({ success: true });

      } catch (error) {
        console.error(`[Offscreen] Error in cropAndCopy flow (name: ${error.name}):`, error.message, error);
        if (error.name === 'NotAllowedError') {
           console.error("[Offscreen] Clipboard write failed with NotAllowedError. This indicates the document (offscreen) was not focused or did not have active permission. Ensure the 'CLIPBOARD' reason is used for the offscreen document and test focus strategies. The current strategy of creating a fresh offscreen doc and calling window.focus() was attempted.");
        }
        sendResponse({ success: false, error: `Offscreen: ${error.name || 'Error'} - ${error.message || 'Unknown error'}` });
      }
    })();

    return true; // ESSENTIAL: Indicates sendResponse will be called asynchronously.
  }

  console.warn("[Offscreen] Received unhandled action:", request.action);
  sendResponse({ success: false, error: `Offscreen: Unknown action '${request.action}'` });
  return false;
});


// --- Image Cropping Function ---
function cropImage(dataUrl, coords) {
  console.log("[Offscreen cropImage] Starting. Coords:", coords);
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      console.log('[Offscreen cropImage] Image loaded. Source img dimensions:', img.width, 'x', img.height);

      const canvas = document.createElement('canvas');
      const roundedWidth = Math.max(1, Math.round(coords.width));   // Ensure at least 1px
      const roundedHeight = Math.max(1, Math.round(coords.height)); // Ensure at least 1px

      canvas.width = roundedWidth;
      canvas.height = roundedHeight;
      console.log('[Offscreen cropImage] Canvas created. Dimensions:', canvas.width, 'x', canvas.height);

      const ctx = canvas.getContext('2d');
      const sx = Math.round(coords.x);
      const sy = Math.round(coords.y);
      // Use the same rounded dimensions for source width/height as canvas width/height
      // This assumes the intent is to scale the selected region to fit the canvas exactly.
      // If the source region is smaller than the canvas, it will be stretched.
      // If larger, it will be shrunk.
      const sWidth = Math.max(1, Math.round(coords.width));
      const sHeight = Math.max(1, Math.round(coords.height));

      // Sanity check: Ensure source rectangle is somewhat within image bounds
      // This is a soft check; drawImage has its own internal clipping/erroring
      if (sx < 0 || sy < 0 || sx + sWidth > img.width + 5 || sy + sHeight > img.height + 5) { // Added 5px tolerance
        console.warn(
            `[Offscreen cropImage] DrawImage source rectangle (x:${sx}, y:${sy}, w:${sWidth}, h:${sHeight}) may be outside or partially outside source image (w:${img.width}, h:${img.height}). This can lead to empty or partial crops.`
        );
      }
      if (sWidth <= 0 || sHeight <= 0) {
        return reject(new Error(`Source dimensions for drawImage are invalid (w:${sWidth}, h:${sHeight}). Cannot be zero or negative.`));
      }

      console.log('[Offscreen cropImage] Drawing image to canvas. Source rect:',
                  `sx=${sx}, sy=${sy}, sWidth=${sWidth}, sHeight=${sHeight}. Dest rect: 0,0,${canvas.width},${canvas.height}`);
      try {
        ctx.drawImage(img,
          sx, sy, sWidth, sHeight,
          0, 0, canvas.width, canvas.height
        );
        console.log('[Offscreen cropImage] Image drawn to canvas.');
      } catch (e) {
        console.error('[Offscreen cropImage] Error during ctx.drawImage:', e.name, e.message, e);
        return reject(new Error(`drawImage failed: ${e.name} - ${e.message}. Check source coords (x:${sx},y:${sy},w:${sWidth},h:${sHeight}) vs image (${img.width}x${img.height}).`));
      }

      canvas.toBlob((blob) => {
        if (blob && blob.size > 0) {
          console.log('[Offscreen cropImage] Canvas converted to Blob. Size:', blob.size, 'Type:', blob.type);
          resolve(blob);
        } else if (blob && blob.size === 0) {
          console.warn('[Offscreen cropImage] canvas.toBlob produced an empty blob (size 0). This might be due to fully transparent image or invalid drawImage parameters.');
          // Resolve with empty blob, let clipboard decide if it can handle it or if it's an error upstream
          resolve(blob);
        }
        else {
          console.error('[Offscreen cropImage] canvas.toBlob failed, returned null blob. Canvas might be empty, too large, or tainted.');
          reject(new Error('Canvas toBlob failed to produce a blob.'));
        }
      }, 'image/png');
    };

    img.onerror = (errorEvent) => {
      console.error("[Offscreen cropImage] Image load error. Event:", errorEvent, "Image src (first 100 chars):", (img.src || '').substring(0,100) + "...");
      reject(new Error('Image loading failed in offscreen document. The dataUrl might be malformed or too long.'));
    };

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        const errMsg = `[Offscreen cropImage] Invalid dataUrl format. Must start with 'data:image/'. Received (first 30 chars): ${(dataUrl || '').substring(0,30)}`;
        console.error(errMsg);
        reject(new Error(errMsg));
        return;
    }
    img.src = dataUrl;
    console.log('[Offscreen cropImage] Image src set (first 100 chars of dataUrl). Waiting for onload/onerror...');
  });
}