import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backendBoundary } from "../frontend-vue/build/backend-boundary.ts";

let root: string;

function write(file: string, text: string): void {
  const path = join(root, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function manifest(directory: string, name: string): void {
  write(`${directory}/package.json`, JSON.stringify({ name }));
}

/**
 * A frontend entry with `source` as its only import, built for real.
 *
 * @param source The import the entry makes
 * @param extra Plugins registered after the boundary
 * @param external The build's `external` option, if any
 */
async function buildEntry(
  source: string,
  extra: Plugin[] = [],
  external?: (id: string) => boolean,
): Promise<void> {
  write(
    "frontend/entry.ts",
    `import "${source}";\nexport const frontend = 1;\n`,
  );
  await build({
    root: join(root, "frontend"),
    configFile: false,
    logLevel: "silent",
    plugins: [backendBoundary(), ...extra],
    build: {
      write: false,
      lib: { entry: join(root, "frontend/entry.ts"), formats: ["es"] },
      rollupOptions: external ? { external } : undefined,
    },
  });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "dms-saas-boundary-")));
  manifest("backend", "@antelopejs/dms-saas");
  write("backend/src/routes/status.ts", "export const status = 1;\n");
  write("backend/dist/index.js", "export const built = 1;\n");
  write("backend/srcfoo/index.ts", "export const sibling = 1;\n");
  write("backend/dist/src/index.js", "export const builtSource = 1;\n");
  manifest("backend/frontend-vue", "@antelopejs/dms-saas-frontend-vue");
  write("backend/frontend-vue/src/screen.ts", "export const screen = 1;\n");
  manifest("other", "another-package");
  write("other/src/index.ts", "export const other = 1;\n");
  manifest("frontend", "@antelopejs/dms-saas-frontend-vue");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the backend boundary of a real build", () => {
  it("fails when the frontend imports a file under the backend's src", async () => {
    await expect(buildEntry("../backend/src/routes/status.ts")).rejects.toThrow(
      /frontend\/entry\.ts imports .*backend\/src\/routes\/status\.ts/,
    );
  });

  it("fails when the import carries a query", async () => {
    await expect(
      buildEntry("../backend/src/routes/status.ts?raw"),
    ).rejects.toThrow(/Backend boundary/);
  });

  it("follows a symlink a resolver returns to the file it points at", async () => {
    symlinkSync(
      join(root, "backend/src/routes"),
      join(root, "frontend/routes"),
    );
    const linked: Plugin = {
      name: "test:linked",
      enforce: "pre",
      resolveId: (source) =>
        source === "@linked/status"
          ? join(root, "frontend/routes/status.ts")
          : null,
    };
    await expect(buildEntry("@linked/status", [linked])).rejects.toThrow(
      /backend\/src\/routes\/status\.ts/,
    );
  });

  it("sees through an alias another plugin resolves", async () => {
    const alias: Plugin = {
      name: "test:alias",
      enforce: "pre",
      resolveId: (source) =>
        source === "@backend/status"
          ? join(root, "backend/src/routes/status.ts")
          : null,
    };
    await expect(buildEntry("@backend/status", [alias])).rejects.toThrow(
      /Backend boundary/,
    );
  });

  it("lets the backend's built output through", async () => {
    await expect(
      buildEntry("../backend/dist/index.js"),
    ).resolves.toBeUndefined();
  });

  it("lets a sibling directory whose name starts with src through", async () => {
    await expect(
      buildEntry("../backend/srcfoo/index.ts"),
    ).resolves.toBeUndefined();
  });

  it("lets the src of a package nested in the backend's directory through", async () => {
    await expect(
      buildEntry("../backend/frontend-vue/src/screen.ts"),
    ).resolves.toBeUndefined();
  });

  it("fails when a resolver answers a backend source file with a hash", async () => {
    const hashed: Plugin = {
      name: "test:hashed",
      enforce: "pre",
      resolveId: (source) =>
        source === "@hashed/status"
          ? `${join(root, "backend/src/routes/status.ts")}#fragment`
          : null,
      load: (id) =>
        id.endsWith("#fragment") ? "export const status = 1;" : null,
    };
    await expect(buildEntry("@hashed/status", [hashed])).rejects.toThrow(
      /Backend boundary/,
    );
  });

  it("fails when the import itself carries a hash", async () => {
    await expect(
      buildEntry("../backend/src/routes/status.ts#fragment"),
    ).rejects.toThrow(/Backend boundary/);
  });

  it("fails when a resolver marks a backend source file external", async () => {
    const external: Plugin = {
      name: "test:external",
      enforce: "pre",
      resolveId: (source) =>
        source === "@external/status"
          ? { id: join(root, "backend/src/routes/status.ts"), external: true }
          : null,
    };
    await expect(buildEntry("@external/status", [external])).rejects.toThrow(
      /Backend boundary/,
    );
  });

  it("fails when the build's external option matches the resolved backend file", async () => {
    await expect(
      buildEntry("../backend/src/routes/status.ts", [], (id) =>
        id.startsWith(join(root, "backend/src/")),
      ),
    ).rejects.toThrow(/Backend boundary/);
  });

  it("lets a src directory inside the backend's built output through", async () => {
    await expect(
      buildEntry("../backend/dist/src/index.js"),
    ).resolves.toBeUndefined();
  });

  it("lets the src of another package through", async () => {
    await expect(buildEntry("../other/src/index.ts")).resolves.toBeUndefined();
  });

  it("ignores a virtual module", async () => {
    const virtual: Plugin = {
      name: "test:virtual",
      enforce: "pre",
      resolveId: (source) => (source === "virtual:ok" ? "\0virtual:ok" : null),
      load: (id) => (id === "\0virtual:ok" ? "export const v = 1;" : null),
    };
    await expect(buildEntry("virtual:ok", [virtual])).resolves.toBeUndefined();
  });
});
