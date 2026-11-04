import {
  type ComputedParameter,
  computeParameter,
  getRegisteredRouteHandlers,
  HTTPResult,
  type RequestContext,
  type RouteHandler,
} from "@antelopejs/interface-api";

const HTTP_FORBIDDEN = 403;

/**
 * The `handler` route a controller registered for a method (in any case: the
 * method decorators register `get`, `post`...) and a full location.
 */
export function registeredRoute(
  method: string,
  location: string,
): RouteHandler {
  const registered = getRegisteredRouteHandlers().find(
    ({ handler }) =>
      handler.mode === "handler" &&
      handler.method.toLowerCase() === method.toLowerCase() &&
      handler.location === location,
  );
  if (!registered) throw new Error(`No route answers ${method} ${location}`);
  return registered.handler;
}

/** A fresh instance of the controller class a route was registered on. */
export function newController(route: RouteHandler) {
  return new route.controller();
}

/**
 * The controller a route serves a request with, as the API module builds it:
 * every computed property resolved, the class-level guards (keyed by symbol)
 * included and started after the named ones.
 */
export async function resolvedController(
  route: RouteHandler,
  context: RequestContext,
): Promise<ReturnType<typeof newController>> {
  const controller = newController(route);
  const properties: Record<PropertyKey, ComputedParameter> = route.properties;
  await Promise.all(
    Reflect.ownKeys(properties).map(async (key) => {
      if (!Object.hasOwn(properties, key)) return;
      Reflect.set(
        controller,
        key,
        await computeParameter(context, properties[key], controller),
      );
    }),
  );
  return controller;
}

/**
 * Serves one request with a registered route the way the API module does:
 * {@link resolvedController}, then every parameter provider (guards, bodies,
 * models) in parallel, then the handler.
 */
export async function callRoute(
  method: string,
  location: string,
  context: RequestContext,
): Promise<ReturnType<RouteHandler["callback"]>> {
  const route = registeredRoute(method, location);
  const controller = await resolvedController(route, context);
  const parameters = await Promise.all(
    route.parameters.map((parameter) =>
      computeParameter(context, parameter, controller),
    ),
  );
  return route.callback.apply(controller, parameters);
}

/** The `handler` routes a controller class registered, by method name. */
export function controllerRoutes(
  controller: object,
): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();
  for (const { handler } of getRegisteredRouteHandlers()) {
    if (handler.mode !== "handler" || handler.controller !== controller)
      continue;
    routes.set(handler.callback.name, handler);
  }
  return routes;
}

/** The refusal the DMS answers a request of a user who is not a platform owner with. */
const OWNER_ONLY_REFUSAL = { status: HTTP_FORBIDDEN, body: "Owner-only" };

/**
 * Whether serving `context` with the route stops at the platform-owner
 * check: its controller properties and parameters are computed as the API
 * module does, and one of them refuses with the DMS owner-only answer.
 */
export async function refusesAsOwnerOnly(
  route: RouteHandler,
  context: RequestContext,
): Promise<boolean> {
  const controller = newController(route);
  const computed = await Promise.allSettled([
    ...Object.values(route.properties).map((property) =>
      computeParameter(context, property, controller),
    ),
    ...route.parameters.map((parameter) =>
      computeParameter(context, parameter, controller),
    ),
  ]);
  return computed.some(
    (outcome) =>
      outcome.status === "rejected" &&
      outcome.reason instanceof HTTPResult &&
      outcome.reason.getStatus() === OWNER_ONLY_REFUSAL.status &&
      outcome.reason.getBody() === OWNER_ONLY_REFUSAL.body,
  );
}
