import { ImplementInterface } from "@antelopejs/interface-core";
import {
  internal,
  type PermissionsResolverInfo,
} from "@antelopejs/interface-dms/permissions-resolver";

/**
 * Stands in for the DMS runtime behind
 * `@antelopejs/interface-dms/permissions-resolver`: its registering proxy
 * keeps each resolver registered through it, in order, including those
 * registered before the call, which the proxy replays.
 */
export function implementPermissionsResolvers(): PermissionsResolverInfo[] {
  const registered: PermissionsResolverInfo[] = [];
  ImplementInterface(internal, {
    RegisterPermissionsResolver: {
      register: (info) => registered.push(info),
      unregister: (info) => {
        registered.splice(registered.indexOf(info), 1);
      },
    },
  });
  return registered;
}

/** The resolver registered under `id`; throws when none is. */
export function registeredResolver(
  registered: PermissionsResolverInfo[],
  id: string,
): PermissionsResolverInfo {
  const info = registered.find((resolver) => resolver.id === id);
  if (!info) throw new Error(`No permissions resolver is registered as ${id}`);
  return info;
}
