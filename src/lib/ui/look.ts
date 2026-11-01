/**
 * The look switch: `<html data-look="glass|classic">`. "glass" is the iOS 27 (phone) / macOS 27
 * (desktop) look; "classic" is the look before it, untouched — every glass rule in globals.css is
 * keyed on `:root[data-look="glass"]`, so the attribute is the whole switch.
 *
 * Per device, like the rest of the page's display state: localStorage, stamped on <html> before first
 * paint by `LOOK_BOOT_SCRIPT` (layout.tsx), so a reload never flashes the other look. `?look=classic`
 * (or `?look=glass`) on any URL sets it too — the way back for a visitor with no Settings page, and
 * for a check that has to see one look or the other.
 */
export type Look = "glass" | "classic";

export const LOOK_STORAGE_KEY = "velai-look";
export const DEFAULT_LOOK: Look = "glass";

export function parseLook(value: string | null | undefined): Look | null {
    return value === "glass" || value === "classic" ? value : null;
}

/** Runs in <head>, before paint. Reads ?look= first (and remembers it), then storage, else the default. */
export const LOOK_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,k=${JSON.stringify(LOOK_STORAGE_KEY)},q=new URLSearchParams(location.search).get("look"),v=(q==="glass"||q==="classic")?q:null;if(v){try{localStorage.setItem(k,v)}catch(e){}}else{try{v=localStorage.getItem(k)}catch(e){}}d.setAttribute("data-look",(v==="glass"||v==="classic")?v:${JSON.stringify(DEFAULT_LOOK)})}catch(e){}})();`;

export function currentLook(): Look {
    if (typeof document === "undefined") return DEFAULT_LOOK;
    return parseLook(document.documentElement.getAttribute("data-look")) ?? DEFAULT_LOOK;
}

export function setLook(look: Look): void {
    document.documentElement.setAttribute("data-look", look);
    try {
        window.localStorage.setItem(LOOK_STORAGE_KEY, look);
    } catch {
        /* private mode / storage disabled: the choice holds until the page closes */
    }
}
