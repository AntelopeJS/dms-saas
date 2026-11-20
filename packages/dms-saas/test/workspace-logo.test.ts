import { buffer } from "node:stream/consumers";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import type { TenantExportArchive } from "@antelopejs/interface-dms/hooks";
import { WriteFile } from "@antelopejs/interface-file-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { exportSaasTenantData } from "../src/hooks/tenant-export";
import { SaasWorkspacesController } from "../src/routes/tenant/workspaces";
import { listMyWorkspaces } from "../src/workspaces/my-workspaces";
import { implementPromotedFileSave } from "./helpers/attachments";
import { addTenantMember, useDmsAuth } from "./helpers/dms";
import { useMemoryFileStorage } from "./helpers/file-storage";
import { useMongoDatabase } from "./helpers/mongo";
import {
  createOwnedWorkspace,
  type OwnedWorkspace,
} from "./helpers/workspaces";

useMongoDatabase();
useDmsAuth();
useMemoryFileStorage();
const fileSaves = implementPromotedFileSave();

const FIRST_LOGO = { key: "workspace-logos/first.png" };
const SECOND_LOGO = { key: "workspace-logos/second.png" };

function workspacesController() {
  return Object.assign(new SaasWorkspacesController(), {
    tenantModel: GetModel(TenantModel),
  });
}

interface IdentitySubmission {
  name?: string;
  logo?: unknown;
}

async function save(workspace: OwnedWorkspace, body: IdentitySubmission) {
  return workspacesController().saveCurrentIdentity(
    workspace.owner,
    workspace.request,
    body,
  );
}

async function switcherLogo(workspace: OwnedWorkspace) {
  const [row] = await listMyWorkspaces(workspace.owner._id, workspace.tenantId);
  return row?.logoUrl;
}

async function storedLogo(workspace: OwnedWorkspace) {
  const current = await workspacesController().getCurrent(
    workspace.owner,
    workspace.request,
  );
  return current.logo;
}

beforeEach(() => {
  fileSaves.length = 0;
});

describe("workspace logo", () => {
  it("rejects a switcher that shows a logo for a workspace that has none", async () => {
    const workspace = await createOwnedWorkspace();

    await expect(storedLogo(workspace)).resolves.toBeNull();
    await expect(switcherLogo(workspace)).resolves.toBeNull();
  });

  it("rejects an upload the switcher does not show", async () => {
    const workspace = await createOwnedWorkspace();

    const saved = await save(workspace, { logo: FIRST_LOGO });

    expect(saved.logo).toEqual(FIRST_LOGO);
    await expect(storedLogo(workspace)).resolves.toEqual(FIRST_LOGO);
    await expect(switcherLogo(workspace)).resolves.toMatch(
      /\/workspace-logos%2Ffirst\.png$/,
    );
  });

  it("rejects a replacement that leaves the old file out of the cleanup", async () => {
    const workspace = await createOwnedWorkspace();
    await save(workspace, { logo: FIRST_LOGO });

    await save(workspace, { logo: SECOND_LOGO });

    expect(fileSaves.at(-1)).toMatchObject({
      submitted: { logo: SECOND_LOGO },
      before: { logo: FIRST_LOGO },
    });
    await expect(switcherLogo(workspace)).resolves.toMatch(/second\.png$/);
  });

  it("rejects a removal that keeps showing the logo", async () => {
    const workspace = await createOwnedWorkspace();
    await save(workspace, { logo: FIRST_LOGO });

    await save(workspace, { logo: null });

    await expect(storedLogo(workspace)).resolves.toBeNull();
    await expect(switcherLogo(workspace)).resolves.toBeNull();
  });

  it("rejects a rename that drops the logo it did not send", async () => {
    const workspace = await createOwnedWorkspace();
    await save(workspace, { logo: FIRST_LOGO });

    const savesBefore = fileSaves.length;

    await save(workspace, { name: "Acme" });

    expect(fileSaves).toHaveLength(savesBefore);
    await expect(storedLogo(workspace)).resolves.toEqual(FIRST_LOGO);
  });

  it("rejects a logo change that needs the unchanged name sent along", async () => {
    const workspace = await createOwnedWorkspace();

    await save(workspace, { logo: FIRST_LOGO });

    await expect(
      GetModel(TenantModel).get(workspace.tenantId),
    ).resolves.toMatchObject({ name: workspace.tenantId });
    await expect(storedLogo(workspace)).resolves.toEqual(FIRST_LOGO);
  });

  it("rejects storing a logo that is not an image value", async () => {
    const workspace = await createOwnedWorkspace();
    await save(workspace, { logo: FIRST_LOGO });

    await expect(save(workspace, { logo: "first.png" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(storedLogo(workspace)).resolves.toEqual(FIRST_LOGO);
  });

  it("rejects a switcher that shows only the current workspace's logo", async () => {
    const acme = await createOwnedWorkspace();
    await save(acme, { logo: FIRST_LOGO });
    const other = await createOwnedWorkspace();
    await addTenantMember(other.tenantId, acme.owner, false);

    const rows = await listMyWorkspaces(acme.owner._id, other.tenantId);

    expect(rows.map((row) => row._id)).toEqual([other.tenantId, acme.tenantId]);
    expect(rows[0]?.logoUrl).toBeNull();
    expect(rows[1]?.logoUrl).toMatch(/first\.png$/);
  });

  it("rejects a workspace export that leaves out the logo row or its file", async () => {
    const workspace = await createOwnedWorkspace();
    const logoBytes = Buffer.from("first logo");
    await WriteFile(
      {
        filename: "first.png",
        path: "workspace-logos",
        size: logoBytes.length,
        mimetype: "image/png",
      },
      logoBytes,
    );
    await save(workspace, { logo: FIRST_LOGO });
    const entries = new Map<string, Buffer>();
    const archive: TenantExportArchive = {
      async addJson() {},
      async addFile() {},
      async addStream(path, stream) {
        entries.set(path, await buffer(stream));
      },
    };

    await exportSaasTenantData(
      workspace.tenantId,
      archive,
      new AbortController().signal,
    );

    expect([...entries.keys()]).toEqual([
      "invoices.jsonl",
      "credit-notes.jsonl",
      "refunds.jsonl",
      "workspace-branding.jsonl",
      `files/${FIRST_LOGO.key}`,
    ]);
    const brandingRow = entries.get("workspace-branding.jsonl") ?? "";
    expect(JSON.parse(brandingRow.toString("utf-8"))).toMatchObject({
      _id: workspace.tenantId,
      logo: FIRST_LOGO,
    });
    expect(entries.get(`files/${FIRST_LOGO.key}`)).toEqual(logoBytes);
  });
});
