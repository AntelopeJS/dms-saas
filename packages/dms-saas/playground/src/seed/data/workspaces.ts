import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { PLAN_IDS } from "./catalogue";
import { ADMIN_ID, HUGO_ID } from "./people";
import type {
  DayOffset,
  SeedBillingProfile,
  SeedMember,
  SeedSubscription,
  SeedWorkspace,
} from "./types";

/** How long a DMS invitation stays valid. */
const INVITATION_VALIDITY_DAYS = 7;

export const WORKSPACE_IDS = {
  northwind: "northwind-traders",
  umbrella: "umbrella-medical",
  wayne: "wayne-enterprises",
  initech: "initech",
  acme: "acme",
  stark: "stark-industries",
  globex: "globex",
  hooli: "hooli",
  soylent: "soylent-foods",
  piedPiper: "pied-piper",
  vandelay: "vandelay",
  massiveDynamic: "massive-dynamic",
  aviato: "aviato",
} as const;

const W = WORKSPACE_IDS;

function owner(userId: string, joinedOn: DayOffset): SeedMember {
  return { userId, isTenantOwner: true, joinedOn };
}

function member(userId: string, joinedOn: DayOffset): SeedMember {
  return { userId, isTenantOwner: false, joinedOn };
}

/** A subscription with every optional field at rest, for the specs to override. */
const QUIET_SUBSCRIPTION: SeedSubscription = {
  planId: PLAN_IDS.free,
  status: "active",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  cardFingerprint: null,
  currentPeriodEndOn: null,
  freeUntilOn: null,
  pastDueSinceOn: null,
  isComplimentary: false,
  updatedOn: 0,
  createdBy: null,
};

function subscription(overrides: Partial<SeedSubscription>): SeedSubscription {
  return { ...QUIET_SUBSCRIPTION, ...overrides };
}

function business(
  companyName: string,
  vatNumber: string | null,
  billingEmail: string,
  address: SeedBillingProfile["address"],
): SeedBillingProfile {
  return {
    customerType: "business",
    companyName,
    vatNumber,
    billingEmail,
    address,
  };
}

function address(
  line1: string,
  postalCode: string,
  city: string,
  country: string,
): SeedBillingProfile["address"] {
  return { line1, line2: null, postalCode, city, state: null, country };
}

/** The platform's own workspace, where the first admin lands, as on onboarding. */
export const DEFAULT_WORKSPACE: SeedWorkspace = {
  id: DEFAULT_TENANT_ID,
  name: "Default",
  createdOn: -702,
  members: [owner(ADMIN_ID, -702)],
  invitations: [],
  subscription: subscription({ updatedOn: -702 }),
  billingProfile: null,
};

export const WORKSPACES: SeedWorkspace[] = [
  {
    id: W.northwind,
    name: "Northwind Traders",
    createdOn: -574,
    members: [
      owner("user-margaux-dubois", -574),
      member("user-thomas-bernard", -572),
      member("user-lea-garnier", -380),
      member("user-antoine-petit", -210),
      member("user-chloe-lambert", -95),
    ],
    invitations: [
      {
        email: "julien.roux@northwind.eu",
        firstname: "Julien",
        lastname: "Roux",
        asTenantOwner: false,
        sentOn: -2,
        expiresOn: INVITATION_VALIDITY_DAYS - 2,
        invitedBy: "user-margaux-dubois",
      },
    ],
    subscription: subscription({
      planId: PLAN_IDS.business,
      stripeCustomerId: "cus_Q2m8Lx4vTnR1",
      stripeSubscriptionId: "sub_1Q2m8LKZ4vTnR1aBc9dE",
      cardFingerprint: "Nw7kQ2xLp9TzR4mV",
      currentPeriodEndOn: 24,
      updatedOn: -6,
      createdBy: "user-margaux-dubois",
    }),
    billingProfile: business(
      "Northwind Traders SAS",
      "FR40303265045",
      "billing@northwind.eu",
      address("12 rue de la Paix", "75002", "Paris", "FR"),
    ),
  },
  {
    id: W.umbrella,
    name: "Umbrella Medical",
    createdOn: -491,
    members: [
      owner("user-alice-moreau", -491),
      member("user-nina-sharp", -247),
      member("user-paul-girard", -300),
      member("user-emma-fontaine", -120),
    ],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.business,
      stripeCustomerId: "cus_Pk3Ru7WmHs2D",
      stripeSubscriptionId: "sub_1Pk3RuKZ7WmHs2DfG4hJ",
      cardFingerprint: "Um3pV8wQs1KdN6tY",
      currentPeriodEndOn: 7,
      updatedOn: -23,
      createdBy: "user-alice-moreau",
    }),
    billingProfile: business(
      "Umbrella Medical SA",
      "FR83404833048",
      "accounts@umbrella-medical.com",
      address("8 quai Claude Bernard", "69007", "Lyon", "FR"),
    ),
  },
  {
    id: W.wayne,
    name: "Wayne Enterprises",
    createdOn: -613,
    members: [owner("user-lucius-fox", -613), member("user-bruce-wayne", -600)],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.enterprise,
      stripeCustomerId: "cus_Nb6Ty2QeLw9X",
      stripeSubscriptionId: "sub_1Nb6TyKZ2QeLw9XkL3mN",
      cardFingerprint: "We9cT1bHn5RqZ2xK",
      currentPeriodEndOn: 117,
      updatedOn: -248,
      createdBy: "user-lucius-fox",
    }),
    billingProfile: business(
      "Wayne Enterprises, Inc.",
      null,
      "ap@wayne-enterprises.com",
      {
        ...address("1007 Mountain Drive", "10001", "Gotham", "US"),
        state: "NJ",
      },
    ),
  },
  {
    id: W.initech,
    name: "Initech",
    createdOn: -321,
    members: [
      owner("user-bill-lumbergh", -321),
      member("user-peter-gibbons", -318),
      member("user-samir-nagheenanajar", -317),
      member("user-milton-waddams", -30),
      member(HUGO_ID, -12),
    ],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.business,
      status: "past_due",
      stripeCustomerId: "cus_Oj4Hd8VnPq3S",
      stripeSubscriptionId: "sub_1Oj4HdKZ8VnPq3SpQ7rS",
      cardFingerprint: "In4dH8vNp3QsJ7wE",
      currentPeriodEndOn: 21,
      pastDueSinceOn: -9,
      updatedOn: -9,
      createdBy: "user-bill-lumbergh",
    }),
    billingProfile: business(
      "Initech LLC",
      "DE811907980",
      "finance@initech.com",
      address("Friedrichstraße 68", "10117", "Berlin", "DE"),
    ),
  },
  {
    id: W.acme,
    name: "acme",
    createdOn: -637,
    members: [
      owner(ADMIN_ID, -637),
      member("user-jules-lefevre", -540),
      member(HUGO_ID, -400),
    ],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.business,
      stripeCustomerId: "cus_Mh2Zc5KtRb8F",
      stripeSubscriptionId: "sub_1Mh2ZcKZ5KtRb8FtU2vW",
      cardFingerprint: "Ac2mE5kTr8BfZ1qL",
      currentPeriodEndOn: 11,
      updatedOn: -19,
      createdBy: ADMIN_ID,
    }),
    billingProfile: business(
      "Acme SARL",
      "FR27514867391",
      "admin@example.com",
      address("4 place Bellecour", "69002", "Lyon", "FR"),
    ),
  },
  {
    id: W.stark,
    name: "Stark Industries",
    createdOn: -22,
    members: [owner("user-pepper-potts", -22), member("user-happy-hogan", -20)],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.pro,
      status: "trialing",
      stripeCustomerId: "cus_Qs9Tk4MbVx6P",
      stripeSubscriptionId: "sub_1Qs9TkKZ4MbVx6PxY5zA",
      cardFingerprint: "St6pK4mBv9XqT3nR",
      currentPeriodEndOn: 6,
      updatedOn: -22,
      createdBy: "user-pepper-potts",
    }),
    billingProfile: business("Stark Industries", null, "pepper@stark.com", {
      ...address("200 Park Avenue", "10166", "New York", "US"),
      state: "NY",
    }),
  },
  {
    id: W.globex,
    name: "Globex",
    createdOn: -96,
    members: [],
    invitations: [
      {
        email: "hank@globex.com",
        firstname: "Hank",
        lastname: "Scorpio",
        asTenantOwner: true,
        sentOn: -3,
        expiresOn: INVITATION_VALIDITY_DAYS - 3,
        invitedBy: ADMIN_ID,
      },
    ],
    subscription: subscription({
      planId: PLAN_IDS.business,
      freeUntilOn: 4,
      isComplimentary: true,
      updatedOn: -96,
      createdBy: ADMIN_ID,
    }),
    billingProfile: null,
  },
  {
    id: W.hooli,
    name: "Hooli",
    createdOn: -549,
    members: [
      owner("user-gavin-belson", -549),
      member("user-richard-hendricks", -200),
    ],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.team,
      stripeCustomerId: "cus_Lq7Wn3GzJc1M",
      freeUntilOn: 7,
      isComplimentary: true,
      updatedOn: -53,
      createdBy: "user-gavin-belson",
    }),
    billingProfile: business(
      "Hooli XYZ",
      "NL853746333B01",
      "billing@hooli.com",
      address("Herengracht 182", "1016 BR", "Amsterdam", "NL"),
    ),
  },
  {
    id: W.soylent,
    name: "Soylent Foods",
    createdOn: -8,
    members: [],
    invitations: [
      {
        email: "ops@soylent.eu",
        firstname: null,
        lastname: null,
        asTenantOwner: true,
        sentOn: -6,
        expiresOn: 1,
        invitedBy: HUGO_ID,
      },
    ],
    subscription: subscription({
      planId: PLAN_IDS.pro,
      status: "pending_payment",
      updatedOn: -8,
      createdBy: HUGO_ID,
    }),
    billingProfile: null,
  },
  {
    id: W.piedPiper,
    name: "Pied Piper",
    createdOn: -523,
    members: [
      owner("user-richard-hendricks", -523),
      member("user-dinesh-chugtai", -520),
    ],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.starter,
      status: "suspended",
      stripeCustomerId: "cus_Kp5Fs9DwYh4N",
      stripeSubscriptionId: "sub_1Kp5FsKZ9DwYh4NbC6dE",
      cardFingerprint: "Pp5fS9dWy4HnM8kQ",
      currentPeriodEndOn: -8,
      updatedOn: -17,
      createdBy: "user-richard-hendricks",
    }),
    billingProfile: {
      customerType: "individual",
      companyName: null,
      vatNumber: null,
      billingEmail: "richard@piedpiper.com",
      address: {
        ...address("5230 Newell Road", "94303", "Palo Alto", "US"),
        state: "CA",
      },
    },
  },
  {
    id: W.vandelay,
    name: "Vandelay Industries",
    createdOn: -556,
    members: [],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.pro,
      status: "cancelled",
      stripeCustomerId: "cus_Jr8Gv2NxTk5B",
      stripeSubscriptionId: "sub_1Jr8GvKZ2NxTk5BfG8hI",
      cardFingerprint: "Vd8gV2nXt5KbL1pW",
      currentPeriodEndOn: -25,
      updatedOn: -25,
      createdBy: null,
    }),
    billingProfile: business(
      "Vandelay Industries",
      "BE0417497106",
      "art@vandelay.com",
      address("Avenue Louise 54", "1050", "Brussels", "BE"),
    ),
  },
  {
    id: W.massiveDynamic,
    name: "Massive Dynamic",
    createdOn: -247,
    members: [owner("user-nina-sharp", -247)],
    invitations: [],
    subscription: subscription({
      planId: PLAN_IDS.pro,
      isComplimentary: true,
      updatedOn: -247,
      createdBy: ADMIN_ID,
    }),
    billingProfile: null,
  },
  {
    id: W.aviato,
    name: "Aviato",
    createdOn: -150,
    members: [owner("user-erlich-bachman", -150)],
    invitations: [],
    subscription: subscription({
      updatedOn: -150,
      createdBy: "user-erlich-bachman",
    }),
    billingProfile: {
      customerType: "individual",
      companyName: null,
      vatNumber: null,
      billingEmail: "erlich@aviato.com",
      address: {
        ...address("5230 Newell Road", "94303", "Palo Alto", "US"),
        state: "CA",
      },
    },
  },
];
