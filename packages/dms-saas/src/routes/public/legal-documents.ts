import { Controller, Get, JSONBody, Put } from "@antelopejs/interface-api";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { LEGAL_DOCUMENTS_SINGLETON_ID, LegalDocumentsModel } from "../../db";

interface LegalDocumentsBody {
  termsOfUse: string;
  termsAndConditions: string;
  privacyPolicy: string;
}

const EMPTY_DOCUMENTS = {
  _id: LEGAL_DOCUMENTS_SINGLETON_ID,
  termsOfUse: "",
  termsAndConditions: "",
  privacyPolicy: "",
  updatedAt: new Date(0),
};

export async function ensureLegalDocumentsSingleton(): Promise<void> {
  const legalDocumentsModel = GetModel(LegalDocumentsModel);
  const existing = await legalDocumentsModel.get(LEGAL_DOCUMENTS_SINGLETON_ID);
  if (existing) return;
  await legalDocumentsModel.insert([
    { ...EMPTY_DOCUMENTS, updatedAt: new Date() },
  ]);
}

export class LegalDocumentsController extends Controller(
  "/api/saas/legal-documents",
) {
  @Model(LegalDocumentsModel)
  declare legalDocumentsModel: LegalDocumentsModel;

  @Get("/")
  async get() {
    const existing = await this.legalDocumentsModel.get(
      LEGAL_DOCUMENTS_SINGLETON_ID,
    );
    return existing ?? EMPTY_DOCUMENTS;
  }

  @Put("/")
  async update(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: LegalDocumentsBody,
  ) {
    await ensureLegalDocumentsSingleton();
    await this.legalDocumentsModel.update(LEGAL_DOCUMENTS_SINGLETON_ID, {
      termsOfUse: body.termsOfUse,
      termsAndConditions: body.termsAndConditions,
      privacyPolicy: body.privacyPolicy,
      updatedAt: new Date(),
    });
    return this.legalDocumentsModel.get(LEGAL_DOCUMENTS_SINGLETON_ID);
  }
}
