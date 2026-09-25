import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";

const LEGAL_ENDPOINT = "/api/saas/legal-documents";
const DOCUMENT_FIELD = "termsOfUse";

// Read before sign-up, from the auth footer and the terms checkbox: the console
// layout's authenticated calls would bounce an anonymous visitor to the login.
@RegisterPage()
export class SaasTermsOfUsePage extends PageController(
  "terms-of-use",
  {
    displayName: "$saas.legal.terms_of_use",
    description: "$saas.legal.terms_of_use_page_description",
    category: pagesCategory,
    publicAccess: true,
    hidden: true,
  },
  EmptyLayout(),
) {
  static legalContent = CustomComponent("DmsSaasLegalLayout")
    .meta({ name: "$saas.legal.terms_of_use" })
    .options({ endpoint: LEGAL_ENDPOINT, documentField: DOCUMENT_FIELD });
}
