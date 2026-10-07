// Excerpt from a private codebase: HALO Agent OS, server/today.ts at 88cf4ce.
// Shown for reading. Not licensed for reuse; see ../LICENSE.
//
// The home screen, computed — no model call (`docs/WORKSTATION.md` §2.1).
//
// Four blocks from state the harness already keeps: the brief (what happened
// since the owner last looked), Needs-you (one ranked list of everything that
// waits on a human), Next (three template runs the plan suggests), and the
// week (routines ahead). Pure over plain inputs so it is a table of tests and
// costs nothing per render.
import type { Handoff } from "./agent-board.ts";
import type { Approval } from "./approvals.ts";
import type { Routine, RoutineRun } from "./routines.ts";
import type { Template } from "./templates.ts";

export interface TodayBot {
  id: string;
  name: string;
  title: string;
  chiefOfStaff?: boolean;
  /** The thread has something the owner has not read. */
  unread?: boolean;
  busy?: boolean;
}

export interface TodayInput {
  now: number;
  /** When the owner last opened Today (or signed in). Brief covers since then; null = last 24h. */
  since: number | null;
  bots: TodayBot[];
  routines: Routine[];
  runs: RoutineRun[];
  handoffs: Handoff[];
  /** Approvals waiting on the owner, from `buildApprovals` — an agent is
   * stopped mid-work until each one is answered, which is why they outrank
   * everything else on this list. Omitted = none. */
  approvals?: Approval[];
  templates: Template[];
  /** Templates the plan named as the first task and the stage's suggestions, by slug, best first. */
  suggestedSlugs: string[];
  /** Whether an intake plan has been applied. */
  planned: boolean;
  spend?: { usedCents: number; capCents: number | null };
}

export type NeedKind = "approval" | "question" | "returned-handoff" | "failed-routine" | "missed-routine" | "spend";

export interface NeedRow {
  kind: NeedKind;
  /** Higher first. */
  rank: number;
  title: string;
  detail: string;
  botId?: string;
  threadId?: string;
  runId?: string;
  /**
   * The routine a failed or missed run belongs to.
   *
   * Carried so Today's "Retry" can actually start a run. Without it the button
   * could only navigate, which is what it did until 2026-09-09 — a control
   * whose label named an action it did not perform.
   */
  routineId?: string;
  handoffId?: string;
  /** The verb on the button. */
  action: "Answer" | "Open" | "Reopen" | "Retry" | "Plan";
  at: number;
}

export interface BriefLine {
  kind: "run" | "handoff" | "spend" | "quiet";
  text: string;
  at: number;
  /** The agent to open for this line, when there is one. */
  botId?: string;
  threadId?: string;
  runId?: string;
}

export interface NextRow {
  slug: string;
  title: string;
  /** Why now. */
  reason: string;
  department?: string;
  botId?: string;
}

export interface Today {
  since: number;
  brief: BriefLine[];
  needsYou: NeedRow[];
  next: NextRow[];
  week: Array<{ routineId: string; name: string; botId: string; at: number; status: "scheduled" | RoutineRun["status"] }>;
  counts: { agents: number; busy: number; routines: number; needsYou: number };
  planned: boolean;
}

const DAY = 24 * 60 * 60_000;

function botName(bots: TodayBot[], id: string) {
  return bots.find((b) => b.id === id)?.name ?? "an agent";
}

export function buildToday(input: TodayInput): Today {
  const since = input.since ?? input.now - DAY;
  const brief: BriefLine[] = [];

  for (const run of input.runs) {
    const at = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
    if (at < since || at > input.now) continue;
    if (run.status === "completed") {
      brief.push({ kind: "run", at, botId: run.botId, runId: run.id, threadId: run.threadId, text: `${run.routineName} ran (${botName(input.bots, run.botId)})${run.output ? `: ${run.output.slice(0, 120)}` : ""}` });
    }
  }
  for (const h of input.handoffs) {
    const at = h.updatedAt ?? h.createdAt;
    if (h.state === "done" && at >= since && at <= input.now) {
      const who = h.toBotId ? botName(input.bots, h.toBotId) : "the team";
      brief.push({ kind: "handoff", at, botId: h.toBotId ?? h.fromBotId, text: `${who} finished "${h.task}" for ${h.fromBotName || botName(input.bots, h.fromBotId)}` });
    }
  }
  if (input.spend && input.spend.usedCents > 0) {
    const cap = input.spend.capCents != null ? ` of a $${(input.spend.capCents / 100).toFixed(0)} cap` : "";
    brief.push({ kind: "spend", at: input.now, text: `Model spend this month: $${(input.spend.usedCents / 100).toFixed(2)}${cap}` });
  }
  brief.sort((a, b) => b.at - a.at);
  if (brief.length === 0) brief.push({ kind: "quiet", at: input.now, text: input.planned ? "Nothing ran since you last looked." : "Nothing has run yet. Set the team up and the first task starts now." });

  const needsYou: NeedRow[] = [];
  // Spend, in front of the wall. Derived from the report on every build rather
  // than remembered, so it is on the page for as long as it is true and gone the
  // period it stops being true. 75% is a heads-up; 95% is "agents stop soon".
  if (input.spend?.capCents && input.spend.usedCents / input.spend.capCents >= 0.75) {
    const pct = Math.floor((input.spend.usedCents / input.spend.capCents) * 100);
    const urgent = pct >= 95;
    needsYou.push({
      kind: "spend",
      rank: urgent ? 92 : 55,
      title: urgent ? `Model spend is at ${pct}% — agents stop at 100%` : `Model spend is at ${pct}% of this period's budget`,
      detail: `$${(input.spend.usedCents / 100).toFixed(2)} of $${(input.spend.capCents / 100).toFixed(2)} used. ${urgent ? "Add budget now or work will pause until the period rolls over." : "Nothing stops yet; this is the early warning."}`,
      action: "Plan",
      at: input.now,
    });
  }
  // Approvals first, and above everything (a question is 80). Every other row
  // is work the owner could do later; an approval is an agent standing still.
  //
  // A stale one is ranked just under the live ones rather than at the bottom:
  // it is not actionable, but it means an agent gave up waiting and its turn is
  // gone, which the owner should see once — and its verb is Open, not Answer,
  // because `respondToRequest` would throw for it.
  for (const a of input.approvals ?? []) {
    const where = a.taskTitle ? ` · ${a.taskTitle}` : "";
    needsYou.push(
      a.stale
        ? { kind: "approval", rank: 90, title: `${a.botName} asked about ${a.tool} and gave up waiting`, detail: `The turn it belonged to has ended, so this can no longer be answered: ${a.summary}${where}`, botId: a.botId, threadId: a.threadId, action: "Open", at: a.at }
        : { kind: "approval", rank: 95, title: `${a.botName} needs approval to use ${a.tool}`, detail: `${a.summary}${where}`, botId: a.botId, threadId: a.threadId, action: "Answer", at: a.at },
    );
  }
  for (const run of input.runs) {
    if (run.seenAt) continue;
    if (run.status === "failed") needsYou.push({ kind: "failed-routine", rank: 60, title: `${run.routineName} failed`, detail: run.error?.slice(0, 160) || "No reason was recorded.", botId: run.botId, threadId: run.threadId, runId: run.id, routineId: run.routineId, action: "Retry", at: run.finishedAt ?? run.scheduledFor });
    if (run.status === "missed") needsYou.push({ kind: "missed-routine", rank: 40, title: `${run.routineName} was missed`, detail: run.lateReason === "asleep" ? "The computer was asleep." : run.lateReason === "app-closed" ? "HALO was closed." : "It did not run on time.", botId: run.botId, runId: run.id, routineId: run.routineId, action: "Retry", at: run.scheduledFor });
  }
  for (const h of input.handoffs) {
    if (h.state === "returned") {
      const who = h.toBotId ? botName(input.bots, h.toBotId) : "the team";
      needsYou.push({ kind: "returned-handoff", rank: 70, title: `"${h.task}" came back`, detail: `${who} returned it to ${h.fromBotName || botName(input.bots, h.fromBotId)}${h.result ? `: ${h.result.slice(0, 140)}` : "."}`, handoffId: h.id, botId: h.fromBotId, action: "Reopen", at: h.updatedAt ?? h.createdAt });
    }
  }
  for (const b of input.bots) {
    if (b.unread) needsYou.push({ kind: "question", rank: 80, title: `${b.name} is waiting on you`, detail: b.title ? `${b.title} has something you have not read.` : "There is something you have not read.", botId: b.id, action: "Open", at: input.now });
  }
  needsYou.sort((a, b) => b.rank - a.rank || b.at - a.at);

  const next: NextRow[] = [];
  const bySlug = new Map(input.templates.map((t) => [t.slug, t]));
  for (const slug of input.suggestedSlugs) {
    const t = bySlug.get(slug);
    if (!t || next.some((n) => n.slug === slug)) continue;
    next.push({ slug, title: t.title, reason: t.whenToUse, department: t.department });
    if (next.length === 3) break;
  }
  if (next.length < 3) {
    for (const t of input.templates) {
      if (next.some((n) => n.slug === t.slug)) continue;
      next.push({ slug: t.slug, title: t.title, reason: t.whenToUse, department: t.department });
      if (next.length === 3) break;
    }
  }

  const horizon = input.now + 7 * DAY;
  const week: Today["week"] = [];
  for (const r of input.routines) {
    if (!r.enabled || r.nextRunAt == null || r.nextRunAt > horizon) continue;
    week.push({ routineId: r.id, name: r.name, botId: r.botId, at: r.nextRunAt, status: "scheduled" });
  }
  for (const run of input.runs) {
    if (run.scheduledFor >= input.now - DAY && run.scheduledFor <= horizon && run.status !== "queued") {
      week.push({ routineId: run.routineId, name: run.routineName, botId: run.botId, at: run.scheduledFor, status: run.status });
    }
  }
  week.sort((a, b) => a.at - b.at);

  return {
    since,
    brief,
    needsYou,
    next,
    week,
    counts: { agents: input.bots.length, busy: input.bots.filter((b) => b.busy).length, routines: input.routines.filter((r) => r.enabled).length, needsYou: needsYou.length },
    planned: input.planned,
  };
}
