import { resolve } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(__dirname, ".env") });

/**
 * The dev frontend's hosts. The dev frontend (`ajs dms dev`) is a separate CLI
 * process, not an Antelope module, so its origins cannot be published as
 * config variables.
 */
const CLIENT_HOSTS = ["localhost", "127.0.0.1"];
const CLIENT_PORTS = [3000, 3001];

interface OAuthCredentials {
  clientId?: string;
  clientSecret?: string;
}

/**
 * The OAuth credentials of a provider, read from the environment or
 * `playground/.env`, never committed. The DMS offers a provider, and draws its
 * "Continue with" button on the login and sign-up screens, only once both
 * credentials are set. Register
 * `http://localhost:3001/auth/oauth/<provider>/callback` with the provider.
 */
function oauthCredentials(prefix: string): OAuthCredentials {
  return {
    clientId: process.env[`${prefix}_CLIENT_ID`],
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`],
  };
}

/**
 * The playground project. The playground module is not a workspace package:
 * without `--ignore-workspace` pnpm installs the root workspace instead of its
 * lockfile, and it is transpiled without type checking, because dms-saas
 * rebuilds the interface package's types at the same moment and checking
 * against them half-written fails at random (`pnpm build` keeps the type
 * check). The dms-saas module is only built: the workspace is installed
 * beforehand, as the README says, and installing it here would inherit the
 * playground's hoisted linker and relink the whole workspace away from the
 * layout CI uses. Signing up with an OAuth provider opens a new account, which
 * then sets up its first workspace on `auth/no-workspace`. The file storage's
 * `baseUrl` is public because the browser opens the minted asset and
 * presigned URLs.
 */
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
        installCommand: [
          "pnpm install --ignore-workspace",
          "pnpm build:transpile",
        ],
      },
    },
    "dms-saas": {
      source: {
        type: "local",
        path: "..",
        watchDir: ["src"],
        installCommand: ["pnpm build"],
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
        version: ">=0.11.0 <1.0.0",
      },
      config: {
        auth: {
          jwtSecret: "dev",
          oauth: {
            providers: {
              github: oauthCredentials("GITHUB"),
              google: oauthCredentials("GOOGLE"),
            },
            allowAccountCreation: true,
          },
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
        version: "^1.5.0",
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
        version: ">=0.1.13 <1.0.0",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "${@api.API_PUBLIC_BASE_URL}",
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: ">=0.0.6 <1.0.0",
      },
      config: {
        ethereal: true,
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.5.0",
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
