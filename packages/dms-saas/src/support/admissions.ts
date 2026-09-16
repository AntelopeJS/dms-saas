import { assert } from "@antelopejs/interface-api-util";
import {
  BasicDataModel,
  Field,
  GetModel,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import {
  DeleteFile,
  GetFileMetadata,
  PromoteFile,
  stripStagingPrefix,
} from "@antelopejs/interface-file-storage";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import {
  assertSupportAttachmentMetadata,
  assertSupportAttachmentPath,
} from "./attachments";
import { tenantSupportAttachmentPath } from "./config";
import {
  type SupportOperation,
  SupportOperationModel,
  supportPublication,
} from "./operations";
import { getSupportUpload, type SupportUpload } from "./uploads";

const HTTP_CONFLICT = 409;
const HTTP_UNAVAILABLE = 503;
const SUPPORT_ADMISSIONS_TABLE = "support_attachment_admissions";

/** Source ownership is insert-only; promotion confirmation is monotonic and never releases ownership. */
@RegisterTable(SUPPORT_ADMISSIONS_TABLE, CORE_SCHEMA_NAME)
export class SupportAttachmentAdmission extends Table {
  @Field("string")
  declare _id: string;
  @Index()
  @Field("string")
  declare operationId: string;
  @Field("string")
  declare stagedKey: string;
  @Field("string")
  declare storage: string;
  @Field("string")
  declare finalKey: string;
  @Field("string")
  declare revision: string;
  @Field("boolean")
  declare promotionConfirmed: boolean;
}

/** Keeps immutable admission ownership separate from positive promotion evidence. */
export class SupportAttachmentAdmissionModel extends BasicDataModel(
  SupportAttachmentAdmission,
) {
  /** Reconciles insert acknowledgement against permanent business ownership. */
  async admit(
    candidate: SupportAttachmentAdmission,
  ): Promise<SupportAttachmentAdmission> {
    try {
      await this.insert(candidate);
    } catch {
      // Duplicate requests and uncertain acknowledgements require the same ownership read.
    }
    const admitted = await this.get(candidate._id);
    assert(
      admitted,
      HTTP_UNAVAILABLE,
      "saas.errors.support.attachment_pending",
    );
    assert(
      admitted.operationId === candidate.operationId,
      HTTP_CONFLICT,
      "saas.errors.support.attachment_already_admitted",
    );
    return admitted;
  }

  /** Confirms only a successful trusted-origin promotion, including a late rejected worker's orphan. */
  async confirmPromotion(admission: SupportAttachmentAdmission): Promise<void> {
    if (admission.promotionConfirmed) return;
    await this.table
      .atomicMutation(admission._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: `${admission._id}:admitted`,
        nextRevision: `${admission._id}:promoted`,
        patch: { promotionConfirmed: true },
      })
      .run();
    const stored = await this.get(admission._id);
    assert(
      stored?.promotionConfirmed,
      HTTP_UNAVAILABLE,
      "saas.errors.support.attachment_pending",
    );
  }
}

async function admitAttachment(
  operationId: string,
  upload: SupportUpload,
): Promise<SupportAttachmentAdmission> {
  return GetModel(SupportAttachmentAdmissionModel).admit({
    _id: upload._id,
    operationId,
    stagedKey: upload.stagedKey,
    storage: upload.storage,
    finalKey: stripStagingPrefix(upload.stagedKey),
    revision: `${upload._id}:admitted`,
    promotionConfirmed: false,
  });
}

async function prepareAdmission(
  operations: SupportOperationModel,
  admission: SupportAttachmentAdmission,
): Promise<void> {
  const operation = await operations.get(admission.operationId);
  assert(operation, HTTP_UNAVAILABLE, "saas.errors.support.operation_pending");
  assert(
    operation.status !== "rejected",
    HTTP_CONFLICT,
    "saas.errors.support.tenant_busy",
  );
  if (operation.status !== "prepared") return;
  const promoted = await PromoteFile(admission.stagedKey, admission.storage);
  assert(
    promoted.resourceKey === admission.finalKey,
    HTTP_UNAVAILABLE,
    "saas.errors.support.attachment_pending",
  );
  await GetModel(SupportAttachmentAdmissionModel).confirmPromotion(admission);
  const metadata = await GetFileMetadata(admission.finalKey, admission.storage);
  assertSupportAttachmentMetadata(metadata);
}

/** Admits an issued private source, promotes with no fallback, then validates the final immutable metadata. */
export async function prepareSupportAttachments(
  operations: SupportOperationModel,
  operation: SupportOperation,
  tenantId: string,
): Promise<void> {
  const { stagedKeys } = supportPublication(operation);
  for (const key of stagedKeys)
    assertSupportAttachmentPath(key, tenantSupportAttachmentPath(tenantId));
  for (const key of stagedKeys) {
    const upload = await getSupportUpload(tenantId, key);
    const admission = await admitAttachment(operation._id, upload);
    await prepareAdmission(operations, admission);
  }
}

/** Repeats physical cleanup of owned rejected work; unconfirmed finals are deliberately retained. */
export async function cancelSupportAttachments(
  operation: SupportOperation,
): Promise<void> {
  assert(
    operation.status === "rejected",
    HTTP_UNAVAILABLE,
    "saas.errors.support.operation_pending",
  );
  const admissions = await GetModel(SupportAttachmentAdmissionModel).getBy(
    "operationId",
    operation._id,
  );
  const outcomes = await Promise.allSettled(
    admissions.flatMap((admission) => {
      const keys = admission.promotionConfirmed
        ? [admission.finalKey, admission.stagedKey]
        : [admission.stagedKey];
      return keys.map((key) => DeleteFile(key, admission.storage));
    }),
  );
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (failures.length)
    throw new AggregateError(
      failures,
      "Support attachment cancellation pending",
    );
}
