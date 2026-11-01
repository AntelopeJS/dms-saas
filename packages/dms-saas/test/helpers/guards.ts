import {
  computeParameter,
  HTTPResult,
  type RequestContext,
} from "@antelopejs/interface-api";
import { controllerRoutes } from "./routes";

const HTTP_FORBIDDEN = 403;

/**
 * What the DMS guards of a controller's routes answer to a request, by method
 * name: the 403 bodies of the guards that refuse it, for each route with at
 * least one. Each route's controller properties and parameters are computed
 * as the API module does, without running the route itself. Needs
 * `useMongoDatabase` and `useDmsAuth`.
 */
export async function guardRefusals(
  controller: object,
  request: RequestContext,
): Promise<Record<string, unknown[]>> {
  const refusals: Record<string, unknown[]> = {};
  for (const [name, route] of controllerRoutes(controller)) {
    const instance = new route.proto.constructor();
    const computed = await Promise.allSettled([
      ...Object.values(route.properties).map((property) =>
        computeParameter(request, property, instance),
      ),
      ...route.parameters.map((parameter) =>
        computeParameter(request, parameter, instance),
      ),
    ]);
    const bodies = computed.flatMap((outcome) =>
      outcome.status === "rejected" &&
      outcome.reason instanceof HTTPResult &&
      outcome.reason.getStatus() === HTTP_FORBIDDEN
        ? [outcome.reason.getBody()]
        : [],
    );
    if (bodies.length > 0) refusals[name] = bodies;
  }
  return refusals;
}
