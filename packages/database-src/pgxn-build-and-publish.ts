import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import semver from "semver";

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    username: { type: "string", short: "u" },
    password: { type: "string", short: "p" },
    version: { type: "string", short: "v" },
    clean: { type: "boolean", short: "c", default: false },
  },
  strict: false,
});

const pgxnUsername = args.username ?? process.env.PGXN_USERNAME;
const pgxnPassword = args.password ?? process.env.PGXN_PASSWORD;
const clean = args.clean === true;

const version = args.version;
if (!version) {
  console.error(
    "Error: --version (-v) is required, e.g. --version 2.0.1 (or -v 2.0.1)",
  );
  process.exit(1);
}
if (!semver.valid(version)) {
  console.error(`Error: "${version}" is not a valid semver version.`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const pkgName: string = pkg.name;
const description: string = pkg.description;
const author: string = pkg.author;
const license: string = pkg.license;

const MIGRATIONS_DIR = "supabase/migrations";
const FULL_EXT_MIGRATIONS_DIR = "full-ext/supabase/migrations";
const TEMPLATES_DIR = "pgxn-templates";
const TEMP_BUILD_DIR = "pgxn-dist";

// A migration filename is either a base install (single version) or an
// upgrade diff (old--new); both forms carry a timestamp prefix on disk that
// gets stripped for the published package. `toVersion` is the version the
// file brings you to — what matters for "is this file needed to reach
// `version`" and for the exact-match presence checks below.
type ParsedMigration =
  | { kind: "base"; toVersion: string; strippedName: string }
  | {
    kind: "upgrade";
    fromVersion: string;
    toVersion: string;
    strippedName: string;
  };

function parseMigrationFile(
  name: string,
  filename: string,
): ParsedMigration | null {
  const stripped = filename.replace(/^\d+_/, "");
  const baseMatch = stripped.match(new RegExp(`^${name}--([\\d.]+)\\.sql$`));
  if (baseMatch) {
    return { kind: "base", toVersion: baseMatch[1], strippedName: stripped };
  }
  const upgradeMatch = stripped.match(
    new RegExp(`^${name}--([\\d.]+)--([\\d.]+)\\.sql$`),
  );
  if (upgradeMatch) {
    return {
      kind: "upgrade",
      fromVersion: upgradeMatch[1],
      toVersion: upgradeMatch[2],
      strippedName: stripped,
    };
  }
  return null;
}

// 1. Gather every fsm_core migration in supabase/migrations and confirm the
//    requested version's own migration file actually exists there — building
//    a release for a version with no migration would silently ship stale SQL.
const mainMigrations = readdirSync(MIGRATIONS_DIR)
  .map((file) => ({ file, parsed: parseMigrationFile(pkgName, file) }))
  .filter(
    (m): m is { file: string; parsed: ParsedMigration } => m.parsed !== null,
  );

const hasTargetVersion = mainMigrations.some((m) =>
  m.parsed.toVersion === version
);
if (!hasTargetVersion) {
  console.error(
    `Error: no migration file for version ${version} found in ${MIGRATIONS_DIR}. Create it (e.g. via npm run supabase:restart:with:diff:withUpgradeScript:*) before building.`,
  );
  process.exit(1);
}

// 2. The shipped set is every migration up to and including `version` — the
// full base + upgrade-diff chain a fresh PGXN install/upgrade needs.
const migrationsToShip = mainMigrations.filter((m) =>
  semver.lte(m.parsed.toVersion, version)
);

const baseInstall = migrationsToShip.find((m) => m.parsed.kind === "base");
if (!baseInstall) {
  console.error(
    `Error: no base install migration (${pkgName}--<version>.sql) found up to version ${version} in ${MIGRATIONS_DIR}.`,
  );
  process.exit(1);
}
const baseInstallFile = baseInstall.parsed.strippedName;

// 3. full-ext/supabase/migrations holds the pgrx-validated build of each
// version's SQL. If it has a file for `version`, it overrides (same stripped
// filename as) whatever supabase/migrations produced for that version — it's
// the authoritative install script for a release, not an additional file.
let fullExtOverride: { file: string; parsed: ParsedMigration } | undefined;
if (existsSync(FULL_EXT_MIGRATIONS_DIR)) {
  fullExtOverride = readdirSync(FULL_EXT_MIGRATIONS_DIR)
    .map((file) => ({ file, parsed: parseMigrationFile(pkgName, file) }))
    .find(
      (m): m is { file: string; parsed: ParsedMigration } =>
        m.parsed !== null && m.parsed.toVersion === version,
    );
}

const SPDX_TO_PGXN: Record<string, string> = {
  "apache-2.0": "apache_2_0",
  "mit": "mit",
  "postgresql": "postgresql",
  "bsd-2-clause": "bsd",
  "bsd-3-clause": "bsd",
  "gpl-2.0": "gpl_2",
  "gpl-3.0": "gpl_3",
};

const placeholders: Record<string, string> = {
  "{{NAME}}": pkgName,
  "{{VERSION}}": version,
  "{{DESCRIPTION}}": description,
  "{{AUTHOR}}": author,
  "{{LICENSE_PGXN}}": SPDX_TO_PGXN[license.toLowerCase()] ??
    license.toLowerCase(),
  "{{PROVIDES_FILE}}": baseInstallFile,
};

function fillTemplate(content: string): string {
  let result = content;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

// 1. Ensure pgxn-dist exists, and clear out migration files left over from a
//    previous build — otherwise a smaller `version` target would still ship
//    newer .sql files an earlier run copied in.
mkdirSync(TEMP_BUILD_DIR, { recursive: true });
for (const f of readdirSync(TEMP_BUILD_DIR)) {
  if (parseMigrationFile(pkgName, f) !== null) {
    unlinkSync(join(TEMP_BUILD_DIR, f));
  }
}

// 2. Fill templates and write to pgxn-dist
const controlContent = fillTemplate(
  readFileSync(join(TEMPLATES_DIR, "extension.control"), "utf8"),
);
writeFileSync(join(TEMP_BUILD_DIR, `${pkgName}.control`), controlContent);
console.log(`Wrote ${pkgName}.control`);

const metaContent = fillTemplate(
  readFileSync(join(TEMPLATES_DIR, "META.json"), "utf8"),
);
writeFileSync(join(TEMP_BUILD_DIR, "META.json"), metaContent);
console.log(`Wrote META.json`);

// 3. Copy README
copyFileSync("README.md", join(TEMP_BUILD_DIR, "README.md"));
console.log(`Wrote README.md`);

// 4. Copy the migration chain up to `version`, stripping the timestamp prefix
for (const m of migrationsToShip) {
  copyFileSync(
    join(MIGRATIONS_DIR, m.file),
    join(TEMP_BUILD_DIR, m.parsed.strippedName),
  );
  console.log(`Copied: ${m.file} → ${m.parsed.strippedName}`);
}

// 5. Apply the full-ext override, if this version has one
if (fullExtOverride) {
  copyFileSync(
    join(FULL_EXT_MIGRATIONS_DIR, fullExtOverride.file),
    join(TEMP_BUILD_DIR, fullExtOverride.parsed.strippedName),
  );
  console.log(
    `Copied (full-ext override): ${fullExtOverride.file} → ${fullExtOverride.parsed.strippedName}`,
  );
} else {
  console.log(
    `No full-ext override for version ${version} in ${FULL_EXT_MIGRATIONS_DIR} — using the supabase/migrations copy.`,
  );
}

console.log(`\nStaging dir contents:`);
readdirSync(TEMP_BUILD_DIR).forEach((f) => console.log(`  ${f}`));

// 6. Create zip via git archive using a throwaway git repo in a temp dir so
//    the main working tree stays clean (pgxn-dist is untracked).
const zipName = `${pkgName}-${version}.zip`;
const tmpRepo = join(tmpdir(), `pgxn-build-${Date.now()}`);

try {
  mkdirSync(tmpRepo, { recursive: true });
  execSync(`cp -r "${TEMP_BUILD_DIR}/." "${tmpRepo}/"`, { shell: true });
  execSync(`git init -q "${tmpRepo}"`, { shell: true });
  execSync(`git -C "${tmpRepo}" add .`, { shell: true, stdio: "pipe" });
  const treeHash = execSync(`git -C "${tmpRepo}" write-tree`, {
    encoding: "utf8",
    shell: true,
  }).trim();
  execSync(
    `git -C "${tmpRepo}" archive --format=zip --prefix="${pkgName}-${version}/" "${treeHash}" > "${
      join(process.cwd(), zipName)
    }"`,
    { shell: true, stdio: "inherit" },
  );
  console.log(`\nCreated: ${zipName}`);
} finally {
  rmSync(tmpRepo, { recursive: true, force: true });
}

// pgxn-dist is just staging for the zip above — remove it now that the zip
// exists, so it never lingers as a stale snapshot between builds. Skipped
// with --clean=false (the default) so the staged files are left on disk to
// inspect, e.g. while debugging what actually went into the zip.
if (clean) {
  rmSync(TEMP_BUILD_DIR, { recursive: true, force: true });
  console.log(`\nRemoved ${TEMP_BUILD_DIR} (pass --clean=false to keep it).`);
} else {
  console.log(
    `\nKept ${TEMP_BUILD_DIR} for inspection (pass --clean to remove it after building).`,
  );
}

// 7. Upload to PGXN or show manual hint
const zipPath = join(process.cwd(), zipName);

if (!pgxnUsername || !pgxnPassword) {
  console.log(`\nPGXN credentials not provided. To upload manually, run:`);
  console.log(
    `  curl -u "USERNAME:PASSWORD" -F "archive=@${zipPath}" https://manager.pgxn.org/upload`,
  );
  console.log(`\nOr re-run with credentials:`);
  console.log(
    `  npx tsx pgxn-build-and-publish.ts --version ${version} -u USERNAME -p PASSWORD`,
  );
  console.log(`  (or set PGXN_USERNAME and PGXN_PASSWORD env vars)`);
} else {
  (async () => {
    const formData = new FormData();
    const zipBuffer = readFileSync(zipPath);
    formData.append(
      "archive",
      new Blob([zipBuffer], { type: "application/zip" }),
      zipName,
    );

    const credentials = Buffer.from(`${pgxnUsername}:${pgxnPassword}`).toString(
      "base64",
    );

    console.log(`\nUploading ${zipName} to PGXN...`);
    const response = await fetch("https://manager.pgxn.org/upload", {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}` },
      body: formData,
    });

    if (response.ok) {
      console.log(`Upload successful (${response.status})`);
    } else {
      const body = await response.text();
      console.error(`Upload failed: ${response.status} ${response.statusText}`);
      if (body) console.error(body);
      process.exit(1);
    }
  })().catch((err: Error) => {
    console.error(`Upload error: ${err.message}`);
    process.exit(1);
  });
}
