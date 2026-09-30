import { jsPDF } from "jspdf";

/**
 * A one-page résumé PDF whose summary, skills and bullets wrap across printed
 * lines, the way a real résumé does. Its text (a made-up person) is below, so
 * a test can say what each paragraph should read after extraction.
 */
export const WRAPPED_RESUME = {
    name: "Jordan Lee",
    summary:
        "Platform engineer with nine years building payment and ledger systems for regulated lenders, most recently owning the move from nightly batch settlement to streaming reconciliation across four regions, which cut month-end close from six days to one and kept audit findings at zero through two regulator reviews.",
    skills:
        "Languages & Platforms: Go, TypeScript, PostgreSQL, Kafka, Kubernetes, Terraform, Large-Scale Data Pipelines, Event Sourcing (CQRS, Outbox, Sagas), Observability (OpenTelemetry, Grafana), Incident Command",
    role: "Staff Engineer | Northwind Payments",
    dates: "2019 – Present",
    bullets: [
        "Led the ledger migration from a monolith to event-sourced services, moving forty million accounts with no downtime and no reconciliation breaks across the cutover weekend.",
        "Built the settlement pipeline that replaced nightly batches, cutting payout latency from a full day to under five minutes for merchants in four regions.",
    ],
    education: "BSc Computer Science | University of Toronto | 2015",
};

export function buildWrappedResumePdf(): ArrayBuffer {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const left = 50;
    const right = 562;
    let y = 60;

    const heading = (text: string) => {
        y += 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(text, left, y);
        y += 16;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
    };
    const paragraph = (text: string, x: number) => {
        for (const line of doc.splitTextToSize(text, right - x) as string[]) {
            doc.text(line, x, y);
            y += 13;
        }
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(WRAPPED_RESUME.name, left, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Toronto, ON | jordan@example.com | (416) 555-0199", left, y);
    y += 16;

    heading("SUMMARY");
    paragraph(WRAPPED_RESUME.summary, left);
    heading("SKILLS");
    paragraph(WRAPPED_RESUME.skills, left);
    heading("EXPERIENCE");
    doc.text(WRAPPED_RESUME.role, left, y);
    doc.text(WRAPPED_RESUME.dates, right, y, { align: "right" });
    y += 15;
    for (const bullet of WRAPPED_RESUME.bullets) {
        doc.text("•", left + 4, y);
        paragraph(bullet, left + 16);
        y += 3;
    }
    heading("EDUCATION");
    doc.text(WRAPPED_RESUME.education, left, y);

    return doc.output("arraybuffer");
}
