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

const emptyState =
    document.getElementById("empty-state");

const submitButton =
    form.querySelector(
        'button[type="submit"]'
    );


let operationInProgress = false;


function setMessage(text, type = "status") {
    message.textContent = text;
    message.classList.remove("error", "success");

    if (type === "error") {
        message.classList.add("error");
    } else if (type === "success") {
        message.classList.add("success");
    }
}


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

    if (sites.length === 0) {
        list.replaceChildren();
        list.hidden = true;

        if (emptyState) {
            emptyState.hidden = false;
        }

        return;
    }

    if (emptyState) {
        emptyState.hidden = true;
    }

    list.hidden = false;

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


    entries.forEach(
        (
            {
                site,
                hasPermission
            },
            index
        ) => {
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

                    setMessage("");
                    setBusy(true);

                    try {
                        await removeSite(site, index);
                    } catch (error) {
                        console.error(error);

                        setMessage(
                            "The site could not be removed.",
                            "error"
                        );
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
    );


    list.replaceChildren(fragment);
}


async function addSite(
    site,
    hadPermission,
    granted
) {
    if (!granted) {
        setMessage(
            "Site permission was not granted.",
            "error"
        );

        return;
    }


    const sites =
        await getSites();


    if (sites.includes(site)) {
        if (hadPermission) {
            setMessage(
                "This site is already enabled.",
                "status"
            );

            return;
        }


        await requestSync();

        input.removeAttribute("aria-invalid");

        setMessage(
            `${site} re-enabled.`,
            "success"
        );

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
    input.removeAttribute("aria-invalid");

    setMessage(
        `${site} added.`,
        "success"
    );

    await renderSites();
}


async function removeSite(site, index) {
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


    setMessage(
        `${site} removed.`,
        "success"
    );

    await renderSites();

    const remainingButtons =
        list.querySelectorAll("button");

    if (remainingButtons.length > 0) {
        const targetButton =
            remainingButtons[index] ||
            remainingButtons[remainingButtons.length - 1];

        targetButton?.focus();
    } else {
        input.focus();
    }
}


input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") {
        input.removeAttribute("aria-invalid");

        if (message.classList.contains("error")) {
            setMessage("");
        }
    }
});


form.addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();


        if (operationInProgress) {
            return;
        }


        setMessage("");

        const site =
            normalizeSite(input.value);


        if (!site) {
            input.setAttribute(
                "aria-invalid",
                "true"
            );

            setMessage(
                "Enter a valid domain, such as example.com.",
                "error"
            );

            input.focus();

            return;
        }

        input.removeAttribute("aria-invalid");


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

            setMessage(
                "The site could not be added.",
                "error"
            );
        } finally {
            setBusy(false);
        }
    }
);


renderSites().catch((error) => {
    console.error(error);

    setMessage(
        "The site list could not be loaded.",
        "error"
    );
});