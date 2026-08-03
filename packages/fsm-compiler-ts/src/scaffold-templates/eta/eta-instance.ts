import { Eta } from "eta";

/**
 * Shared Eta instance for all scaffold templates. `autoEscape: false` because
 * these templates generate source code, not HTML — escaping would corrupt
 * generated syntax. Every `.eta` template also uses raw (`<%~ %>`)
 * interpolation explicitly, so this is defense in depth, not the only guard.
 * `autoTrim: false` because Eta's default (`[false, "nl"]`) swallows the
 * newline immediately after a tag, which would silently corrupt these
 * byte-exact stub templates.
 */
export const eta = new Eta({ autoEscape: false, autoTrim: false });
