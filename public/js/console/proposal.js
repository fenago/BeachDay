// Proposal card (docs/04 §1 step 4, approval-spec §2 and §4). Built from GET /api/proposals/:id
// ({proposal, diffs, deploys, approveEnabled, approvals}). Summary, paths and diff lines are TEXT only.
// The card owns one persistent role="status" region and one role="alert" region, present before any text.
import { h, icon, say, clear, announce, shortSha, shortHash, commitUrl, commitsUrl, externalLink, formatWhen, utf8Bytes } from "./dom.js";

// Display-only mirror of the deny list (docs/04 §6). The server is the control and re-checks at approve time;
// this only stops the card from inviting a doomed Approve.
const DENY = [/^netlify(\/|\.toml$)/i, /^\.github\//i, /^package(-lock)?\.json$/i, /^scripts\//i, /(^|\/)\.env/i, /^\.git(\/|modules$)/i,
  /^\.claude\/settings/i, /\.(pem|key)$/i, /^public\/(_headers|_redirects|sw\.js|version\.json)$/i, /^public\/(sw|vendor|generated)\//i];
export const isDeniedPath = (p) => typeof p !== "string" || p.includes("..") || DENY.some((re) => re.test(p));

/** The §6 warnings for a path, as copy ids. */
export function warningsFor(path) {
  const w = [];
  if (/^public\/.+\.(js|html)$/i.test(path)) w.push("agents.proposal.warn.code");
  if (/^\.claude\//.test(path)) w.push("agents.proposal.warn.agents");
  if (/^tests\//.test(path)) w.push("agents.proposal.warn.tests");
  return w;
}

/** A unified diff as lines with a real +/− marker on every changed line (WCAG 1.4.1). */
export function diffLines(text) {
  const lines = String(text ?? "").replace(/\n$/, "").split("\n");
  return lines.map((line) => {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@") || line.startsWith("\\")) {
      return h("span", { class: "diff__line diff__line--hunk" }, line);
    }
    const kind = line[0] === "+" ? "add" : line[0] === "-" ? "del" : "ctx";
    const marker = kind === "add" ? "+" : kind === "del" ? "−" : " ";
    const label = kind === "add" ? say("agents.proposal.added") : kind === "del" ? say("agents.proposal.removed") : null;
    return h("span", { class: `diff__line diff__line--${kind}` },
      h("span", { class: "diff__marker", "aria-hidden": "true" }, marker),
      label ? h("span", { class: "visually-hidden" }, `${label}: `) : null,
      line.slice(1));
  });
}

function diffBlock(path, diffText) {
  const pre = h("pre", { class: "diff", tabindex: "0", role: "region", "aria-label": say("agents.proposal.diff.for", { path }) });
  pre.append(...diffLines(diffText));
  return h("details", { class: "disclosure diff-block", dataset: { testid: "proposal-diff" } },
    h("summary", {}, icon("chevron-down"), h("span", { class: "diff-block__path" }, say("agents.proposal.diff.for", { path }))),
    pre);
}

const shortLabel = (s) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

/**
 * @param {object} view  proposal-view {proposal, diffs, deploys, approveEnabled, approvals}
 * @param {{onReview: (card, view) => void, onReject: (card, view) => void, headingLevel?: number}} handlers
 * @returns {HTMLElement & {status: HTMLElement, alert: HTMLElement, update: (view) => void}}
 */
export function proposalCard(view, handlers) {
  const p = view.proposal;
  const titleId = `proposal-${p.id}`;
  const status = h("p", { class: "status-line", role: "status", dataset: { testid: "proposal-status" } });
  const alert = h("div", { role: "alert", dataset: { testid: "proposal-alert" } });
  const actions = h("div", { class: "button-row" });
  const outcome = h("ul", { class: "outcome", dataset: { testid: "proposal-outcome" } });
  const files = Array.isArray(p.files) ? p.files : [];
  const diffs = new Map((view.diffs ?? []).map((d) => [d.path, d.diff]));
  const anyDenied = files.some((f) => isDeniedPath(f.path));
  const warnIds = [...new Set(files.flatMap((f) => warningsFor(f.path)))];
  const heading = `h${handlers.headingLevel ?? 2}`;

  const card = h("article", { class: "proposal-card", "aria-labelledby": titleId, dataset: { testid: "proposal-card", proposal: p.id, status: p.status } },
    h(heading, { class: "proposal-card__title", id: titleId }, `${say("agents.proposal.title")}: ${p.summary}`),
    h("p", { class: "proposal-card__meta" },
      `${p.agent} · ${files.length === 1 ? say("agents.proposal.file") : say("agents.proposal.files", { n: files.length })} · `,
      say("agents.proposal.meta", { base: shortSha(p.baseSha), hash: shortHash(p.contentHash) })),
    h("ul", { class: "file-list" }, files.map((f) => {
      const denied = isDeniedPath(f.path);
      return h("li", { class: "file-list__item" },
        h("span", { class: "file-list__path" }, f.path),
        h("span", { class: "muted" }, ` ${say("agents.proposal.bytes", { bytes: utf8Bytes(f.content) })} `),
        h("span", { class: `file-status file-status--${denied ? "denied" : "ok"}` },
          icon(denied ? "x-circle" : "check-circle"), say(denied ? "agents.proposal.denied" : "agents.proposal.allowed")));
    })),
    warnIds.length ? h("ul", { class: "warning-list", dataset: { testid: "proposal-warnings" } },
      warnIds.map((id) => h("li", {}, icon("alert"), h("span", {}, say(id))))) : null,
    ...files.map((f) => diffBlock(f.path, diffs.get(f.path) ?? "")),
    actions, outcome, status, alert);

  Object.assign(card, { status, alert, outcome, actions, view });

  /** Re-draw the buttons and state text for a (re)loaded view. Keeps the live regions in place. */
  card.update = (next) => {
    card.view = next;
    const np = next.proposal;
    card.dataset.status = np.status;
    clear(actions);
    if (np.status === "pending") {
      const capped = next.approvals && next.approvals.retryAt;
      const review = h("button", { class: "btn btn--primary", type: "button", dataset: { testid: "proposal-review" },
        "aria-label": `${say("btn.review")}: ${shortLabel(np.summary)}` }, say("btn.review"));
      const reject = h("button", { class: "btn btn--danger", type: "button", dataset: { testid: "proposal-reject" },
        "aria-label": `${say("btn.reject")}: ${shortLabel(np.summary)}`, onclick: () => handlers.onReject(card, card.view) }, say("btn.reject"));
      if (anyDenied) {
        announce(alert, say("console.error.path"));
      } else if (capped) {
        showCap(card, next.approvals);
      } else if (next.approveEnabled === false) {
        const why = h("p", { class: "field__hint", id: `${p.id}-off`, dataset: { testid: "approve-off" } }, say("console.approve.disabled"));
        review.setAttribute("aria-disabled", "true");
        review.setAttribute("aria-describedby", why.id);
        actions.append(review, reject, why);
        return;
      } else {
        review.addEventListener("click", () => handlers.onReview(card, card.view));
        actions.append(review);
      }
      actions.append(reject);
      return;
    }
    if (np.status === "stale") announce(status, say("console.stale.card"));
    else if (np.status === "rejected") announce(status, say("console.status.rejected"));
    else if (np.status === "committing") announce(status, say("agents.proposal.committing"));
    else if (np.status === "failed") announce(alert, say("agents.proposal.failed"));
    else if (np.status === "committed" && np.commitSha) showCommitted(card, np.commitSha, next.deploys, { live: false });
  };
  card.update(view);
  return card;
}

/** S9: the cap message is a blocking failure (role="alert"). Review stays hidden until retryAt; Reject stays. */
export function showCap(card, approvals) {
  const a = approvals ?? {};
  const daily = Number.isInteger(a.usedToday) && Number.isInteger(a.perDay) && a.usedToday >= a.perDay;
  const line = daily
    ? say("console.cap.day")
    : say("console.cap.month", { used: a.used31 ?? a.per31Days ?? 14, date: formatWhen(a.retryAt) || "—" });
  clear(card.alert, h("div", { class: "cap-note", dataset: { testid: "approve-cap" } },
    h("p", {}, line), h("p", {}, say("console.cap.waiting"))));
  card.actions.querySelector('[data-testid="proposal-review"]')?.remove();
}

/**
 * The committed outcome. deploys !== false uses the deploy wording (the safe default when unknown, docs/04 §1).
 * Returns the <li> to update with Live.
 */
export function showCommitted(card, commitSha, deploys, { live = true } = {}) {
  clear(card.actions);
  const shaLink = externalLink(commitUrl(commitSha), shortSha(commitSha), { class: "outcome__sha", dataset: { testid: "commit-link" } });
  const text = deploys === false
    ? say("console.status.committed.nodeploy", { sha: shortSha(commitSha) })
    : say("console.status.committed", { sha: shortSha(commitSha) });
  announce(card.status, text);
  const item = h("li", { "data-state": deploys === false ? "done" : "pending" }, icon(deploys === false ? "check-circle" : "clock"),
    h("span", {}, `${say("btn.viewCommit")} `), shaLink);
  clear(card.outcome, item);
  if (deploys === false) card.outcome.append(h("li", { "data-state": "done", class: "deploy-note" }, say("console.status.nodeploy.detail")));
  card.liveItem = live && deploys !== false ? item : null;
  return item;
}

export function showLive(card) {
  announce(card.status, say("console.status.live"));
  if (card.liveItem) { card.liveItem.dataset.state = "done"; card.liveItem.querySelector("use")?.setAttribute("href", "/img/sprite.svg#check-circle"); }
}

export function showStillDeploying(card) {
  announce(card.status, say("console.status.stilldeploying"));
}

/** 502 / unknown outcome on Approve: never offer Approve again; point at the commit list. */
export function showUnconfirmed(card) {
  clear(card.alert, h("div", { class: "banner banner--error", dataset: { testid: "approve-unconfirmed" } },
    icon("x-circle"),
    h("div", { class: "banner__body" },
      h("p", { class: "banner__title" }, say("console.error.confirm")),
      h("p", {}, say("console.error.confirm.next")),
      h("p", {}, externalLink(commitsUrl(), say("btn.viewCommits"))))));
}

/** Small placeholder from the SSE `proposal` event, replaced by the full card once the GET returns. */
export function proposalPlaceholder(ev) {
  return h("article", { class: "proposal-card", dataset: { testid: "proposal-card", proposal: ev.proposalId }, "aria-busy": "true" },
    h("h2", { class: "proposal-card__title" }, `${say("agents.proposal.title")}: ${ev.summary}`),
    h("ul", { class: "file-list" }, (ev.files ?? []).map((f) => h("li", { class: "file-list__item" },
      h("span", { class: "file-list__path" }, f.path), h("span", { class: "muted" }, ` ${say("agents.proposal.bytes", { bytes: f.bytes })}`)))),
    h("p", { class: "status-line", role: "status" }, say("agents.proposal.loading")));
}
