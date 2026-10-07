import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { Form, Grid, GridRow } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type {
  FormProps,
  FormSection,
} from "@antelopejs/interface-dms/base/form";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { HttpMethod } from "@antelopejs/interface-dms/base/types/http";
import { SegmentConditionsType } from "../../../utils";
import { SaasSegmentsController, SEGMENTS_PAGE_URL } from "./index";

const SEGMENTS_API = "/api/saas/segments";
const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;
const SPACING = "1.5rem";
const I18N = "$saas.segments.editor";

const SECTIONS: FormSection[] = [
  {
    id: "details",
    label: `${I18N}.details`,
    icon: "i-ph-text-aa",
    fields: [
      {
        id: "name",
        label: `${I18N}.name`,
        hint: `${I18N}.name_hint`,
        type: new DefaultDataTypes.StringType({
          maxLength: NAME_MAX_LENGTH,
          placeholder: `${I18N}.name_placeholder`,
        }),
        required: true,
      },
      {
        id: "description",
        label: `${I18N}.description`,
        hint: `${I18N}.description_hint`,
        type: new DefaultDataTypes.StringType({
          maxLength: DESCRIPTION_MAX_LENGTH,
          placeholder: `${I18N}.description_placeholder`,
        }),
      },
    ],
  },
  {
    id: "rules",
    label: `${I18N}.conditions`,
    description: `${I18N}.conditions_description`,
    icon: "i-ph-funnel",
    fields: [
      {
        id: "conditions",
        type: new SegmentConditionsType({
          fieldsCatalogUrl: `${SEGMENTS_API}/fields`,
        }),
      },
    ],
  },
];

const BASE_FORM: FormProps = {
  sections: SECTIONS,
  sectionNav: "none",
  saveMode: "bar",
  submitLabel: `${I18N}.save`,
  labelKey: "name",
  backTo: SEGMENTS_PAGE_URL,
};

const preview = CustomComponent("DmsSaasSegmentLivePreview").meta({
  name: "$saas.permissions.users.segment_preview",
  description: "$saas.permissions.users.segment_preview_description",
  icon: "i-ph-eye",
});

function editorLayout(form: FormProps) {
  return Grid({ gap: SPACING }).child(
    "row",
    GridRow()
      .child("form", Form(form), { colSpan: 2 })
      .child("preview", preview, { colSpan: 1 }),
  );
}

@RegisterPage()
export class SaasSegmentNewController extends PageController(
  "new",
  {
    displayName: `${I18N}.new_title`,
    description: `${I18N}.new_description`,
    category: SaasSegmentsController,
    urlSlug: "new",
    icon: "i-ph-plus",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static editor = editorLayout({
    ...BASE_FORM,
    submitUrl: SEGMENTS_API,
    submitUrlMethod: HttpMethod.post,
    successMessage: `${I18N}.created`,
    redirectOnSuccess: `${SEGMENTS_PAGE_URL}/{{response._id}}/edit`,
  });
}

@RegisterPage()
export class SaasSegmentEditController extends PageController(
  "edit",
  {
    displayName: `${I18N}.edit_title`,
    description: `${I18N}.edit_description`,
    category: SaasSegmentsController,
    urlSlug: ":id/edit",
    icon: "i-ph-pencil-simple",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static editor = editorLayout({
    ...BASE_FORM,
    fetchUrl: `${SEGMENTS_API}/{{params.id}}`,
    submitUrl: `${SEGMENTS_API}/{{params.id}}`,
    submitUrlMethod: HttpMethod.put,
    successMessage: `${I18N}.saved`,
  });
}
