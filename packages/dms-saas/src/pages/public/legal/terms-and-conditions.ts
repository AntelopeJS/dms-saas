import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";

const DOCUMENT_FIELD = "termsAndConditions";

// Read before sign-up, from the auth footer and the terms checkbox: the console
// layout's authenticated calls would bounce an anonymous visitor to the login.
@RegisterPage()
export class SaasTermsAndConditionsPage extends PageController(
  "terms-and-conditions",
  {
    displayName: "$saas.legal.terms_and_conditions",
    description: "$saas.public.legal.terms_and_conditions_page_description",
    category: pagesCategory,
    publicAccess: true,
    hidden: true,
  },
  EmptyLayout(),
) {
  static legalContent = CustomComponent("DmsSaasLegalLayout")
    .meta({
      name: "$saas.legal.terms_and_conditions",
      description: "$saas.permissions.public.legal_document_description",
      icon: "i-ph-file-text",
    })
    .options({ documentField: DOCUMENT_FIELD });
}
