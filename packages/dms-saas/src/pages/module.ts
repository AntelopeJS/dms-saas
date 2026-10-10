import { RegisterModule } from "@antelopejs/interface-dms/page";
import { SAAS_MODULE_DEFINITION, SAAS_MODULE_ID } from "./definitions";

export { workspaceSettingsCategory } from "@antelopejs/interface-dms/page";
export { SAAS_MODULE_ID };

export const saasModule = RegisterModule(SAAS_MODULE_DEFINITION.registration);
