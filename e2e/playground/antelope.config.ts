import { defineConfig } from "@antelopejs/interface-core/config";

const preferredApiPort = process.env.PORT ?? "5010";
const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;

interface SaasConfig {
  stripe: {
    secretKey: string;
    publishableKey: string;
    webhookSecret: string;
  };
  admissionMode?: string;
  registration?: { paymentMethod?: string };
  publicScreens?: { register?: boolean; pricing?: boolean };
  allowedRedirectHosts?: string[];
  defaultPlanSlug?: string;
  upcomingInvoicePreviewCacheTtlSeconds?: number;
  reportingCurrency?: string;
}

/**
 * The module's options, each from a `E2E_SAAS_*` variable a journey sets in
 * the run's environment before it restarts the backend. Unset, the module
 * runs its own defaults, with Stripe keys that are placeholders: the module
 * makes no Stripe call, which is what the tests rely on.
 */
function saasConfig(): SaasConfig {
  const env = process.env;
  const config: SaasConfig = {
    stripe: {
      secretKey: env.E2E_SAAS_STRIPE_SECRET_KEY ?? "sk_test_placeholder",
      publishableKey: "pk_test_placeholder",
      webhookSecret: env.E2E_SAAS_WEBHOOK_SECRET ?? "whsec_placeholder",
    },
  };
  if (env.E2E_SAAS_ADMISSION) config.admissionMode = env.E2E_SAAS_ADMISSION;
  if (env.E2E_SAAS_PAYMENT_METHOD)
    config.registration = { paymentMethod: env.E2E_SAAS_PAYMENT_METHOD };
  if (env.E2E_SAAS_SCREENS_OFF) {
    const off = env.E2E_SAAS_SCREENS_OFF.split(",");
    config.publicScreens = {
      register: !off.includes("register"),
      pricing: !off.includes("pricing"),
    };
  }
  if (env.E2E_SAAS_ALLOWED_HOSTS)
    config.allowedRedirectHosts = env.E2E_SAAS_ALLOWED_HOSTS.split(",");
  if (env.E2E_SAAS_DEFAULT_PLAN)
    config.defaultPlanSlug = env.E2E_SAAS_DEFAULT_PLAN;
  if (env.E2E_SAAS_PREVIEW_TTL)
    config.upcomingInvoicePreviewCacheTtlSeconds = Number(
      env.E2E_SAAS_PREVIEW_TTL,
    );
  if (env.E2E_SAAS_REPORTING_CURRENCY)
    config.reportingCurrency = env.E2E_SAAS_REPORTING_CURRENCY;
  return config;
}

/**
 * The repository's playground with the ports, origins, secrets and mail
 * the `@antelopejs/dms/e2e` kit sets for a run, a fixture module (`app`) and
 * the module under test built from the checkout.
 */
export default defineConfig({
  name: "dms-saas-e2e",
  modules: {
    app: {
      source: { type: "local", path: "." },
    },
    "dms-saas": {
      source: { type: "local", path: "../../packages/dms-saas" },
      config: saasConfig(),
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: "0.21.4-next.1011.g9a5478b",
      },
      config: {
        homepage: "/welcome",
        meta: {
          title: "AntelopeJS SaaS",
          description: "SaaS end-to-end tests",
        },
        auth: {
          jwtSecret: process.env.DMS_JWT_SECRET ?? "dev",
          signInCountry: { database: false },
        },
        htmlRender: {
          serviceSecret: process.env.DMS_HTML_RENDER_SECRET ?? "dev",
          renderEndpoint: dmsClientUrl && `${dmsClientUrl}/api/html/render`,
        },
        apiBaseUrl: "${@api.API_PUBLIC_BASE_URL}",
        clientBaseUrl: dmsClientUrl,
        frontend: { bootstrapSecret: process.env.DMS_BOOTSTRAP_SECRET },
        docsPreview: true,
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "~1.8.10",
      },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: process.env.MONGO_DATABASE ?? "dms_saas_e2e",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "~1.1.2",
      },
      config: { secret: process.env.AUTH_JWT_SECRET ?? "dev" },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: ">=0.2.1 <0.3.0",
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
        version: ">=0.0.12 <0.1.0",
      },
      config: {
        host: "127.0.0.1",
        port: Number(process.env.DMS_SMTP_PORT ?? "9"),
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "~1.7.5",
      },
      config: {
        servers: [{ protocol: "http", port: preferredApiPort }],
        publicBaseUrl: process.env.DMS_CLIENT_BASE_URL,
        cors: {
          allowedOrigins: [
            process.env.DMS_CLIENT_BASE_URL ?? "http://localhost:3001",
          ],
        },
      },
    },
  },
});
