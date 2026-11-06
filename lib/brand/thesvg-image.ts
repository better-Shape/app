/**
 * An `<img>` source for a `thesvg` icon's markup: a `data:` URL, so drawing it asks no server, and
 * an image of its own, so the icon's ids and embedded styles cannot leak into the page. `fill`
 * colours a one-colour variant whose root names no fill of its own.
 */
export const thesvgDataUrl = (markup: string, fill?: string): string => {
    const svg = markup.replace(/<title>[^<]*<\/title>/gi, "");
    const root = svg.slice(0, svg.indexOf(">"));
    const coloured = fill && !/\sfill=/.test(root) ? svg.replace("<svg ", `<svg fill="#${fill}" `) : svg;
    return `data:image/svg+xml,${encodeURIComponent(coloured)}`;
};
