import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import type { z } from "zod";

/** The longest workspace or user id an action input takes. */
export const ID_MAX_LENGTH = 100;

/**
 * Runs an action body so that what it throws fails the step with a readable
 * message prefixed by the action id: an `HTTPResult` from a module service
 * shows its message key and status instead of an object.
 */
export async function asStep<T>(
  actionId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HTTPResult)
      throw new Error(
        `${actionId}: ${error.getBody()} (HTTP ${error.getStatus()})`,
      );
    if (error instanceof Error && !error.message.startsWith(`${actionId}:`))
      throw new Error(`${actionId}: ${error.message}`, { cause: error });
    throw error;
  }
}

/** Parses a step's input, failing the step with the first invalid field. */
export function parseActionInput<I, T>(
  actionId: string,
  schema: z.ZodType<T, z.ZodTypeDef, I>,
  input: I,
): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") || "input";
  throw new Error(`${actionId}: ${field}: ${issue?.message ?? "invalid"}`);
}

/** Fails the step for a workspace that has no tenant row. */
export async function requireWorkspace(tenantId: string): Promise<void> {
  if (!(await GetModel(TenantModel).get(tenantId)))
    throw new Error(`unknown workspace "${tenantId}"`);
}
