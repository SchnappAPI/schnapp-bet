import { NextRequest, NextResponse } from "next/server";

const OWNER = "SchnappAPI";
const REPO  = "appfolio-quickbase-sync";
const LINE_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;

function elapsed(jobStart: string, iso: string): number {
  const a = jobStart.endsWith("Z") ? jobStart : jobStart + "Z";
  const b = iso.endsWith("Z") ? iso : iso + "Z";
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
}

interface StatusRow { id:string; pending:string; active:string; done:string; state:"pending"|"active"|"done"|"error"; elapsedSeconds?:number; }

const ROWS: Omit<StatusRow,"state">[] = [
  {id:"fetch_unit_directory",             pending:"Fetch records from /unit_directory.json",                         active:"Fetching records from /unit_directory.json...",          done:"Fetched {n} records from /unit_directory.json"},
  {id:"fetch_unit_vacancy",               pending:"Fetch records from /unit_vacancy.json",                           active:"Fetching records from /unit_vacancy.json...",            done:"Fetched {n} records from /unit_vacancy.json"},
  {id:"fetch_property_custom_fields",     pending:"Fetch records from /property_custom_fields.json",                 active:"Fetching records from /property_custom_fields.json...",  done:"Fetched {n} records from /property_custom_fields.json"},
  {id:"fetch_unit_custom_fields",         pending:"Fetch records from /unit_custom_fields.json",                     active:"Fetching records from /unit_custom_fields.json...",      done:"Fetched {n} records from /unit_custom_fields.json"},
  {id:"fetch_tenant_directory",           pending:"Fetch records from /tenant_directory.json",                       active:"Fetching records from /tenant_directory.json...",        done:"Fetched {n} records from /tenant_directory.json"},
  {id:"fetch_rental_applications_pending",pending:"Fetch records from /rental_applications.json (pending)",          active:"Fetching records from /rental_applications.json (pending)...",done:"Fetched {n} records from /rental_applications.json (pending)"},
  {id:"fetch_rental_applications_leases", pending:"Fetch records from /rental_applications.json (leases mtd)",       active:"Fetching records from /rental_applications.json (leases mtd)...",done:"Fetched {n} records from /rental_applications.json (leases mtd)"},
  {id:"fetch_tenant_tickler",             pending:"Fetch records from /tenant_tickler.json",                         active:"Fetching records from /tenant_tickler.json...",          done:"Fetched {n} records from /tenant_tickler.json"},
  {id:"transform_units",                  pending:"Transform unit records",                                          active:"Transforming unit records...",                           done:"Transformed {n} unit records"},
  {id:"transform_residents",              pending:"Transform resident records",                                      active:"Transforming resident records...",                       done:"Transformed {n} resident records"},
  {id:"transform_occupancy",              pending:"Calculate occupancy",                                             active:"Calculating occupancy...",                              done:"Calculated occupancy for {n} properties"},
  {id:"dropbox_units",                    pending:"Upload Units -> /QuickBase Sync/Units/ (mode=overwrite)",          active:"Uploading Units -> /QuickBase Sync/Units/...",           done:"Uploaded Units -> /QuickBase Sync/Units/ (mode=overwrite)"},
  {id:"dropbox_residents",               pending:"Upload Residents -> /QuickBase Sync/Residents/ (mode=overwrite)", active:"Uploading Residents -> /QuickBase Sync/Residents/...",   done:"Uploaded Residents -> /QuickBase Sync/Residents/ (mode=overwrite)"},
  {id:"dropbox_occupancy",               pending:"Upload Occupancy -> /QuickBase Sync/Occupancy Report/ (mode=add)",active:"Uploading Occupancy -> /QuickBase Sync/Occupancy Report/...",done:"Uploaded Occupancy -> /QuickBase Sync/Occupancy Report/ (mode=add)"},
  {id:"sleep",                           pending:"Wait 30s for Dropbox to register files",                         active:"Waiting 30s for Dropbox to register files...",          done:"Waited 30s for Dropbox to register files"},
  {id:"qb_units",                        pending:"Trigger Units table refresh",                                    active:"Triggering Units table refresh...",                     done:"Units table refresh triggered"},
  {id:"qb_residents",                    pending:"Trigger Residents table refresh",                                active:"Triggering Residents table refresh...",                 done:"Residents table refresh triggered"},
  {id:"qb_occupancy",                    pending:"Trigger Occupancy Reports table refresh",                        active:"Triggering Occupancy Reports table refresh...",         done:"Occupancy Reports table refresh triggered"},
  {id:"job_complete",                    pending:"Await job completion",                                           active:"Awaiting job completion...",                            done:"Job complete — {n}"},
];
interface LogMatch { re:RegExp; id:string; count?:(m:RegExpMatchArray)=>string; }
const LOG_MATCHES: LogMatch[] = [
  {re:/Fetched (\d+) records from \/unit_directory\.json/,         id:"fetch_unit_directory",              count:m=>m[1]},
  {re:/Fetched (\d+) records from \/unit_vacancy\.json/,           id:"fetch_unit_vacancy",                count:m=>m[1]},
  {re:/Fetched (\d+) records from \/property_custom_fields\.json/, id:"fetch_property_custom_fields",      count:m=>m[1]},
  {re:/Fetched (\d+) records from \/unit_custom_fields\.json/,     id:"fetch_unit_custom_fields",          count:m=>m[1]},
  {re:/Fetched (\d+) records from \/tenant_directory\.json/,       id:"fetch_tenant_directory",            count:m=>m[1]},
  {re:/Fetched (\d+) records from \/rental_applications\.json/,    id:"fetch_rental_applications_pending", count:m=>m[1]},
  {re:/Fetched (\d+) records from \/rental_applications\.json/,    id:"fetch_rental_applications_leases",  count:m=>m[1]},
  {re:/Fetched (\d+) records from \/tenant_tickler\.json/,         id:"fetch_tenant_tickler",              count:m=>m[1]},
  {re:/Transformed (\d+) unit records/,                              id:"transform_units",                   count:m=>m[1]},
  {re:/Transformed (\d+) resident records/,                          id:"transform_residents",               count:m=>m[1]},
  {re:/Calculated occupancy for (\d+) properties/,                   id:"transform_occupancy",               count:m=>m[1]},
  {re:/Uploaded units\.csv/,                                         id:"dropbox_units"},
  {re:/Uploaded residents\.csv/,                                     id:"dropbox_residents"},
  {re:/Uploaded occupancy_/,                                          id:"dropbox_occupancy"},
  {re:/Units refresh trigger status:/,                                id:"qb_units"},
  {re:/Residents refresh trigger status:/,                            id:"qb_residents"},
  {re:/Occupancy refresh trigger status:/,                            id:"qb_occupancy"},
];

const STEP_ROW_IDS: Record<string,string[]> = {
  "Run CSV export": ["fetch_unit_directory","fetch_unit_vacancy","fetch_property_custom_fields","fetch_unit_custom_fields","fetch_tenant_directory","fetch_rental_applications_pending","fetch_rental_applications_leases","fetch_tenant_tickler","transform_units","transform_residents","transform_occupancy"],
  "Upload CSVs to Dropbox": ["dropbox_units","dropbox_residents","dropbox_occupancy"],
  "Sleep 30s to allow Dropbox to register files": ["sleep"],
  "Trigger refresh - Fish Units":     ["qb_units"],
  "Trigger refresh - Fish Residents": ["qb_residents"],
  "Trigger refresh - Fish Occupancy": ["qb_occupancy"],
};

function parseLog(raw:string, rows:StatusRow[], jobStart:string): void {
  const byId = new Map(rows.map(r=>[r.id,r]));
  const fired = new Set<string>();
  for (const line of raw.split("\n")) {
    const clean = line.replace(/\x1b\[[0-9;]*m/g,"").replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/,"").trim();
    const tsMatch = line.match(LINE_TS_RE);
    const lineTs  = tsMatch ? tsMatch[1] : null;
    for (const lm of LOG_MATCHES) {
      if (fired.has(lm.id)) continue;
      const m = clean.match(lm.re);
      if (m) {
        fired.add(lm.id);
        const row = byId.get(lm.id);
        if (row) {
          const count = lm.count ? lm.count(m) : undefined;
          row.done = count ? row.done.replace("{n}",count) : row.done;
          row.state = "done";
          row.elapsedSeconds = lineTs ? elapsed(jobStart,lineTs) : undefined;
        }
        break;
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) return NextResponse.json({error:"missing runId"},{status:400});
  const token = process.env.GITHUB_PAT;
  if (!token) return NextResponse.json({error:"GITHUB_PAT not configured"},{status:500});
  const headers = {Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json"};

  const [runRes,jobsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}`,{headers}),
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`,{headers}),
  ]);
  if (!runRes.ok) return NextResponse.json({error:"run not found"},{status:404});
  const run      = await runRes.json();
  const jobsData = jobsRes.ok ? await jobsRes.json() : {jobs:[]};
  const job      = jobsData.jobs?.[0];
  const done     = run.status === "completed";
  const failed   = done && run.conclusion !== "success";
  const rows: StatusRow[] = ROWS.map(r=>({...r,state:"pending"}));
  const byId = new Map(rows.map(r=>[r.id,r]));

  if (job) {
    const steps: any[] = job.steps ?? [];
    const stepMap = new Map(steps.map((s:any)=>[s.name,s]));
    const jobStart = job.started_at ?? "";

    // Mark first undone row active for each in-progress step
    for (const [stepName,ids] of Object.entries(STEP_ROW_IDS)) {
      const s = stepMap.get(stepName);
      if (s?.status === "in_progress") {
        for (const id of ids) {
          const r = byId.get(id);
          if (r && r.state === "pending") { r.state = "active"; break; }
        }
      }
    }

    // Parse log when export step has started
    const exportStep = stepMap.get("Run CSV export");
    if (exportStep && exportStep.status !== "queued") {
      const logRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`,
        {headers}
      );
      if (logRes.ok) parseLog(await logRes.text(), rows, jobStart);
    }

    // Sleep from step status
    const sleepStep = stepMap.get("Sleep 30s to allow Dropbox to register files");
    const sleepRow  = byId.get("sleep");
    if (sleepRow && sleepRow.state !== "done") {
      if (sleepStep?.conclusion === "success") {
        sleepRow.state = "done";
        sleepRow.elapsedSeconds = sleepStep.completed_at ? elapsed(jobStart,sleepStep.completed_at) : undefined;
      } else if (sleepStep?.status === "in_progress") { sleepRow.state = "active"; }
    }

    // QB from step status
    const qbPairs:[string,string][] = [
      ["Trigger refresh - Fish Units","qb_units"],
      ["Trigger refresh - Fish Residents","qb_residents"],
      ["Trigger refresh - Fish Occupancy","qb_occupancy"],
    ];
    for (const [sn,id] of qbPairs) {
      const s = stepMap.get(sn); const r = byId.get(id);
      if (!s || !r || r.state === "done") continue;
      if (s.conclusion === "success") {
        r.state = "done";
        r.elapsedSeconds = s.completed_at ? elapsed(jobStart,s.completed_at) : undefined;
      } else if (s.status === "in_progress") { r.state = "active"; }
      else if (s.conclusion && s.conclusion !== "success") { r.state = "error"; }
    }

    // Job complete
    const cr = byId.get("job_complete");
    if (cr) {
      if (done) {
        const totalSec = Math.round((new Date(job.completed_at).getTime()-new Date(job.started_at).getTime())/1000);
        const m=Math.floor(totalSec/60),s=totalSec%60;
        cr.done = cr.done.replace("{n}", m>0?`${m}m ${s}s`:`${s}s`);
        cr.state = failed ? "error" : "done";
        cr.elapsedSeconds = totalSec;
      } else if (run.status==="in_progress") { cr.state="active"; }
    }
  }

  return NextResponse.json({rows,done,failed});
}
