import { NextRequest, NextResponse } from "next/server";

const OWNER = "SchnappAPI";
const REPO = "appfolio-quickbase-sync";

const LINE_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;

function ts(iso: string): string {
  return new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "America/Chicago",
  });
}

export type RowState = "pending" | "active" | "done" | "error";

export interface StatusRow {
  id: string;
  pending: string;
  active: string;
  done: string; // may contain {n} placeholder filled at parse time
  state: RowState;
  completedAt?: string; // Central time string
}

// The 19 fixed rows in display order.
// done templates use {n} for dynamic counts filled by the log parser.
const ROWS: Omit<StatusRow, "state">[] = [
  {
    id: "fetch_unit_directory",
    pending: "Fetch records from /unit_directory.json",
    active:  "Fetching records from /unit_directory.json...",
    done:    "Fetched {n} records from /unit_directory.json",
  },
  {
    id: "fetch_unit_vacancy",
    pending: "Fetch records from /unit_vacancy.json",
    active:  "Fetching records from /unit_vacancy.json...",
    done:    "Fetched {n} records from /unit_vacancy.json",
  },
  {
    id: "fetch_property_custom_fields",
    pending: "Fetch records from /property_custom_fields.json",
    active:  "Fetching records from /property_custom_fields.json...",
    done:    "Fetched {n} records from /property_custom_fields.json",
  },
  {
    id: "fetch_unit_custom_fields",
    pending: "Fetch records from /unit_custom_fields.json",
    active:  "Fetching records from /unit_custom_fields.json...",
    done:    "Fetched {n} records from /unit_custom_fields.json",
  },
  {
    id: "fetch_tenant_directory",
    pending: "Fetch records from /tenant_directory.json",
    active:  "Fetching records from /tenant_directory.json...",
    done:    "Fetched {n} records from /tenant_directory.json",
  },
  {
    id: "fetch_rental_applications_pending",
    pending: "Fetch records from /rental_applications.json (pending)",
    active:  "Fetching records from /rental_applications.json (pending)...",
    done:    "Fetched {n} records from /rental_applications.json (pending)",
  },
  {
    id: "fetch_rental_applications_leases",
    pending: "Fetch records from /rental_applications.json (leases mtd)",
    active:  "Fetching records from /rental_applications.json (leases mtd)...",
    done:    "Fetched {n} records from /rental_applications.json (leases mtd)",
  },
  {
    id: "fetch_tenant_tickler",
    pending: "Fetch records from /tenant_tickler.json",
    active:  "Fetching records from /tenant_tickler.json...",
    done:    "Fetched {n} records from /tenant_tickler.json",
  },
  {
    id: "transform_units",
    pending: "Transform unit records",
    active:  "Transforming unit records...",
    done:    "Transformed {n} unit records",
  },
  {
    id: "transform_residents",
    pending: "Transform resident records",
    active:  "Transforming resident records...",
    done:    "Transformed {n} resident records",
  },
  {
    id: "transform_occupancy",
    pending: "Calculate occupancy",
    active:  "Calculating occupancy...",
    done:    "Calculated occupancy for {n} properties",
  },
  {
    id: "dropbox_units",
    pending: "Upload Units -> /QuickBase Sync/Units/ (mode=overwrite)",
    active:  "Uploading Units -> /QuickBase Sync/Units/...",
    done:    "Uploaded Units -> /QuickBase Sync/Units/ (mode=overwrite)",
  },
  {
    id: "dropbox_residents",
    pending: "Upload Residents -> /QuickBase Sync/Residents/ (mode=overwrite)",
    active:  "Uploading Residents -> /QuickBase Sync/Residents/...",
    done:    "Uploaded Residents -> /QuickBase Sync/Residents/ (mode=overwrite)",
  },
  {
    id: "dropbox_occupancy",
    pending: "Upload Occupancy -> /QuickBase Sync/Occupancy Report/ (mode=add)",
    active:  "Uploading Occupancy -> /QuickBase Sync/Occupancy Report/...",
    done:    "Uploaded Occupancy -> /QuickBase Sync/Occupancy Report/ (mode=add)",
  },
  {
    id: "sleep",
    pending: "Wait 30s for Dropbox to register files",
    active:  "Waiting 30s for Dropbox to register files...",
    done:    "Waited 30s for Dropbox to register files",
  },
  {
    id: "qb_units",
    pending: "Trigger Units table refresh",
    active:  "Triggering Units table refresh...",
    done:    "Units table refresh triggered",
  },
  {
    id: "qb_residents",
    pending: "Trigger Residents table refresh",
    active:  "Triggering Residents table refresh...",
    done:    "Residents table refresh triggered",
  },
  {
    id: "qb_occupancy",
    pending: "Trigger Occupancy Reports table refresh",
    active:  "Triggering Occupancy Reports table refresh...",
    done:    "Occupancy Reports table refresh triggered",
  },
  {
    id: "job_complete",
    pending: "Await job completion",
    active:  "Awaiting job completion...",
    done:    "Job complete — {n}",
  },
];

// Each entry: log regex -> row id -> optional count extractor
// For rental_applications we need two separate entries keyed by which
// "Fetching" line preceded it. We track a "pending apps seen" flag.
interface LogMatch {
  re: RegExp;
  id: string;
  count?: (m: RegExpMatchArray) => string;
}

// Ordered — first match wins per line, fired set prevents double-firing same id.
// Two rental_applications entries are disambiguated by order: pending fires first,
// leases fires second (the log always emits them in that order).
const LOG_MATCHES: LogMatch[] = [
  { re: /Fetched (\d+) records from \/unit_directory\.json/,          id: "fetch_unit_directory",                  count: m => m[1] },
  { re: /Fetched (\d+) records from \/unit_vacancy\.json/,            id: "fetch_unit_vacancy",                    count: m => m[1] },
  { re: /Fetched (\d+) records from \/property_custom_fields\.json/,  id: "fetch_property_custom_fields",          count: m => m[1] },
  { re: /Fetched (\d+) records from \/unit_custom_fields\.json/,      id: "fetch_unit_custom_fields",              count: m => m[1] },
  { re: /Fetched (\d+) records from \/tenant_directory\.json/,        id: "fetch_tenant_directory",                count: m => m[1] },
  { re: /Fetched (\d+) records from \/rental_applications\.json/,     id: "fetch_rental_applications_pending",     count: m => m[1] },
  { re: /Fetched (\d+) records from \/rental_applications\.json/,     id: "fetch_rental_applications_leases",      count: m => m[1] },
  { re: /Fetched (\d+) records from \/tenant_tickler\.json/,          id: "fetch_tenant_tickler",                  count: m => m[1] },
  { re: /Transformed (\d+) unit records/,                             id: "transform_units",                       count: m => m[1] },
  { re: /Transformed (\d+) resident records/,                         id: "transform_residents",                   count: m => m[1] },
  { re: /Calculated occupancy for (\d+) properties/,                  id: "transform_occupancy",                   count: m => m[1] },
  { re: /Uploaded units\.csv/,                                        id: "dropbox_units" },
  { re: /Uploaded residents\.csv/,                                     id: "dropbox_residents" },
  { re: /Uploaded occupancy_/,                                        id: "dropbox_occupancy" },
  { re: /Units refresh trigger status:/,                              id: "qb_units" },
  { re: /Residents refresh trigger status:/,                          id: "qb_residents" },
  { re: /Occupancy refresh trigger status:/,                          id: "qb_occupancy" },
];

function parseLog(
  raw: string,
  rows: StatusRow[],
  jobStartedAt: string,
  sleepStepStarted: boolean,
  sleepStepDone: boolean,
  sleepStepCompletedAt?: string,
): void {
  const byId = new Map(rows.map(r => [r.id, r]));
  const fired = new Set<string>();
  const lines = raw.split("\n");

  for (const line of lines) {
    const clean = line
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")
      .trim();

    const tsMatch = line.match(LINE_TS_RE);
    const lineTime = tsMatch ? ts(tsMatch[1]) : undefined;

    for (const lm of LOG_MATCHES) {
      if (fired.has(lm.id)) continue;
      const m = clean.match(lm.re);
      if (m) {
        fired.add(lm.id);
        const row = byId.get(lm.id);
        if (row) {
          const count = lm.count ? lm.count(m) : undefined;
          row.done = count ? row.done.replace("{n}", count) : row.done;
          row.state = "done";
          row.completedAt = lineTime;
        }
        break;
      }
    }
  }

  // Sleep step is driven by GitHub step-level status, not log lines
  const sleepRow = byId.get("sleep");
  if (sleepRow && sleepRow.state === "pending") {
    if (sleepStepDone) {
      sleepRow.state = "done";
      sleepRow.completedAt = sleepStepCompletedAt ? ts(sleepStepCompletedAt) : undefined;
    } else if (sleepStepStarted) {
      sleepRow.state = "active";
    }
  }
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

  // Build initial rows all as pending
  const rows: StatusRow[] = ROWS.map(r => ({ ...r, state: "pending" }));
  const byId = new Map(rows.map(r => [r.id, r]));

  if (job) {
    const steps: any[] = job.steps ?? [];
    const step = (name: string) => steps.find((s: any) => s.name === name);

    const exportStep  = step("Run CSV export");
    const dropboxStep = step("Upload CSVs to Dropbox");
    const sleepStep   = step("Sleep 30s to allow Dropbox to register files");
    const unitsStep   = step("Trigger refresh - Fish Units");
    const residentsStep = step("Trigger refresh - Fish Residents");
    const occupancyStep = step("Trigger refresh - Fish Occupancy");

    // Mark active for in-progress GitHub steps whose rows haven't fired yet
    if (exportStep?.status === "in_progress") {
      // Mark first un-done fetch row as active
      for (const id of [
        "fetch_unit_directory","fetch_unit_vacancy","fetch_property_custom_fields",
        "fetch_unit_custom_fields","fetch_tenant_directory",
        "fetch_rental_applications_pending","fetch_rental_applications_leases",
        "fetch_tenant_tickler","transform_units","transform_residents","transform_occupancy",
      ]) {
        const r = byId.get(id);
        if (r && r.state === "pending") { r.state = "active"; break; }
      }
    }
    if (dropboxStep?.status === "in_progress") {
      for (const id of ["dropbox_units","dropbox_residents","dropbox_occupancy"]) {
        const r = byId.get(id);
        if (r && r.state === "pending") { r.state = "active"; break; }
      }
    }

    // Fetch and parse the flat log if the export step has started
    const shouldFetchLog = exportStep && exportStep.status !== "queued";
    if (shouldFetchLog) {
      const logRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`,
        { headers }
      );
      if (logRes.ok) {
        parseLog(
          await logRes.text(),
          rows,
          job.started_at,
          !!sleepStep && sleepStep.status !== "queued",
          !!sleepStep && sleepStep.conclusion === "success",
          sleepStep?.completed_at,
        );
      }
    }

    // QB rows driven by step status
    const markQb = (stepObj: any, id: string) => {
      if (!stepObj) return;
      const r = byId.get(id);
      if (!r) return;
      if (stepObj.conclusion === "success") {
        r.state = "done";
        r.completedAt = stepObj.completed_at ? ts(stepObj.completed_at) : undefined;
      } else if (stepObj.status === "in_progress") {
        r.state = "active";
      } else if (stepObj.conclusion && stepObj.conclusion !== "success") {
        r.state = "error";
      }
    };
    markQb(unitsStep,     "qb_units");
    markQb(residentsStep, "qb_residents");
    markQb(occupancyStep, "qb_occupancy");

    // Job complete row
    const completeRow = byId.get("job_complete");
    if (completeRow) {
      if (done) {
        const elapsed = Math.round(
          (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000
        );
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        completeRow.done = completeRow.done.replace("{n}", m > 0 ? `${m}m ${s}s` : `${s}s`);
        completeRow.state = failed ? "error" : "done";
        completeRow.completedAt = ts(job.completed_at);
      } else if (run.status === "in_progress") {
        completeRow.state = "active";
      }
    }
  }

  return NextResponse.json({ rows, done, failed });
}
