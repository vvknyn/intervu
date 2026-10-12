import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contactValues, fieldKind, filledList, isConfirmation, type FieldHint } from "../../extension/src/form-fill";

function hint(over: Partial<FieldHint>): FieldHint {
    return { type: "text", autocomplete: "", name: "", id: "", label: "", placeholder: "", ...over };
}

describe("fieldKind: application form fields by what the form says about them", () => {
    it("reads the common applicant-tracking forms", () => {
        // Older one-page boards: job_application[...] names.
        assert.equal(fieldKind(hint({ name: "job_application[first_name]", id: "first_name", label: "First Name *" })), "firstName");
        assert.equal(fieldKind(hint({ name: "job_application[last_name]", label: "Last Name *" })), "lastName");
        assert.equal(fieldKind(hint({ name: "job_application[email]", label: "Email *" })), "email");
        assert.equal(fieldKind(hint({ name: "job_application[phone]", label: "Phone" })), "phone");
        assert.equal(fieldKind(hint({ type: "file", id: "resume", label: "" })), "resume");
        // "Full name✱" with a name="name" input; urls[...] link fields.
        assert.equal(fieldKind(hint({ name: "name", label: "Full name✱" })), "fullName");
        assert.equal(fieldKind(hint({ name: "urls[LinkedIn]", label: "LinkedIn URL" })), "linkedin");
        assert.equal(fieldKind(hint({ name: "urls[GitHub]", label: "GitHub URL" })), "github");
        assert.equal(fieldKind(hint({ name: "urls[Portfolio]", label: "Portfolio URL" })), "website");
        assert.equal(fieldKind(hint({ name: "urls[Other]", label: "Other website" })), "website");
        assert.equal(fieldKind(hint({ name: "location", label: "Current location" })), "location");
        // System-field names with no label of their own.
        assert.equal(fieldKind(hint({ name: "_systemfield_name" })), "fullName");
        assert.equal(fieldKind(hint({ type: "email", name: "_systemfield_email" })), "email");
        assert.equal(fieldKind(hint({ type: "file", id: "_systemfield_resume" })), "resume");
        // Multi-step forms with ids such as legalNameSection_firstName.
        assert.equal(fieldKind(hint({ id: "legalNameSection_firstName", label: "Given Name(s)" })), "firstName");
        assert.equal(fieldKind(hint({ id: "legalNameSection_lastName", label: "Family Name" })), "lastName");
        assert.equal(fieldKind(hint({ id: "addressSection_city", label: "City" })), "city");
        assert.equal(fieldKind(hint({ type: "tel", id: "phoneNumber", label: "Phone Number" })), "phone");
    });

    it("trusts the browser's autocomplete tokens", () => {
        assert.equal(fieldKind(hint({ autocomplete: "given-name", label: "Prénom" })), "firstName");
        assert.equal(fieldKind(hint({ autocomplete: "section-a family-name" })), "lastName");
        assert.equal(fieldKind(hint({ autocomplete: "tel", label: "Téléphone" })), "phone");
    });

    it("leaves other people's details and other kinds of names alone", () => {
        for (const label of ["Referrer's email", "Name of the person who referred you", "Emergency contact phone", "Hiring manager name", "Company name", "Preferred first name", "Middle name", "School name", "Name of your current employer"]) {
            assert.equal(fieldKind(hint({ label })), null, label);
        }
        assert.equal(fieldKind(hint({ type: "tel", label: "Phone extension" })), null);
        assert.equal(fieldKind(hint({ label: "Preferred work location" })), null);
        assert.equal(fieldKind(hint({ label: "Are you willing to relocate? Which city?" })), null);
    });

    it("attaches the résumé only to a résumé upload", () => {
        assert.equal(fieldKind(hint({ type: "file", label: "Resume/CV" })), "resume");
        assert.equal(fieldKind(hint({ type: "file", label: "Curriculum vitae" })), "resume");
        assert.equal(fieldKind(hint({ type: "file", label: "Cover Letter" })), null);
        assert.equal(fieldKind(hint({ type: "file", label: "Upload your resume or cover letter" })), null);
        assert.equal(fieldKind(hint({ type: "file", label: "Transcript" })), null);
    });

    it("never touches drop-downs, dates, numbers, passwords or check boxes", () => {
        for (const type of ["password", "checkbox", "radio", "date", "number", "hidden"]) assert.equal(fieldKind(hint({ type, label: "Email" })), null, type);
    });
});

describe("contactValues: what each field gets from the résumé", () => {
    const profile = { name: "Jordan Lee", email: "jordan.lee@example.com", phone: "416-555-0100", location: "Toronto, ON, Canada", linkedin: "linkedin.com/in/jordanlee", website: "" };

    it("splits the name and keeps the contact lines as written", () => {
        const v = contactValues(profile);
        assert.equal(v.fullName, "Jordan Lee");
        assert.equal(v.firstName, "Jordan");
        assert.equal(v.lastName, "Lee");
        assert.equal(v.email, "jordan.lee@example.com");
        assert.equal(v.phone, "416-555-0100");
        assert.equal(v.location, "Toronto, ON, Canada");
        assert.equal(v.city, "Toronto");
        assert.equal(v.linkedin, "https://linkedin.com/in/jordanlee");
        assert.equal(v.website, undefined);
    });

    it("keeps a particle with the last name and fixes an all-caps heading", () => {
        const v = contactValues({ ...profile, name: "MARIA VAN DER BERG" });
        assert.equal(v.firstName, "Maria");
        assert.equal(v.lastName, "Van Der Berg");
        const mixed = contactValues({ ...profile, name: "Anne-Marie de la Cruz" });
        assert.equal(mixed.firstName, "Anne-Marie");
        assert.equal(mixed.lastName, "de la Cruz");
    });

    it("leaves out what the résumé doesn't have", () => {
        const v = contactValues({ name: "Priya", email: "", phone: "", location: "", linkedin: undefined, website: "github.com/priya" });
        assert.equal(v.fullName, "Priya");
        assert.equal(v.firstName, undefined);
        assert.equal(v.email, undefined);
        assert.equal(v.github, "https://github.com/priya");
        assert.equal(v.website, "https://github.com/priya");
    });
});

describe("isConfirmation: the site says the application went through", () => {
    it("reads common thank-you pages", () => {
        for (const text of ["Thank you for applying to Cedarbrook Health!", "Application submitted", "Your application has been received.", "We've received your application", "Thanks for your application"]) {
            assert.equal(isConfirmation(text), true, text);
        }
    });
    it("doesn't take a job page's own words for one", () => {
        for (const text of ["Thank you for your interest in Cedarbrook Health.", "Submit application", "Apply for this job", "Application deadline: November 15"]) {
            assert.equal(isConfirmation(text), false, text);
        }
    });
});

describe("filledList", () => {
    it("names what was filled once each", () => {
        assert.equal(filledList(["firstName", "lastName", "email", "phone", "resume"]), "name, email, phone and résumé PDF");
        assert.equal(filledList(["resume", "fullName", "email", "location"]), "name, email, location and résumé PDF");
        assert.equal(filledList(["email"]), "email");
        assert.equal(filledList([]), "");
    });
});
