import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  buildRegisterBody,
  useRegistrationWorld,
  world,
} from "./helpers/registration";
import { useMongoDatabase } from "./helpers/mongo";
import { callRoute } from "./helpers/routes";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();
useSuiteStripe();
useRegistrationWorld();

const REGISTER_ROUTE = "/api/saas/register/";

/** A `POST /api/saas/register` request from one client address, as the API module hands it over. */
function registerRequest(remoteAddress: string): RequestContext {
  return fromPartial<RequestContext>({
    rawRequest: { headers: {}, socket: { remoteAddress } },
    body: Promise.resolve(Buffer.from(JSON.stringify(buildRegisterBody()))),
    response: new HTTPResult(),
  });
}

/** Registers from `remoteAddress` and returns the limit the route announced. */
async function registerAndReadLimit(remoteAddress: string): Promise<number> {
  const request = registerRequest(remoteAddress);
  await callRoute("POST", REGISTER_ROUTE, request);
  return Number(request.response.getHeaders()["X-RateLimit-Limit"]);
}

describe("rate limit on the public registration endpoint", () => {
  it("registers up to the limit, then answers 429 without creating an account", async () => {
    const limit = await registerAndReadLimit("198.51.100.1");
    expect(limit).toBeGreaterThan(0);
    for (let call = 2; call <= limit; call += 1) {
      await callRoute("POST", REGISTER_ROUTE, registerRequest("198.51.100.1"));
    }
    expect(await world.users()).toHaveLength(limit);

    await expect(
      callRoute("POST", REGISTER_ROUTE, registerRequest("198.51.100.1")),
    ).rejects.toSatisfy(
      (refusal) => refusal instanceof HTTPResult && refusal.getStatus() === 429,
    );
    expect(await world.users()).toHaveLength(limit);
  });

  it("counts each client address on its own", async () => {
    const limit = await registerAndReadLimit("198.51.100.2");
    for (let call = 2; call <= limit; call += 1) {
      await callRoute("POST", REGISTER_ROUTE, registerRequest("198.51.100.2"));
    }

    await registerAndReadLimit("198.51.100.3");

    expect(await world.users()).toHaveLength(limit + 1);
  });
});
