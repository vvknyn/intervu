/** A machine token: lowercase letters/digits joined by "_" or "-", no spaces ("big_tech", "full_time").
 *  Free text ("Node.js", "United States") is not one and must pass through unchanged. */
const MACHINE_TOKEN = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/;
export const isMachineToken = (value: string): boolean => MACHINE_TOKEN.test(value);
