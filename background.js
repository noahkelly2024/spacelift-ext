// background.js

// --- Offscreen Document Management ---
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null; // To prevent concurrent creation attempts

async function hasOffscreenDocument() {
    if (!chrome.offscreen) { // Guard for environments where offscreen might not be available
        console.warn("Background: chrome.offscreen API not available.");
        return false;
    }
    const contexts = await chrome.offscreen.getContexts({ // Replaced deprecated getContexts
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts && contexts.length > 0;
}


async function closeOffscreenDocument() {
    if (!chrome.offscreen) return; // Guard
    if (await hasOffscreenDocument()) {
        console.log("Background: Closing existing offscreen document.");
        try {
            await chrome.offscreen.closeDocument();
        } catch (e) {
            console.warn("Background: Error during closeDocument (it might have auto-closed or already been closing):", e.message);
        }
    } else {
        console.log("Background: No active offscreen document to close.");
    }
}

async function setupOffscreenDocumentForClipboard() {
    if (!chrome.offscreen) {
        throw new Error("Background: chrome.offscreen API is not available. Cannot proceed.");
    }

    // Attempt to close any existing document to ensure freshness
    await closeOffscreenDocument();

    // Check if creation is already in progress (e.g., rapid clicks)
    if (creatingOffscreenPromise) {
        console.log("Background: Offscreen document creation already in progress by another call. Awaiting its completion.");
        await creatingOffscreenPromise;
        // After awaiting, the document should exist, so we can return.
        // We assume the other call will set it up correctly.
        // Or, if we want each call to ensure ITS document, this logic might need adjustment,
        // but for now, let's avoid race conditions on createDocument.
        return;
    }

    console.log("Background: Creating a new offscreen document for clipboard operation.");
    creatingOffscreenPromise = chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: 'Process image and copy to clipboard (fresh instance).',
    });

    try {
        await creatingOffscreenPromise;
        console.log("Background: New offscreen document created successfully.");
    } catch (error) {
        console.error("Background: Error creating new offscreen document:", error);
        creatingOffscreenPromise = null; // Reset promise on failure
        throw error; // Re-throw to be caught by the caller
    } finally {
        // Important: Reset promise whether it succeeded or failed,
        // so subsequent calls can attempt creation again.
        creatingOffscreenPromise = null;
    }
}


// --- Extension Icon Click Listener ---
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) {
        console.error("Background: Tab ID is missing on action click.");
        return;
    }
    if (!(tab.url?.startsWith("http://") || tab.url?.startsWith("https://"))) {
        console.warn("Background: Cannot inject script into non-http(s) pages. Tab URL:", tab.url);
        chrome.notifications.create({
            type: 'basic', iconUrl: 'icons/icon48.png',
            title: 'Action Failed',
            message: 'Screenshots can only be taken on http or https pages.'
        });
        return;
    }

    try {
        console.log("Background: Injecting content script into tab:", tab.id);
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content_script.js']
        });
        console.log("Background: Content script injected successfully.");
    } catch (err) {
        console.error("Background: Failed to inject content script:", err);
    }
});

// --- Message Listener (from content script or offscreen) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background: Received message:", request.action, "from", sender.tab ? `tab ${sender.tab.id}` : "extension context (e.g. offscreen)");

    if (request.action === "captureArea") {
        if (!sender.tab) {
            console.error("Background: 'captureArea' message received without sender.tab. This is unexpected.");
            sendResponse({ success: false, error: "Background: Internal error - missing tab context." });
            return false; // No async from this path
        }

        (async () => {
            try {
                await setupOffscreenDocumentForClipboard();

                console.log("Background: Capturing visible tab for windowId:", sender.tab.windowId);
                const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });

                if (chrome.runtime.lastError || !dataUrl) {
                    throw new Error(`Failed to capture tab: ${chrome.runtime.lastError?.message || 'No dataUrl received'}`);
                }
                console.log("Background: Tab captured. DataURL length (approx):", dataUrl.length);

                console.log("Background: Sending data to offscreen document for cropping.");
                const offscreenResponse = await chrome.runtime.sendMessage({
                    target: 'offscreen',
                    action: 'cropAndCopy',
                    dataUrl: dataUrl,
                    coords: request.coords
                });

                if (chrome.runtime.lastError) {
                    throw new Error(`Error messaging offscreen: ${chrome.runtime.lastError.message}`);
                }

                if (offscreenResponse && offscreenResponse.success) {
                    console.log("Background: Offscreen document reported success.");
                    chrome.notifications.create({
                        type: 'basic', iconUrl: 'icons/icon48.png',
                        title: 'Screenshot Copied!',
                        message: 'The selected area has been copied to your clipboard.'
                    });
                    sendResponse({ success: true });
                } else {
                    const errorMsg = offscreenResponse?.error || 'Unknown error from screenshot processing service.';
                    console.error("Background: Offscreen document reported failure:", errorMsg);
                    chrome.notifications.create({
                        type: 'basic', iconUrl: 'icons/icon48.png',
                        title: 'Screenshot Failed', message: errorMsg
                    });
                    sendResponse({ success: false, error: errorMsg });
                }

            } catch (error) {
                console.error("Background: Error during captureArea flow:", error.message, error);
                chrome.notifications.create({
                    type: 'basic', iconUrl: 'icons/icon48.png',
                    title: 'Screenshot Error',
                    message: error.message || "An unexpected error occurred."
                });
                sendResponse({ success: false, error: `Background: ${error.message || "An unexpected error occurred."}` });
            }
        })();

        return true; // ESSENTIAL: Indicates sendResponse will be called asynchronously.
    }

    console.warn("Background: Received unhandled message action:", request.action);
    return false; // For unhandled actions, assuming no async response.
});

console.log("Background script loaded and listeners attached.");