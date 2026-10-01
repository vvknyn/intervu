/**
 * ATS-shaped job postings for description-formatting tests. The Expel TAM
 * role is the one Vivek screenshotted on 2026-09-30 (every duty and
 * requirement rendered as its own paragraph, "What you should bring with
 * you" as body text); the others cover the other shapes ingest produces.
 * Wording is abridged from public postings; only structure matters here.
 */

export const EXPEL_TAM_HTML = `
<p><strong>About Expel</strong></p>
<p>Expel is a security operations provider that helps organizations of all sizes minimize business risk. We combine our technology with people to detect and respond to threats around the clock.</p>
<p><strong>What you&rsquo;ll do</strong></p>
<ul>
<li>Serve as the technical point of contact for a portfolio of enterprise customers, guiding adoption and integration decisions</li>
<li>Advise customers on security program improvements, detection strategies, and how to get more value from their technology investments</li>
<li>Help customers mature their use of Expel over time, expanding integrations and optimizing their configuration. Provide technical content and support for CSM-led quarterly business reviews</li>
<li>Handle troubleshooting and integration challenges, partnering with TSEs, Detection &amp; Response, Engineering, and Product teams as needed; escalate complex issues to senior TAMs</li>
<li>Identify technical expansion opportunities (new integrations, additional coverage)</li>
</ul>
<p><strong>What you should bring with you</strong></p>
<ul>
<li>5+ years of security industry experience, majority in consultative customer-facing roles</li>
<li>Deep technical expertise in two or more security product spaces (EDR, NDR, SIEM, Cloud security, IAM, etc.) and associated detection strategies</li>
<li>Experience in customer-facing technical roles (solutions engineering, professional services, technical consulting). Understanding of enterprise security operations and the challenges security teams face</li>
<li>Strong consultative skills; leads with listening, understands customer context before recommending solutions. Ability to communicate complex technical concepts to varied audiences, from SOC analysts to security directors</li>
</ul>
<p><strong>Compensation</strong></p>
<p>The base salary range for this role is $150,000 - $180,000 USD, plus equity and benefits.</p>
<p>Expel is an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, color, religion, sex, sexual orientation, gender identity, national origin, disability, or protected veteran status.</p>
<p>#LI-Remote</p>
`;

/** Workday: `<br>`-separated lines inside one block, colon headings. */
export const WORKDAY_HTML = `
<div><p><b>Position Summary:</b></p><p>The Customer Success Manager owns renewal outcomes for a book of mid-market accounts.</p>
<p><b>Responsibilities:</b></p><p>Run onboarding for new accounts<br>Lead quarterly business reviews<br>Forecast renewals in Salesforce</p>
<p><b>Location:</b> Toronto, Ontario (Hybrid)</p></div>
`;

/** Prose-only posting: short paragraphs that must stay paragraphs. */
export const PROSE_HTML = `
<p><strong>About the team</strong></p>
<p>We are a small platform team that owns the event pipeline behind every product at Northwind. The pipeline moves four billion events a day.</p>
<p>Our engineers work across the stack, from Kafka consumers to the dashboards our analysts use every morning.</p>
<p>You will join a team of six engineers and report to the head of platform, who has led the group since it was founded.</p>
`;

/** Short skills list with no markers (each `<li>` one or two words). */
export const SKILLS_HTML = `
<p><strong>Tools we use</strong></p>
<ul><li>Python</li><li>SQL</li><li>dbt</li><li>Snowflake</li></ul>
<p>We hire across Canada and the United States.</p>
`;
