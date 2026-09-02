import semver from "semver";
import { getExistingHighestPkgVersion } from "./get-existing-highest-pkg-version.ts";

const DEFAULT_VERSION = "1.0.0";

/**
 * Computes the migration filename (sans directory/timestamp prefix) for the
 * next release: increments the highest version already recorded in
 * `migrationsDir` by `incrementType` (semver's `inc`), or starts at
 * `DEFAULT_VERSION` if no prior migration exists.
 *
 * `format` controls the naming convention:
 * - "upgrade" (default): `{pkgName}--{old}--{new}.sql`, or just
 *   `{pkgName}--{DEFAULT_VERSION}.sql` for the very first migration. This is
 *   the PGXN upgrade-diff convention used by `supabase/migrations`.
 * - "single": always `{pkgName}--{new}.sql`, no `old` segment — used for
 *   `full-ext/supabase/migrations`, which holds one authoritative SQL file
 *   per version rather than an upgrade chain.
 */
export function getNextPkgVersionFilename(
  pkgName: string,
  incrementType: semver.ReleaseType,
  migrationsDir = "supabase/migrations",
  format: "upgrade" | "single" = "upgrade",
): string {
  const existingHighest = getExistingHighestPkgVersion(pkgName, migrationsDir);

  if (existingHighest === null) {
    return `${pkgName}--${DEFAULT_VERSION}`;
  }

  const nextVersion = semver.inc(existingHighest, incrementType);
  if (!nextVersion) {
    throw new Error(
      `Error: could not increment version ${existingHighest} with increment type "${incrementType}".`,
    );
  }

  return format === "single"
    ? `${pkgName}--${nextVersion}`
    : `${pkgName}--${existingHighest}--${nextVersion}`;
}
