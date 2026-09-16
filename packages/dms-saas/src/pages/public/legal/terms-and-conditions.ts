import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";

const LEGAL_ENDPOINT = "/api/saas/legal-documents";
const DOCUMENT_FIELD = "termsAndConditions";

@RegisterPage()
export class SaasTermsAndConditionsPage extends PageController(
  "terms-and-conditions",
  {
    displayName: "$saas.legal.terms_and_conditions",
    description: "$saas.legal.terms_and_conditions_page_description",
    category: pagesCategory,
    publicAccess: true,
    hidden: true,
  },
) {
  static legalContent = CustomComponent("DmsSaasLegalLayout")
    .meta({ name: "$saas.legal.terms_and_conditions" })
    .options({ endpoint: LEGAL_ENDPOINT, documentField: DOCUMENT_FIELD });
}
