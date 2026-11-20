import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { Form } from "@antelopejs/interface-dms/base/form";

/** The page `homepage: "/welcome"` of this project's DMS config points at. */
@RegisterPage()
export class PageWelcome extends PageController("welcome", {
  displayName: "Welcome",
  icon: "i-ph-hand-waving",
  category: pagesCategory,
  order: 0,
  description: "End-to-end welcome page",
}) {
  static form = Form({
    title: "Welcome",
    description: "Static form on the end-to-end welcome page",
    fields: [
      {
        id: "name",
        label: "Name",
        type: new DefaultDataTypes.StringType({
          placeholder: "Your name",
          maxLength: 100,
        }),
      },
    ],
  });
}
