import { resolve } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(__dirname, ".env") });

// The dev frontend (`ajs dms dev`) is a separate CLI process, not an Antelope
// module, so its origins cannot be published as config variables.
const CLIENT_HOSTS = ["localhost", "127.0.0.1"];
const CLIENT_PORTS = [3000, 3001];

export default defineConfig({
  name: "playground",
  logging: {
    channelFilter: {
      "*": "trace",
    },
  },
  envOverrides: {
    STRIPE_SECRET_KEY: "modules.dms-saas.config.stripe.secretKey",
    STRIPE_PUBLISHABLE_KEY: "modules.dms-saas.config.stripe.publishableKey",
    STRIPE_WEBHOOK_SECRET: "modules.dms-saas.config.stripe.webhookSecret",
  },
  modules: {
    playground: {
      source: {
        type: "local",
        path: ".",
        installCommand: ["pnpm install", "pnpm build"],
      },
    },
    "dms-saas": {
      source: {
        type: "local",
        path: "..",
        watchDir: ["src"],
        installCommand: ["pnpm install", "pnpm build"],
      },
      config: {
        stripe: {
          secretKey: "sk_test_placeholder",
          webhookSecret: "whsec_placeholder",
          publishableKey: "pk_test_placeholder",
        },
        allowedRedirectHosts: CLIENT_HOSTS.flatMap((host) =>
          CLIENT_PORTS.map((port) => `${host}:${port}`),
        ),
      },
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.4.3 <1.0.0",
      },
      config: {
        auth: {
          jwtSecret: "dev",
        },
        homepage: "/welcome",
        meta: {
          title: "AntelopeJS SaaS",
          description: "AntelopeJS DMS SaaS playground",
        },
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.3.1",
      },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: "playground_dms_saas",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.0.3",
      },
      config: {
        secret: "dev",
      },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "^0.1.5",
      },
      config: {
        storagePath: ".antelope/file-storage",
        // Minted asset and presigned URLs are opened by the browser.
        baseUrl: "${@api.API_PUBLIC_BASE_URL}",
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "^0.0.5",
      },
      config: {
        ethereal: true,
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.3.0",
      },
      config: {
        servers: [
          {
            protocol: "http",
            port: "5010",
          },
        ],
      },
    },
  },
});
