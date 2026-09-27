/**
 * Linux headless Chromium FreeType hinting can split label glyphs in PNG
 * captures while DOM/CSS are identical. Visual QA and ad hoc design screenshots
 * on Linux must pass `--font-render-hinting=none` at launch — not headed Xvfb,
 * not macOS, not Firefox/WebKit, not production PDF/runtime paths unless they
 * are explicitly taking a fidelity screenshot.
 */
const FONT_RENDER_HINTING_NONE = "--font-render-hinting=none";

function isLinux() {
    return process.platform === "linux";
}

/** @returns {string[]} extra Chromium CLI args (empty off Linux) */
function linuxChromiumVisualQaArgs() {
    if (!isLinux()) return [];
    return [FONT_RENDER_HINTING_NONE];
}

/**
 * Merge Linux visual-QA Chromium args into Playwright `launchOptions` or
 * `chromium.launch()` options. Defaults to headless when not specified.
 *
 * @param {import('playwright').LaunchOptions} [base]
 * @returns {import('playwright').LaunchOptions}
 */
function linuxChromiumVisualQaLaunchOptions(base = {}) {
    const extra = linuxChromiumVisualQaArgs();
    const args = [...(base.args ?? []), ...extra];
    return {
        ...base,
        headless: base.headless ?? true,
        args,
    };
}

module.exports = {
    FONT_RENDER_HINTING_NONE,
    isLinux,
    linuxChromiumVisualQaArgs,
    linuxChromiumVisualQaLaunchOptions,
};
