import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const stagedMode = process.argv.includes("--staged");
const selftestMode = process.argv.includes("--selftest");
const failures = [];

function stagedText(name) {
  const result = spawnSync("git", ["show", `:${name}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Unable to read staged ${name}`);
  }
  return result.stdout;
}

async function sourceText(name) {
  return stagedMode
    ? stagedText(name)
    : readFile(path.join(root, name), "utf8");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    failures.push(`${label}: missing ${expected}`);
  }
}

const html = await sourceText("index.html");
const logo = await sourceText("assets/daewon-logo-D-mark.svg");

const forbiddenPatterns = [
  [/Sungji/i, "personal name"],
  [/Corporate Strategy Director/i, "personal title"],
  [/sungji@/i, "personal mailbox"],
  [/\+?84\s*865\s*813\s*877/i, "personal phone"],
  [/\btel:/i, "telephone link"],
  [/\bfor sale\b/i, "public sale language"],
  [/\bacquisition\b/i, "public acquisition language"],
  [/\bavailable area\b/i, "public availability detail"],
  [/\brental price\b/i, "public price language"],
  [
    new RegExp("\\u2014|&m" + "dash;|&#0*" + "8212;|&#x0*" + "2014;", "i"),
    "em dash",
  ],
];

for (const [pattern, label] of forbiddenPatterns) {
  if (pattern.test(html)) {
    failures.push(`index.html: forbidden ${label}`);
  }
}

const mailLinks = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map(
  (match) => match[1],
);
if (mailLinks.length < 3) {
  failures.push("index.html: expected direct and structured company email links");
}
for (const href of mailLinks) {
  if (!href.startsWith("mailto:contact@daewontextile.com")) {
    failures.push(`index.html: non-company email route ${href}`);
  }
}

for (const required of [
  "Industrial space enquiries in Đồng Nai",
  "Liên hệ thuê mặt bằng công nghiệp tại Đồng Nai",
  "Proposed%20activity",
  "Approximate%20area",
  "Preferred%20start%20date",
  "Ho%E1%BA%A1t%20%C4%91%E1%BB%99ng%20d%E1%BB%B1%20ki%E1%BA%BFn",
  "Di%E1%BB%87n%20t%C3%ADch%20d%E1%BB%B1%20ki%E1%BA%BFn",
  "Th%E1%BB%9Di%20gian%20b%E1%BA%AFt%20%C4%91%E1%BA%A7u",
  "assets/daewon-facility-exterior-2025.webp",
]) {
  requireText(html, required, "index.html");
}

requireText(logo, 'fill="#fe0100"', "logo SVG");
if (/#db7a6b/i.test(logo)) {
  failures.push("logo SVG: muted legacy coral returned");
}

if (stagedMode) {
  const stagedNames = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: root, encoding: "utf8" },
  ).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  for (const privateName of ["PRODUCT.md", "README.md"]) {
    if (stagedNames.includes(privateName)) {
      failures.push(`${privateName}: private context must not be published`);
    }
  }
}

if (selftestMode) {
  const personalLeakCaught = forbiddenPatterns.some(
    ([pattern, label]) => label === "personal name" && pattern.test("Sungji"),
  );
  const emDashRule = forbiddenPatterns.find(
    ([, label]) => label === "em dash",
  )?.[0];
  const emDashFormsCaught =
    emDashRule?.test(String.fromCodePoint(0x2014)) &&
    emDashRule?.test("&m" + "dash;") &&
    emDashRule?.test("&#" + "8212;") &&
    emDashRule?.test("&#x" + "2014;");
  const wrongMailboxCaught = !(
    "mailto:sungji@daewontextile.com"
  ).startsWith("mailto:contact@daewontextile.com");
  const mutedLogoCaught = /#db7a6b/i.test(
    logo.replace("#fe0100", "#db7a6b"),
  );

  if (
    !personalLeakCaught ||
    !emDashFormsCaught ||
    !wrongMailboxCaught ||
    !mutedLogoCaught
  ) {
    failures.push("website guard selftest did not catch every injected defect");
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `website guard passed${stagedMode ? " for staged source" : ""}${selftestMode ? " with injected-defect selftest" : ""}\n`,
);
