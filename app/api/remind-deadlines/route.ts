import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

type DueTask = {
  id: string;
  title: string;
  price: number;
  deadline: string;
  assigned_to: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date();
  const soon = new Date(now.getTime() + 36 * 60 * 60 * 1000);

  const { data, error } = await admin
    .from("tasks")
    .select("id,title,price,deadline,assigned_to")
    .in("status", ["taken", "in_progress", "rejected"])
    .is("reminded_at", null)
    .not("assigned_to", "is", null)
    .gt("deadline", now.toISOString())
    .lte("deadline", soon.toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tasks = (data ?? []) as DueTask[];
  if (tasks.length === 0) return NextResponse.json({ reminded: 0, emails: 0 });

  const byEmployee = new Map<string, DueTask[]>();
  for (const task of tasks) {
    const list = byEmployee.get(task.assigned_to) ?? [];
    list.push(task);
    byEmployee.set(task.assigned_to, list);
  }

  const { data: people, error: peopleError } = await admin
    .from("profiles")
    .select("id,email,full_name")
    .in("id", Array.from(byEmployee.keys()));
  if (peopleError) {
    return NextResponse.json({ error: peopleError.message }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const fmt = (d: string) =>
    new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Colombo" });

  let emails = 0;
  let reminded = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (const person of people ?? []) {
    if (!person.email) continue;
    const list = byEmployee.get(person.id) ?? [];
    const items = list
      .map(
        (task) =>
          `<li style="margin-bottom:10px"><b>${esc(task.title)}</b><br>
           LKR ${Number(task.price).toLocaleString("en-US")} · due <b>${esc(fmt(task.deadline))}</b></li>`
      )
      .join("");

    const html = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
  <div style="background:#0000FF;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold">LeafOff Team Portal</div>
  <div style="padding:24px;color:#000">
    <h2 style="margin:0 0 12px">⏰ ${list.length === 1 ? "A task is" : "Tasks are"} due soon</h2>
    <p>Hi ${esc(person.full_name ?? "there")}, these tasks are due within the next day or so:</p>
    <ul style="padding-left:20px">${items}</ul>
    <a href="${site}/dashboard" style="display:inline-block;background:#0000FF;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Open my dashboard</a>
  </div>
</div>`;

    try {
      await transporter.sendMail({
        from: `"LeafOff Team Portal" <${process.env.GMAIL_USER}>`,
        to: person.email,
        subject: `Reminder: ${list.length} task${list.length > 1 ? "s" : ""} due soon`,
        html,
      });
    } catch (error) {
      failed++;
      firstError ??= error instanceof Error ? error.message : String(error);
      console.error(`Failed to send deadline reminder to ${person.email}:`, error);
      continue;
    }

    emails++;
    reminded += list.length;

    const { error: updateError } = await admin
      .from("tasks")
      .update({ reminded_at: new Date().toISOString() })
      .in(
        "id",
        list.map((task) => task.id)
      );
    if (updateError) {
      failed++;
      firstError ??= updateError.message;
      console.error(`Failed to mark reminded tasks for ${person.id}:`, updateError);
    }
  }

  return NextResponse.json(
    {
      reminded,
      emails,
      ...(failed > 0 && { failed, error: firstError }),
    },
    { status: failed > 0 ? 500 : 200 }
  );
}
