// Manual client-tool loop for a Beach Day agent job (runs in the background function).
// Rules from https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls :
//  - continue while stop_reason === "tool_use"
//  - append response.content UNCHANGED as the assistant turn (thinking blocks included)
//  - answer EVERY tool_use block, all tool_result blocks in ONE user message, results first
//  - failures go back as tool_result with is_error: true
import { TOOLS } from "./tools.mjs";

export async function runAgent({ client, runTool, system, messages, model = "claude-opus-5-5", maxRounds = 15, log = () => {} }) {
  const convo = [...messages];
  for (let round = 1; round <= maxRounds; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },   // code-change jobs
      system,
      tools: TOOLS,
      tool_choice: { type: "auto" },        // any/tool return 400 on Opus 5.5 / Sonnet 5.5
      messages: convo,
    });
    log(`round ${round}: stop_reason=${res.stop_reason} blocks=${res.content.map((b) => b.type).join(",")}`);

    switch (res.stop_reason) {
      case "tool_use": {
        convo.push({ role: "assistant", content: res.content });
        const calls = res.content.filter((b) => b.type === "tool_use");
        const results = [];
        for (const call of calls) results.push(await runTool(call)); // serial: GitHub prefers serial requests
        convo.push({ role: "user", content: results });
        continue;
      }
      case "end_turn":
      case "stop_sequence":
        return { status: "done", text: textOf(res), messages: [...convo, { role: "assistant", content: res.content }] };
      case "max_tokens":
        // A tool_use cut off by max_tokens may have truncated input: never execute it.
        return { status: "truncated", text: textOf(res), messages: convo };
      case "refusal":
        // Discard partial output; the conversation must be reset or retried on a fallback model.
        return { status: "refused", details: res.stop_details ?? null, messages: convo };
      default:
        // pause_turn only happens with server tools (not used here); model_context_window_exceeded etc.
        return { status: "stopped", stop_reason: res.stop_reason, messages: convo };
    }
  }
  return { status: "max_rounds", messages: convo };
}

const textOf = (res) => res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
