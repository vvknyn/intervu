import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
    Frame,
    FramePanel,
    FrameHeader,
    FrameTitle,
    FrameDescription,
    FrameFooter,
} from "@/components/ui/frame";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    InputGroupText,
} from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Checkbox, CheckboxChoice } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem, RadioChoice } from "@/components/ui/radio-group";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
} from "@/components/ui/table";
import {
    Empty,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription,
    EmptyContent,
} from "@/components/ui/empty";
import { TrackerTableView } from "@/components/tracker/TrackerTableView";
import type { Pursuit } from "@/lib/pursuits/types";

const ROOT = path.resolve(__dirname, "../..");

describe("coss ui registry & primitives integration", () => {
    it("registers @coss in components.json", () => {
        const raw = JSON.parse(readFileSync(path.join(ROOT, "components.json"), "utf8"));
        assert.equal(raw.registries?.["@coss"], "https://coss.com/ui/r/{name}.json");
    });

    it("renders Frame and compound slots with semantic border and surface tokens", () => {
        const html = renderToStaticMarkup(
            <Frame>
                <FrameHeader>
                    <FrameTitle>Applications</FrameTitle>
                    <FrameDescription>Active pursuits</FrameDescription>
                </FrameHeader>
                <FramePanel>Body</FramePanel>
                <FrameFooter>Footer</FrameFooter>
            </Frame>,
        );
        assert.match(html, /data-slot="frame"/);
        assert.match(html, /data-slot="frame-panel"/);
        assert.match(html, /rounded-panel/);
        assert.match(html, /bg-muted/);
        assert.match(html, /bg-surface/);
    });

    it("renders InputGroup on ctl-lg default and ctl-md sm, supporting asChild inputs and Kbd", () => {
        const defaultHtml = renderToStaticMarkup(
            <InputGroup>
                <InputGroupAddon>
                    <InputGroupText>$</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput aria-label="Amount" />
                <InputGroupAddon align="inline-end">
                    <KbdGroup>
                        <Kbd>/</Kbd>
                    </KbdGroup>
                </InputGroupAddon>
            </InputGroup>,
        );
        assert.match(defaultHtml, /ctl-lg/);
        assert.match(defaultHtml, /data-slot="input-group"/);
        assert.match(defaultHtml, /data-slot="kbd"/);

        const smAsChildHtml = renderToStaticMarkup(
            <InputGroup size="sm">
                <InputGroupInput asChild>
                    <input type="text" data-testid="custom-child-input" defaultValue="120000" />
                </InputGroupInput>
            </InputGroup>,
        );
        assert.match(smAsChildHtml, /ctl-md/);
        assert.match(smAsChildHtml, /data-testid="custom-child-input"/);
    });

    it("renders Checkbox, CheckboxChoice, RadioGroup, and RadioChoice without raw accent-brand inputs", () => {
        const choiceHtml = renderToStaticMarkup(
            <div>
                <Checkbox aria-label="Remote" defaultChecked />
                <CheckboxChoice checked readOnly aria-label="Full-time" />
                <RadioGroup defaultValue="any">
                    <RadioGroupItem value="any" aria-label="Any date" />
                </RadioGroup>
                <RadioChoice name="date" checked readOnly aria-label="Past week" />
            </div>,
        );
        assert.match(choiceHtml, /data-slot="checkbox"/);
        assert.match(choiceHtml, /data-slot="checkbox-choice-box"/);
        assert.match(choiceHtml, /data-slot="radio-group"/);
        assert.match(choiceHtml, /data-slot="radio-choice-circle"/);
        assert.match(choiceHtml, /ctl-check/);
        assert.doesNotMatch(choiceHtml, /accent-brand/);
    });

    it("renders Field in both shorthand label mode and compound description/error mode", () => {
        const withDescription = renderToStaticMarkup(
            <Field label="Target role" htmlFor="role" description="Shown on your profile">
                <input id="role" type="text" />
            </Field>,
        );
        assert.match(withDescription, /for="role"/);
        assert.match(withDescription, /data-slot="field-description"/);

        const withError = renderToStaticMarkup(
            <Field label="Target role" htmlFor="role" description="Shown on your profile" error="Required">
                <input id="role" type="text" />
            </Field>,
        );
        assert.match(withError, /role="alert"/);
        assert.doesNotMatch(withError, /data-slot="field-description"/);

        const compound = renderToStaticMarkup(
            <Field invalid>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <FieldDescription>Work or personal</FieldDescription>
                <FieldError>Invalid address</FieldError>
            </Field>,
        );
        assert.match(compound, /data-invalid=""/);
        assert.match(compound, /Invalid address/);
    });

    it("renders Table, Empty, and TrackerTableView for both empty and populated states", () => {
        const emptyHtml = renderToStaticMarkup(
            <TrackerTableView
                pursuits={[]}
                selectedId={null}
                detailOpen={false}
                onRowClick={() => {}}
            />,
        );
        assert.match(emptyHtml, /data-slot="empty"/);
        assert.match(emptyHtml, /No tracked roles\./);

        const samplePursuit: Pursuit = {
            id: "p-1",
            user_id: "u-1",
            position: "Staff Product Designer",
            company_name: "Linear",
            status: "interviewing",
            resume_version: { version_name: "Design Systems v3" },
            created_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
            updated_at: new Date().toISOString(),
        };

        const tableHtml = renderToStaticMarkup(
            <TrackerTableView
                pursuits={[samplePursuit]}
                selectedId="p-1"
                detailOpen
                onRowClick={() => {}}
            />,
        );
        assert.match(tableHtml, /data-testid="tracker-table"/);
        assert.match(tableHtml, /data-slot="table"/);
        assert.match(tableHtml, /data-state="selected"/);
        assert.match(tableHtml, /Staff Product Designer/);
        assert.match(tableHtml, /Linear/);

        const directTable = renderToStaticMarkup(
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Role</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow>
                        <TableCell>
                            <Empty>
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">*</EmptyMedia>
                                    <EmptyTitle>None</EmptyTitle>
                                    <EmptyDescription>Add one</EmptyDescription>
                                </EmptyHeader>
                                <EmptyContent>CTA</EmptyContent>
                            </Empty>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>,
        );
        assert.match(directTable, /data-slot="empty-media"/);
    });

    it("guards TrackerKanbanBoard tablet scroll-snap before xl 5-column expansion", () => {
        const kanbanSrc = readFileSync(
            path.join(ROOT, "src/components/tracker/TrackerKanbanBoard.tsx"),
            "utf8",
        );
        assert.match(kanbanSrc, /md:grid-flow-col/);
        assert.match(kanbanSrc, /md:min-w-56/);
        assert.match(kanbanSrc, /xl:grid-cols-5/);
    });
});
