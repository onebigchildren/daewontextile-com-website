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

// 2026-07-29 owner direction ("add a zalo icon or sth. to my zalo is fine")
// deliberately overrides the 2026-07-28 no-personal-Zalo rule. The number is
// permitted ONLY as the href of the approved zalo.me link; it must not appear
// as visible text, in a tel: link, or anywhere else in the page. Everything the
// number is checked against below is derived from this single constant, so
// changing the Zalo number here updates the guard with it.
const ZALO_HREF = "https://zalo.me/84865813877";
const zaloDigits = ZALO_HREF.replace(/\D/g, "");
const htmlWithoutZaloHref = (source) => source.split(ZALO_HREF).join("");

const forbiddenPatterns = [
  [/Sungji/i, "personal name"],
  [/Corporate Strategy Director/i, "personal title"],
  [/sungji@/i, "personal mailbox"],
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

// The Zalo number is allowed in exactly one place: the approved href.
const htmlOutsideZaloHref = htmlWithoutZaloHref(html);
const loosePhone = new RegExp(
  `\\+?${zaloDigits.split("").join("[\\s.()-]*")}`,
  "i",
);
if (loosePhone.test(htmlOutsideZaloHref)) {
  failures.push(
    "index.html: Zalo phone number appears outside the approved zalo.me href",
  );
}
const zaloLinks = [...html.matchAll(/href="(https:\/\/zalo\.me\/[^"]*)"/g)].map(
  (match) => match[1],
);
for (const href of zaloLinks) {
  if (href !== ZALO_HREF) {
    failures.push(`index.html: unapproved Zalo route ${href}`);
  }
}
if (zaloLinks.length !== 1) {
  failures.push(
    `index.html: expected exactly one approved Zalo link, found ${zaloLinks.length}`,
  );
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
  // A visible-text copy of the Zalo number must still be caught, even though
  // the same digits are legitimately present inside the approved href.
  const visiblePhoneCaught = loosePhone.test(
    htmlWithoutZaloHref(`${html}<span>+84 865 813 877</span>`),
  );
  const strayZaloRouteCaught = "https://zalo.me/84000000000" !== ZALO_HREF;

  if (
    !personalLeakCaught ||
    !emDashFormsCaught ||
    !wrongMailboxCaught ||
    !mutedLogoCaught ||
    !lowContrastCaught ||
    !visiblePhoneCaught ||
    !strayZaloRouteCaught
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
