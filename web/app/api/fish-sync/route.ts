import { NextRequest, NextResponse } from "next/server";

const OWNER = "SchnappAPI";
const REPO = "appfolio-quickbase-sync";
const WORKFLOW = "csv_sync.yml";

export async function POST(req: NextRequest) {
  const fishSecret = req.headers.get("x-fish-secret") ?? "";
  const expectedSecret = process.env.FISH_SYNC_SECRET ?? "";

  if (!expectedSecret || fishSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_PAT not configured." },
      { status: 500 }
    );
  }

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text();
    return NextResponse.json(
      { error: `GitHub dispatch failed: ${text}` },
      { status: 500 }
    );
  }

  await new Promise((r) => setTimeout(r, 3000));

  const runsRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1&event=workflow_dispatch`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  const data = runsRes.ok ? await runsRes.json() : {};
  const runId: number | null = data.workflow_runs?.[0]?.id ?? null;

  return NextResponse.json({ runId });
}
