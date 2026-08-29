import {
    getSiteOrigins,
    normalizeSite,
    sanitizeSites
} from "../src/site-utils.js";


const form =
    document.getElementById("site-form");

const input =
    document.getElementById("site-input");

const list =
    document.getElementById("site-list");

const message =
    document.getElementById("message");

const submitButton =
    form.querySelector(
        'button[type="submit"]'
    );


let operationInProgress = false;


function setBusy(isBusy) {
    operationInProgress = isBusy;

    form.setAttribute(
        "aria-busy",
        String(isBusy)
    );

    list.setAttribute(
        "aria-busy",
        String(isBusy)
    );

    input.disabled = isBusy;
    submitButton.disabled = isBusy;

    for (
        const button of
        list.querySelectorAll("button")
    ) {
        button.disabled = isBusy;
    }
}


async function getSites() {
    const result =
        await chrome.storage.local.get(
            "automaticSites"
        );

    return sanitizeSites(
        result.automaticSites
    );
}


function originMatchesSite(origin, site) {
    const match =
        origin.toLowerCase().match(
            /^[a-z*]+:\/\/(?:\*\.)?([^/]+)/
        );

    if (!match) {
        return false;
    }

    const hostname =
        match[1].replace(/\.$/, "");

    return (
        hostname === site ||
        hostname.endsWith(`.${site}`)
    );
}


async function getCurrentSiteOrigins(site) {
    const permissions =
        await chrome.permissions.getAll();

    return (permissions.origins || [])
        .filter((origin) => {
            return originMatchesSite(
                origin,
                site
            );
        });
}


async function hasSitePermission(site) {
    const origins =
        await getCurrentSiteOrigins(site);

    return origins.length > 0;
}


async function removeSitePermissions(site) {
    const origins =
        await getCurrentSiteOrigins(site);

    if (origins.length === 0) {
        return;
    }

    const removed =
        await chrome.permissions.remove({
            origins
        });

    if (
        !removed ||
        await hasSitePermission(site)
    ) {
        throw new Error(
            "Site permission could not be removed."
        );
    }
}


async function requestSync() {
    const response =
        await chrome.runtime.sendMessage({
            type: "sync-automatic-sites"
        });

    if (!response?.ok) {
        throw new Error(
            "Automatic-site synchronization failed."
        );
    }
}


async function renderSites() {
    const sites =
        await getSites();

    const entries =
        await Promise.all(
            sites.map(async (site) => ({
                site,
                hasPermission:
                    await hasSitePermission(site)
            }))
        );


    const fragment =
        document.createDocumentFragment();


    for (
        const {
            site,
            hasPermission
        } of entries
    ) {
        const item =
            document.createElement("li");

        const label =
            document.createElement("span");

        const removeButton =
            document.createElement("button");


        label.textContent = hasPermission
            ? site
            : `${site} (permission removed)`;


        removeButton.type = "button";
        removeButton.textContent = "Remove";

        removeButton.setAttribute(
            "aria-label",
            `Remove ${site}`
        );


        removeButton.addEventListener(
            "click",
            async () => {
                if (operationInProgress) {
                    return;
                }

                message.textContent = "";
                setBusy(true);

                try {
                    await removeSite(site);
                } catch (error) {
                    console.error(error);

                    message.textContent =
                        "The site could not be removed.";
                } finally {
                    setBusy(false);
                }
            }
        );


        item.append(
            label,
            removeButton
        );

        fragment.appendChild(item);
    }


    list.replaceChildren(fragment);
}


async function addSite(
    site,
    hadPermission,
    granted
) {
    if (!granted) {
        message.textContent =
            "Site permission was not granted.";

        return;
    }


    const sites =
        await getSites();


    if (sites.includes(site)) {
        if (hadPermission) {
            message.textContent =
                "This site is already enabled.";

            return;
        }


        await requestSync();

        message.textContent =
            `${site} re-enabled.`;

        await renderSites();

        return;
    }


    const origins =
        getSiteOrigins(site);

    const updatedSites =
        [...sites, site].sort();


    try {
        await chrome.storage.local.set({
            automaticSites: updatedSites
        });
    } catch (error) {
        await chrome.permissions.remove({
            origins
        }).catch((rollbackError) => {
            console.error(
                "Permission rollback failed:",
                rollbackError
            );
        });

        throw error;
    }


    await requestSync();

    input.value = "";

    message.textContent =
        `${site} added.`;

    await renderSites();
}


async function removeSite(site) {
    const sites =
        await getSites();

    const updatedSites =
        sites.filter(
            (item) => item !== site
        );


    await chrome.storage.local.set({
        automaticSites: updatedSites
    });

    await requestSync();


    try {
        await removeSitePermissions(site);
    } catch (error) {
        await chrome.storage.local.set({
            automaticSites: sites
        });

        await requestSync().catch((syncError) => {
            console.error(
                "Permission rollback sync failed:",
                syncError
            );
        });

        throw error;
    }


    message.textContent =
        `${site} removed.`;

    await renderSites();
}


form.addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();


        if (operationInProgress) {
            return;
        }


        message.textContent = "";

        const site =
            normalizeSite(input.value);


        if (!site) {
            message.textContent =
                "Enter a valid domain, such as example.com.";

            input.focus();

            return;
        }


        const origins =
            getSiteOrigins(site);


        /*
         * These calls must start directly inside the
         * user-input handler, before the first await.
         *
         * Firefox requires permissions.request() to be
         * initiated while the user gesture is still active.
         */
        const permissionCheck =
            chrome.permissions.contains({
                origins
            });

        const permissionRequest =
            chrome.permissions.request({
                origins
            });


        setBusy(true);


        try {
            const [
                hadPermission,
                granted
            ] = await Promise.all([
                permissionCheck,
                permissionRequest
            ]);


            await addSite(
                site,
                hadPermission,
                granted
            );
        } catch (error) {
            console.error(error);

            message.textContent =
                "The site could not be added.";
        } finally {
            setBusy(false);
        }
    }
);


renderSites().catch((error) => {
    console.error(error);

    message.textContent =
        "The site list could not be loaded.";
});