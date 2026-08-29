(() => {
    const ENABLED_ATTRIBUTE =
        "data-enable-copy-right-click";

    const STYLE_ID =
        "enable-copy-right-click-style";


    if (
        document.documentElement.hasAttribute(
            ENABLED_ATTRIBUTE
        )
    ) {
        return;
    }


    document.documentElement.setAttribute(
        ENABLED_ATTRIBUTE,
        ""
    );


    const blockedEvents = [
        "contextmenu",
        "copy",
        "cut",
        "paste",
        "selectstart",
        "dragstart"
    ];


    const inlineAttributes = [
        "oncontextmenu",
        "oncopy",
        "oncut",
        "onpaste",
        "onselectstart",
        "ondragstart"
    ];


    function clearInlineHandlers(target) {
        if (!target) {
            return;
        }

        for (const attribute of inlineAttributes) {
            target.removeAttribute(attribute);
        }

        for (const eventName of blockedEvents) {
            target[`on${eventName}`] = null;
        }
    }


    clearInlineHandlers(
        document.documentElement
    );

    clearInlineHandlers(
        document.body
    );


    for (const eventName of blockedEvents) {
        window[`on${eventName}`] = null;
        document[`on${eventName}`] = null;

        window.addEventListener(
            eventName,
            (event) => {
                event.stopImmediatePropagation();
            },
            true
        );
    }


    if (!document.getElementById(STYLE_ID)) {
        const style =
            document.createElement("style");

        style.id = STYLE_ID;

        style.textContent = `
            * {
                -webkit-user-select: auto !important;
                user-select: auto !important;
            }
        `;

        (
            document.head ||
            document.documentElement
        ).appendChild(style);
    }
})();