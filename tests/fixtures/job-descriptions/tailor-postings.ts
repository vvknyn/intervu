/**
 * One posting per résumé in tests/fixtures/resume-corpus, for the tailoring
 * tests: a role the person could apply to, at another employer, sometimes in
 * another country (so its spelling differs from the résumé's), written the way
 * real postings are (duties, then requirements) and naming some things the
 * person has and some they don't. Invented; wording follows public postings
 * for the same kinds of roles.
 */
import type { TailorJobInput } from "../../../src/lib/local-ai/tailor-resume";

export const TAILOR_POSTINGS: Record<string, TailorJobInput> = {
    "accountant-ca": {
        title: "Senior Accountant",
        company: "Northline Utilities",
        location: "Edmonton, AB",
        description: `What you'll do
- Own the month-end close and year-end close for multiple entities.
- Reconcile balance sheet accounts and prepare consolidated financial statements under IFRS.
- Partner with external auditors and lead audit support.
- Prepare tax provisions and variance analysis for management.
What you bring
- CPA designation and 5+ years of progressive accounting experience.
- Advanced Excel; experience with SAP or Oracle.`,
    },
    "admin-us": {
        title: "Executive Assistant",
        company: "Harbor Point Capital",
        location: "Boston, MA",
        description: `Responsibilities
- Manage complex calendars and coordinate domestic and international travel.
- Schedule meetings, take minutes and track action items.
- Greet visitors and handle phone calls with professionalism.
- Organize files and handle data entry in our CRM.
Qualifications
- 3+ years supporting executives; strong Microsoft Office skills.`,
    },
    "barista-ca": {
        title: "Café Supervisor",
        company: "Northern Grind Coffee",
        location: "Vancouver, BC",
        description: `About the role
- Supervise the café team on each shift and train new baristas.
- Deliver great customer service and prepare espresso drinks to standard.
- Handle cash, close out tills and place inventory orders.
- Keep the café clean and follow food safety standards.
Requirements: FoodSafe Level 1, 1+ year leading a team.`,
    },
    "chef-ca": {
        title: "Chef de Cuisine",
        company: "Osteria Lume",
        location: "Montreal, QC",
        description: `Responsibilities
- Lead the kitchen brigade and train cooks on every station.
- Develop seasonal menus and manage food costs and ordering.
- Oversee inventory, food safety and kitchen management standards.
- Work with the front of house to deliver a consistent guest experience.
Requirements: 5+ years in Italian or Mediterranean kitchens.`,
    },
    "civil-ae": {
        title: "Senior Civil Engineer",
        company: "Gulf Structures Consultancy",
        location: "Abu Dhabi, United Arab Emirates",
        description: `Key responsibilities
- Lead the structural design of residential and commercial buildings.
- Supervise construction on site and coordinate with contractors.
- Prepare project schedules in Primavera P6 and manage QA/QC procedures.
- Review drawings in AutoCAD and Revit; perform quantity take-offs.
Requirements: BSc Civil Engineering, 7+ years, Society of Engineers membership.`,
    },
    "csr-ph": {
        title: "Customer Support Specialist",
        company: "BrightCall Solutions",
        location: "Makati, Philippines",
        description: `What you will do
- Handle inbound calls, emails and live chats from customers in the US.
- Troubleshoot account and billing issues and resolve them on the first contact.
- Maintain high customer satisfaction (CSAT) and quality scores.
- Log every interaction in Zendesk and Salesforce.
Qualifications: 1+ year BPO experience, excellent English.`,
    },
    "datasci-de": {
        title: "Senior Data Scientist",
        company: "Rheinfahrt Mobility",
        location: "Munich, Germany",
        description: `Your tasks
- Build forecasting and machine learning models in Python with pandas and scikit-learn.
- Design and analyse A/B tests with product teams.
- Write SQL to explore large datasets and present insights to stakeholders.
- Build dashboards in Looker or Tableau.
Your profile: MSc in a quantitative field, 4+ years.`,
    },
    "designer-br": {
        title: "Senior Brand Designer",
        company: "Estúdio Faro",
        location: "Rio de Janeiro, Brazil",
        description: `Responsibilities
- Create brand identity systems, packaging and campaign assets.
- Lead projects from concept to final artwork with clients.
- Work in Figma, Adobe Illustrator, Photoshop and InDesign.
- Collaborate with copywriters and motion designers.
Requirements: portfolio, 4+ years in a studio or agency, strong typography.`,
    },
    "driver-us": {
        title: "OTR Class A CDL Driver",
        company: "Plainsway Freight",
        location: "Dallas, TX",
        description: `Duties
- Drive long-haul routes across the lower 48 with dry van loads.
- Complete pre-trip and post-trip inspections and keep accurate ELD logs.
- Secure loads and follow DOT regulations and safety policies.
- Communicate with dispatch and deliver on time.
Requirements: Class A CDL, 2+ years OTR, clean MVR; hazmat endorsement a plus.`,
    },
    "electrician-au": {
        title: "Commercial Electrician",
        company: "Southern Cross Electrical",
        location: "Melbourne, VIC",
        description: `About the role
- Install and maintain commercial wiring, switchboards and three-phase power.
- Perform fault finding and testing and tagging to AS/NZS 3000.
- Install conduit and cable tray on new builds and fit-outs.
- Work with builders and site managers to deliver on schedule.
Requirements: A-grade licence, own tools, white card.`,
    },
    "hr-ie": {
        title: "HR Business Partner",
        company: "Lir Software",
        location: "Cork, Ireland",
        description: `The role
- Advise managers on employee relations and Irish employment law.
- Manage end-to-end recruitment and onboarding for new hires.
- Run the performance management cycle and support payroll.
- Keep HRIS data accurate and report on people metrics.
About you: 4+ years in HR, CIPD qualification.`,
    },
    "lawyer-us": {
        title: "Corporate Associate (M&A)",
        company: "Whitcombe & Hale LLP",
        location: "New York, NY",
        description: `Responsibilities
- Draft and negotiate merger agreements and ancillary documents.
- Run due diligence and coordinate with specialist teams.
- Advise private equity clients on acquisitions and securities law matters.
- Conduct legal research and draft memoranda.
Qualifications: J.D., admitted in New York, 3–5 years of M&A experience.`,
    },
    "marketing-ng": {
        title: "Head of Growth Marketing",
        company: "Paystream",
        location: "Lagos, Nigeria",
        description: `What you'll do
- Own performance marketing across Google Ads, Meta Ads and TikTok.
- Manage the marketing budget and report on customer acquisition cost.
- Lead brand strategy, SEO and content marketing.
- Run market research to find new customer segments.
Requirements: 6+ years in fintech or consumer marketing, team leadership.`,
    },
    "mecheng-ca": {
        title: "Mechanical Design Engineer",
        company: "Lakehead Robotics",
        location: "Waterloo, ON",
        description: `Responsibilities
- Design mechanical assemblies in SolidWorks and create drawings with GD&T.
- Run thermal and structural analysis in ANSYS.
- Build and test prototypes and apply design for manufacturing.
- Work with suppliers and manufacturing on production releases.
Requirements: P.Eng or EIT, 3+ years.`,
    },
    "nurse-ca": {
        title: "Registered Nurse, Emergency",
        company: "Sunnybrook Health Sciences Centre",
        location: "Toronto, ON",
        description: `Responsibilities
- Triage and assess patients using CTAS and develop nursing care plans.
- Administer medications and IV therapy and provide wound care.
- Document assessments and interventions in the electronic health record.
- Provide patient education and mentor new nurses.
Requirements: current CNO registration, BLS and ACLS, 2+ years emergency experience.`,
    },
    "pharmacist-ca": {
        title: "Staff Pharmacist",
        company: "Rexall",
        location: "Ottawa, ON",
        description: `Responsibilities
- Dispense prescriptions accurately and check for drug interactions.
- Conduct medication reviews and counsel patients.
- Administer immunizations and injections.
- Supervise pharmacy assistants and technicians.
Requirements: OCP licence, injection certification, experience with Kroll or HealthWatch.`,
    },
    "pm-us": {
        title: "Senior Product Manager, Platform",
        company: "Lattice Ledger",
        location: "San Francisco, CA",
        description: `What you'll do
- Own the roadmap for our developer platform and public APIs.
- Run experiments and use SQL to measure impact.
- Partner with engineering, design and sales stakeholders to ship features.
- Set pricing and packaging for platform products.
What you bring: 6+ years in product management, B2B SaaS.`,
    },
    "swe-in": {
        title: "Senior Backend Engineer",
        company: "PayGrid",
        location: "Bengaluru, India",
        description: `What you'll do
- Design and build payment microservices in Go and Java.
- Own services on PostgreSQL, Kafka and Redis running on Kubernetes in AWS.
- Improve latency and reliability of high-throughput REST APIs.
- Mentor engineers and review code.
Requirements: 6+ years backend experience.`,
    },
    "teacher-uk": {
        title: "Year 2 Teacher",
        company: "Riverside Academy Trust",
        location: "Leeds, United Kingdom",
        description: `The role
- Plan and teach engaging lessons for a Year 2 class.
- Lead phonics and early reading and assess pupil progress.
- Support pupils with SEND and work with teaching assistants.
- Communicate with parents and follow safeguarding procedures.
Requirements: QTS, enhanced DBS, experience in Key Stage 1.`,
    },
    "warehouse-ca": {
        title: "Shipping and Receiving Associate",
        company: "Northbound Logistics",
        location: "Brampton, ON",
        description: `Duties
- Pick, pack and ship customer orders accurately using RF scanners.
- Operate forklifts and reach trucks safely.
- Load and unload trucks and keep inventory counts accurate.
- Follow WHMIS and health and safety rules.
Requirements: valid forklift certification, able to lift 50 lbs.`,
    },
};

/** Postings for the longer résumés in tests/fixtures (file name → posting). */
export const LONG_RESUME_POSTINGS: Record<string, TailorJobInput> = {
    "vivek-tam-resume.txt": {
        title: "Technical Account Manager",
        company: "Expel",
        description: `What you'll do
- Serve as the technical point of contact for a portfolio of enterprise customers, guiding adoption and integration decisions.
- Advise customers on security program improvements and detection strategies.
- Help customers mature their use of the platform over time, expanding integrations and optimizing their configuration. Provide technical content for quarterly business reviews (QBRs).
- Handle troubleshooting and integration challenges, partnering with engineering and product teams; escalate complex issues.
- Identify technical expansion opportunities.
What you should bring
- 5+ years in consultative customer-facing roles; SLA management and incident response experience.
- Ability to communicate complex technical concepts to executives.`,
    },
    "vivek-pm-resume.txt": {
        title: "Senior Product Manager",
        company: "Northwind Health",
        description: `Responsibilities
- Own the product roadmap for our customer-facing APIs and prioritize the backlog with engineering.
- Lead discovery with customers and translate requirements into shippable releases.
- Collaborate with engineering, design and customer success to launch features.
- Define success metrics, monitor adoption and improve retention.
Requirements: 7+ years of product management in B2B SaaS, experience with regulated industries.`,
    },
    "vivek-csm-golden-resume.txt": {
        title: "Senior Customer Success Manager",
        company: "Lumen Cloud",
        description: `What you'll do
- Manage a portfolio of enterprise clients and own renewals and expansion.
- Run quarterly business reviews with executive stakeholders.
- Coordinate onboarding and implementation with cross-functional teams.
- Monitor customer health, identify risks and drive adoption.
- Partner with support and engineering to resolve escalations.`,
    },
    "sample-resume.txt": {
        title: "Staff Software Engineer, Platform",
        company: "Harbor",
        description: `You will
- Lead the design of our microservices platform on Kubernetes and AWS.
- Mentor and coach engineers across teams.
- Improve the latency and reliability of our APIs and CI/CD pipelines.
- Develop React and Node.js services in TypeScript.
Requirements: 8+ years of experience, PostgreSQL, Docker.`,
    },
    "health-rn-resume.txt": {
        title: "Registered Nurse - Intensive Care Unit",
        company: "Trillium Health Partners",
        description: `Responsibilities
- Provide direct patient care to critically ill patients in the ICU.
- Administer medications and IV therapy; document care in the electronic health record (EHR).
- Mentor new graduate nurses and nursing students.
- Provide patient and family education and support discharge planning.
Requirements: BScN, CNO registration, BLS and ACLS, 2+ years of critical care.`,
    },
};
