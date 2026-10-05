/**
 * `/jobs?setup=open` opens the setup sheet for an account that still has
 * setup open: the welcome email's "Finish setup". For anyone else (a guest,
 * an account from before setup existed, setup already finished) it is plain
 * /jobs. The param is taken off the address once read, so a refresh does not
 * reopen the sheet.
 */
export const SETUP_LINK_PARAM = "setup";
export const SETUP_LINK_VALUE = "open";
export const SETUP_LINK_PATH = `/jobs?${SETUP_LINK_PARAM}=${SETUP_LINK_VALUE}`;

/** True when the page was opened from a setup link. */
export function isSetupLink(pathname: string, search: string): boolean {
    return pathname === "/jobs" && new URLSearchParams(search).get(SETUP_LINK_PARAM) === SETUP_LINK_VALUE;
}

/** The address without the setup param, for `history.replaceState`. */
export function withoutSetupLink(pathname: string, search: string, hash = ""): string {
    const params = new URLSearchParams(search);
    params.delete(SETUP_LINK_PARAM);
    const rest = params.toString();
    return `${pathname}${rest ? `?${rest}` : ""}${hash}`;
}
