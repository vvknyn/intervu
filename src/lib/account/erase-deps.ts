/**
 * The real wiring behind `eraseAccount`, shared by the Delete account action
 * and the orphan-account erase script so neither carries a copy.
 *
 * The WorkOS client is passed in: the app reaches it through authkit
 * (getWorkosUserManagement), the one-off script builds it from the API key.
 */
import { deleteLegacyFirebaseUser, getAdminDb } from "@/lib/firebase/admin";
import { isWorkosNotFound } from "@/lib/auth/workos-errors";
import { resolveWorkosUserId, type WorkosUserManagement } from "@/lib/auth/workos-runtime";
import { getIntervuPg, getTelemetryForgetPg } from "@/lib/pg/pool";

import {
    deletePosthogPerson,
    deleteStripeCustomer,
    eraseIdentityStore,
    eraseMirrorStore,
    erasePgRows,
    eraseTelemetry,
    findStripeCustomerByUid,
    storeEraseDeps,
    type EraseAccountDeps,
    type ProcessorStatus,
} from "./erase-account";

/** Deletes the WorkOS user for a uid; "not-found" when WorkOS has none (already gone, or never existed). */
export async function deleteWorkosSignIn(
    userManagement: Pick<WorkosUserManagement, "getUserByExternalId" | "deleteUser">,
    uid: string,
): Promise<ProcessorStatus> {
    try {
        const workosUserId = await resolveWorkosUserId((externalId) => userManagement.getUserByExternalId(externalId), uid);
        await userManagement.deleteUser(workosUserId);
        return "deleted";
    } catch (error) {
        if (isWorkosNotFound(error)) return "not-found";
        throw error;
    }
}

export function realEraseDeps(getUserManagement: () => Promise<WorkosUserManagement>): EraseAccountDeps {
    const telemetryPg = getTelemetryForgetPg();
    return {
        ...storeEraseDeps(getAdminDb()),
        eraseMirrorStore,
        findStripeCustomerByUid: (uid) => findStripeCustomerByUid(uid),
        deleteStripeCustomer: (customerId) => deleteStripeCustomer(customerId),
        deletePgRows: (uid) => erasePgRows(getIntervuPg(), uid),
        deleteTelemetry: (uid) => eraseTelemetry(telemetryPg, uid),
        deleteAnalyticsPerson: (uid) => deletePosthogPerson(uid),
        deleteLegacySignIn: (uid) => deleteLegacyFirebaseUser(uid),
        async deleteSignIn(uid) {
            return deleteWorkosSignIn(await getUserManagement(), uid);
        },
        // The ledger rows went by uid already; WorkOS no longer knows the
        // address by now, so forgetIdentity's own lookup would find nobody.
        eraseIdentityStore: (uid, email) => eraseIdentityStore(getIntervuPg(), uid, email),
        logError: (message) => console.error(message),
    };
}
