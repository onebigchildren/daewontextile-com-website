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

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4
    ));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const values = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function themeTokens(block) {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)]
      .map((match) => [match[1], match[2]]),
  );
}

function requireTextContrast(tokens, themeName) {
  for (const [foreground, background] of [
    ["--ink-soft", "--bg"],
    ["--ink-faint", "--bg"],
  ]) {
    const ratio = contrastRatio(tokens[foreground], tokens[background]);
    if (ratio < 4.5) {
      failures.push(
        `${themeName}: ${foreground} contrast ${ratio.toFixed(2)}:1 is below 4.5:1`,
      );
    }
  }
}

const html = await sourceText("index.html");
const logo = await sourceText("assets/daewon-logo-D-mark.svg");
const lightThemeMatch = html.match(/:root\s*\{([^}]+)\}/);
const darkThemeMatch = html.match(
  /@media\s*\(prefers-color-scheme:dark\)\s*\{\s*:root\s*\{([^}]+)\}/,
);

if (!lightThemeMatch || !darkThemeMatch) {
  failures.push("index.html: light and dark color tokens are required");
} else {
  requireTextContrast(themeTokens(lightThemeMatch[1]), "light theme");
  requireTextContrast(themeTokens(darkThemeMatch[1]), "dark theme");
}

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
  [/Industrial space enquiries/i, "rejected property splash-page copy"],
  [/A practical first step/i, "rejected generic sales copy"],
  [/Tell us what your operation needs/i, "rejected lead-form copy"],
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
  "Daewon Textile Vietnam Co., Ltd.",
  "Công ty TNHH Dệt Daewon Việt Nam",
  "Business enquiries",
  "Liên hệ kinh doanh",
  "Please use the company email for all enquiries.",
  "Vui lòng sử dụng email công ty cho mọi thông tin liên hệ.",
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
  const lowContrastCaught = contrastRatio("#c9c9c9", "#ffffff") < 4.5;

  if (
    !personalLeakCaught ||
    !emDashFormsCaught ||
    !wrongMailboxCaught ||
    !mutedLogoCaught ||
    !lowContrastCaught
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
