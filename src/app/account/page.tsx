import { getServerUser } from "@/lib/auth/server-user";
import { redirect } from "next/navigation";

export default async function AccountPage() {
    const user = await getServerUser();

    if (!user) {
        redirect("/");
    }

    redirect("/settings?tab=account");
}
