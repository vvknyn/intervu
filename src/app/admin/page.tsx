import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { getServerUser } from "@/lib/auth/server-user";
import { isAdminUser } from "@/lib/llm/credit-gate";

export default async function AdminPage() {
    const user = await getServerUser();
    if (!user) {
        redirect("/login?next=/admin"); // signup-gate-exempt: server redirect into the auth flow, not a rendered prompt
    }
    if (!(await isAdminUser(user))) {
        redirect("/");
    }

    return <AdminPanel />;
}
