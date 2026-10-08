import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Only Vercel's scheduler (or you, with the secret) may run this
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: expired, error } = await admin
    .from("task_files")
    .select("id,path")
    .lte("expires_at", new Date().toISOString())
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let deleted = 0;
  if (expired && expired.length > 0) {
    const { error: rmError } = await admin.storage
      .from("submissions")
      .remove(expired.map((f) => f.path));
    if (rmError) return NextResponse.json({ error: rmError.message }, { status: 500 });

    const { error: deleteError } = await admin
      .from("task_files")
      .delete()
      .in("id", expired.map((f) => f.id));
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    deleted = expired.length;
  }

  const { data: orphaned, error: orphanError } = await admin
    .from("task_references")
    .select("id,path")
    .is("task_id", null)
    .limit(500);
  if (orphanError) return NextResponse.json({ error: orphanError.message }, { status: 500 });

  let orphans = 0;
  if (orphaned && orphaned.length > 0) {
    const { error: rmError } = await admin.storage
      .from("task-references")
      .remove(orphaned.map((file) => file.path));
    if (rmError) return NextResponse.json({ error: rmError.message }, { status: 500 });

    const { error: deleteError } = await admin
      .from("task_references")
      .delete()
      .in("id", orphaned.map((file) => file.id));
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    orphans = orphaned.length;
  }

  return NextResponse.json({ deleted, orphans });
}