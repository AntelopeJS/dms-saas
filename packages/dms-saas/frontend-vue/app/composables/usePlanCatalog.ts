import { type PlanCatalog, PLANS_ENDPOINT } from '../build/plan-catalog'

const PLAN_CATALOG_STATE_KEY = 'saas-plan-catalog'

/**
 * The plans, features and new-plan permissions of the catalogue, read once
 * for every block of a page: the plan cards, the editor's access matrix and
 * preview, the retire dialog. `load` serves what a block already read,
 * `refresh` reads the catalogue as it stands now.
 */
export function usePlanCatalog(): SharedRequest<PlanCatalog> {
	const { $authFetch } = useAuthFetch()
	return useSharedRequest(PLAN_CATALOG_STATE_KEY, () =>
		$authFetch<PlanCatalog>(`${PLANS_ENDPOINT}/catalog`),
	)
}
