import {
    getSiteOrigins,
    sanitizeSites
} from "./site-utils.js";


const AUTOMATIC_SCRIPT_ID =
    "automatic-sites";

const actions = new Map();

let syncQueue = Promise.resolve();


function reportError(context, error) {
    console.error(
        `[Enable Copy and Right Click] ${context}:`,
        error
    );
}


function queueAction(tabId) {
    const previous =
        actions.get(tabId) || Promise.resolve();

    const current = previous
        .catch((error) => {
            reportError(
                "Previous tab action failed",
                error
            );
        })
        .then(() => {
            return enableCopyAndRightClick(tabId);
        })
        .catch((error) => {
            reportError(
                `Could not enable tab ${tabId}`,
                error
            );
        })
        .finally(() => {
            if (actions.get(tabId) === current) {
                actions.delete(tabId);
            }
        });

    actions.set(tabId, current);
}


async function enableCopyAndRightClick(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: {
                tabId,
                allFrames: true
            },
            files: [
                "src/enable.js"
            ]
        });
    } catch (error) {
        reportError(
            `Could not enable all frames in tab ${tabId}`,
            error
        );

        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            files: [
                "src/enable.js"
            ]
        });
    }

    await chrome.action.setBadgeText({
        tabId,
        text: "ON"
    });

    await chrome.action.setTitle({
        tabId,
        title: "Enable Copy and Right Click: Active"
    });
}


function queueAutomaticSitesSync() {
    syncQueue = syncQueue
        .catch((error) => {
            reportError(
                "Previous automatic-site sync failed",
                error
            );
        })
        .then(syncAutomaticSites);

    return syncQueue;
}


async function getPermittedMatches(sites) {
    const permissionResults =
        await Promise.all(
            sites.map(async (site) => {
                const origins =
                    getSiteOrigins(site);

                const permitted =
                    await chrome.permissions.contains({
                        origins
                    });

                return permitted
                    ? origins
                    : [];
            })
        );

    return [
        ...new Set(
            permissionResults.flat()
        )
    ];
}


async function syncAutomaticSites() {
    const result =
        await chrome.storage.local.get(
            "automaticSites"
        );

    const sites =
        sanitizeSites(result.automaticSites);

    const matches =
        await getPermittedMatches(sites);

    const existing =
        await chrome.scripting
            .getRegisteredContentScripts({
                ids: [
                    AUTOMATIC_SCRIPT_ID
                ]
            });

    const isRegistered =
        existing.length > 0;


    if (matches.length === 0) {
        if (isRegistered) {
            await chrome.scripting
                .unregisterContentScripts({
                    ids: [
                        AUTOMATIC_SCRIPT_ID
                    ]
                });
        }

        return;
    }


    const script = {
        id: AUTOMATIC_SCRIPT_ID,
        matches,
        js: [
            "src/enable.js"
        ],
        allFrames: true,
        runAt: "document_start"
    };


    if (isRegistered) {
        await chrome.scripting
            .updateContentScripts([
                script
            ]);

        return;
    }


    await chrome.scripting
        .registerContentScripts([
            script
        ]);
}


function requestSync() {
    queueAutomaticSitesSync()
        .catch((error) => {
            reportError(
                "Automatic-site sync failed",
                error
            );
        });
}


chrome.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) {
        queueAction(tab.id);
    }
});


chrome.commands.onCommand.addListener(
    async (command) => {
        if (
            command !==
            "enable-copy-right-click"
        ) {
            return;
        }

        try {
            const [tab] =
                await chrome.tabs.query({
                    active: true,
                    currentWindow: true
                });

            if (tab?.id !== undefined) {
                queueAction(tab.id);
            }
        } catch (error) {
            reportError(
                "Keyboard command failed",
                error
            );
        }
    }
);


chrome.tabs.onUpdated.addListener(
    (tabId, changeInfo) => {
        if (changeInfo.status !== "loading") {
            return;
        }

        chrome.action.setBadgeText({
            tabId,
            text: ""
        }).catch((error) => {
            reportError(
                "Could not clear badge",
                error
            );
        });

        chrome.action.setTitle({
            tabId,
            title: "Enable Copy and Right Click"
        }).catch((error) => {
            reportError(
                "Could not reset title",
                error
            );
        });
    }
);


chrome.runtime.onInstalled.addListener(
    requestSync
);


chrome.runtime.onStartup.addListener(
    requestSync
);


chrome.storage.onChanged.addListener(
    (changes, areaName) => {
        if (
            areaName === "local" &&
            changes.automaticSites
        ) {
            requestSync();
        }
    }
);


chrome.permissions.onAdded.addListener(
    requestSync
);


chrome.permissions.onRemoved.addListener(
    requestSync
);


chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
        if (
            message?.type !==
            "sync-automatic-sites"
        ) {
            return false;
        }

        queueAutomaticSitesSync()
            .then(() => {
                sendResponse({
                    ok: true
                });
            })
            .catch((error) => {
                reportError(
                    "Requested sync failed",
                    error
                );

                sendResponse({
                    ok: false
                });
            });

        return true;
    }
);
