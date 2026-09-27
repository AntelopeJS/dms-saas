/** Limits applied to public registration extras before hooks receive them. */
export interface RegistrationExtrasLimits {
  maxSerialisedBytes: number;
  maxKeys: number;
  maxDepth: number;
}

/** Bounds consumers can apply before sending registration extras. */
export const REGISTRATION_EXTRAS_LIMITS: RegistrationExtrasLimits = {
  maxSerialisedBytes: 4096,
  maxKeys: 64,
  maxDepth: 4,
};
