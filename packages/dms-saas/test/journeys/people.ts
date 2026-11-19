import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { Answer, Journey, Json } from "./journey.ts";
import { saas } from "./saas.ts";

/** The columns of an owners export. */
export const CSV_HEADER =
  "user_id,email,name,language,created_at,is_validated,workspaces,owned_workspaces,owned_mrr";

/** The rule `email contains alpha`. */
export const EMAIL_ALPHA = {
  field: "email",
  operator: "contains",
  value: "alpha",
};

const EXPORT_ATTEMPTS = 30;
const EXPORT_POLL_MS = 1000;
const segmentRow = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
});
const jobStarted = z.object({ jobId: z.string() });
const jobStatus = z.object({ status: z.string() });
const meRow = z.object({ _id: z.string() });

/** A segment write, as the editor sends it. */
export function saveSegment(
  journey: Journey,
  label: string,
  body: Json,
): Promise<Answer> {
  return saas(journey, label, "POST", "/segments", { body });
}

/** The id of the segment an answer created or returned, "" when it holds none. */
export function segmentId(answer: Answer): string {
  const row = segmentRow.safeParse(answer.body).data;
  return row?._id ?? row?.id ?? "";
}

/** A rule tree `levels` groups deep, its only condition `email contains alpha`. */
export function nested(levels: number): Json {
  return levels === 0
    ? EMAIL_ALPHA
    : { logical: "and", conditions: [nested(levels - 1)] };
}

/** The id of the signed-in platform admin. */
export async function adminId(journey: Journey): Promise<string> {
  const me = await journey.api("who am I", {
    method: "GET",
    path: "/api/auth/me",
  });
  return meRow.parse(me.body)._id;
}

/** Starts an owners export of a segment and reads the file once it is built, as CSV lines, header first. */
export async function exportedLines(
  journey: Journey,
  segmentId: string,
): Promise<string[]> {
  const started = await saas(
    journey,
    "start the owners export",
    "POST",
    `/segments/${segmentId}/owners-export/start`,
  );
  const { jobId } = jobStarted.parse(started.body);
  for (let attempt = 0; attempt < EXPORT_ATTEMPTS; attempt += 1) {
    const status = await saas(
      journey,
      "export status",
      "GET",
      `/segments/${segmentId}/owners-export/status/${jobId}`,
    );
    if (jobStatus.safeParse(status.body).data?.status === "completed") break;
    await sleep(EXPORT_POLL_MS);
  }
  const file = await saas(
    journey,
    "download the export",
    "GET",
    `/segments/${segmentId}/owners-export/download/${jobId}`,
  );
  return z
    .string()
    .parse(file.body)
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((line) => line !== "");
}

/** The rule `email contains value`. */
export function contains(value: string) {
  return { field: "email", operator: "contains", value };
}

/** Saves the five segments whose counts the journey checks: one e-mail, an or, an and, workspace owners and verified users. */
export async function createCountedSegments(journey: Journey) {
  const create = (label: string, conditions: Json) =>
    saveSegment(journey, `create the segment ${label}`, {
      name: label,
      conditions,
    });
  return {
    only: await create("only alpha", {
      logical: "and",
      conditions: [contains("alpha")],
    }),
    either: await create("alpha or beta", {
      logical: "or",
      conditions: [contains("alpha"), contains("beta")],
    }),
    both: await create("alpha and beta", {
      logical: "and",
      conditions: [contains("alpha"), contains("beta")],
    }),
    owners: await create("owners of a free workspace", {
      logical: "and",
      conditions: [
        {
          kind: "workspaceRef",
          quantifier: "any",
          role: "owner",
          conditions: {
            logical: "and",
            conditions: [{ field: "status", operator: "eq", value: "free" }],
          },
        },
      ],
    }),
    everyone: await create("a verified e-mail", {
      logical: "and",
      conditions: [{ field: "isValidated", operator: "eq", value: true }],
    }),
  };
}
