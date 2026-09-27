import type { CSSProperties } from "react";

type Postcard = {
    title: string;
    meta: string;
    style: CSSProperties;
};

/** Owner-approved fan geometry — guarded by unit tests; do not recompose without review. */
export const POSTCARDS = [
    {
        title: "Remote AI Roles",
        meta: "Remote · Full-time",
        style: {
            top: "6%",
            left: "18%",
            transform: "rotate(-11deg)",
            zIndex: 1,
        },
    },
    {
        title: "Product Designer",
        meta: "New York, NY · Full-time",
        style: {
            top: "18%",
            left: "48%",
            transform: "rotate(8deg)",
            zIndex: 2,
        },
    },
    {
        title: "Growth Marketing Lead",
        meta: "Remote · MA · Full-time",
        style: {
            top: "52%",
            left: "42%",
            transform: "rotate(12deg)",
            zIndex: 3,
        },
    },
    {
        title: "Data Scientist",
        meta: "Boston, MA · Full-time",
        style: {
            top: "58%",
            left: "8%",
            transform: "rotate(-7deg)",
            zIndex: 4,
        },
    },
    {
        title: "Software Engineer",
        meta: "San Francisco, CA · Full-time",
        style: {
            top: "26%",
            left: "20%",
            transform: "rotate(-3deg)",
            zIndex: 5,
        },
    },
] as const satisfies readonly Postcard[];

export const CONCEPT_A_POSTCARD_CLASS = "concept-a-postcard";
export const CONCEPT_A_POSTCARD_STACK_CLASS = "concept-a-postcard-stack";
