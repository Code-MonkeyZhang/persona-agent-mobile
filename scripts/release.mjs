import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const rnDir = resolve(rootDir, "react-native");

const semverRegex = /^\d+\.\d+\.\d+$/;
const buildRegex = /^\d+$/;

const version = process.argv[2];
const build = process.argv[3];

if (!version || !semverRegex.test(version) || !build || !buildRegex.test(build)) {
  console.error(
    "Usage: node scripts/release.mjs <version> <build>\nExample: node scripts/release.mjs 1.0.3 4",
  );
  process.exit(1);
}

const tag = `v${version}-${build}`;
const commitMessage = `release: Persona v${version} (build ${build})`;

function run(cmd, options) {
  const exitOnError = options?.exitOnError ?? true;
  try {
    return execSync(cmd, { cwd: rootDir, encoding: "utf-8" }).trim();
  } catch (e) {
    if (exitOnError) {
      console.error(`Command failed: ${cmd}`);
      process.exit(1);
    }
    return null;
  }
}

console.log(`\n🚀 Preparing release ${tag}\n`);

const branch = run("git branch --show-current");
if (branch !== "main") {
  console.error(`Error: Current branch is "${branch}", expected "main".`);
  process.exit(1);
}

const status = run("git status --porcelain");
if (status) {
  console.error("Error: Working tree is not clean. Commit or stash your changes first.");
  process.exit(1);
}

const existingTag = run(`git tag -l ${tag}`, { exitOnError: false });
if (existingTag) {
  console.error(`Error: Tag ${tag} already exists.`);
  process.exit(1);
}

const currentCommit = run("git log --oneline -1");
console.log(`Current HEAD: ${currentCommit}\n`);

// Bump react-native/package.json
const pkgPath = resolve(rnDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const oldVersion = pkg.version;
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`react-native/package.json: ${oldVersion} → ${version}`);

// Bump iOS pbxproj (both MARKETING_VERSION and CURRENT_PROJECT_VERSION)
const pbxPath = resolve(rnDir, "ios/Persona.xcodeproj/project.pbxproj");
let pbx = readFileSync(pbxPath, "utf-8");
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
writeFileSync(pbxPath, pbx);
console.log(`iOS: MARKETING_VERSION → ${version}, CURRENT_PROJECT_VERSION → ${build}`);

// Bump Android build.gradle (kept in sync even though this release is iOS-only)
const gradlePath = resolve(rnDir, "android/app/build.gradle");
let gradle = readFileSync(gradlePath, "utf-8");
gradle = gradle.replace(/versionCode \d+/, `versionCode ${build}`);
gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${version}"`);
writeFileSync(gradlePath, gradle);
console.log(`Android: versionCode → ${build}, versionName → ${version}`);

console.log("");
console.log("About to release:\n");
console.log(`  1. Commit: "${commitMessage}"`);
console.log(`  2. Tag:    ${tag}`);
console.log(`  3. Push:   origin/main (with tags)`);
console.log(`\nCI will build and upload to App Store Connect (TestFlight).\n`);

process.stdout.write("Continue? [y/N] ");
const answer = await new Promise((res) => {
  process.stdin.once("data", (data) => res(data.toString().trim()));
});

if (answer.toLowerCase() !== "y") {
  console.log("\nAborted. Reverting version bump...");
  run(
    "git checkout -- react-native/package.json react-native/ios/Persona.xcodeproj/project.pbxproj react-native/android/app/build.gradle",
  );
  console.log("Version bump reverted.");
  process.exit(0);
}

const diff = run("git status --porcelain");
if (diff) {
  console.log("\n📦 Committing...");
  run(
    "git add react-native/package.json react-native/ios/Persona.xcodeproj/project.pbxproj react-native/android/app/build.gradle",
  );
  run(`git commit -m "${commitMessage}"`);
} else {
  console.log("\nℹ️  No version changes (already at target), skipping commit.");
}

console.log("🏷️  Tagging...");
run(`git tag ${tag}`);

console.log("📤 Pushing to origin...");
const pushResult = run("git push origin main --tags", { exitOnError: false });

if (pushResult === null) {
  console.error("\n❌ Push failed! Rolling back...");
  run(`git push origin :refs/tags/${tag}`, { exitOnError: false });
  run(`git tag -d ${tag}`, { exitOnError: false });
  if (diff) {
    run("git reset --hard HEAD~1");
  }
  console.error("Rollback complete. Local commit and tag have been removed.");
  console.error("Please check your network or permissions and try again.");
  process.exit(1);
}

console.log(`\n✅ Done! ${tag} pushed to origin.`);
console.log(`CI will build and upload to TestFlight. Check progress at:`);
console.log(`https://github.com/Code-MonkeyZhang/persona-agent-mobile/actions\n`);
process.exit(0);
