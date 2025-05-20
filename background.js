// background.js

// --- Offscreen Document Management ---
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null; // To prevent concurrent creation attempts

async function hasOffscreenDocument() {
    // Correct way to check for existing offscreen documents
    if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
        });
        return contexts && contexts.length > 0;
    }
    // Fallback if getContexts is somehow not available (shouldn't happen in MV3)
    console.warn("Background: chrome.runtime.getContexts API not available. Offscreen document check might be unreliable.");
    return false; // Or attempt another method if absolutely necessary, but getContexts is standard.
}

async function closeOffscreenDocument() {
    if (!chrome.offscreen) {
        console.warn("Background: chrome.offscreen API not available for closing.");
        return;
    }
    // No need to check with getContexts before calling closeDocument,
    // as closeDocument itself handles the case where no document exists.
    // It will reject its promise if no document is open or if another error occurs.
    try {
        // Check if a document MIGHT be open using our hasOffscreenDocument logic before attempting to close
        // This is slightly more robust to avoid an error if it's already closed by other means.
        if (await hasOffscreenDocument()) {
            console.log("Background: Attempting to close existing offscreen document.");
            await chrome.offscreen.closeDocument();
            console.log("Background: closeDocument call completed.");
        } else {
            console.log("Background: No active offscreen document found to close.");
        }
    } catch (e) {
        // This catch is important because closeDocument() can reject if no document exists.
        // We don't want this to be an unhandled rejection if we're just trying to be thorough.
        console.warn("Background: Error or warning during closeDocument (e.g., no document to close, or it was closing):", e.message);
    }
}


async function setupOffscreenDocumentForClipboard() {
    if (!chrome.offscreen) {
        throw new Error("Background: chrome.offscreen API is not available. Cannot proceed.");
    }

    // Attempt to close any existing document to ensure freshness
    // This is an aggressive strategy.
    console.log("Background: Ensuring any previous offscreen document is closed before creating a new one.");
    await closeOffscreenDocument(); // closeOffscreenDocument now handles cases where no doc exists

    // After attempting to close, let's verify if it's truly gone or if another is being created.
    // This helps manage concurrent calls.
    if (creatingOffscreenPromise) {
        console.log("Background: Offscreen document creation already in progress by another call. Awaiting its completion.");
        await creatingOffscreenPromise;
        // If we awaited, the document should now exist (or creation failed).
        // Check one last time if it actually exists now, as the other call might have failed.
        if (await hasOffscreenDocument()) {
            console.log("Background: Offscreen document created by concurrent call is now ready.");
            return;
        } else {
            console.warn("Background: Concurrent offscreen creation seems to have failed. Will attempt to create now.");
            // Fall through to create it in this call if the concurrent one failed.
        }
    }

    // Double-check if a document exists *now* before trying to create one.
    // This handles the case where a concurrent setupOffscreenDocument completed successfully
    // while this instance was waiting for closeOffscreenDocument.
    if (await hasOffscreenDocument()) {
        console.log("Background: Offscreen document already exists (possibly created by a concurrent call). No need to create again.");
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
        // No need to set creatingOffscreenPromise to null here, finally block handles it.
        throw error;
    } finally {
        // Important: Reset promise whether it succeeded or failed,
        // so subsequent calls can attempt creation again or know it's done.
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
    const source = sender.tab ? `tab ${sender.tab.id}` : (sender.documentId ? `offscreen (documentId: ${sender.documentId})` : "extension context");
    console.log(`Background: Received message: '${request.action}' from ${source}`);


    if (request.action === "captureArea") {
        if (!sender.tab) {
            console.error("Background: 'captureArea' message received without sender.tab. This is unexpected.");
            sendResponse({ success: false, error: "Background: Internal error - missing tab context." });
            return false;
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

                if (chrome.runtime.lastError) { // This checks for errors in sending the message itself or if port closed.
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
                } else { // This handles errors reported *by* the offscreen document's logic.
                    const errorMsg = offscreenResponse?.error || 'Unknown error from screenshot processing service.';
                    console.error("Background: Offscreen document reported failure:", errorMsg);
                    chrome.notifications.create({
                        type: 'basic', iconUrl: 'icons/icon48.png',
                        title: 'Screenshot Failed', message: errorMsg
                    });
                    sendResponse({ success: false, error: errorMsg });
                }

            } catch (error) { // This catches errors from setupOffscreen, captureVisibleTab, or unhandled promise rejections.
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

    console.warn(`Background: Received unhandled message action: '${request.action}'`);
    // If you don't intend to send a response for other actions, return false or nothing.
    return false;
});

console.log("Background script loaded and listeners attached. Version with runtime.getContexts fix.");