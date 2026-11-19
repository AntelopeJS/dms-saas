import { guarded } from "../guard.mjs";
import { peopleMoreJourneys } from "./parts/people-more.mjs";

/** Customers › Users and Segments, in the browser. */
export const journeys = guarded(peopleMoreJourneys);
