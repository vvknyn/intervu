import { prettyEnum } from "@/lib/jobs/presentation";

/** A machine token: lowercase letters/digits joined by "_" or "-", no spaces ("big_tech", "ai-infra").
 *  Free text ("Node.js", "United States") is not one and must pass through unchanged. */
const MACHINE_TOKEN = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/;

/** A machine token as /jobs shows it (`prettyEnum`, with "-" a word separator too); anything else unchanged. */
export const machineTokenLabel = (value: string): string =>
  MACHINE_TOKEN.test(value) ? prettyEnum(value.replace(/-/g, "_")) : value;
