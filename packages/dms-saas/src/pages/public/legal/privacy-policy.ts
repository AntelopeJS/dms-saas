import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";

const LEGAL_ENDPOINT = "/api/saas/legal-documents";
const DOCUMENT_FIELD = "privacyPolicy";

@RegisterPage()
export class SaasPrivacyPolicyPage extends PageController("privacy-policy", {
  displayName: "$saas.legal.privacy_policy",
  description: "$saas.legal.privacy_policy_page_description",
  category: pagesCategory,
  publicAccess: true,
  hidden: true,
}) {
  static legalContent = CustomComponent("DmsSaasLegalLayout")
    .meta({ name: "$saas.legal.privacy_policy" })
    .options({ endpoint: LEGAL_ENDPOINT, documentField: DOCUMENT_FIELD });
}
