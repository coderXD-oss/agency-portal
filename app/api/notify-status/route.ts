import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const lkr = (n: number) => `LKR ${Number(n).toLocaleString("en-US")}`;

function layout(heading: string, body: string, site: string) {
  return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
  <div style="background:#0000FF;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold">LeafOff Team Portal</div>
  <div style="padding:24px;color:#000">
    <h2 style="margin:0 0 12px">${heading}</h2>
    ${body}
    <a href="${esc(site)}/dashboard" style="display:inline-block;margin-top:12px;background:#0000FF;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Open my dashboard</a>
  </div>
</div>`;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey)
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user)
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { data: me, error: profileError } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  if (profileError)
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (!me?.is_admin)
    return NextResponse.json({ error: "Admins only" }, { status: 403 });

  let body: { type?: unknown; taskId?: unknown; payoutId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { type, taskId, payoutId } = body;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

  let employeeId: string;
  let subject: string;
  let html: string;

  if (type === "approved" || type === "rejected") {
    if (typeof taskId !== "string" || !taskId)
      return NextResponse.json({ error: "Task ID is required" }, { status: 400 });

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("title,price,status,assigned_to,admin_feedback")
      .eq("id", taskId).single();
    if (taskError)
      return NextResponse.json({ error: taskError.message }, { status: taskError.code === "PGRST116" ? 404 : 500 });
    if (!task.assigned_to)
      return NextResponse.json({ error: "Task has no assigned employee" }, { status: 404 });
    if (task.status !== type)
      return NextResponse.json({ error: "Task status doesn't match" }, { status: 400 });

    employeeId = task.assigned_to;
    if (type === "approved") {
      subject = `Approved: ${task.title}`;
      html = layout(
        "Your work was approved ✅",
        `<p><b>${esc(task.title)}</b> was approved.</p>
         <p style="font-size:22px;font-weight:bold;color:#0000FF;margin:0 0 8px">${lkr(task.price)}</p>
         <p style="color:#374151">This amount has been added to your earnings.</p>`,
        site
      );
    } else {
      subject = `Changes needed: ${task.title}`;
      html = layout(
        "Your work needs changes",
        `<p><b>${esc(task.title)}</b> was not approved yet.</p>
         <p style="background:#f3f4f6;border-radius:12px;padding:12px 16px;white-space:pre-wrap">${esc(task.admin_feedback ?? "No feedback was added.")}</p>
         <p style="color:#374151">Please fix it and submit again from your dashboard.</p>`,
        site
      );
    }
  } else if (type === "paid") {
    if (typeof payoutId !== "string" || !payoutId)
      return NextResponse.json({ error: "Payout ID is required" }, { status: 400 });

    const { data: payout, error: payoutError } = await supabase
      .from("payouts").select("employee_id,amount,paid_at").eq("id", payoutId).single();
    if (payoutError)
      return NextResponse.json({ error: payoutError.message }, { status: payoutError.code === "PGRST116" ? 404 : 500 });

    employeeId = payout.employee_id;
    const when = new Date(payout.paid_at).toLocaleDateString("en-GB", { timeZone: "Asia/Colombo" });
    subject = `Payment recorded: ${lkr(payout.amount)}`;
    html = layout(
      "You've been paid 💸",
      `<p style="font-size:22px;font-weight:bold;color:#0000FF;margin:0 0 8px">${lkr(payout.amount)}</p>
       <p style="color:#374151">A payout was recorded for you on ${esc(when)}.</p>`,
      site
    );
  } else {
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }

  const { data: emp, error: employeeError } = await supabase
    .from("profiles").select("email").eq("id", employeeId).single();
  if (employeeError)
    return NextResponse.json({ error: employeeError.message }, { status: 500 });
  if (!emp?.email)
    return NextResponse.json({ error: "Employee has no email" }, { status: 404 });

  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword)
    return NextResponse.json({ error: "Email is not configured" }, { status: 500 });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPassword },
  });

  try {
    await transporter.sendMail({
      from: `"LeafOff Team Portal" <${gmailUser}>`,
      to: emp.email,
      subject,
      html,
    });
    return NextResponse.json({ sent: 1 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
