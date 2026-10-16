import { type PlanCatalog, PLANS_ENDPOINT } from '../build/plan-catalog'

/**
 * The plans, features and new-plan permissions of the catalogue, read once
 * for every block of a page: the plan cards, the editor's access matrix and
 * preview, the retire dialog. `refresh` reads the catalogue as it stands now.
 */
export function usePlanCatalog(): ApiDataResult<PlanCatalog> {
	return useApiData<PlanCatalog>(`${PLANS_ENDPOINT}/catalog`)
}
