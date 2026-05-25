import { NextRequest, NextResponse } from "next/server";

const OWNER = "SchnappAPI";
const REPO = "appfolio-quickbase-sync";

// Maps GitHub step names to terse caveman log labels.
const STEP_LABELS: Record<string, string> = {
  "Run CSV export":              "FETCHING DATA",
  "Upload CSVs to Dropbox":      "DROPBOX UPLOAD DONE",
  "Sleep 30s to allow Dropbox to register files": "WAITING FOR DROPBOX",
  "Trigger refresh - Fish Units":     "QB UNITS REFRESH",
  "Trigger refresh - Fish Residents": "QB RESIDENTS REFRESH",
  "Trigger refresh - Fish Occupancy": "QB OCCUPANCY REFRESH",
};

// Row count patterns parsed from the "Run CSV export" step log.
const ROW_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "WROTE {n} UNITS",         re: /Wrote (\d+) rows.*units\.csv/i },
  { label: "WROTE {n} RESIDENTS",     re: /Wrote (\d+) rows.*residents\.csv/i },
  { label: "WROTE {n} OCCUPANCY ROWS",re: /Wrote (\d+) rows.*occupancy_/i },
];

// QB refresh status parsed from trigger step logs.
const QB_STATUS_RE = /status: (\d{3})/i;

function ts(d: string) {
  const dt = new Date(d);
  return dt.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "America/Chicago",
  });
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

  // Fetch run status
  const runRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}`,
    { headers }
  );
  if (!runRes.ok) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const run = await runRes.json();

  // Fetch jobs
  const jobsRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`,
    { headers }
  );
  const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };
  const job = jobsData.jobs?.[0];

  const lines: { time: string; text: string }[] = [];
  const done = run.status === "completed";
  const failed = done && run.conclusion !== "success";

  if (!job) {
    return NextResponse.json({ lines, done, failed, runUrl: run.html_url });
  }

  const steps: any[] = job.steps ?? [];

  // For the CSV export step, fetch logs to extract row counts and QB statuses.
  let exportLog = "";
  let unitsLog = "";
  let residentsLog = "";
  let occupancyLog = "";

  const completedStepNames = new Set(
    steps.filter(s => s.conclusion).map(s => s.name)
  );

  const needsLogs =
    completedStepNames.has("Run CSV export") ||
    completedStepNames.has("Trigger refresh - Fish Units") ||
    completedStepNames.has("Trigger refresh - Fish Residents") ||
    completedStepNames.has("Trigger refresh - Fish Occupancy");

  if (needsLogs) {
    const logRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`,
      { headers }
    );
    if (logRes.ok) {
      const raw = await logRes.text();
      // Split into per-step sections by the GitHub log header format.
      // Each step starts with a line like: ##[group]Run CSV export
      const sections = raw.split(/\n(?=##\[group\])/);
      for (const sec of sections) {
        const header = sec.match(/##\[group\](.*)/)?.[1]?.trim() ?? "";
        if (header === "Run CSV export") exportLog = sec;
        else if (header === "Trigger refresh - Fish Units") unitsLog = sec;
        else if (header === "Trigger refresh - Fish Residents") residentsLog = sec;
        else if (header === "Trigger refresh - Fish Occupancy") occupancyLog = sec;
      }
    }
  }

  // Build log lines from completed/in-progress steps.
  for (const step of steps) {
    const label = STEP_LABELS[step.name];
    if (!label) continue;

    const stepTime = step.completed_at ?? step.started_at ?? job.started_at;
    const time = ts(stepTime);

    if (!step.conclusion && step.status === "in_progress") {
      lines.push({ time, text: `${label}...` });
      continue;
    }

    if (!step.conclusion) continue; // queued, not started

    const ok = step.conclusion === "success";

    if (step.name === "Run CSV export") {
      if (ok) {
        // Emit individual row count lines.
        for (const pat of ROW_PATTERNS) {
          const m = exportLog.match(pat.re);
          if (m) {
            lines.push({ time, text: pat.label.replace("{n}", m[1]) });
          }
        }
      } else {
        lines.push({ time, text: "FETCH FAILED" });
      }
      continue;
    }

    if (step.name === "Upload CSVs to Dropbox") {
      lines.push({ time, text: ok ? "DROPBOX UPLOAD DONE" : "DROPBOX UPLOAD FAILED" });
      continue;
    }

    if (step.name === "Sleep 30s to allow Dropbox to register files") {
      // Silent — not interesting enough to show.
      continue;
    }

    // QB refresh steps
    const logText =
      step.name === "Trigger refresh - Fish Units" ? unitsLog :
      step.name === "Trigger refresh - Fish Residents" ? residentsLog :
      occupancyLog;
    const statusMatch = logText.match(QB_STATUS_RE);
    const statusCode = statusMatch ? statusMatch[1] : ok ? "200" : "ERR";
    lines.push({ time, text: `${label} (${statusCode})` });
  }

  // Final summary line if done.
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
