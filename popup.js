document.getElementById("start").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["selection-style.css"]
    });

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  });
});
