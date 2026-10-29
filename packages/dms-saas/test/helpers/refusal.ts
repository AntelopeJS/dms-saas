import { HTTPResult } from "@antelopejs/interface-api";

/**
 * The HTTP refusal a pending call settles with. Fails the test when the call
 * succeeds, or when it is rejected with anything but an `HTTPResult`.
 *
 * @param settling The call under test; only how it is rejected is read
 */
export async function httpRefusal(
  settling: Promise<unknown>,
): Promise<HTTPResult> {
  try {
    await settling;
  } catch (error) {
    if (error instanceof HTTPResult) return error;
    throw error;
  }
  throw new Error("Expected an HTTP refusal, the call succeeded");
}
