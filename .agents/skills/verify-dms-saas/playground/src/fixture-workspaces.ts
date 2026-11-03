import { Controller, Get } from "@antelopejs/interface-api";

/** The trusted backend calls of the `workspaces` features, under `/verify-saas/workspaces`. */
export class VerifyWorkspacesFixtureController extends Controller("/verify-saas/workspaces") {
  @Get("/ping")
  ping() {
    return { ok: true };
  }
}
