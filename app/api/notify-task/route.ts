import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  // A Supabase client that acts as the logged-in person, so your security rules still apply
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // Only admins may send alerts
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { taskId } = await req.json();
  const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).single();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Who should get the email?
  let q = supabase.from("profiles").select("email,full_name")
    .eq("is_active", true).eq("is_admin", false);
  if (task.mode === "direct") q = q.eq("id", task.assigned_to);
  else if (task.required_role) q = q.eq("job_role", task.required_role);
  const { data: people } = await q;
  const recipients = (people ?? []).filter((p) => p.email);
  if (recipients.length === 0) return NextResponse.json({ sent: 0, failed: 0 });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const direct = task.mode === "direct";
  const deadline = task.deadline
    ? new Date(task.deadline).toLocaleString("en-GB", { timeZone: "Asia/Colombo" })
    : "No deadline";

  const html = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
  <div style="background:#0000FF;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold">LeafOff Team Portal</div>
  <div style="padding:24px;color:#000">
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px">${direct ? "Assigned to you" : "New task available"}</p>
    <h2 style="margin:0 0 12px">${esc(task.title)}</h2>
    <p style="font-size:22px;font-weight:bold;color:#0000FF;margin:0 0 12px">LKR ${Number(task.price).toLocaleString("en-US")}</p>
    <p style="margin:0 0 6px"><b>Role:</b> ${esc(task.required_role ?? "Any role")}</p>
    <p style="margin:0 0 12px"><b>Deadline:</b> ${esc(deadline)}</p>
    <p style="color:#374151">${esc((task.description ?? "").slice(0, 300))}</p>
    ${direct ? "" : `<p style="color:#b91c1c;font-size:13px">First come, first served. Once someone takes it, it's gone.</p>`}
    <a href="${site}/dashboard" style="display:inline-block;background:#0000FF;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:bold">${direct ? "Open my dashboard" : "Take this task"}</a>
  </div>
</div>`;

  // One separate email per person, so nobody sees anyone else's address
  const results = await Promise.allSettled(
    recipients.map((p) =>
      transporter.sendMail({
        from: `"LeafOff Team Portal" <${process.env.GMAIL_USER}>`,
        to: p.email!,
        subject: direct
          ? `New task assigned to you: ${task.title}`
          : `New task available: ${task.title} (LKR ${Number(task.price).toLocaleString("en-US")})`,
        html,
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const firstFail = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  return NextResponse.json({
    sent,
    failed: recipients.length - sent,
    error: sent === 0 && firstFail ? String(firstFail.reason?.message ?? firstFail.reason) : undefined,
  });
}