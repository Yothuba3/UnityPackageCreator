#!/usr/bin/env node
// create-unity-package.mjs
// Usage: node create-unity-package.mjs [output-dir]

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execSync } from "node:child_process";

// ─── Debug ──────────────────────────────────────────────────────────────────
const DEBUG = !!process.env.UPC_DEBUG;
let gitDetectError = null;

// ─── ANSI colors ────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m",
  red: "\x1b[31m",  blue: "\x1b[34m",
};
const bold   = (s) => `${c.bold}${s}${c.reset}`;
const dim    = (s) => `${c.dim}${s}${c.reset}`;
const cyan   = (s) => `${c.cyan}${s}${c.reset}`;
const green  = (s) => `${c.green}${s}${c.reset}`;
const yellow = (s) => `${c.yellow}${s}${c.reset}`;
const red    = (s) => `${c.red}${s}${c.reset}`;
const blue   = (s) => `${c.blue}${s}${c.reset}`;

// ─── Git helpers ─────────────────────────────────────────────────────────────
// git コマンドに依存しないよう .git ディレクトリを親方向に探索する
function findGitRootByFs(startDir) {
  let cur = resolve(startDir);
  while (true) {
    const candidate = join(cur, ".git");
    try {
      if (statSync(candidate)) return cur;
    } catch { /* ignore */ }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function getGitRoot(dir) {
  // 1st: git CLI
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir, stdio: ["pipe","pipe","pipe"],
    }).toString().trim();
  } catch (e) {
    gitDetectError = e.message;
  }
  // 2nd: fs フォールバック
  return findGitRootByFs(dir);
}

// .git/config を直接パースして origin の URL を取り出すフォールバック
function parseOriginFromGitConfig(gitRoot) {
  try {
    const cfg = readFileSync(join(gitRoot, ".git", "config"), "utf-8");
    // [remote "origin"] ブロックを探す
    const m = cfg.match(/\[remote "origin"\]([^\[]*)/);
    if (!m) return null;
    const urlMatch = m[1].match(/^\s*url\s*=\s*(.+)$/m);
    return urlMatch ? urlMatch[1].trim() : null;
  } catch { return null; }
}

function getGitRemoteUrl(dir) {
  try {
    return execSync("git remote get-url origin", {
      cwd: dir, stdio: ["pipe","pipe","pipe"],
    }).toString().trim();
  } catch { /* fall through */ }
  return parseOriginFromGitConfig(dir);
}

function normalizeGitUrl(url) {
  if (!url) return null;
  const m = url.match(/^git@([^:]+):(.+)$/);
  return m ? `https://${m[1]}/${m[2]}` : url;
}

// ─── UI helpers ──────────────────────────────────────────────────────────────
function header() {
  console.clear();
  console.log();
  console.log(`  ${bold(cyan("◆ Unity Package Generator"))}`);
  console.log(`  ${dim("package.json をインタラクティブに作成します")}`);
  console.log(`  ${dim("─".repeat(46))}`);
  console.log();
}

function section(title) {
  console.log();
  console.log(`  ${bold(blue(`▸ ${title}`))}`);
  console.log();
}

function hint(text) { console.log(`    ${dim(text)}`); }

function validate(value, rule) {
  if (rule === "required" && !value.trim()) return "必須項目です";
  if (rule === "packageName") {
    if (!value.trim()) return "必須項目です";
    if (!/^[a-z0-9]+(\.[a-z0-9][a-z0-9\-]*)*$/.test(value))
      return "形式: com.company.package-name（小文字・数字・ハイフン・ドット）";
  }
  if (rule === "version") {
    if (!value.trim()) return "必須項目です";
    if (!/^\d+\.\d+\.\d+$/.test(value))
      return "形式: 1.0.0（セマンティックバージョニング）";
  }
  if (rule === "unityVersion") {
    if (!value.trim()) return "必須項目です";
    if (!/^\d{4}\.\d+$/.test(value))
      return "形式: 2022.3（MAJOR.MINOR）";
  }
  return null;
}

async function ask(rl, label, { defaultValue = "", rule = null, hint: hintText = "" } = {}) {
  const defaultLabel = defaultValue ? dim(` (${defaultValue})`) : "";
  if (hintText) hint(hintText);
  while (true) {
    const raw   = await rl.question(`  ${cyan("?")} ${bold(label)}${defaultLabel} › `);
    const value = raw.trim() || defaultValue;
    const error = rule ? validate(value, rule) : null;
    if (error) { console.log(`  ${red("✖")} ${error}`); }
    else        { return value; }
  }
}

async function confirm(rl, label, defaultYes = false) {
  const marker = defaultYes ? "(Y/n)" : "(y/N)";
  const raw    = await rl.question(`  ${cyan("?")} ${bold(label)} ${dim(marker)} › `);
  const val    = raw.trim().toLowerCase();
  if (!val) return defaultYes;
  return val === "y";
}

function previewJson(pkg) {
  console.log();
  console.log(`  ${bold(green("◇ 生成される package.json"))}`);
  console.log(`  ${dim("─".repeat(46))}`);
  for (const line of JSON.stringify(pkg, null, 2).split("\n"))
    console.log(`  ${dim(line)}`);
  console.log(`  ${dim("─".repeat(46))}`);
  console.log();
}

function previewReadme(md) {
  console.log();
  console.log(`  ${bold(green("◇ 生成される README"))}`);
  console.log(`  ${dim("─".repeat(46))}`);
  for (const line of md.split("\n"))
    console.log(`  ${dim(line)}`);
  console.log(`  ${dim("─".repeat(46))}`);
  console.log();
}

// ─── README builder ───────────────────────────────────────────────────────────
function buildReadme({ displayName, description, name, version, remoteUrl }) {
  const httpsUrl = normalizeGitUrl(remoteUrl);
  const upmUrl   = httpsUrl
    ? `${httpsUrl.replace(/\.git$/, "")}.git#${version}`
    : `https://github.com/your-org/your-repo.git#${version}`;

  const descBlock = description ? `\n${description}\n` : "";
  const repoBlock = httpsUrl ? [`## Repository`, ``, httpsUrl, ``] : [];

  return [
    `# ${displayName}`,
    descBlock,
    `## Installation`,
    ``,
    `### Using Unity Package Manager (Git URL)`,
    ``,
    "Open `Packages/manifest.json` and add the following to the `dependencies` block:",
    ``,
    "```json",
    `{`,
    `  "dependencies": {`,
    `    "${name}": "${upmUrl}"`,
    `  }`,
    `}`,
    "```",
    ``,
    "Or use **Window › Package Manager › + › Add package from git URL** and enter:",
    ``,
    "```",
    upmUrl,
    "```",
    ``,
    ...repoBlock,
  ].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const outDir = resolve(process.argv[2] ?? ".");
  const rl     = readline.createInterface({ input, output, terminal: true });

  header();

  // Git 検出
  const gitRoot   = getGitRoot(outDir);
  const remoteUrl = gitRoot ? getGitRemoteUrl(gitRoot) : null;
  const isGit     = !!gitRoot;

  if (isGit) {
    console.log(`  ${green("✔")} Git リポジトリを検出 ${dim(gitRoot)}`);
    if (remoteUrl) {
      console.log(`    ${dim("origin: " + normalizeGitUrl(remoteUrl))}`);
    } else {
      console.log(`    ${yellow("⚠")}  origin が未設定です（README の URL は仮のものになります）`);
    }
  } else {
    console.log(`  ${yellow("⚠")}  Git リポジトリではありません（README 生成はスキップされます）`);
    console.log(`    ${dim("cwd: " + outDir)}`);
    if (DEBUG && gitDetectError) {
      console.log(`    ${dim("git error: " + gitDetectError)}`);
    } else if (gitDetectError) {
      console.log(`    ${dim("UPC_DEBUG=1 で git エラー詳細を表示します")}`);
    }
  }

  // Step 1: name
  section("1 / 7  パッケージ名");
  hint("Unity の命名規則: com.{company}.{package-name}");
  const name = await ask(rl, "name", {
    rule: "packageName", defaultValue: "com.company.my-package",
  });

  // Step 2: version
  section("2 / 7  バージョン");
  const version = await ask(rl, "version", {
    rule: "version", defaultValue: "1.0.0",
    hint: "セマンティックバージョニング (MAJOR.MINOR.PATCH)",
  });

  // Step 3: displayName
  section("3 / 7  表示名");
  hint("Package Manager UI に表示される名前です");
  const displayName = await ask(rl, "displayName", {
    rule: "required", defaultValue: "My Package",
  });

  // Step 4: description
  section("4 / 7  説明");
  const description = await ask(rl, "description", {
    defaultValue: "", hint: "省略可（Enter でスキップ）",
  });

  // Step 5: unity version
  section("5 / 7  対応 Unity バージョン");
  hint("パッケージが動作する最小 Unity バージョン (MAJOR.MINOR)");
  const unity = await ask(rl, "unity", {
    rule: "unityVersion", defaultValue: "2022.3",
  });

  // Step 6: author
  section("6 / 7  作者");
  const author = await ask(rl, "author", {
    defaultValue: "", hint: "省略可（Enter でスキップ）",
  });

  // Step 7: license
  section("7 / 7  ライセンス");
  const license = await ask(rl, "license", {
    defaultValue: "MIT", hint: "SPDX 識別子 (例: MIT, Apache-2.0)",
  });

  // Build package.json (UPM が参照する順序で出力)
  const pkg = { name, version, displayName };
  if (description) pkg.description = description;
  pkg.unity = unity;
  if (author) pkg.author = author;
  pkg.license = license;
  pkg.dependencies = {};

  // README オプション（Git リポジトリ内のみ）
  let generateReadme = false;
  let readmePath     = null;
  let readmeContent  = null;

  if (isGit) {
    section("README  UPM インポート用 README の生成");
    hint("Git URL を使ったインストール手順を含む README.md を生成します");
    generateReadme = await confirm(rl, "README を生成しますか？", true);

    if (generateReadme) {
      readmeContent = buildReadme({ displayName, description, name, version, remoteUrl });
      const defaultReadmePath = join(outDir, "README.md");
      if (existsSync(defaultReadmePath)) {
        console.log(`  ${yellow("⚠")}  README.md が既に存在するため README.upm.md として保存します`);
        readmePath = join(outDir, "README.upm.md");
      } else {
        readmePath = defaultReadmePath;
      }
      previewReadme(readmeContent);
    }
  }

  // Preview & confirm
  previewJson(pkg);

  const pkgPath   = join(outDir, "package.json");
  const pkgExists = existsSync(pkgPath);
  if (pkgExists) console.log(`  ${yellow("⚠")}  package.json が既に存在します`);

  const doSave = await confirm(
    rl,
    pkgExists ? "上書きして保存しますか？" : "保存しますか？",
    !pkgExists
  );
  rl.close();

  if (!doSave) {
    console.log();
    console.log(`  ${dim("キャンセルしました")}`);
    console.log();
    return;
  }

  // Write files
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log();
  console.log(`  ${green("✔")} ${bold("package.json")}   ${dim(pkgPath)}`);

  if (generateReadme && readmePath && readmeContent) {
    writeFileSync(readmePath, readmeContent + "\n", "utf-8");
    const label = readmePath.endsWith("README.upm.md") ? "README.upm.md" : "README.md";
    console.log(`  ${green("✔")} ${bold(label)}   ${dim(readmePath)}`);
  }

  console.log();
}

main().catch((err) => {
  console.error(red(`\nエラー: ${err.message}`));
  process.exit(1);
});
