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
 * The module's options, each from a `VERIFY_SAAS_*` variable a journey sets in
 * the run's environment before it restarts the backend. Unset, the module
 * runs its own defaults, with Stripe keys that are placeholders: the module
 * makes no Stripe call, which is what the verification relies on.
 */
function saasConfig(): SaasConfig {
  const env = process.env;
  const config: SaasConfig = {
    stripe: {
      secretKey: env.VERIFY_SAAS_STRIPE_SECRET_KEY ?? "sk_test_placeholder",
      publishableKey: "pk_test_placeholder",
      webhookSecret: env.VERIFY_SAAS_WEBHOOK_SECRET ?? "whsec_placeholder",
    },
  };
  if (env.VERIFY_SAAS_ADMISSION) config.admissionMode = env.VERIFY_SAAS_ADMISSION;
  if (env.VERIFY_SAAS_PAYMENT_METHOD)
    config.registration = { paymentMethod: env.VERIFY_SAAS_PAYMENT_METHOD };
  if (env.VERIFY_SAAS_SCREENS_OFF) {
    const off = env.VERIFY_SAAS_SCREENS_OFF.split(",");
    config.publicScreens = {
      register: !off.includes("register"),
      pricing: !off.includes("pricing"),
    };
  }
  if (env.VERIFY_SAAS_ALLOWED_HOSTS)
    config.allowedRedirectHosts = env.VERIFY_SAAS_ALLOWED_HOSTS.split(",");
  if (env.VERIFY_SAAS_DEFAULT_PLAN)
    config.defaultPlanSlug = env.VERIFY_SAAS_DEFAULT_PLAN;
  if (env.VERIFY_SAAS_PREVIEW_TTL)
    config.upcomingInvoicePreviewCacheTtlSeconds = Number(
      env.VERIFY_SAAS_PREVIEW_TTL,
    );
  if (env.VERIFY_SAAS_REPORTING_CURRENCY)
    config.reportingCurrency = env.VERIFY_SAAS_REPORTING_CURRENCY;
  return config;
}

/**
 * The repository's playground with the ports, origins, secrets and mail
 * `dms-control` sets for a run, a fixture module (`app`) and the module under
 * verification built from the checkout.
 */
export default defineConfig({
  name: "verify-dms-saas",
  modules: {
    app: {
      source: { type: "local", path: "." },
    },
    "dms-saas": {
      source: { type: "local", path: "../../../../packages/dms-saas" },
      config: saasConfig(),
    },
    dms: {
      source: {
        type: "local",
        path: "../../../../packages/dms-saas/node_modules/@antelopejs/dms",
      },
      config: {
        homepage: "/welcome",
        meta: { title: "AntelopeJS SaaS", description: "SaaS verification" },
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
        version: "^1.5.0",
      },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: process.env.MONGO_DATABASE ?? "verify_dms_saas",
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
      config: { secret: process.env.AUTH_JWT_SECRET ?? "dev" },
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
        host: "127.0.0.1",
        port: Number(process.env.DMS_SMTP_PORT ?? "9"),
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.5.0",
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
