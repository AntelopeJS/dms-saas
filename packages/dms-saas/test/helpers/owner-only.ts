import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { createUser, tenantRequest } from "./dms";
import { controllerRoutes, refusesAsOwnerOnly } from "./routes";

/**
 * The routes of `controller` the DMS refuses to a signed-in user who is not a
 * platform owner, by method name, sorted. Each of them is also checked to
 * let a platform owner past the same check; one that does not throws. Needs
 * `useMongoDatabase` and `useDmsAuth`.
 */
export async function ownerOnlyRoutes(controller: object): Promise<string[]> {
  const member = await tenantRequest(await createUser(), DEFAULT_TENANT_ID);
  const owner = await tenantRequest(
    await createUser({ owner: true }),
    DEFAULT_TENANT_ID,
  );
  const refused: string[] = [];
  for (const [name, route] of controllerRoutes(controller)) {
    if (!(await refusesAsOwnerOnly(route, member))) continue;
    if (await refusesAsOwnerOnly(route, owner))
      throw new Error(`${name} refuses platform owners too`);
    refused.push(name);
  }
  return refused.sort();
}
