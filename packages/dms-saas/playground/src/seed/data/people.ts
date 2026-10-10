import type { DayOffset, SeedUser } from "./types";

/** The account a reviewer signs in with: platform admin and owner of acme. */
export const PLATFORM_ADMIN_EMAIL = "admin@example.com";

/**
 * Shared by every seeded account. Written straight to the user table, so it
 * is not held to the DMS password policy, which refuses the dash.
 */
export const SEED_PASSWORD = "Playground-Admin-1!";

export const ADMIN_ID = "user-camille-laurent";
export const HUGO_ID = "user-hugo-martin";
export const SOFIA_ID = "user-sofia-rossi";

const EN = "en";
const FR = "fr";

interface Person {
  id: string;
  name: string;
  email: string;
  language: string;
  createdOn: DayOffset;
  lastActiveOn: DayOffset | null;
}

function admin(person: Person): SeedUser {
  return { ...person, isValidated: true, isPlatformAdmin: true };
}

function customer(person: Person): SeedUser {
  return { ...person, isValidated: true, isPlatformAdmin: false };
}

function unverified(person: Person): SeedUser {
  return { ...person, isValidated: false, isPlatformAdmin: false };
}

/** The platform admin comes last: its row is the marker of a complete seed. */
export const PLATFORM_ADMIN: SeedUser = admin({
  id: ADMIN_ID,
  name: "Camille Laurent",
  email: PLATFORM_ADMIN_EMAIL,
  language: EN,
  createdOn: -702,
  lastActiveOn: 0,
});

export const OTHER_USERS: SeedUser[] = [
  admin({
    id: HUGO_ID,
    name: "Hugo Martin",
    email: "hugo@antelope.io",
    language: FR,
    createdOn: -625,
    lastActiveOn: 0,
  }),
  admin({
    id: SOFIA_ID,
    name: "Sofia Rossi",
    email: "sofia@antelope.io",
    language: EN,
    createdOn: -410,
    lastActiveOn: -3,
  }),
  customer({
    id: "user-margaux-dubois",
    name: "Margaux Dubois",
    email: "margaux@northwind.eu",
    language: FR,
    createdOn: -574,
    lastActiveOn: 0,
  }),
  customer({
    id: "user-thomas-bernard",
    name: "Thomas Bernard",
    email: "thomas.bernard@northwind.eu",
    language: FR,
    createdOn: -572,
    lastActiveOn: 0,
  }),
  customer({
    id: "user-lea-garnier",
    name: "Léa Garnier",
    email: "lea.garnier@northwind.eu",
    language: FR,
    createdOn: -380,
    lastActiveOn: -2,
  }),
  customer({
    id: "user-antoine-petit",
    name: "Antoine Petit",
    email: "antoine.petit@northwind.eu",
    language: FR,
    createdOn: -210,
    lastActiveOn: -18,
  }),
  customer({
    id: "user-chloe-lambert",
    name: "Chloé Lambert",
    email: "chloe.lambert@northwind.eu",
    language: EN,
    createdOn: -95,
    lastActiveOn: -1,
  }),
  unverified({
    id: "user-julien-roux",
    name: "Julien Roux",
    email: "julien.roux@northwind.eu",
    language: FR,
    createdOn: -11,
    lastActiveOn: null,
  }),
  customer({
    id: "user-alice-moreau",
    name: "Alice Moreau",
    email: "alice@umbrella-medical.com",
    language: FR,
    createdOn: -491,
    lastActiveOn: -1,
  }),
  customer({
    id: "user-nina-sharp",
    name: "Nina Sharp",
    email: "nina.sharp@massivedynamic.com",
    language: EN,
    createdOn: -247,
    lastActiveOn: -41,
  }),
  customer({
    id: "user-paul-girard",
    name: "Paul Girard",
    email: "paul.girard@umbrella-medical.com",
    language: FR,
    createdOn: -300,
    lastActiveOn: -5,
  }),
  customer({
    id: "user-emma-fontaine",
    name: "Emma Fontaine",
    email: "emma.fontaine@umbrella-medical.com",
    language: FR,
    createdOn: -120,
    lastActiveOn: -33,
  }),
  customer({
    id: "user-lucius-fox",
    name: "Lucius Fox",
    email: "lucius@wayne-enterprises.com",
    language: EN,
    createdOn: -613,
    lastActiveOn: -4,
  }),
  customer({
    id: "user-bruce-wayne",
    name: "Bruce Wayne",
    email: "bruce@wayne-enterprises.com",
    language: EN,
    createdOn: -600,
    lastActiveOn: -62,
  }),
  customer({
    id: "user-bill-lumbergh",
    name: "Bill Lumbergh",
    email: "bill@initech.com",
    language: EN,
    createdOn: -321,
    lastActiveOn: -6,
  }),
  customer({
    id: "user-peter-gibbons",
    name: "Peter Gibbons",
    email: "peter@initech.com",
    language: EN,
    createdOn: -318,
    lastActiveOn: -45,
  }),
  customer({
    id: "user-samir-nagheenanajar",
    name: "Samir Nagheenanajar",
    email: "samir@initech.com",
    language: EN,
    createdOn: -317,
    lastActiveOn: -9,
  }),
  unverified({
    id: "user-milton-waddams",
    name: "Milton Waddams",
    email: "milton@initech.com",
    language: EN,
    createdOn: -30,
    lastActiveOn: null,
  }),
  customer({
    id: "user-jules-lefevre",
    name: "Jules Lefèvre",
    email: "jules@acme.fr",
    language: FR,
    createdOn: -540,
    lastActiveOn: -2,
  }),
  customer({
    id: "user-pepper-potts",
    name: "Pepper Potts",
    email: "pepper@stark.com",
    language: EN,
    createdOn: -22,
    lastActiveOn: -1,
  }),
  customer({
    id: "user-happy-hogan",
    name: "Happy Hogan",
    email: "happy@stark.com",
    language: EN,
    createdOn: -20,
    lastActiveOn: -7,
  }),
  customer({
    id: "user-gavin-belson",
    name: "Gavin Belson",
    email: "gavin@hooli.com",
    language: EN,
    createdOn: -549,
    lastActiveOn: -2,
  }),
  customer({
    id: "user-richard-hendricks",
    name: "Richard Hendricks",
    email: "richard@piedpiper.com",
    language: EN,
    createdOn: -523,
    lastActiveOn: -9,
  }),
  customer({
    id: "user-dinesh-chugtai",
    name: "Dinesh Chugtai",
    email: "dinesh@piedpiper.com",
    language: EN,
    createdOn: -520,
    lastActiveOn: -16,
  }),
  customer({
    id: "user-erlich-bachman",
    name: "Erlich Bachman",
    email: "erlich@aviato.com",
    language: EN,
    createdOn: -150,
    lastActiveOn: -27,
  }),
];
