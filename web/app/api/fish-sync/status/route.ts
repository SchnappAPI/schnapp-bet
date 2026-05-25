import { NextRequest, NextResponse } from "next/server";

const OWNER = "SchnappAPI";
const REPO = "appfolio-quickbase-sync";

// ISO timestamp prefix on every GitHub Actions log line.
const LINE_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;

function ts(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "America/Chicago",
  });
}

// Each pattern fires at most once, in order. label() receives the full regex match.
const LOG_PATTERNS: { re: RegExp; label: (m: RegExpMatchArray) => string }[] = [
  { re: /Fetching Unit Directory\.\.\./,           label: () => "FETCHING UNITS" },
  { re: /Fetching Unit Vacancy\.\.\./,             label: () => "FETCHING VACANCY" },
  { re: /Fetching Property Custom Fields\.\.\./,   label: () => "FETCHING PROPERTY FIELDS" },
  { re: /Fetching Unit Custom Fields\.\.\./,       label: () => "FETCHING UNIT FIELDS" },
  { re: /Fetching Tenant Directory/,               label: () => "FETCHING TENANTS" },
  { re: /Fetching Pending Applications\.\.\./,     label: () => "FETCHING PENDING APPS" },
  { re: /Fetching Leases MTD\.\.\./,               label: () => "FETCHING LEASES MTD" },
  { re: /Fetching Future Move-Ins\.\.\./,          label: () => "FETCHING MOVE-INS" },
  { re: /Fetching Rental Applications for Move-Ins/, label: () => "FETCHING APPS FOR MOVE-INS" },
  { re: /\[STEP 3\]/,                             label: () => "MERGING DATA" },
  { re: /\[STEP 4\]/,                             label: () => "TRANSFORMING" },
  { re: /Wrote (\d+) rows.*?units\.csv/,          label: (m) => `WROTE ${m[1]} UNITS` },
  { re: /Wrote (\d+) rows.*?residents\.csv/,      label: (m) => `WROTE ${m[1]} RESIDENTS` },
  { re: /Wrote (\d+) rows.*?occupancy_/,          label: (m) => `WROTE ${m[1]} OCCUPANCY ROWS` },
  { re: /Uploaded units\.csv/,                    label: () => "DROPBOX: UNITS" },
  { re: /Uploaded residents\.csv/,                label: () => "DROPBOX: RESIDENTS" },
  { re: /Uploaded occupancy_/,                    label: () => "DROPBOX: OCCUPANCY" },
  { re: /Units refresh trigger status: (\d+)/,    label: (m) => `QB UNITS REFRESH (${m[1]})` },
  { re: /Residents refresh trigger status: (\d+)/,label: (m) => `QB RESIDENTS REFRESH (${m[1]})` },
  { re: /Occupancy refresh trigger status: (\d+)/,label: (m) => `QB OCCUPANCY REFRESH (${m[1]})` },
];

function parseLog(raw: string): { time: string; text: string }[] {
  const lines = raw.split("\n");
  const result: { time: string; text: string }[] = [];
  const fired = new Set<number>();

  for (const line of lines) {
    // Strip ANSI color codes and the ISO timestamp prefix to get clean text
    const clean = line
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")
      .trim();

    const tsMatch = line.match(LINE_TS_RE);
    const lineTime = tsMatch ? ts(tsMatch[1] + "Z") : "--:--:--";

    for (let i = 0; i < LOG_PATTERNS.length; i++) {
      if (fired.has(i)) continue;
      const m = clean.match(LOG_PATTERNS[i].re);
      if (m) {
        fired.add(i);
        result.push({ time: lineTime, text: LOG_PATTERNS[i].label(m) });
        break; // one pattern per line
      }
    }
  }

  return result;
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
  let lines: { time: string; text: string }[] = [];

  if (job) {
    // Fetch flat log whenever the export step has started (in_progress or completed)
    const steps: any[] = job.steps ?? [];
    const exportStep = steps.find(s => s.name === "Run CSV export");
    const shouldFetchLog = exportStep && exportStep.status !== "queued";

    if (shouldFetchLog) {
      const logRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`,
        { headers }
      );
      if (logRes.ok) {
        lines = parseLog(await logRes.text());
      }
    }

    // Append final summary line
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
  }

  return NextResponse.json({ lines, done, failed });
}
