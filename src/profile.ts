import profileToml from "../profiles/glm-4.7-flash.toml";
import type { Profile } from "./types";

/** The bundled model profile. Every model-specific fact comes from here. */
export function loadProfile(): Profile {
  return profileToml as unknown as Profile;
}
