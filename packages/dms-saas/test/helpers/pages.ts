import { ImplementInterface } from "@antelopejs/interface-core";
import {
  type CategoryInfo,
  type DynamicMenuProviderInfo,
  internal,
  type ModuleInfo,
  type PageExtensionInfo,
  type PageInfo,
} from "@antelopejs/interface-dms/page";
import { type Mock, vi } from "vitest";

/** A registering proxy of the DMS page registry, observed by a test. */
interface ObservedProxy<T> {
  register: Mock<(info: T) => void>;
  unregister: Mock<(info: T) => void>;
}

/**
 * What modules registered with the DMS page registry, in order, through its
 * own registering proxies.
 */
export interface PageRegistry {
  categories: ObservedProxy<CategoryInfo>;
  pages: ObservedProxy<PageInfo>;
  modules: ObservedProxy<ModuleInfo>;
  menuProviders: ObservedProxy<DynamicMenuProviderInfo>;
  pageExtensions: ObservedProxy<PageExtensionInfo>;
}

function observedProxy<T>(): ObservedProxy<T> {
  return {
    register: vi.fn<(info: T) => void>(),
    unregister: vi.fn<(info: T) => void>(),
  };
}

/** The values each registration of `proxy` handed over, in order. */
export function registered<T>(proxy: ObservedProxy<T>): T[] {
  return proxy.register.mock.calls.map(([info]) => info);
}

/**
 * Stands in for the DMS runtime behind `@antelopejs/interface-dms/page`: its
 * registering proxies record each registration, including those made before
 * the call, which the proxies replay.
 */
export function implementPageRegistry(): PageRegistry {
  const registry: PageRegistry = {
    categories: observedProxy(),
    pages: observedProxy(),
    modules: observedProxy(),
    menuProviders: observedProxy(),
    pageExtensions: observedProxy(),
  };
  ImplementInterface(internal, {
    RegisterCategory: registry.categories,
    RegisterPage: registry.pages,
    RegisterModule: registry.modules,
    RegisterDynamicMenuProvider: registry.menuProviders,
    RegisterPageExtension: registry.pageExtensions,
  });
  return registry;
}
