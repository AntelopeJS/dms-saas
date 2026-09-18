const TERMS_OF_USE_ID = "saas-terms-of-use";
const TERMS_AND_CONDITIONS_ID = "saas-terms-and-conditions";
const PRIVACY_POLICY_ID = "saas-privacy-policy";

const TERMS_OF_USE_LABEL = "saas.legal.terms_of_use";
const TERMS_AND_CONDITIONS_LABEL = "saas.legal.terms_and_conditions";
const PRIVACY_POLICY_LABEL = "saas.legal.privacy_policy";

const TERMS_OF_USE_ROUTE = "/terms-of-use";
const TERMS_AND_CONDITIONS_ROUTE = "/terms-and-conditions";
const PRIVACY_POLICY_ROUTE = "/privacy-policy";

const ORDER_TERMS_OF_USE = 100;
const ORDER_TERMS_AND_CONDITIONS = 200;
const ORDER_PRIVACY_POLICY = 300;

export default defineDmsPlugin(() => {
  registerFooterLink({
    id: TERMS_OF_USE_ID,
    label: TERMS_OF_USE_LABEL,
    to: TERMS_OF_USE_ROUTE,
    order: ORDER_TERMS_OF_USE,
  });
  registerFooterLink({
    id: TERMS_AND_CONDITIONS_ID,
    label: TERMS_AND_CONDITIONS_LABEL,
    to: TERMS_AND_CONDITIONS_ROUTE,
    order: ORDER_TERMS_AND_CONDITIONS,
  });
  registerFooterLink({
    id: PRIVACY_POLICY_ID,
    label: PRIVACY_POLICY_LABEL,
    to: PRIVACY_POLICY_ROUTE,
    order: ORDER_PRIVACY_POLICY,
  });
});
