/** Critical first-paint rules for /jobs Concept A — duplicated in layout inline style. */
export const JOBS_LANDING_CRITICAL_CSS = `
#concept-a-ssr{background-color:rgb(var(--surface-poster));color:rgb(var(--surface-poster-foreground))}
#concept-a-ssr .text-poster-hero{font-size:clamp(2.5rem,7vw,4.75rem);line-height:1.05;letter-spacing:-0.02em;font-weight:600;opacity:1!important;animation:none!important;transform:none!important}
#concept-a-ssr h1,#concept-a-ssr h1 *{opacity:1!important;animation:none!important}
html.concept-a-landing-pending [data-testid="topbar"],
html.concept-a-landing-pending [data-testid="mobile-tabbar"],
html.concept-a-landing-pending [data-testid="site-footer"]{display:none!important}
html.concept-a-landing-pending #main{min-height:100dvh;overflow:clip}
html.concept-a-landing-pending #jobs-route-gate-inert{display:none!important}
html.velai-jobs-skip-landing #concept-a-ssr,
html.velai-onboarding-complete #concept-a-ssr{display:none!important}
`.trim();
