"use client";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PriorityBadge from "@/components/PriorityBadge";
import TaskComments from "@/components/TaskComments";
import SubmissionFiles from "@/components/SubmissionFiles";
import EarningsReport from "@/components/EarningsReport";
import { ROLES, TASK_TYPES } from "@/lib/types";
import type { Profile, Task } from "@/lib/types";

const empty = {
  title: "", description: "", requirements: "", price: "",
  deadline: "", required_role: "", mode: "open", assignee: "",
  task_type: "", priority: "medium", client_name: "", client_notes: "",
};

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}

export default function Admin() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [emps, setEmps] = useState<Profile[]>([]);
  const [payouts, setPayouts] = useState<{ employee_id: string; amount: number; paid_at: string }[]>([]);
  const [f, setF] = useState(empty);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("");
  const [empF, setEmpF] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [nowMs, setNowMs] = useState(0);
  const [adminId, setAdminId] = useState("");
  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [confirmBox, setConfirmBox] = useState<{ text: string; action: () => Promise<void> } | null>(null);
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const t = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    const e = await supabase.from("profiles").select("*").eq("is_admin", false);
    const p = await supabase.from("payouts").select("employee_id,amount,paid_at");
    setTasks((t.data as Task[]) ?? []);
    setEmps((e.data as Profile[]) ?? []);
    setPayouts(p.data ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace("/login");
      setAdminId(user.id);
      const { data: p } = await supabase
        .from("profiles").select("is_admin").eq("id", user.id).single();
      if (!p?.is_admin) return router.replace("/");
      load();
    })();
    const ch = supabase.channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [router, load]);

  const name = (id: string | null) => emps.find((e) => e.id === id)?.full_name ?? "—";

  async function createTask(e: FormEvent) {
    e.preventDefault();
    const direct = f.mode === "direct";
    if (direct && !f.assignee) return setNotice("Choose an employee");
    const { data: created, error } = await supabase.from("tasks").insert({
      title: f.title, description: f.description, requirements: f.requirements,
      price: Number(f.price), deadline: f.deadline || null,
      required_role: f.required_role || null, mode: f.mode,
      task_type: f.task_type || null,
      priority: f.priority,
      client_name: f.client_name || null,
      client_notes: f.client_notes || null,
      assigned_to: direct ? f.assignee : null,
      status: direct ? "taken" : "open",
    }).select("id").single();
    if (error) return setNotice(error.message);
    setF(empty);
    setNotice("Task published. Sending email alerts…");
    load();

    // The task is already live. If the email fails, nothing is lost.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !created) return;
    fetch("/api/notify-task", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ taskId: created.id }),
    })
      .then((r) => r.json())
      .then((r) =>
        setNotice(
          r.error
            ? `Task published, but the emails failed: ${r.error}`
            : `Task published. Email sent to ${r.sent} employee(s).`
        )
      )
      .catch(() => setNotice("Task published, but the email alert failed."));
  }

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(""), 5000);
  }

  async function notify(body: { type: "approved" | "rejected" | "paid"; taskId?: string; payoutId?: string }) {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      flash(`Saved, but the email failed: ${error.message}`);
      return;
    }
    if (!session) {
      flash("Saved, but the email failed: not logged in.");
      return;
    }

    fetch("/api/notify-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error ?? "Could not send the email.");
        return result;
      })
      .then((r) => flash(r.error ? `Saved, but the email failed: ${r.error}` : "Saved. The employee was emailed."))
      .catch((err: unknown) => flash(`Saved, but the email failed: ${errorMessage(err)}`));
  }

  async function review(id: string, approve: boolean) {
    if (!approve) {
      setFeedback("");
      setRejectId(id);
      return;
    }
    const { error } = await supabase.from("tasks").update({
      status: "approved", admin_feedback: null, approved_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return flash(`Could not approve the task: ${error.message}`);
    const { error: commentError } = await supabase.from("task_comments")
      .insert({ task_id: id, author_id: adminId, body: "✅ Approved" });
    if (commentError) flash(`Task approved, but the comment failed: ${commentError.message}`);
    load();
    notify({ type: "approved", taskId: id });
  }
  async function confirmReject(e: FormEvent) {
    e.preventDefault();
    if (!rejectId) return;
    const id = rejectId;
    const { error: updateError } = await supabase.from("tasks")
      .update({ status: "rejected", admin_feedback: feedback }).eq("id", id);
    if (updateError) return flash(`Could not reject the task: ${updateError.message}`);
    const { error: commentError } = await supabase.from("task_comments").insert({
      task_id: id, author_id: adminId, body: "❌ Rejected: " + feedback,
    });
    if (commentError) flash(`Task rejected, but the comment failed: ${commentError.message}`);
    setRejectId(null);
    load();
    notify({ type: "rejected", taskId: id });
  }

  async function updateEmp(id: string, patch: Partial<Profile>) {
    await supabase.from("profiles").update(patch).eq("id", id);
    load();
  }

  function markPaid(id: string, amount: number) {
    if (amount <= 0) return setNotice("Nothing is owed to this employee.");
    setNotice("");
    setConfirmBox({
      text: `Record a payout of LKR ${amount.toLocaleString()}?`,
      action: async () => {
        const { data: payout, error } = await supabase
          .from("payouts").insert({ employee_id: id, amount }).select("id").single();
        if (error) {
          flash(`Could not record the payout: ${error.message}`);
          return;
        }
        load();
        if (payout) notify({ type: "paid", payoutId: payout.id });
      },
    });
  }

  function removeTask(id: string) {
    setConfirmBox({
      text: "Delete this task? This can't be undone.",
      action: async () => {
      await supabase.from("tasks").delete().eq("id", id);
      load();
      },
    });
  }

  const input =
    "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0000FF] focus:ring-4 focus:ring-blue-100";
  const card = "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6";
  const submitted = tasks.filter((t) => t.status === "submitted");
  const activeEmployees = emps.filter((employee) => employee.is_active).length;
  const openTasks = tasks.filter((task) => task.status === "open").length;
  const totalEarned = tasks
    .filter((task) => task.status === "approved")
    .reduce((sum, task) => sum + Number(task.price), 0);
  const totalPaid = payouts.reduce((sum, payout) => sum + Number(payout.amount), 0);
  const totalOwed = totalEarned - totalPaid;
  const shown = tasks
    .filter((t) => {
      const text = `${t.title} ${t.description ?? ""} ${name(t.assigned_to)}`.toLowerCase();
      return (
        text.includes(q.trim().toLowerCase()) &&
        (!statusF || t.status === statusF) &&
        (!empF || (empF === "none" ? !t.assigned_to : t.assigned_to === empF))
      );
    })
    .sort((a, b) => {
      if (sortBy === "deadline") return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
      if (sortBy === "price") return Number(b.price) - Number(a.price);
      return b.created_at.localeCompare(a.created_at);
    });
  const filtersOn = q || statusF || empF || sortBy !== "newest";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0000FF] text-sm font-black text-white shadow-md shadow-blue-200">L</span>
            <div>
              <p className="font-bold leading-tight">LeapOff</p>
              <p className="text-xs text-slate-500">Administration workspace</p>
            </div>
          </div>
          <button
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0000FF]"
            onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-7 sm:px-6 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0000FF] via-blue-700 to-indigo-950 p-6 text-white shadow-xl shadow-blue-950/15 sm:p-9">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border-[36px] border-white/10" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 right-1/3 h-64 w-64 rounded-full bg-blue-400/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold tracking-[0.16em] text-blue-100">TEAM OPERATIONS</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Admin dashboard</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100 sm:text-base">
                Manage tasks, review submissions, and keep your team’s earnings organized.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Overview label="Open tasks" value={openTasks} />
              <Overview label="To review" value={submitted.length} />
              <Overview label="Active team" value={activeEmployees} />
              <Overview label="Total owed" value={`LKR ${totalOwed.toLocaleString()}`} />
            </div>
          </div>
        </section>

        {/* CREATE TASK */}
        <section className={card}>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0000FF]">Build your task board</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">Create a task</h2>
              <p className="mt-1 text-sm text-slate-500">Publish an open opportunity or assign work directly to a teammate.</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#0000FF]">NEW TASK</span>
          </div>
          {notice && <p role="status" className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{notice}</p>}
          <form onSubmit={createTask} className="grid gap-3 md:grid-cols-2">
            <input className={input} placeholder="Title" required value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })} />
            <input className={input} type="number" placeholder="Price (LKR)" required value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value })} />
            <textarea className={input} placeholder="Description" value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })} />
            <textarea className={input} placeholder="Instructions and requirements" value={f.requirements}
              onChange={(e) => setF({ ...f, requirements: e.target.value })} />
            <select className={input} value={f.task_type}
              onChange={(e) => setF({ ...f, task_type: e.target.value })}>
              <option value="">Task type…</option>
              {TASK_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select className={input} value={f.priority}
              onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
              <option value="urgent">Urgent</option>
            </select>
            <input className={input} placeholder="Client name (e.g. Brew Haven Café)"
              value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} />
            <textarea className={input} placeholder="Client notes (brand colours, tone, do's and don'ts)"
              value={f.client_notes} onChange={(e) => setF({ ...f, client_notes: e.target.value })} />
            <input className={input} type="datetime-local" value={f.deadline}
              onChange={(e) => setF({ ...f, deadline: e.target.value })} />
            <select className={input} value={f.required_role}
              onChange={(e) => setF({ ...f, required_role: e.target.value })}>
              <option value="">Any role can take it</option>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <select className={input} value={f.mode}
              onChange={(e) => setF({ ...f, mode: e.target.value })}>
              <option value="open">Open: first come, first served</option>
              <option value="direct">Direct: assign to one employee</option>
            </select>
            {f.mode === "direct" && (
              <select className={input} value={f.assignee}
                onChange={(e) => setF({ ...f, assignee: e.target.value })}>
                <option value="">Choose employee…</option>
                {emps.filter((e) => e.is_active).map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name} ({e.job_role})</option>
                ))}
              </select>
            )}
            <button className="rounded-xl bg-[#0000FF] px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-200 md:col-span-2">
              Publish task →
            </button>
          </form>
        </section>

        {/* REVIEW QUEUE */}
        <section aria-labelledby="review-queue-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0000FF]">Needs your attention</p>
              <h2 id="review-queue-heading" className="mt-1 text-2xl font-bold tracking-tight">Review queue</h2>
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${submitted.length ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"}`}>
              {submitted.length} pending
            </span>
          </div>
          {submitted.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-700">✓</span>
              <p className="mt-3 font-semibold text-slate-800">You’re all caught up</p>
              <p className="mt-1 text-sm text-slate-500">There are no submissions waiting for review.</p>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {submitted.map((t) => (
              <article key={t.id} className="flex flex-col rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-600/10">Submitted</span>
                    <h3 className="mt-3 text-lg font-bold text-slate-900">{t.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">Submitted by {name(t.assigned_to)}</p>
                  </div>
                  <span className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-[#0000FF]">
                    LKR {Number(t.price).toLocaleString()}
                  </span>
                </div>
                {t.submission_url && (
                  <p className="mt-4 break-all rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                    <span className="font-semibold text-slate-700">Work link: </span>
                    <a className="font-medium text-[#0000FF] underline" href={t.submission_url} target="_blank" rel="noreferrer">
                      {t.submission_url}
                    </a>
                  </p>
                )}
                <div className="mt-3"><SubmissionFiles taskId={t.id} /></div>
                {t.submission_notes && (
                  <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-5 text-slate-600">
                    <span className="font-semibold text-slate-800">Employee note:</span> {t.submission_notes}
                  </p>
                )}
                <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <button onClick={() => review(t.id, true)}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">Approve</button>
                  <button onClick={() => review(t.id, false)}
                    className="rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100">Reject</button>
                  <button onClick={() => setCommentTask(t)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0000FF]">
                    💬 Comments
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className={`${card} overflow-hidden`}>
          <EarningsReport tasks={tasks} emps={emps} payouts={payouts} />
        </div>

        {/* ALL TASKS */}
        <section>
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0000FF]">Task board</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">
              All tasks <span className="ml-1 align-middle text-sm font-medium text-slate-400">({shown.length} of {tasks.length})</span>
            </h2>
          </div>
          <div className="mb-3 grid gap-2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
            <input
              className={`${input} lg:col-span-2`}
              placeholder="Search title, description or employee…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className={input} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="taken">Taken</option>
              <option value="in_progress">In progress</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select className={input} value={empF} onChange={(e) => setEmpF(e.target.value)}>
              <option value="">All employees</option>
              <option value="none">Unassigned</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <select className={input} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="deadline">Deadline soonest</option>
              <option value="price">Highest price</option>
            </select>
          </div>
          {filtersOn && (
            <button
              className="mb-3 rounded-lg px-2 py-1 text-sm font-semibold text-[#0000FF] underline underline-offset-2 hover:bg-blue-50"
              onClick={() => { setQ(""); setStatusF(""); setEmpF(""); setSortBy("newest"); }}
            >
              Clear filters
            </button>
          )}
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="p-3 font-semibold">Task</th><th className="font-semibold">Price</th><th className="font-semibold">Status</th>
                  <th className="font-semibold">Assigned to</th><th className="font-semibold">Deadline</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/80">
                    <td className="max-w-xs p-3 font-semibold text-slate-800">
                      {t.title}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <PriorityBadge priority={t.priority} />
                        {t.task_type && <span className="text-xs text-gray-500">{t.task_type}</span>}
                        {t.client_name && <span className="text-xs text-gray-500">· {t.client_name}</span>}
                      </div>
                    </td>
                    <td className="font-medium text-slate-700">{Number(t.price).toLocaleString()}</td>
                    <td><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold capitalize text-blue-700">{t.status.replace("_", " ")}</span></td>
                    <td className="text-slate-600">{name(t.assigned_to)}</td>
                    <td className={
                      nowMs > 0 && t.deadline && new Date(t.deadline).getTime() < nowMs &&
                      !["submitted", "approved"].includes(t.status)
                        ? "font-semibold text-red-600" : ""}>
                      {t.deadline ? new Date(t.deadline).toLocaleDateString() : "—"}
                      {nowMs > 0 && t.deadline && new Date(t.deadline).getTime() < nowMs &&
                        !["submitted", "approved"].includes(t.status) ? " ⚠ overdue" : ""}
                    </td>
                    <td className="whitespace-nowrap pr-3">
                      {t.assigned_to && (
                        <button className="mr-3 font-medium text-[#0000FF] hover:underline" onClick={() => setCommentTask(t)}>Comments</button>
                      )}
                      <button className="font-medium text-red-600 hover:underline" onClick={() => removeTask(t.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">No tasks match these filters.</p>}
        </section>

        {/* EMPLOYEES + EARNINGS */}
        <section>
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0000FF]">People and payments</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Employees and earnings</h2>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="p-3 font-semibold">Name</th><th className="font-semibold">Role</th><th className="font-semibold">Active</th>
                  <th className="font-semibold">Earned</th><th className="font-semibold">Paid</th><th className="font-semibold">Owed</th><th></th>
                </tr>
              </thead>
              <tbody>
                {emps.map((e) => {
                  const earned = tasks
                    .filter((t) => t.assigned_to === e.id && t.status === "approved")
                    .reduce((s, t) => s + Number(t.price), 0);
                  const paid = payouts
                    .filter((p) => p.employee_id === e.id)
                    .reduce((s, p) => s + Number(p.amount), 0);
                  return (
                    <tr key={e.id} className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/80">
                      <td className="p-3">
                        <span className="font-semibold text-slate-800">{e.full_name}</span><br /><span className="text-xs text-slate-500">{e.email}</span>
                      </td>
                      <td>
                        <select value={e.job_role}
                          onChange={(ev) => updateEmp(e.id, { job_role: ev.target.value })}
                          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-700 outline-none focus:border-[#0000FF]">
                          {ROLES.map((r) => <option key={r}>{r}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="checkbox" checked={e.is_active}
                          onChange={(ev) => updateEmp(e.id, { is_active: ev.target.checked })} />
                      </td>
                      <td>{earned.toLocaleString()}</td>
                      <td>{paid.toLocaleString()}</td>
                      <td className="font-bold text-[#0000FF]">{(earned - paid).toLocaleString()}</td>
                      <td>
                        <button className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#0000FF] hover:bg-blue-50 hover:text-[#0000FF]"
                          onClick={() => markPaid(e.id, earned - paid)}>
                          Mark paid
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <form onSubmit={confirmReject} className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Send work back</p>
              <h3 className="mt-1 text-xl font-bold">Reject this work</h3>
            </div>
            <textarea
              className={`${input} min-h-32 resize-y`}
              placeholder="What needs to be fixed?" required
              value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectId(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700">Reject</button>
            </div>
          </form>
        </div>
      )}
      {confirmBox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-lg font-semibold text-slate-900">{confirmBox.text}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmBox(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button
                onClick={async () => { await confirmBox.action(); setConfirmBox(null); }}
                className="rounded-xl bg-[#0000FF] px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800">Confirm</button>
            </div>
          </div>
        </div>
      )}
      {commentTask && (
        <TaskComments taskId={commentTask.id} taskTitle={commentTask.title}
          myId={adminId} otherLabel={name(commentTask.assigned_to)}
          onClose={() => setCommentTask(null)} />
      )}
      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-white/10 bg-slate-950 px-5 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </main>
  );
}

function Overview({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-28 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
      <p className="text-xl font-bold sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-blue-100">{label}</p>
    </div>
  );
}