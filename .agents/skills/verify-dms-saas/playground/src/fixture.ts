import { Controller, Get } from "@antelopejs/interface-api";

/** The verification playground's trusted backend calls, under `/verify-saas`. */
export class VerifySaasFixtureController extends Controller("/verify-saas") {
  @Get("/ping")
  ping() {
    return { ok: true };
  }
}
