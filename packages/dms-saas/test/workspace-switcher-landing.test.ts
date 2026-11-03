import { describe, expect, it } from "vitest";
import {
  HOME_PATH,
  workspaceSwitchLandingPath,
} from "../frontend-vue/app/build/workspace-paths";

describe("workspace switch landing page", () => {
  it("rejects reloading a record page in another workspace", () => {
    expect(workspaceSwitchLandingPath({ workspaceScoped: true })).toBe(
      HOME_PATH,
    );
  });

  it("rejects redirecting an unflagged page away from its current URL", () => {
    expect(
      workspaceSwitchLandingPath({ displayName: "Settings" }),
    ).toBeUndefined();
  });

  it("rejects treating the presence of a false flag as workspace scoping", () => {
    expect(
      workspaceSwitchLandingPath({ workspaceScoped: false }),
    ).toBeUndefined();
  });

  it("rejects redirecting when no route matches", () => {
    expect(workspaceSwitchLandingPath(undefined)).toBeUndefined();
  });
});
