const REGISTER_LINK_ID = "saas-login-register";
const REGISTER_LINK_LABEL = "saas.auth.login.create_account";
const REGISTER_LINK_ROUTE = "/register";
const REGISTER_LINK_ORDER = 100;

interface DmsSaasPublicRuntimeConfig {
  admissionMode?: "open" | "invitation-only";
}

export default defineDmsPlugin(() => {
  const config = useDmsRuntimeConfig();
  const dmsSaas = config.public.dmsSaas as
    | DmsSaasPublicRuntimeConfig
    | undefined;
  if (dmsSaas?.admissionMode === "invitation-only") return;

  registerAuthLink({
    id: REGISTER_LINK_ID,
    page: "login",
    label: REGISTER_LINK_LABEL,
    to: REGISTER_LINK_ROUTE,
    order: REGISTER_LINK_ORDER,
  });
});
