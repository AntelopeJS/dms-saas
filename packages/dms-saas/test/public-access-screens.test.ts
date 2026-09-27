import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const pages = vi.hoisted(() => ({
  declared: [] as unknown[][],
  emptyLayout: { layout: "empty" },
}));

vi.mock("@antelopejs/interface-dms/page", () => ({
  PageController: (...args: unknown[]) => {
    pages.declared.push(args);
    return class {};
  },
  RegisterPage: () => () => undefined,
  pagesCategory: {},
}));

vi.mock("@antelopejs/interface-dms/base/layouts", () => ({
  EmptyLayout: () => pages.emptyLayout,
}));

vi.mock("@antelopejs/interface-dms/base/custom", () => {
  const component = { meta: () => component, options: () => component };
  return { CustomComponent: () => component };
});

interface PageOptions {
  publicAccess?: boolean;
}

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
    (slug) => {
      const [, options, layout] =
        pages.declared.find(([name]) => name === slug) ?? [];

      // The console layout's authenticated calls answer 401 to a visitor
      // without a session, which bounces them to the login screen before
      // they can read the terms they are asked to accept.
      expect((options as PageOptions | undefined)?.publicAccess).toBe(true);
      expect(layout).toBe(pages.emptyLayout);
    },
  );
});

describe("login page sign-up link", () => {
  const registered: AuthLink[] = [];

  async function runPlugin(admissionMode?: string): Promise<void> {
    vi.resetModules();
    registered.length = 0;
    vi.stubGlobal("defineDmsPlugin", (setup: PluginSetup) => setup);
    vi.stubGlobal("useDmsRuntimeConfig", () => ({
      public: { dmsSaas: { admissionMode } },
    }));
    vi.stubGlobal("registerAuthLink", (link: AuthLink) =>
      registered.push(link),
    );
    const plugin = await import("../frontend-vue/app/plugins/auth-links");
    (plugin.default as unknown as PluginSetup)();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers sign-up while registration is open", async () => {
    await runPlugin("open");

    expect(registered).toEqual([
      expect.objectContaining({ page: "login", to: "/register" }),
    ]);
  });

  it("hides it when admission is by invitation only", async () => {
    await runPlugin("invitation-only");

    expect(registered).toEqual([]);
  });
});
