import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { GetPageLayoutBySlug } from "@antelopejs/interface-dms/page";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { implementPageRegistry, registered } from "./helpers/pages";

const registry = implementPageRegistry();

interface AuthLink {
  id: string;
  page: string;
  to: string;
}

type PluginSetup = () => void;

const LEGAL_SLUGS = ["privacy-policy", "terms-and-conditions", "terms-of-use"];

describe("legal pages", () => {
  beforeAll(async () => {
    await import("../src/pages/public/legal");
  });

  it.each(LEGAL_SLUGS)(
    "serves /%s to anonymous visitors, outside the console shell",
    async (slug) => {
      const page = registered(registry.pages).find(({ id }) => id === slug);
      const servePage = GetPageLayoutBySlug(`/${slug}`);

      expect(page?.publicAccess).toBe(true);
      await expect(
        servePage?.(
          fromPartial({ user: undefined, tenantId: DEFAULT_TENANT_ID }),
        ),
      ).resolves.toMatchObject({ layout: EmptyLayout() });
    },
  );
});

describe("login page sign-up link", () => {
  const registered: AuthLink[] = [];
  const setups: PluginSetup[] = [];

  async function runPlugin(
    admissionMode?: string,
    publicScreens?: string[],
  ): Promise<void> {
    vi.resetModules();
    registered.length = 0;
    setups.length = 0;
    vi.stubGlobal("defineDmsPlugin", (setup: PluginSetup) => {
      setups.push(setup);
      return setup;
    });
    vi.stubGlobal("useDmsRuntimeConfig", () => ({
      public: { dmsSaas: { admissionMode, publicScreens } },
    }));
    vi.stubGlobal("registerAuthLink", (link: AuthLink) =>
      registered.push(link),
    );
    await import("../frontend-vue/app/plugins/auth-links");
    const [setup] = setups;
    if (!setup) throw new Error("The plugin never called defineDmsPlugin");
    setup();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers sign-up and pricing while registration is open", async () => {
    await runPlugin("open");

    expect(registered).toEqual([
      expect.objectContaining({ page: "login", to: "/register" }),
      expect.objectContaining({ page: "login", to: "/pricing" }),
    ]);
  });

  it("hides sign-up when admission is by invitation only", async () => {
    await runPlugin("invitation-only");

    expect(registered.map((link) => link.to)).toEqual(["/pricing"]);
  });

  it("links only to the bundled screens the deployment serves", async () => {
    await runPlugin("open", ["pricing"]);

    expect(registered.map((link) => link.to)).toEqual(["/pricing"]);

    await runPlugin("open", []);

    expect(registered).toEqual([]);
  });
});
