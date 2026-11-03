import { Controller, Get } from "@antelopejs/interface-api";

/** The trusted backend calls of the `operator` features, under `/verify-saas/operator`. */
export class VerifyOperatorFixtureController extends Controller("/verify-saas/operator") {
  @Get("/ping")
  ping() {
    return { ok: true };
  }
}
