/**
 * Every structured field lands in its own slot, across résumé layouts.
 *
 * Each fixture is a fabricated person (example.com mail, 555 numbers) in a
 * different layout: header styles, "Degree, Institution" and
 * "Institution — Degree" orders, one- and two-line education, remote/hybrid
 * locations, non-US and non-ASCII places. `expect` lists the exact value of
 * every field the review step shows; "" means the résumé does not state it
 * and the slot must stay empty rather than borrow another field's text.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resumeDataFromPlainText, structureResumeText } from "../../src/lib/resume/structure-resume-text";

interface Expected {
    name: string;
    profession: string;
    email: string;
    phone: string;
    location: string;
    summary: string;
    experience: { role: string; company: string; dates: string }[];
    education: { degree: string; institution: string; year: string }[];
    skills: string[];
}

const FIXTURES: { id: string; text: string; expect: Expected }[] = [
    {
        id: "one contact row, no summary, Degree, Institution",
        text: `Jordan Rivera
Software Engineer
jordan.rivera@example.com | Toronto, ON

EXPERIENCE
Northwind Labs
Software Engineer
Jan 2021 - Present
• Built the billing service in TypeScript

EDUCATION
B.Sc. Computer Science, University of Waterloo, 2020

SKILLS
TypeScript, React, PostgreSQL`,
        expect: {
            name: "Jordan Rivera",
            profession: "Software Engineer",
            email: "jordan.rivera@example.com",
            phone: "",
            location: "Toronto, ON",
            summary: "",
            experience: [{ role: "Software Engineer", company: "Northwind Labs", dates: "Jan 2021 - Present" }],
            education: [{ degree: "B.Sc. Computer Science", institution: "University of Waterloo", year: "2020" }],
            skills: ["TypeScript", "React", "PostgreSQL"],
        },
    },
    {
        id: "Location: label, Institution — Degree",
        text: `Priya Raman
Senior Data Analyst
Location: Bengaluru, Karnataka, India
priya.raman@example.com | +91 98765 55012

PROFESSIONAL SUMMARY
Analyst with seven years of retail and payments experience.

EXPERIENCE
Senior Data Analyst | Kestrel Payments | Apr 2019 – Present
• Owned the fraud dashboard
Data Analyst | Lumen Retail | Jun 2016 – Mar 2019
• Built weekly demand forecasts

EDUCATION
Indian Institute of Technology Madras — B.Tech, Mechanical Engineering — 2016

SKILLS
SQL, Python, Tableau`,
        expect: {
            name: "Priya Raman",
            profession: "Senior Data Analyst",
            email: "priya.raman@example.com",
            phone: "+91 98765 55012",
            location: "Bengaluru, Karnataka, India",
            summary: "Analyst with seven years of retail and payments experience.",
            experience: [
                { role: "Senior Data Analyst", company: "Kestrel Payments", dates: "Apr 2019 – Present" },
                { role: "Data Analyst", company: "Lumen Retail", dates: "Jun 2016 – Mar 2019" },
            ],
            education: [
                {
                    degree: "B.Tech, Mechanical Engineering",
                    institution: "Indian Institute of Technology Madras",
                    year: "2016",
                },
            ],
            skills: ["SQL", "Python", "Tableau"],
        },
    },
    {
        id: "hybrid bullet row, non-ASCII place, two-line education",
        text: `Lukas Brenner
Staff Engineer
Hybrid · Zürich, Switzerland · lukas.brenner@example.com

EXPERIENCE
Staff Engineer at Alpenglow Robotics | Mar 2019 – Present
• Led the motion-planning team

EDUCATION
ETH Zürich
M.Sc. Computer Science, 2016

SKILLS
C++, Rust, ROS`,
        expect: {
            name: "Lukas Brenner",
            profession: "Staff Engineer",
            email: "lukas.brenner@example.com",
            phone: "",
            location: "Zürich, Switzerland",
            summary: "",
            experience: [{ role: "Staff Engineer", company: "Alpenglow Robotics", dates: "Mar 2019 – Present" }],
            education: [{ degree: "M.Sc. Computer Science", institution: "ETH Zürich", year: "2016" }],
            skills: ["C++", "Rust", "ROS"],
        },
    },
    {
        id: "Remote (place), Institution | Degree pipes",
        text: `Amara Nwosu
Product Manager
Remote (Lagos, Nigeria) | amara.nwosu@example.com

SUMMARY
Product manager for payments in West Africa.

EXPERIENCE
Product Manager, Kora Payments   Jun 2018 - Present
• Launched merchant payouts

EDUCATION
University of Lagos | BSc Economics | 2014

SKILLS
Roadmaps, SQL, Figma`,
        expect: {
            name: "Amara Nwosu",
            profession: "Product Manager",
            email: "amara.nwosu@example.com",
            phone: "",
            location: "Lagos, Nigeria",
            summary: "Product manager for payments in West Africa.",
            experience: [{ role: "Product Manager", company: "Kora Payments", dates: "Jun 2018 - Present" }],
            education: [{ degree: "BSc Economics", institution: "University of Lagos", year: "2014" }],
            skills: ["Roadmaps", "SQL", "Figma"],
        },
    },
    {
        id: "place first on the contact row, Degree — Institution with no keyword",
        text: `Sofia Almeida
UX Designer
São Paulo, Brazil | sofia.almeida@example.com | linkedin.com/in/sofia-almeida-example

SUMMARY
Designer focused on fintech onboarding.

EXPERIENCE
Pagaleve
UX Designer
Feb 2020 - Present
• Redesigned the signup flow

EDUCATION
MBA — Fundação Getulio Vargas, 2019

SKILLS
Figma, User Research`,
        expect: {
            name: "Sofia Almeida",
            profession: "UX Designer",
            email: "sofia.almeida@example.com",
            phone: "",
            location: "São Paulo, Brazil",
            summary: "Designer focused on fintech onboarding.",
            experience: [{ role: "UX Designer", company: "Pagaleve", dates: "Feb 2020 - Present" }],
            education: [{ degree: "MBA", institution: "Fundação Getulio Vargas", year: "2019" }],
            skills: ["Figma", "User Research"],
        },
    },
    {
        id: "Remote — place, Institution, Degree with 'at' in the school name",
        text: `Ethan Brooks
Senior Product Manager
Remote — Austin, TX | (512) 555-0187 | ethan.brooks@example.com

EXPERIENCE
Senior Product Manager | Mesa Health | 2019 - Present
• Owned the scheduling roadmap

EDUCATION
University of Texas at Austin, B.S. Computer Science, 2012

SKILLS
Roadmaps, SQL`,
        expect: {
            name: "Ethan Brooks",
            profession: "Senior Product Manager",
            email: "ethan.brooks@example.com",
            phone: "(512) 555-0187",
            location: "Austin, TX",
            summary: "",
            experience: [{ role: "Senior Product Manager", company: "Mesa Health", dates: "2019 - Present" }],
            education: [
                { degree: "B.S. Computer Science", institution: "University of Texas at Austin", year: "2012" },
            ],
            skills: ["Roadmaps", "SQL"],
        },
    },
    {
        id: "UK postcode, Degree, Institution with honours",
        text: `Hannah Price
Operations Analyst
Manchester, UK, M1 1AE
hannah.price@example.com

EXPERIENCE
Operations Analyst | Brightwell Logistics | Sep 2018 - Present
• Cut late deliveries by a third

EDUCATION
BSc (Hons) Mathematics, University of Manchester, 2018

SKILLS
Excel, SQL`,
        expect: {
            name: "Hannah Price",
            profession: "Operations Analyst",
            email: "hannah.price@example.com",
            phone: "",
            location: "Manchester, UK",
            summary: "",
            experience: [{ role: "Operations Analyst", company: "Brightwell Logistics", dates: "Sep 2018 - Present" }],
            education: [{ degree: "BSc (Hons) Mathematics", institution: "University of Manchester", year: "2018" }],
            skills: ["Excel", "SQL"],
        },
    },
    {
        id: "header tagline is the summary, three-line education",
        text: `Noah Tremblay
Customer Success Manager
noah.tremblay@example.com | 416-555-0164 | Montréal, QC
Onboards enterprise customers and keeps them.

EXPERIENCE
Customer Success Manager | Borealis Cloud | Jan 2020 – Present
• Renewed every top-20 account

EDUCATION
Bachelor of Commerce
McGill University
2015

SKILLS
Salesforce, Gainsight`,
        expect: {
            name: "Noah Tremblay",
            profession: "Customer Success Manager",
            email: "noah.tremblay@example.com",
            phone: "416-555-0164",
            location: "Montréal, QC",
            summary: "Onboards enterprise customers and keeps them.",
            experience: [
                { role: "Customer Success Manager", company: "Borealis Cloud", dates: "Jan 2020 – Present" },
            ],
            education: [{ degree: "Bachelor of Commerce", institution: "McGill University", year: "2015" }],
            skills: ["Salesforce", "Gainsight"],
        },
    },
    {
        id: "employer on contact row, Bachelors plural, two-line education",
        text: `Asha Menon
Speech Language Pathologist
Hearfon Systems Private Ltd., Bangalore, India | +91 99000 00000 | asha@example.com

PROFESSIONAL SUMMARY
Speech language pathologist working with adults and children.

EDUCATION
Master of Science in Speech Language Pathology
Dr. S.R. Chandrasekhar Institute of Speech and Hearing, Bangalore, India
2014
Bachelors in Audiology and Speech Language Pathology
Manipal University, Manipal, India
2012`,
        expect: {
            name: "Asha Menon",
            profession: "Speech Language Pathologist",
            email: "asha@example.com",
            phone: "+91 99000 00000",
            location: "Bangalore, India",
            summary: "Speech language pathologist working with adults and children.",
            experience: [],
            education: [
                {
                    degree: "Master of Science in Speech Language Pathology",
                    institution: "Dr. S.R. Chandrasekhar Institute of Speech and Hearing, Bangalore, India",
                    year: "2014",
                },
                {
                    degree: "Bachelors in Audiology and Speech Language Pathology",
                    institution: "Manipal University, Manipal, India",
                    year: "2012",
                },
            ],
            skills: [],
        },
    },
];

describe("résumé fields land in their own slot", () => {
    for (const { id, text, expect } of FIXTURES) {
        it(id, () => {
            const out = structureResumeText(text);
            assert.deepEqual(
                {
                    name: out.profile.name,
                    profession: out.profile.profession,
                    email: out.profile.email,
                    phone: out.profile.phone,
                    location: out.profile.location,
                    summary: out.generatedSummary,
                    experience: out.experience.map(({ role, company, dates }) => ({ role, company, dates })),
                    education: out.education,
                    skills: out.competencies.flatMap((c) => c.skills),
                },
                expect,
            );
        });
    }
});

describe("education lines", () => {
    const cases: [string[], { degree: string; institution: string; year: string }[]][] = [
        [["Universidad de Chile — Ingeniería Civil, B.Eng — Mar 2010 – Dec 2015"], [{ degree: "Ingeniería Civil, B.Eng", institution: "Universidad de Chile", year: "2015" }]],
        [["M.A. Economics at Stanford University (2014)", "GPA: 3.9"], [{ degree: "M.A. Economics", institution: "Stanford University", year: "2014" }]],
        [["Diploma in Nursing | Humber College", "PhD, Physics, Université de Montréal, 2021"], [
            { degree: "Diploma in Nursing", institution: "Humber College", year: "" },
            { degree: "PhD, Physics", institution: "Université de Montréal", year: "2021" },
        ]],
    ];
    for (const [lines, expected] of cases) {
        it(lines[0], () => {
            const text = ["Casey Morgan", "casey.morgan@example.com", "EDUCATION", ...lines].join("\n");
            assert.deepEqual(structureResumeText(text).education, expected);
        });
    }
});

describe("duration-span experience and additional sections", () => {
    it("parses duration-dated clinical roles, strips employer/institute prefixes from location, and preserves additionalSections", () => {
        const text = [
            "Krithika Ramanarayanan",
            "krithikaram30@gmail.com | +91 9686492727 | Bangalore, India",
            "PROFESSIONAL SUMMARY",
            "Dedicated Speech Language Pathologist (SLP) with over 5 years of clinical experience in dysphagia management and adult neuro-rehabilitation.",
            "EXPERIENCE",
            "Speech and Swallow Pathologist",
            "Sakra World Hospital, Bangalore | 1 year 7 months",
            "• Performed bedside swallow evaluations and FEES across ICU and neuro wards.",
            "Associate Speech Pathologist",
            "Hearfon Systems Private Ltd., Bangalore | 3 years 6 months",
            "• Delivered speech and language therapy for paediatric and adult caseloads.",
            "EDUCATION",
            "Masters in Speech Language Pathology",
            "All India Institute of Speech and Hearing, Mysore | 2020",
            "LICENCES",
            "Rehabilitation Council of India (RCI) — CRR No. A12345",
            "HONORS",
            "Best Clinical Outgoing Student Award (2020)",
        ].join("\n");
        const out = resumeDataFromPlainText(text);
        assert.equal(out.profile.name, "Krithika Ramanarayanan");
        assert.equal(out.profile.location, "Bangalore, India");
        assert.equal(out.profile.profession, "Speech and Swallow Pathologist");
        assert.equal(out.profile.yearsOfExperience, 5);
        assert.equal(out.experience.length, 2);
        assert.equal(out.experience[0]!.role, "Speech and Swallow Pathologist");
        assert.equal(out.experience[0]!.dates, "1 year 7 months");
        assert.equal(out.education[0]!.degree, "Masters in Speech Language Pathology");
        assert.equal(out.education[0]!.institution, "All India Institute of Speech and Hearing, Mysore");
        assert.ok((out.additionalSections ?? []).some((s) => s.heading.toLowerCase() === "licences"));
        assert.ok((out.additionalSections ?? []).some((s) => s.heading.toLowerCase() === "honors"));
    });
});
