import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { Form } from "@antelopejs/interface-dms/base/form";

@RegisterPage()
export class PageWelcome extends PageController("welcome", {
  displayName: "Welcome",
  icon: "i-ph-hand-waving",
  category: pagesCategory,
  order: 0,
  description: "Playground welcome page",
}) {
  static form = Form({
    title: "Welcome",
    description: "Static form on the playground welcome page",
    fields: [
      {
        id: "name",
        label: "Name",
        type: new DefaultDataTypes.StringType({
          placeholder: "Your name",
          maxLength: 100,
        }),
      },
      {
        id: "email",
        label: "Email",
        type: new DefaultDataTypes.EmailType({
          placeholder: "email@example.com",
        }),
      },
      {
        id: "message",
        label: "Message",
        type: new DefaultDataTypes.StringType({
          placeholder: "Type a message…",
          textarea: true,
          rows: 4,
          maxLength: 500,
        }),
      },
    ],
  });
}
