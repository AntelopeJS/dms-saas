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
/** The documented registrations per client address and minute. */
const DOCUMENTED_LIMIT = 20;
/** Refused by the password policy before any hash: cheap calls that still count. */
const REFUSED_PASSWORD = "short";

/** A `POST /api/saas/register` request from one client address, as the API module hands it over. */
function registerRequest(
  remoteAddress: string,
  password?: string,
): RequestContext {
  const body = buildRegisterBody();
  if (password) body.password = password;
  return fromPartial<RequestContext>({
    rawRequest: { headers: {}, socket: { remoteAddress } },
    body: Promise.resolve(Buffer.from(JSON.stringify(body))),
    response: new HTTPResult(),
  });
}

/** The status a call answers: 200 when it returned, the refusal's otherwise. */
async function statusOf(request: RequestContext): Promise<number> {
  try {
    await callRoute("POST", REGISTER_ROUTE, request);
    return 200;
  } catch (refusal) {
    return refusal instanceof HTTPResult ? refusal.getStatus() : 500;
  }
}

/** Spends all but one call of an address's window on registrations the password policy refuses. */
async function spendAllButOne(remoteAddress: string): Promise<number[]> {
  const statuses = [];
  for (let call = 1; call < DOCUMENTED_LIMIT; call += 1) {
    statuses.push(
      await statusOf(registerRequest(remoteAddress, REFUSED_PASSWORD)),
    );
  }
  return statuses;
}

describe("rate limit on the public registration endpoint", () => {
  it("registers within the limit, then answers 429 without creating an account", async () => {
    expect(new Set(await spendAllButOne("198.51.100.1"))).toEqual(
      new Set([400]),
    );
    const last = registerRequest("198.51.100.1");
    expect(await statusOf(last)).toBe(200);
    expect(last.response.getHeaders()["X-RateLimit-Limit"]).toBe(
      String(DOCUMENTED_LIMIT),
    );
    expect(await world.users()).toHaveLength(1);

    expect(await statusOf(registerRequest("198.51.100.1"))).toBe(429);
    expect(await world.users()).toHaveLength(1);
  });

  it("counts each client address on its own", async () => {
    await spendAllButOne("198.51.100.2");
    expect(
      await statusOf(registerRequest("198.51.100.2", REFUSED_PASSWORD)),
    ).toBe(400);
    expect(await statusOf(registerRequest("198.51.100.2"))).toBe(429);

    expect(await statusOf(registerRequest("198.51.100.3"))).toBe(200);
    expect(await world.users()).toHaveLength(1);
  });
});
