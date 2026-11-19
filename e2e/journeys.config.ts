import type { JourneysConfig } from "@antelopejs/dms/e2e";

export default {
  playground: "e2e/playground",
  prepare: [
    [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    ["pnpm", "e2e:build"],
  ],
  smoke: "smoke",
} satisfies JourneysConfig;
