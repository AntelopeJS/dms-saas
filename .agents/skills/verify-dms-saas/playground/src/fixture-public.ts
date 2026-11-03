import { Controller, Get } from "@antelopejs/interface-api";

/** The trusted backend calls of the `public` features, under `/verify-saas/public`. */
export class VerifyPublicFixtureController extends Controller("/verify-saas/public") {
  @Get("/ping")
  ping() {
    return { ok: true };
  }
}
