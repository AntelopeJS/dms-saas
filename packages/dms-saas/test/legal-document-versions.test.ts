import { describe, expect, it } from "vitest";
import type { LegalDocumentsModel } from "../src/db";
import {
  bumpLegalDocumentVersions,
  readLegalDocuments,
  readLegalDocumentVersions,
  saveLegalDocuments,
} from "../src/operator-billing";
import { LegalDocumentsController } from "../src/routes/public/legal-documents";

const MARCH = new Date("2026-03-12T10:00:00Z");
const NOW = new Date("2026-10-07T12:00:00Z");
const NEVER = { version: 0, publishedAt: null };

type Row = Record<string, unknown>;

function memoryModel(initial?: Row) {
  let row = initial;
  const model = {
    get: async () => row,
    insert: async ([inserted]: Row[]) => {
      row = inserted;
    },
    update: async (_id: string, patch: Row) => {
      row = { ...row, ...patch };
    },
  };
  return {
    model: model as unknown as LegalDocumentsModel,
    current: () => row,
  };
}

describe("legal document versions", () => {
  it("counts a document saved before versions as version 1", () => {
    expect(
      readLegalDocumentVersions({
        termsOfUse: "<p>Terms</p>",
        termsAndConditions: "",
        privacyPolicy: "",
        updatedAt: MARCH,
      }),
    ).toEqual({
      termsOfUse: { version: 1, publishedAt: MARCH },
      termsAndConditions: NEVER,
      privacyPolicy: NEVER,
    });
  });

  it("publishes the next version of a changed document only", () => {
    const row = {
      termsOfUse: "<p>v4</p>",
      privacyPolicy: "<p>v5</p>",
      termsAndConditions: "",
      versions: {
        termsOfUse: { version: 4, publishedAt: MARCH },
        privacyPolicy: { version: 5, publishedAt: MARCH },
      },
      updatedAt: MARCH,
    };

    expect(
      bumpLegalDocumentVersions(
        row,
        { termsOfUse: "<p>v4</p>", privacyPolicy: "<p>v6</p>" },
        NOW,
      ),
    ).toEqual({
      termsOfUse: { version: 4, publishedAt: MARCH },
      privacyPolicy: { version: 6, publishedAt: NOW },
      termsAndConditions: NEVER,
    });
  });

  it("unpublishes an emptied document without reusing its number", () => {
    const row = {
      termsOfUse: "<p>v2</p>",
      versions: { termsOfUse: { version: 2, publishedAt: MARCH } },
    };

    expect(
      bumpLegalDocumentVersions(row, { termsOfUse: "" }, NOW).termsOfUse,
    ).toEqual({ version: 2, publishedAt: null });
  });

  it("saves texts and versions together, and nothing when nothing changed", async () => {
    const store = memoryModel();
    await saveLegalDocuments(store.model, { termsOfUse: "<p>v1</p>" }, NOW);
    const saved = store.current();

    expect(saved).toMatchObject({
      termsOfUse: "<p>v1</p>",
      versions: { termsOfUse: { version: 1, publishedAt: NOW } },
    });

    await saveLegalDocuments(
      store.model,
      { termsOfUse: "<p>v1</p>" },
      new Date(),
    );
    expect(store.current()).toBe(saved);
  });

  it("serves the three texts and their versions publicly", async () => {
    const controller = new LegalDocumentsController();
    controller.legalDocumentsModel = memoryModel({
      termsOfUse: "<p>Terms</p>",
      termsAndConditions: "",
      privacyPolicy: "<p>Privacy</p>",
      versions: { privacyPolicy: { version: 5, publishedAt: MARCH } },
      updatedAt: MARCH,
    }).model;

    expect(await controller.get()).toEqual({
      termsOfUse: "<p>Terms</p>",
      termsAndConditions: "",
      privacyPolicy: "<p>Privacy</p>",
      updatedAt: MARCH,
      versions: {
        termsOfUse: { version: 1, publishedAt: MARCH },
        termsAndConditions: NEVER,
        privacyPolicy: { version: 5, publishedAt: MARCH },
      },
    });
  });

  it("serves empty, never published documents before the row exists", async () => {
    const documents = await readLegalDocuments(memoryModel().model);

    expect(documents.versions).toEqual({
      termsOfUse: NEVER,
      termsAndConditions: NEVER,
      privacyPolicy: NEVER,
    });
  });
});
