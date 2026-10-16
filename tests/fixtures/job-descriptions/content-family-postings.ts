/**
 * CONSTRUCTED postings (no real company or posting) whose TEXT reads as one line of work, under titles a reader
 * could mistake for another: the shapes of the roles a product manager's list showed as Good on 2026-10-16
 * (a "Product Engineering Coordinator" asking for supply chain work, a "Learning & Development Specialist"
 * asking for case management, a "Customer Support Analyst" asking for ticketing) and the product roles that must stay.
 * Each is long enough for the lexicon to call (content-family.ts): six or more of the family's terms, well ahead of the rest.
 */

/** Supply chain and logistics work under an engineering-sounding title. */
export const SUPPLY_CHAIN_TEXT = [
  "About the role\n\nWe make components for industrial customers and need a coordinator to keep materials moving between our suppliers and our plants.",
  "What you'll do\n\nPlace and expedite purchase orders with suppliers and track every shipment to delivery. Manage inventory levels across the warehouse and reorder before stock runs out. Run supply chain planning with demand forecasts, reconcile receipts against purchase orders in the ERP, and handle procurement of raw materials. Negotiate lead times and pricing with vendors, coordinate freight and logistics with carriers, and report on on-time delivery and inventory turns.",
  "What you bring\n\n3+ years in supply chain, procurement or inventory management\nExperience with an ERP such as SAP\nStrong vendor management and negotiation skills\nComfort with logistics, freight and customs paperwork",
].join("\n\n");

/** Case management and community support work under a training-sounding title. */
export const SOCIAL_SERVICES_TEXT = [
  "About the role\n\nOur agency supports families and individuals in crisis across the community, and we need a specialist who can help clients and train our frontline team.",
  "What you'll do\n\nProvide crisis intervention and case management for clients, connect them with community resources and social services, and complete intake assessments. Deliver first aid sessions for staff and volunteers. Support clients with housing, income and mental health needs, document each case and follow up with their families, and coordinate with shelters and other community partners.",
  "What you bring\n\nDiploma in social services or a related field\nExperience in crisis intervention and case management\nComfort delivering first aid sessions\nA caring approach to supporting vulnerable clients in the community",
].join("\n\n");

/** Ticketing and troubleshooting work under an analyst title. */
export const IT_SUPPORT_TEXT = [
  "About the role\n\nJoin our service desk and help our customers get their software and devices working.",
  "What you'll do\n\nRespond to tickets in the ticketing system and troubleshoot technical issues by phone, chat and remote session. Reset passwords and manage user accounts in Active Directory, install and configure software, and escalate hard problems to second-line support. Follow ITIL practice, document fixes in the knowledge base and keep customers updated until the ticket is resolved.",
  "What you bring\n\n2+ years of technical support or help desk experience\nExperience with Active Directory, Windows and Microsoft 365\nStrong troubleshooting skills and a clear writing voice\nFamiliarity with ITIL and ticketing tools",
].join("\n\n");

/** Alert triage and threat hunting work under an engineer title. */
export const SECURITY_OPS_TEXT = [
  "About the role\n\nOur security operations centre protects customers around the clock and we need another analyst on the team.",
  "What you'll do\n\nMonitor and triage alerts in the SIEM, investigate suspicious activity and lead incident response from detection to containment. Hunt for threats across endpoints with EDR tooling, run vulnerability scans and track remediation, and tune detection rules. Write incident reports, work with the SOC on playbooks and keep up with new threat intelligence.",
  "What you bring\n\n3+ years in a SOC or security operations role\nExperience with a SIEM, EDR and incident response\nKnowledge of MITRE ATT&CK and common attack techniques\nGood judgement under pressure",
].join("\n\n");

/** Product management work: the title is the résumé's own, and so is the text. */
export const PRODUCT_TEXT = [
  "About the role\n\nWe are looking for a product manager to own the roadmap for our platform and the customers who build on it.",
  "What you'll do\n\nOwn the product roadmap and product strategy for the platform, from discovery to launch. Write user stories, groom the backlog and prioritize with engineering and design. Define success metrics, run product discovery with customers, make product decisions with stakeholders across the business and report on product performance.",
  "What you bring\n\n5+ years of product management experience\nA record of shipping platform and API products\nStrong product sense and clear written communication\nExperience working with engineering, design and sales",
].join("\n\n");
