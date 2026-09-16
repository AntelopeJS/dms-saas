import type { DmsSaasConfig, PublicScreenId } from "../../types";

type PublicScreenLoader = () => Promise<unknown>;

const PUBLIC_SCREEN_LOADERS: Record<PublicScreenId, PublicScreenLoader> = {
  register: () => import("./register"),
};

/**
 * Public screens the running configuration wants dms-saas to serve.
 *
 * Every screen ships enabled: a consumer opts out of one by setting it to
 * `false`, never by declaring a page on the same slug — page registration is
 * keyed by slug, so two declarations race instead of overriding.
 *
 * @param config Module configuration
 * @returns Ids of the screens to register, in declaration order
 */
export function resolvePublicScreensToRegister(
  config: DmsSaasConfig,
): PublicScreenId[] {
  const ids = Object.keys(PUBLIC_SCREEN_LOADERS) as PublicScreenId[];
  return ids.filter((id) => config.publicScreens?.[id] !== false);
}

/**
 * Register the bundled public screens the configuration keeps.
 *
 * Loading is deferred to this call: a page registers itself on import, so a
 * screen the consumer replaced must never be imported at module load.
 *
 * @param config Module configuration
 */
export async function registerPublicScreens(
  config: DmsSaasConfig,
): Promise<void> {
  for (const id of resolvePublicScreensToRegister(config)) {
    await PUBLIC_SCREEN_LOADERS[id]();
  }
}
