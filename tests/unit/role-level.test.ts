/**
 * What a title and a résumé say about managing people (role-level.ts). A
 * people manager's role is a Stretch for a résumé that shows no one managed
 * (score.ts `newToManaging`), so leading the work, mentoring, or managing
 * accounts, budgets or projects must not read as managing people, and a title
 * that names a kind of work ("Customer Success Manager") is not a manager's.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumeManagedPeople, titleManagesPeople } from '../../src/lib/jobs/role-level';
import type { ResumeData } from '../../src/types/resume';

const resume = (description: string, role = 'Engineer'): ResumeData =>
    ({
        profile: { name: '', profession: '', yearsOfExperience: 5, location: '', email: '', phone: '', linkedin: '', website: '' },
        experience: [{ id: 'e0', company: 'Somewhere', role, dates: 'Jan 2021 - Present', description }],
        competencies: [],
        education: [],
        generatedSummary: '',
    }) as ResumeData;

describe('titleManagesPeople', () => {
    it('reads a people manager\'s title', () => {
        for (const title of [
            'Manager, Customer Success (Enterprise)',
            'Senior Manager, Customer Success',
            'Assistant Manager - Retail',
            'Director, Customer Success',
            'Head of Support',
            'VP Sales',
            'Shift Supervisor',
            'Engineering Manager',
            'Senior Engineering Manager',
            'Store Manager',
            'Nurse Manager',
            'Sous Chef',
        ]) assert.equal(titleManagesPeople(title), true, title);
    });

    it('does not read a title for a kind of work, or one that leads the work', () => {
        for (const title of [
            'Customer Success Manager',
            'Technical Account Manager',
            'Product Manager',
            'Senior Product Manager',
            'Program Manager',
            'Marketing Manager',
            'Case Manager',
            'Property Manager',
            'Team Lead',
            'Technology Lead',
            'Lead Software Engineer',
            'Registered Nurse',
        ]) assert.equal(titleManagesPeople(title), false, title);
    });
});

describe('resumeManagedPeople', () => {
    it('reads lines that say people were managed', () => {
        for (const line of [
            'Managed a team of 6 engineers.',
            'Supervised 12 staff across two shifts.',
            'Managed 8 direct reports.',
            'Hired and managed 4 designers',
            'Oversaw the support team.',
            'Oversaw the 24-hour support team',
            'People management',
        ]) assert.equal(resumeManagedPeople(resume(line)), true, line);
        assert.equal(resumeManagedPeople(resume('Ran the front counter.', 'Shift Supervisor')), true);
    });

    it('does not read leading the work, mentoring, or managing things', () => {
        for (const line of [
            'Led an 8-person team as the primary client-facing lead.',
            'Mentored team of 5 engineers',
            'Managed 4+ concurrent SOWs (~800 hours)',
            'Manage calendars and travel for three executives.',
            'Supervised road and drainage works for a 12 km highway',
            'managing cross-functional teams',
            'Managed a cross-functional team of 8',
            'Managed the client project team',
            'Managed a team of stakeholders',
            'Currently manage a $1.7M ARR, 2-account portfolio',
            'Stakeholder Management, SLA Management',
        ]) assert.equal(resumeManagedPeople(resume(line)), false, line);
        assert.equal(resumeManagedPeople(resume('Led the release train.', 'Team Lead')), false);
    });
});
