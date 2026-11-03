import { Controller, Get } from "@antelopejs/interface-api";

/** The trusted backend calls of the `catalog` features, under `/verify-saas/catalog`. */
export class VerifyCatalogFixtureController extends Controller("/verify-saas/catalog") {
  @Get("/ping")
  ping() {
    return { ok: true };
  }
}
