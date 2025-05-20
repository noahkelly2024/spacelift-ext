chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "areaSelected") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, async (dataUrl) => {
      const blob = await cropImage(dataUrl, msg.rect, msg.dpr);
      const bgRemovedBlob = await removeBackground(blob);
      await copyToClipboard(bgRemovedBlob);
      console.log("✅ Image copied to clipboard with background removed.");
    });
  }
});

async function cropImage(dataUrl, rect, dpr) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = new OffscreenCanvas(rect.width, rect.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        rect.x * dpr, rect.y * dpr,
        rect.width * dpr, rect.height * dpr,
        0, 0,
        rect.width, rect.height
      );
      canvas.convertToBlob().then(resolve);
    };
    img.src = dataUrl;
  });
}

async function removeBackground(blob) {
  const formData = new FormData();
  formData.append("image_file", blob);
  formData.append("size", "auto");

  const response = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: {
      "X-Api-Key": "yfKS4yrnnNzJM2imRjySZjDa"
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error("Background removal failed.");
  }

  return await response.blob();
}

async function copyToClipboard(blob) {
  const item = new ClipboardItem({ [blob.type]: blob });
  await navigator.clipboard.write([item]);
}