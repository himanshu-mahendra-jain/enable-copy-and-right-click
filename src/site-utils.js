export function normalizeSite(value) {
    const trimmed = value.trim();

    if (!trimmed) {
        return null;
    }

    try {
        const url = new URL(
            /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
                ? trimmed
                : `https://${trimmed}`
        );

        let hostname = url.hostname
            .toLowerCase()
            .replace(/\.$/, "");

        if (hostname.startsWith("www.")) {
            hostname = hostname.slice(4);
        }

        return isValidSite(hostname)
            ? hostname
            : null;
    } catch {
        return null;
    }
}


export function isValidSite(site) {
    if (
        typeof site !== "string" ||
        site.length === 0 ||
        site.length > 253
    ) {
        return false;
    }

    if (!site.includes(".")) {
        return false;
    }

    const labels = site.split(".");
    const topLevelDomain =
        labels[labels.length - 1];

    if (!/^[a-z]{2,63}$/i.test(topLevelDomain)) {
        return false;
    }

    return labels.every((label) => {
        if (
            label.length === 0 ||
            label.length > 63
        ) {
            return false;
        }

        return (
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i
                .test(label)
        );
    });
}


export function sanitizeSites(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return [
        ...new Set(
            value.filter(isValidSite)
        )
    ].sort();
}


export function getSiteOrigins(site) {
    if (!isValidSite(site)) {
        return [];
    }

    return [
        `http://${site}/*`,
        `https://${site}/*`,
        `http://*.${site}/*`,
        `https://*.${site}/*`
    ];
}
