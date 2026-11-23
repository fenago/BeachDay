// scripts/build-agents.mjs
// Build step 1. Turns .claude/agents/*.md (plus each agent's skills and knowledge folder)
// into the git-ignored netlify/functions/lib/agents.json that the Console functions read.
//
// Shape (build_plan §5), an array sorted by name:
//   { name, persona, description, personality, model, modelLabel, color, skills: [names],
//     knowledge: { path, title, docs: [{file, title}], examples: [{dir, title}] }, systemPrompt }
// systemPrompt, in this order, with no timestamps (so it stays cacheable):
//   1. the agent body
//   2. "\n\n# Skill: <name>\n" + each SKILL.md, in `skills:` order
//   3. "\n\n# Knowledge: knowledge/<name>/\n" + README.md, then each docs/*.md (sorted)
//   4. a list of example folders, with a line saying to read them with read_file from main
//
// Safety:
//  * Agent files are DATA. They are parsed here with a small frontmatter reader, never imported or evaled.
//  * Names are checked against a strict pattern before they become paths, so an edited agent file cannot
//    point the build at a file outside .claude/skills or knowledge.
//  * Reads no environment variables. Prints ONE summary line and no file contents.
//  * Fails (exit 1, previous deploy stays live) on: invalid frontmatter, a missing skill folder, a missing
//    knowledge README, a model outside opus / inherit / (missing) / sonnet / haiku, or a prompt over 350 KB.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_PROMPT_BYTES = 350 * 1024;
export const MODELS = Object.freeze({
  opus: { id: "claude-opus-5-5", label: "Opus" },
  inherit: { id: "claude-opus-5-5", label: "Opus" },
  sonnet: { id: "claude-sonnet-5-5", label: "Sonnet" },
  haiku: { id: "claude-haiku-5-5", label: "Haiku" },
});
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Minimal frontmatter reader: `key: value` lines, and `key:` followed by `  - item` lines.
// Anything else (nested maps, block scalars, tabs) is invalid on purpose, so a malformed file fails loudly.
export function parseFrontmatter(text, label = "file") {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error(`${label}: frontmatter must start with ---`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error(`${label}: frontmatter is not closed with ---`);
  const data = {};
  let listKey = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const item = /^ {2}- (.+)$/.exec(line);
    if (item) {
      if (!listKey) throw new Error(`${label}: list item without a key (line ${i + 1})`);
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/.exec(line);
    if (!kv) throw new Error(`${label}: invalid frontmatter line ${i + 1}`);
    if (Object.hasOwn(data, kv[1])) throw new Error(`${label}: duplicate key ${kv[1]}`);
    const value = (kv[2] ?? "").trim();
    if (value === "") { data[kv[1]] = []; listKey = kv[1]; } else { data[kv[1]] = unquote(value); listKey = null; }
  }
  return { data, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function unquote(v) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) { try { return JSON.parse(v); } catch { throw new Error("invalid quoted value"); } }
  if (/^'[^']*'$/.test(v)) return v.slice(1, -1);
  return v;
}

export function resolveModel(alias, label) {
  const key = alias === undefined || alias === "" ? "inherit" : alias;
  if (typeof key !== "string" || !Object.hasOwn(MODELS, key)) {
    throw new Error(`${label}: model must be opus, sonnet, haiku or inherit (or missing)`);
  }
  return { model: MODELS[key].id, modelLabel: MODELS[key].label };
}

const firstHeading = (text, fallback) => /^#\s+(.+?)\s*$/m.exec(text)?.[1] ?? fallback;
const readText = (file, label) => {
  try { return readFileSync(file, "utf8"); } catch { throw new Error(`${label}: cannot read ${file}`); }
};

function knowledgeFor(root, name) {
  const dir = join(root, "knowledge", name);
  const readme = join(dir, "README.md");
  if (!existsSync(readme)) throw new Error(`${name}: missing knowledge/${name}/README.md`);
  const readmeText = readText(readme, name);
  const docsDir = join(dir, "docs");
  const docs = existsSync(docsDir)
    ? readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort().map((file) => {
        const text = readText(join(docsDir, file), name);
        return { file, title: firstHeading(text, file), text };
      })
    : [];
  const exDir = join(dir, "examples");
  const examples = existsSync(exDir)
    ? readdirSync(exDir).filter((d) => statSync(join(exDir, d)).isDirectory()).sort().map((d) => {
        const r = join(exDir, d, "README.md");
        return { dir: d, title: existsSync(r) ? firstHeading(readText(r, name), d) : d };
      })
    : [];
  return { readmeText, docs, examples, title: firstHeading(readmeText, `${name} knowledge`) };
}

export function buildAgents({ root }) {
  const agentsDir = join(root, ".claude", "agents");
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) throw new Error("no agent files found");
  const agents = [];
  let biggest = 0;
  for (const file of files) {
    const label = file;
    const { data, body } = parseFrontmatter(readText(join(agentsDir, file), label), label);
    const name = data.name;
    if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error(`${label}: name is missing or not a safe slug`);
    if (typeof data.description !== "string" || data.description === "") throw new Error(`${label}: description is missing`);
    if (agents.some((a) => a.name === name)) throw new Error(`${label}: duplicate agent name ${name}`);
    const { model, modelLabel } = resolveModel(data.model, label);
    const skills = data.skills ?? [];
    if (!Array.isArray(skills)) throw new Error(`${label}: skills must be a list`);

    let prompt = body.replace(/\s+$/, "");
    for (const skill of skills) {
      if (!SAFE_NAME.test(skill)) throw new Error(`${label}: skill name ${JSON.stringify(skill).slice(0, 40)} is not a safe slug`);
      const sf = join(root, ".claude", "skills", skill, "SKILL.md");
      if (!existsSync(sf)) throw new Error(`${label}: skill folder missing for ${skill}`);
      prompt += `\n\n# Skill: ${skill}\n${readText(sf, label).replace(/\s+$/, "")}`;
    }
    const k = knowledgeFor(root, name);
    prompt += `\n\n# Knowledge: knowledge/${name}/\n${k.readmeText.replace(/\s+$/, "")}`;
    for (const d of k.docs) prompt += `\n\n## knowledge/${name}/docs/${d.file}\n${d.text.replace(/\s+$/, "")}`;
    if (k.examples.length) {
      prompt += `\n\n## Examples in knowledge/${name}/examples/\nRead them with read_file from main (list_files shows the files).\n` +
        k.examples.map((e) => `- knowledge/${name}/examples/${e.dir}/ : ${e.title}`).join("\n");
    }
    prompt += "\n";
    const bytes = Buffer.byteLength(prompt, "utf8");
    if (bytes > MAX_PROMPT_BYTES) throw new Error(`${label}: system prompt is ${bytes} bytes, over the ${MAX_PROMPT_BYTES} limit`);
    biggest = Math.max(biggest, bytes);

    agents.push({
      name,
      persona: data.persona || name,
      description: data.description,
      personality: data.personality || data.description,
      model,
      modelLabel,
      color: data.color || "",
      skills,
      knowledge: {
        path: `knowledge/${name}/`,
        title: k.title,
        docs: k.docs.map(({ file, title }) => ({ file, title })),
        examples: k.examples,
      },
      systemPrompt: prompt,
    });
  }
  agents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { agents, biggest };
}

// CLI: node scripts/build-agents.mjs [--root <dir>] [--out <file>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const arg = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback; };
  const root = arg("--root", join(dirname(fileURLToPath(import.meta.url)), ".."));
  const out = arg("--out", join(root, "netlify", "functions", "lib", "agents.json"));
  try {
    const { agents, biggest } = buildAgents({ root });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(agents) + "\n");
    const skills = new Set(agents.flatMap((a) => a.skills)).size;
    console.log(`build-agents: ${agents.length} agents, ${skills} skills, biggest prompt ${(biggest / 1024).toFixed(1)} KB (limit ${MAX_PROMPT_BYTES / 1024} KB)`);
  } catch (e) {
    console.error(`build-agents: ${e.message}`);
    process.exit(1);
  }
}
