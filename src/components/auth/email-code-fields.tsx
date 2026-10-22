import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineSpinner } from "@/components/ui/wait-state";
import { EMAIL_CODE_FIELD_LABEL, EMAIL_CODE_SUBMIT_LABEL } from "@/lib/auth/email-code-copy";

/** The 6-digit field and its submit button; the form around them belongs to the caller (AuthKit page, inline password step). */
export function EmailCodeFields({ isPending }: { isPending: boolean }) {
    return (
        <>
            <Field label={EMAIL_CODE_FIELD_LABEL} htmlFor="email-code">
                <Input
                    id="email-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={7}
                    disabled={isPending}
                    className="text-center font-mono text-lg"
                />
            </Field>
            <Button type="submit" disabled={isPending} className="w-full">
                {isPending && <InlineSpinner size={16} className="mr-2" />}
                {EMAIL_CODE_SUBMIT_LABEL}
            </Button>
        </>
    );
}
