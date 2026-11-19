import { z } from "zod";
import { expect, test } from "./journeys/journey.ts";
import { pendingInvitations, putSubscription } from "./journeys/back-office.ts";
import {
  allPermissionIds,
  createdId,
  createPlan,
  createRole,
  inviteMember,
  joinMember,
  register,
  saas,
  errorCode,
} from "./journeys/saas.ts";

const SIGNUP_LINK = /\/auth\/signup\?token=([^&\s]+)/;
const EXPORT_POLLS = 30;
const EXPORT_POLL_MS = 1000;
const CSV_ROW_BREAK = "\r\n";
const CSV_EMAIL_COLUMN = 1;
const CSV_OWNED_MRR_COLUMN = 8;

const exportJob = z.object({ jobId: z.string() });
const exportProgress = z.object({ status: z.string() });

test("an-operator-resends-copies-and-revokes-a-pending-invitation", async ({
  journey,
}) => {
  await createPlan(journey, "free", {
    permissions: await allPermissionIds(journey),
  });
  const owner = await register(journey, "inviter");
  const role = await createRole(journey, "inviter");
  const keepEmail = journey.email("keep");
  const dropEmail = journey.email("drop");
  await inviteMember(journey, "inviter", keepEmail, role);
  await inviteMember(journey, "inviter", dropEmail, role);
  const listed = await pendingInvitations(journey, owner.tenantId);
  const emails = listed.map((entry) => entry.email);
  expect(emails, "both invitations are pending").toContain(dropEmail);
  expect(emails, "both invitations are pending").toContain(keepEmail);
  const idOf = (email: string) =>
    listed.find((entry) => entry.email === email)?.id ?? "";

  const base = `/workspaces/${owner.tenantId}/invitations`;
  const link = await saas(
    journey,
    "copy the link",
    "POST",
    `${base}/${idOf(keepEmail)}/link`,
  );
  const revoked = await saas(
    journey,
    "revoke the dropped invitation",
    "POST",
    `${base}/${idOf(dropEmail)}/revoke`,
  );
  const after = await pendingInvitations(journey, owner.tenantId);
  const twice = await saas(
    journey,
    "revoke it again",
    "POST",
    `${base}/${idOf(dropEmail)}/revoke`,
  );
  const remaining = await pendingInvitations(journey, owner.tenantId);

  expect.soft(link.status, "the link is returned").toBe(200);
  expect
    .soft(JSON.stringify(link.body), "the link carries a token")
    .toContain("token=");
  expect.soft(revoked.status, "revoke: 200").toBe(200);
  expect
    .soft(after, "one invitation is left, the kept one")
    .toMatchObject([{ email: keepEmail }]);
  expect.soft(twice.status, "revoking it again is harmless").toBe(200);
  expect.soft(remaining, "the same single invitation remains").toHaveLength(1);
});

test("resending-an-invitation-issues-a-new-link-and-kills-the-old-one", async ({
  journey,
}) => {
  await createPlan(journey, "free", {
    permissions: await allPermissionIds(journey),
  });
  const owner = await register(journey, "resender");
  const role = await createRole(journey, "resender");
  const email = journey.email("invitee");
  const first = await inviteMember(journey, "resender", email, role);
  const before = await pendingInvitations(journey, owner.tenantId);
  const resent = await saas(
    journey,
    "resend the invitation",
    "POST",
    `/workspaces/${owner.tenantId}/invitations/${before[0]?.id ?? ""}/resend`,
  );
  const isNewLink = (link: string) =>
    SIGNUP_LINK.test(link) && !link.includes(first.token);
  const mail = await journey.mail(
    (message) =>
      message.to.some((to) => to.includes(email)) &&
      message.links.some(isNewLink),
  );
  const newLink = mail.match?.links.findLast(isNewLink) ?? "";
  const newToken = SIGNUP_LINK.exec(newLink)?.[1] ?? "";
  const after = await pendingInvitations(journey, owner.tenantId);

  expect
    .soft(resent, "200 with emailDelivery sent")
    .toMatchObject({ status: 200, body: { emailDelivery: "sent" } });
  expect(first.token, "the first invitation mailed a link").not.toBe("");
  expect(newToken, "a new link arrived").not.toBe("");
  expect
    .soft(newToken, "a new link arrived, different from the first")
    .not.toBe(first.token);
  expect
    .soft(after, "one invitation remains for the address")
    .toMatchObject([{ email }]);
  expect
    .soft(
      Date.parse(after[0]?.expiresAt ?? ""),
      "its expiry is not earlier than before",
    )
    .toBeGreaterThanOrEqual(Date.parse(before[0]?.expiresAt ?? ""));

  const password = journey.password();
  const signUp = (label: string, token: string) =>
    journey.api(label, {
      method: "POST",
      path: "/api/auth/signup",
      as: "anon",
      body: { name: "Invitee", email, password, token },
    });
  const old = await signUp("sign up with the old link", first.token);
  const fresh = await signUp("sign up with the new link", newToken);
  expect
    .soft(old.status ?? 0, "the old link is refused")
    .toBeGreaterThanOrEqual(400);
  expect.soft(fresh.status, "the new link creates the account").toBe(200);
});

test("internal-notes-are-the-platform-owners-and-nobody-elses", async ({
  journey,
}) => {
  await createPlan(journey, "free", {
    permissions: await allPermissionIds(journey),
  });
  const owner = await register(journey, "noted", { workspaceName: "Noted Co" });
  const member = await joinMember(journey, "noted", "noted-member");
  const base = `/platform-notes/workspace/${owner.tenantId}`;
  const written = await saas(journey, "write a note", "POST", base, {
    body: { content: "  Watch this account  " },
  });
  const empty = await saas(journey, "write an empty note", "POST", base, {
    body: { content: "   " },
  });
  const listed = await saas(journey, "read the notes", "GET", base);
  expect
    .soft(written, "write: 200, content trimmed")
    .toMatchObject({ status: 200, body: { content: "Watch this account" } });
  expect.soft(empty.status, "an empty note is refused 400").toBe(400);
  expect
    .soft(listed.body, "the list holds the one note")
    .toMatchObject({ items: [{ content: "Watch this account" }] });

  const noteId = createdId(written);
  expect(member.ok, "the member joined").toBe(true);
  for (const who of ["noted", "noted-member", "anon"]) {
    const read = await saas(journey, `${who} reads the notes`, "GET", base, {
      as: who,
    });
    const write = await saas(journey, `${who} writes a note`, "POST", base, {
      as: who,
      body: { content: "I can write too" },
    });
    const remove = await saas(
      journey,
      `${who} deletes the note`,
      "DELETE",
      `/platform-notes/${noteId}`,
      { as: who },
    );
    expect.soft([401, 403], `${who}: read refused`).toContain(read.status);
    expect.soft([401, 403], `${who}: write refused`).toContain(write.status);
    expect.soft([401, 403], `${who}: delete refused`).toContain(remove.status);
  }
  const after = await saas(
    journey,
    "read the notes after the refusals",
    "GET",
    base,
  );
  expect
    .soft(after.body, "the note is untouched")
    .toMatchObject({ items: [{ content: "Watch this account" }] });

  const removed = await saas(
    journey,
    "the platform owner deletes the note",
    "DELETE",
    `/platform-notes/${noteId}`,
  );
  const gone = await saas(journey, "read the notes once deleted", "GET", base);
  expect.soft(removed.status, "the platform owner deletes it: 200").toBe(200);
  expect.soft(gone.body, "and no note is left").toMatchObject({ items: [] });
});

test("a-second-data-export-is-refused-while-one-is-running", async ({
  journey,
}) => {
  await createPlan(journey, "free", {
    permissions: await allPermissionIds(journey),
  });
  await register(journey, "exporter", { workspaceName: "Export Co" });
  const member = await joinMember(journey, "exporter", "export-member");
  const memberTry = await saas(
    journey,
    "a member starts an export",
    "POST",
    "/data-export/start",
    { as: "export-member" },
  );
  const firstExport = await saas(
    journey,
    "the first export",
    "POST",
    "/data-export/start",
    { as: "exporter" },
  );
  const secondExport = await saas(
    journey,
    "the second export",
    "POST",
    "/data-export/start",
    { as: "exporter" },
  );
  const results = [firstExport, secondExport];

  expect(member.ok, "the member joined").toBe(true);
  expect.soft(memberTry.status, "a member is refused 403").toBe(403);
  expect
    .soft(
      results.map((answer) => Number(answer.status)).toSorted((a, b) => a - b),
      "the first request starts (200) and the second, made while it runs, is refused (409)",
    )
    .toEqual([200, 409]);
  expect
    .soft(
      results
        .filter((answer) => answer.status === 409)
        .map((answer) => errorCode(answer)),
      "the refusal is saas.errors.data_export.already_running",
    )
    .toContain("saas.errors.data_export.already_running");
});

test("segment-money-columns-count-only-paying-workspaces-and-a-twelfth-of-a-yearly-price", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const yearly = await createPlan(journey, "yearly", {
    price: 120,
    interval: "year",
    order: 1,
  });
  const monthly = await createPlan(journey, "monthly", {
    price: 50,
    order: 2,
  });
  const cases = [
    {
      name: "mrr-yearly",
      plan: yearly.id,
      status: "active",
      gift: false,
      expected: "10.00",
    },
    {
      name: "mrr-monthly",
      plan: monthly.id,
      status: "active",
      gift: false,
      expected: "50.00",
    },
    {
      name: "mrr-trial",
      plan: monthly.id,
      status: "trialing",
      gift: false,
      expected: "0.00",
    },
    {
      name: "mrr-gift",
      plan: monthly.id,
      status: "active",
      gift: true,
      expected: "0.00",
    },
    {
      name: "mrr-suspended",
      plan: monthly.id,
      status: "suspended",
      gift: false,
      expected: "0.00",
    },
  ];
  const owners = new Map<string, string>();
  for (const entry of cases) {
    const visitor = await register(journey, entry.name, {
      workspaceName: entry.name,
    });
    owners.set(entry.name, visitor.email);
    await putSubscription(journey, visitor.tenantId, entry.plan, entry.status, {
      complimentary: entry.gift,
    });
  }

  const segment = await saas(
    journey,
    "create the segment",
    "POST",
    "/segments",
    {
      body: {
        name: "MRR cases",
        conditions: {
          logical: "and",
          conditions: [{ field: "email", operator: "contains", value: "mrr-" }],
        },
      },
    },
  );
  const segmentId = createdId(segment);
  const started = await saas(
    journey,
    "start the export",
    "POST",
    `/segments/${segmentId}/owners-export/start`,
  );
  const { jobId } = exportJob.parse(started.body);
  for (let attempt = 0; attempt < EXPORT_POLLS; attempt += 1) {
    const progress = await saas(
      journey,
      "export status",
      "GET",
      `/segments/${segmentId}/owners-export/status/${jobId}`,
    );
    if (exportProgress.safeParse(progress.body).data?.status === "completed") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, EXPORT_POLL_MS));
  }
  const file = await saas(
    journey,
    "download",
    "GET",
    `/segments/${segmentId}/owners-export/download/${jobId}`,
  );
  const rows = (z.string().safeParse(file.body).data ?? "")
    .split(CSV_ROW_BREAK)
    .slice(1)
    .filter((line) => line !== "")
    .map((line) => line.split(","));
  const ownedMrr = (email: string) =>
    rows.find((row) => row[CSV_EMAIL_COLUMN] === email)?.[CSV_OWNED_MRR_COLUMN];

  for (const entry of cases) {
    expect
      .soft(
        ownedMrr(owners.get(entry.name) ?? ""),
        `${entry.name}: ${entry.expected}`,
      )
      .toBe(entry.expected);
  }
});
