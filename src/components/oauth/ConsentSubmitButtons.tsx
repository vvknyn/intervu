"use client";

import { useFormStatus } from "react-dom";
import {  } from "@phosphor-icons/react";
import { InlineSpinner } from "@/components/ui/wait-state";
import { Button } from "@/components/ui/button";

function ConsentSubmitButton({
    label,
    pendingLabel,
    variant,
}: {
    label: string;
    pendingLabel: string;
    variant?: "outline";
}) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" variant={variant} className="w-full" disabled={pending}>
            {pending && <InlineSpinner size={16} className="mr-2" />}
            {pending ? pendingLabel : label}
        </Button>
    );
}

export function ConsentAllowButton() {
    return <ConsentSubmitButton label="Allow" pendingLabel="Allowing…" />;
}

export function ConsentDenyButton() {
    return <ConsentSubmitButton label="Deny" pendingLabel="Denying…" variant="outline" />;
}
