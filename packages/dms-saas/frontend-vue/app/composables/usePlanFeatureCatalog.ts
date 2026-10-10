import {
	type CatalogFeature,
	type PlanCatalog,
	PLANS_ENDPOINT,
} from '../build/plan-catalog'

const PLAN_FEATURE_CATALOG_STATE_KEY = 'saas-plan-feature-catalog'

/**
 * The features of the catalogue the plan cards list. Every card of a page
 * asks for them as it mounts: the cards mount together, so they share one
 * request, and a later page of cards reads the features as they stand then.
 */
export function usePlanFeatureCatalog(): SharedRequest<CatalogFeature[]> {
	const { $authFetch } = useAuthFetch()
	return useSharedRequest(PLAN_FEATURE_CATALOG_STATE_KEY, () =>
		$authFetch<PlanCatalog>(`${PLANS_ENDPOINT}/catalog`).then(
			(catalog) => catalog.features,
		),
	)
}
