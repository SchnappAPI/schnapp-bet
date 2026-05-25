import { NextRequest, NextResponse } from "next/server";

const OWNER = "SchnappAPI";
const REPO = "appfolio-quickbase-sync";

// QB refresh status parsed from trigger step logs.
const QB_STATUS_RE = /status: (\d{3})/i;

function ts(d: string) {
  const dt = new Date(d);
  return dt.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "America/Chicago",
  });
}

// Ordered inline patterns to scan from the "Run CSV export" log.
// Each fires at most once, in the order listed.
const INLINE_PATTERNS: { re: RegExp; label: (m: RegExpMatchArray) => string }[] = [
  { re: /Fetching Unit Directory/i,          label: () => "FETCHING UNITS" },
  { re: /Fetching Unit Vacancy/i,            label: () => "FETCHING VACANCY" },
  { re: /Fetching Property Custom Fields/i,  label: () => "FETCHING PROPERTY FIELDS" },
  { re: /Fetching Unit Custom Fields/i,      label: () => "FETCHING UNIT FIELDS" },
  { re: /Fetching Tenant Directory/i,        label: () => "FETCHING TENANTS" },
  { re: /Fetching Pending Applications/i,    label: () => "FETCHING PENDING APPS" },
  { re: /Fetching Leases MTD/i,              label: () => "FETCHING LEASES MTD" },
  { re: /Fetching Future Move-Ins/i,         label: () => "FETCHING MOVE-INS" },
  { re: /\[STEP 3\]/i,                       label: () => "MERGING DATA" },
  { re: /\[STEP 4\]/i,                       label: () => "TRANSFORMING" },
  { re: /Wrote (\d+) rows.*?units\.csv/i,    label: (m) => `WROTE ${m[1]} UNITS` },
  { re: /Wrote (\d+) rows.*?residents\.csv/i,label: (m) => `WROTE ${m[1]} RESIDENTS` },
  { re: /Wrote (\d+) rows.*?occupancy_/i,    label: (m) => `WROTE ${m[1]} OCCUPANCY ROWS` },
];

// Inline patterns for the Dropbox upload step.
const DROPBOX_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /Uploaded units\.csv/i,      label: "DROPBOX: UNITS" },
  { re: /Uploaded residents\.csv/i,  label: "DROPBOX: RESIDENTS" },
  { re: /Uploaded occupancy_/i,      label: "DROPBOX: OCCUPANCY" },
];

function parseInlineLines(
  log: string,
  patterns: { re: RegExp; label: (m: RegExpMatchArray) => string }[],
  stepStartedAt: string
): { time: string; text: string }[] {
  // GitHub job log lines look like: 2025-05-01T10:00:01.1234567Z  some text
  // We'll try to extract timestamps per line; fall back to step start time.
  const lines = log.split("\n");
  const result: { time: string; text: string }[] = [];
  const fired = new Set<number>();

  for (const line of lines) {
    // GitHub log timestamp prefix: YYYY-MM-DDTHH:MM:SS.xxxxxxxZ
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    const lineTime = tsMatch ? ts(tsMatch[1] + "Z") : ts(stepStartedAt);
    const text = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")
                     .replace(/##\[.*?\]/g, "")
                     .trim();

    for (let i = 0; i < patterns.length; i++) {
      if (fired.has(i)) continue;
      const m = text.match(patterns[i].re);
      if (m) {
        fired.add(i);
        result.push({ time: lineTime, text: patterns[i].label(m) });
      }
    }
  }
  return result;
}

function parseDropboxLines(
  log: string,
  stepStartedAt: string
): { time: string; text: string }[] {
  const lines = log.split("\n");
  const result: { time: string; text: string }[] = [];
  const fired = new Set<number>();

  for (const line of lines) {
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    const lineTime = tsMatch ? ts(tsMatch[1] + "Z") : ts(stepStartedAt);
    const text = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")
                     .replace(/##\[.*?\]/g, "")
                     .trim();

    for (let i = 0; i < DROPBOX_PATTERNS.length; i++) {
      if (fired.has(i)) continue;
      if (DROPBOX_PATTERNS[i].re.test(text)) {
        fired.add(i);
        result.push({ time: lineTime, text: DROPBOX_PATTERNS[i].label });
      }
    }
  }
  return result;
}

function splitLogSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = raw.split(/\n(?=##\[group\])/);
  for (const sec of parts) {
    const header = sec.match(/##\[group\](.*)/)?.[1]?.trim() ?? "";
    if (header) sections[header] = sec;
  }
  return sections;
}

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "missing runId" }, { status: 400 });

  const token = process.env.GITHUB_PAT;
  if (!token) return NextResponse.json({ error: "GITHUB_PAT not configured" }, { status: 500 });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const [runRes, jobsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}`, { headers }),
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`, { headers }),
  ]);

  if (!runRes.ok) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const run = await runRes.json();
  const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };
  const job = jobsData.jobs?.[0];

  const done = run.status === "completed";
  const failed = done && run.conclusion !== "success";
  const lines: { time: string; text: string }[] = [];

  if (!job) {
    return NextResponse.json({ lines, done, failed, runUrl: run.html_url });
  }

  const steps: any[] = job.steps ?? [];
  const completedNames = new Set(steps.filter(s => s.conclusion).map(s => s.name));
  const activeNames = new Set(steps.filter(s => s.status === "in_progress").map(s => s.name));

  const needsLogs =
    completedNames.has("Run CSV export") ||
    completedNames.has("Upload CSVs to Dropbox") ||
    completedNames.has("Trigger refresh - Fish Units") ||
    completedNames.has("Trigger refresh - Fish Residents") ||
    completedNames.has("Trigger refresh - Fish Occupancy") ||
    // Also fetch logs while export step is in-progress to stream inline events
    activeNames.has("Run CSV export") ||
    activeNames.has("Upload CSVs to Dropbox");

  let sections: Record<string, string> = {};
  if (needsLogs) {
    const logRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`,
      { headers }
    );
    if (logRes.ok) {
      sections = splitLogSections(await logRes.text());
    }
  }

  for (const step of steps) {
    if (step.status === "queued") continue;

    const stepTime = step.started_at ?? job.started_at;
    const time = ts(stepTime);

    // --- Run CSV export ---
    if (step.name === "Run CSV export") {
      const log = sections["Run CSV export"] ?? "";
      if (log) {
        // Stream inline events from the log regardless of step completion state
        const parsed = parseInlineLines(log, INLINE_PATTERNS, stepTime);
        lines.push(...parsed);
      } else if (step.status === "in_progress") {
        lines.push({ time, text: "FETCHING DATA..." });
      } else if (step.conclusion && step.conclusion !== "success") {
        lines.push({ time, text: "FETCH FAILED" });
      }
      continue;
    }

    // --- Upload CSVs to Dropbox ---
    if (step.name === "Upload CSVs to Dropbox") {
      const log = sections["Upload CSVs to Dropbox"] ?? "";
      if (log) {
        const parsed = parseDropboxLines(log, stepTime);
        lines.push(...parsed);
        if (!parsed.length && step.conclusion) {
          lines.push({ time: ts(step.completed_at ?? stepTime), text: step.conclusion === "success" ? "DROPBOX UPLOAD DONE" : "DROPBOX UPLOAD FAILED" });
        }
      } else if (step.status === "in_progress") {
        lines.push({ time, text: "UPLOADING TO DROPBOX..." });
      }
      continue;
    }

    // --- Sleep step: skip ---
    if (step.name === "Sleep 30s to allow Dropbox to register files") continue;

    // --- QB refresh steps ---
    if (step.name.startsWith("Trigger refresh")) {
      if (step.status === "in_progress") {
        const label = step.name.replace("Trigger refresh - ", "QB ").toUpperCase() + " REFRESH...";
        lines.push({ time, text: label });
        continue;
      }
      if (!step.conclusion) continue;
      const sectionKey = step.name;
      const log = sections[sectionKey] ?? "";
      const statusMatch = log.match(QB_STATUS_RE);
      const statusCode = statusMatch ? statusMatch[1] : step.conclusion === "success" ? "200" : "ERR";
      const label = step.name
        .replace("Trigger refresh - Fish ", "QB ")
        .toUpperCase();
      lines.push({ time: ts(step.completed_at ?? stepTime), text: `${label} REFRESH (${statusCode})` });
    }
  }

  // Final summary
  if (done && job.started_at && job.completed_at) {
    const elapsed = Math.round(
      (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000
    );
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const dur = m > 0 ? `${m}m ${s}s` : `${s}s`;
    lines.push({
      time: ts(job.completed_at),
      text: failed ? `FAILED. ${dur}` : `DONE. ${dur}`,
    });
  }

  return NextResponse.json({ lines, done, failed, runUrl: run.html_url });
}
