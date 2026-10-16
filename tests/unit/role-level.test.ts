/**
 * What a title and a résumé say about managing people (role-level.ts). A
 * people manager's role is a Stretch for a résumé that shows no one managed
 * (score.ts `newToManaging`), so leading the work, mentoring, or managing
 * accounts, budgets or projects must not read as managing people, and a title
 * that names a kind of work ("Customer Success Manager") is not a manager's.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listedPastSenior, resumeHoldsPastSenior, resumeManagedPeople, titleManagesPeople, titlePastSenior } from '../../src/lib/jobs/role-level';
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

describe('a title that ranks past Senior (Staff, Principal, Director...)', () => {
    it('reads the individual-contributor and leadership rungs above Senior', () => {
        for (const title of [
            'Staff Software Engineer',
            'Staff Product Manager',
            'Staff Technical Account Manager',
            'Staff Product Manager (B2B Solutions)',
            'Senior Staff Engineer',
            'Software Engineer, Staff',
            'Principal Product Manager',
            'Distinguished Engineer',
            'Group Product Manager',
            'Director, Customer Success',
            'Head of Support',
            'VP Sales',
            'Vice President of Engineering',
            'Engineering - Staff Machine Learning Engineer',
            'Développeur de données senior, niveau 2/Staff Data Developer',
        ]) {
            assert.equal(titlePastSenior(title), true, title);
        }
    });

    it('leaves ordinary grades and senior titles alone', () => {
        for (const title of [
            'Staff Accountant',
            'Staff Nurse',
            'Staff Attorney',
            'Staff Services Manager',
            'Staff Development Manager',
            'Support Staff Manager',
            'Vice Principal',
            'Assistant Principal',
            'Principal Investigator',
            'Research Fellow',
            'Senior Manager, Customer Success',
            'Senior Product Manager',
            'Lead Software Engineer',
            'Technical Account Manager',
            'Software Engineer III',
        ]) {
            assert.equal(titlePastSenior(title), false, title);
        }
    });

    it('a listing marked Executive is past Senior whatever its title says', () => {
        assert.equal(listedPastSenior('executive'), true);
        assert.equal(listedPastSenior(' Executive '), true);
        for (const level of ['senior', 'lead', 'mid', 'unknown', null, undefined]) assert.equal(listedPastSenior(level), false, String(level));
    });

    it('a résumé shows such a role only by a title it held', () => {
        assert.equal(resumeHoldsPastSenior(resume('Led the account team', 'Staff Engineer')), true);
        assert.equal(resumeHoldsPastSenior(resume('Led the account team', 'Director of Customer Success')), true);
        assert.equal(resumeHoldsPastSenior(resume('Led the account team', 'Team Lead')), false);
        assert.equal(resumeHoldsPastSenior(resume('Worked alongside the Director of Sales', 'Technical Account Manager')), false);
        assert.equal(resumeHoldsPastSenior(null), false);
    });
});
