import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";

const LEGAL_ENDPOINT = "/api/saas/legal-documents";
const DOCUMENT_FIELD = "privacyPolicy";

// Read before sign-up, from the auth footer and the terms checkbox: the console
// layout's authenticated calls would bounce an anonymous visitor to the login.
@RegisterPage()
export class SaasPrivacyPolicyPage extends PageController(
  "privacy-policy",
  {
    displayName: "$saas.legal.privacy_policy",
    description: "$saas.legal.privacy_policy_page_description",
    category: pagesCategory,
    publicAccess: true,
    hidden: true,
  },
  EmptyLayout(),
) {
  static legalContent = CustomComponent("DmsSaasLegalLayout")
    .meta({ name: "$saas.legal.privacy_policy" })
    .options({ endpoint: LEGAL_ENDPOINT, documentField: DOCUMENT_FIELD });
}
