import {
  computeParameter,
  getRegisteredRouteHandlers,
  type RequestContext,
  type RouteHandler,
} from "@antelopejs/interface-api";

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

/**
 * Serves one request with a registered route the way the API module does: a
 * fresh controller with its computed properties, then every parameter
 * provider (guards, bodies, models) in parallel, then the handler.
 */
export async function callRoute(
  method: string,
  location: string,
  context: RequestContext,
): Promise<ReturnType<RouteHandler["callback"]>> {
  const route = registeredRoute(method, location);
  const controller = new route.proto.constructor();
  await Promise.all(
    Object.entries(route.properties).map(async ([key, property]) => {
      controller[key] = await computeParameter(context, property, controller);
    }),
  );
  const parameters = await Promise.all(
    route.parameters.map((parameter) =>
      computeParameter(context, parameter, controller),
    ),
  );
  return route.callback.apply(controller, parameters);
}
