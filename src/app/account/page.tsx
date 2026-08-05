import { getServerUser } from "@/lib/firebase/auth-session";
import { redirect } from "next/navigation";

export default async function AccountPage() {
    const user = await getServerUser();

    if (!user) {
        redirect("/");
    }

    redirect("/settings?tab=account");
}
