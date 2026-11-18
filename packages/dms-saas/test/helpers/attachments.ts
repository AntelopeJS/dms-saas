import { ImplementInterface } from "@antelopejs/interface-core";
import * as attachments from "@antelopejs/interface-dms/attachments";
import * as uploads from "@antelopejs/interface-dms/uploads";

const UNUSED_HANDLER = () => {
  throw new Error("Not implemented by the suite");
};

/**
 * Implements `SaveComponentFiles` as a DMS whose files are already promoted:
 * it hands the submitted values to the save untouched and keeps each request,
 * whose `before` names the files the DMS deletes once the save succeeds.
 */
export function implementPromotedFileSave(): attachments.AttachmentSaveRequest[] {
  const requests: attachments.AttachmentSaveRequest[] = [];
  ImplementInterface(attachments, {
    internal: { SaveTableViewAttachments: UNUSED_HANDLER },
    SaveComponentFiles: async (request, save) => {
      requests.push(request);
      return (await save(request.submitted)).result;
    },
    GetAttachmentValidationMetadata: UNUSED_HANDLER,
  });
  return requests;
}

/**
 * Implements the signing of upload tokens, which a form serializing a file
 * or image field asks the DMS for.
 */
export function implementUploadTokens(): void {
  ImplementInterface(uploads, {
    internal: {
      RegisterNativeUploadField: {
        register: () => undefined,
        unregister: () => undefined,
      },
    },
    SignUploadToken: async () => "suite-upload-token",
  });
}
