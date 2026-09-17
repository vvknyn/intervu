import { Document, Packer, Paragraph, TextRun, AlignmentType, TabStopPosition, TabStopType, BorderStyle } from "docx";
import { saveAs } from "file-saver";
import { ResumeData, ResumeSection, getSectionOrder } from "@/types/resume";

export const exportToDocx = async (data: ResumeData) => {
    // Compact styles for maximum space utilization
    const BODY_FONT_SIZE = 20; // 10pt - compact
    const HEADING_FONT_SIZE = 22; // 11pt
    const NAME_FONT_SIZE = 28; // 14pt
    const FONT_FAMILY = "Times New Roman";

    // Get dynamic section order (honors a saved custom order, merging in any
    // section — e.g. 'projects' — that order predates)
    const sectionOrder = getSectionOrder(data);

    // 1. Header Section - Compact centered
    const headerParagraphs = [
        new Paragraph({
            children: [
                new TextRun({
                    text: data.profile.name || "Your Name",
                    font: FONT_FAMILY,
                    size: NAME_FONT_SIZE,
                    bold: true,
                })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({
                    text: [
                        data.profile.location,
                        data.profile.phone,
                        data.profile.email,
                        data.profile.linkedin?.replace(/^https?:\/\//, '')
                    ].filter(Boolean).join(" | "),
                    font: FONT_FAMILY,
                    size: BODY_FONT_SIZE
                }),
            ],
            spacing: { after: 100 },
            border: {
                bottom: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
            },
        }),
    ];

    // Section builders
    const buildSummary = () => data.generatedSummary ? [
        new Paragraph({
            children: [
                new TextRun({ text: "PROFESSIONAL SUMMARY", bold: true, font: FONT_FAMILY, size: HEADING_FONT_SIZE })
            ],
            alignment: AlignmentType.CENTER,
            border: {
                bottom: { color: "666666", space: 1, style: BorderStyle.SINGLE, size: 4 },
            },
            spacing: { before: 100, after: 60 },
        }),
        new Paragraph({
            children: [
                new TextRun({
                    text: data.generatedSummary,
                    font: FONT_FAMILY,
                    size: BODY_FONT_SIZE,
                }),
            ],
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 80, line: 260 },
        }),
    ] : [];

    const buildSkills = () => data.competencies && data.competencies.length > 0 ? [
        new Paragraph({
            children: [
                new TextRun({ text: "CORE COMPETENCIES", bold: true, font: FONT_FAMILY, size: HEADING_FONT_SIZE })
            ],
            alignment: AlignmentType.CENTER,
            border: {
                bottom: { color: "666666", space: 1, style: BorderStyle.SINGLE, size: 4 },
            },
            spacing: { before: 100, after: 60 },
        }),
        ...data.competencies.map(cat =>
            new Paragraph({
                children: [
                    new TextRun({ text: "• ", font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    new TextRun({ text: `${cat.category}: `, bold: true, underline: {}, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    new TextRun({ text: cat.skills.join(", "), font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                ],
                spacing: { after: 40, line: 260 },
            })
        ),
    ] : [];

    const buildExperience = () => data.experience && data.experience.length > 0 ? [
        new Paragraph({
            children: [
                new TextRun({ text: "PROFESSIONAL EXPERIENCE", bold: true, font: FONT_FAMILY, size: HEADING_FONT_SIZE })
            ],
            alignment: AlignmentType.CENTER,
            border: {
                bottom: { color: "666666", space: 1, style: BorderStyle.SINGLE, size: 4 },
            },
            spacing: { before: 100, after: 60 },
        }),
        ...data.experience.flatMap(exp => [
            new Paragraph({
                children: [
                    new TextRun({ text: exp.role, bold: true, underline: {}, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    new TextRun({ text: " | ", font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    new TextRun({ text: exp.company, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    new TextRun({
                        text: `\t${exp.dates}`,
                        italics: true,
                        font: FONT_FAMILY,
                        size: BODY_FONT_SIZE,
                    }),
                ],
                tabStops: [
                    { type: TabStopType.RIGHT, position: TabStopPosition.MAX }
                ],
                spacing: { before: 80 },
            }),
            ...exp.description.split('\n').filter(line => line.trim()).map(line =>
                new Paragraph({
                    children: [
                        new TextRun({ text: "• ", font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                        new TextRun({ text: line.trim().replace(/^[-•]\s*/, ''), font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    ],
                    spacing: { after: 20, line: 260 },
                })
            ),
        ])
    ] : [];

    const buildEducation = () => data.education && data.education.length > 0 ? [
        new Paragraph({
            children: [
                new TextRun({ text: "EDUCATION & PROFESSIONAL DEVELOPMENT", bold: true, font: FONT_FAMILY, size: HEADING_FONT_SIZE })
            ],
            alignment: AlignmentType.CENTER,
            border: {
                bottom: { color: "666666", space: 1, style: BorderStyle.SINGLE, size: 4 },
            },
            spacing: { before: 100, after: 60 },
        }),
        ...data.education.flatMap(edu => [
            new Paragraph({
                children: [
                    new TextRun({ text: edu.degree, bold: true, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    ...(edu.institution ? [
                        new TextRun({ text: " | ", font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                        new TextRun({ text: edu.institution, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    ] : []),
                    ...(edu.year ? [
                        new TextRun({ text: ` (${edu.year})`, italics: true, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    ] : []),
                ],
                spacing: { after: 40, line: 260 },
            }),
            ...[
                edu.gpa ? `GPA: ${edu.gpa}` : null,
                edu.honours?.length ? `Honours: ${edu.honours.join(", ")}` : null,
                edu.coursework?.length ? `Relevant coursework: ${edu.coursework.join(", ")}` : null,
                edu.activities?.length ? `Activities: ${edu.activities.join(", ")}` : null,
            ].filter((line): line is string => line !== null).map(line =>
                new Paragraph({
                    children: [new TextRun({ text: line, font: FONT_FAMILY, size: BODY_FONT_SIZE })],
                    spacing: { after: 20, line: 260 },
                })
            ),
        ]),
    ] : [];

    const buildProjects = () => data.projects && data.projects.length > 0 ? [
        new Paragraph({
            children: [
                new TextRun({ text: "PROJECTS", bold: true, font: FONT_FAMILY, size: HEADING_FONT_SIZE })
            ],
            alignment: AlignmentType.CENTER,
            border: {
                bottom: { color: "666666", space: 1, style: BorderStyle.SINGLE, size: 4 },
            },
            spacing: { before: 100, after: 60 },
        }),
        ...data.projects.flatMap(proj => [
            new Paragraph({
                children: [
                    new TextRun({ text: proj.role, bold: true, underline: {}, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    ...(proj.company ? [
                        new TextRun({ text: " | ", font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                        new TextRun({ text: proj.company, font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    ] : []),
                    ...(proj.dates ? [
                        new TextRun({
                            text: `\t${proj.dates}`,
                            italics: true,
                            font: FONT_FAMILY,
                            size: BODY_FONT_SIZE,
                        }),
                    ] : []),
                ],
                tabStops: [
                    { type: TabStopType.RIGHT, position: TabStopPosition.MAX }
                ],
                spacing: { before: 80 },
            }),
            ...proj.description.split('\n').filter(line => line.trim()).map(line =>
                new Paragraph({
                    children: [
                        new TextRun({ text: "• ", font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                        new TextRun({ text: line.trim().replace(/^[-•]\s*/, ''), font: FONT_FAMILY, size: BODY_FONT_SIZE }),
                    ],
                    spacing: { after: 20, line: 260 },
                })
            ),
        ])
    ] : [];

    // Section builder map
    const sectionBuilders: Record<ResumeSection, () => Paragraph[]> = {
        summary: buildSummary,
        skills: buildSkills,
        experience: buildExperience,
        education: buildEducation,
        projects: buildProjects,
    };

    // Build sections in dynamic order
    const contentSections = sectionOrder.flatMap(section => sectionBuilders[section]());

    const doc = new Document({
        sections: [
            {
                properties: {
                    page: {
                        margin: {
                            top: 400,    // ~0.28 inch - tight
                            right: 500,  // ~0.35 inch
                            bottom: 400, // ~0.28 inch
                            left: 500,   // ~0.35 inch
                        },
                    },
                },
                children: [
                    ...headerParagraphs,
                    ...contentSections
                ],
            },
        ],
    });

    const blob = await Packer.toBlob(doc);
    const fileNameBase = data.profile.name || data.profile.profession;
    const fileName = fileNameBase
        ? `${fileNameBase.replace(/\s+/g, '_')}_Resume.docx`
        : "Resume.docx";
    saveAs(blob, fileName);
};
