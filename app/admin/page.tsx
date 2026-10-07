"use client";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TaskComments from "@/components/TaskComments";
import SubmissionFiles from "@/components/SubmissionFiles";
import EarningsReport from "@/components/EarningsReport";
import { ROLES } from "@/lib/types";
import type { Profile, Task } from "@/lib/types";

const empty = {
  title: "", description: "", requirements: "", price: "",
  deadline: "", required_role: "", mode: "open", assignee: "",
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
    "w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-black outline-none focus:border-[#0000FF] focus:ring-2 focus:ring-[#0000FF]/20";
  const card = "rounded-2xl bg-white p-5 shadow";
  const submitted = tasks.filter((t) => t.status === "submitted");
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
    <main className="min-h-screen bg-gray-100 text-black">
      <header className="bg-black px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="text-xl font-bold text-white">Admin dashboard</h1>
          <button
            className="rounded-full bg-[#0000FF] px-4 py-1.5 text-sm text-white hover:bg-white hover:text-black"
            onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-10 p-6">
        {/* CREATE TASK */}
        <section className={card}>
          <h2 className="mb-3 text-xl font-semibold">Create task</h2>
          {notice && <p className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{notice}</p>}
          <form onSubmit={createTask} className="grid gap-3 md:grid-cols-2">
            <input className={input} placeholder="Title" required value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })} />
            <input className={input} type="number" placeholder="Price (LKR)" required value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value })} />
            <textarea className={input} placeholder="Description" value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })} />
            <textarea className={input} placeholder="Requirements" value={f.requirements}
              onChange={(e) => setF({ ...f, requirements: e.target.value })} />
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
            <button className="rounded-xl bg-[#0000FF] p-2 font-semibold text-white hover:bg-black md:col-span-2">
              Publish task
            </button>
          </form>
        </section>

        {/* REVIEW QUEUE */}
        <section>
          <h2 className="mb-3 text-xl font-semibold">Review queue ({submitted.length})</h2>
          {submitted.length === 0 && <p className="text-gray-500">Nothing to review.</p>}
          {submitted.map((t) => (
            <div key={t.id} className={`${card} mb-3`}>
              <b>{t.title}</b> by {name(t.assigned_to)},{" "}
              <span className="font-bold text-[#0000FF]">LKR {Number(t.price).toLocaleString()}</span>
              {t.submission_url && (
                <p className="text-sm">
                  Work:{" "}
                  <a className="text-[#0000FF] underline" href={t.submission_url} target="_blank">
                    {t.submission_url}
                  </a>
                </p>
              )}
              <SubmissionFiles taskId={t.id} />
              {t.submission_notes && (
                <p className="text-sm text-gray-600">Notes: {t.submission_notes}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={() => review(t.id, true)}
                  className="rounded-full bg-green-600 px-4 py-1 text-white hover:bg-green-700">Approve</button>
                <button onClick={() => review(t.id, false)}
                  className="rounded-full bg-red-600 px-4 py-1 text-white hover:bg-red-700">Reject</button>
                <button onClick={() => setCommentTask(t)}
                  className="rounded-full border border-gray-300 px-4 py-1 hover:border-[#0000FF] hover:text-[#0000FF]">
                  💬 Comments
                </button>
              </div>
            </div>
          ))}
        </section>

        <EarningsReport tasks={tasks} emps={emps} payouts={payouts} />

        {/* ALL TASKS */}
        <section>
          <h2 className="mb-3 text-xl font-semibold">
            All tasks <span className="text-sm font-normal text-gray-500">({shown.length} of {tasks.length})</span>
          </h2>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
              className="mb-3 text-sm text-[#0000FF] underline"
              onClick={() => { setQ(""); setStatusF(""); setEmpF(""); setSortBy("newest"); }}
            >
              Clear filters
            </button>
          )}
          <div className="overflow-x-auto rounded-2xl bg-white shadow">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-black text-left text-white">
                  <th className="p-3">Task</th><th>Price</th><th>Status</th>
                  <th>Assigned to</th><th>Deadline</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="p-3">{t.title}</td>
                    <td>{Number(t.price).toLocaleString()}</td>
                    <td className="font-medium uppercase text-[#0000FF]">{t.status.replace("_", " ")}</td>
                    <td>{name(t.assigned_to)}</td>
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
                        <button className="mr-3 text-[#0000FF]" onClick={() => setCommentTask(t)}>Comments</button>
                      )}
                      <button className="text-red-600" onClick={() => removeTask(t.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="mt-3 text-gray-500">No tasks match these filters.</p>}
        </section>

        {/* EMPLOYEES + EARNINGS */}
        <section>
          <h2 className="mb-3 text-xl font-semibold">Employees and earnings</h2>
          <div className="overflow-x-auto rounded-2xl bg-white shadow">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-black text-left text-white">
                  <th className="p-3">Name</th><th>Role</th><th>Active</th>
                  <th>Earned</th><th>Paid</th><th>Owed</th><th></th>
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
                    <tr key={e.id} className="border-b">
                      <td className="p-3">
                        {e.full_name}<br /><span className="text-gray-500">{e.email}</span>
                      </td>
                      <td>
                        <select value={e.job_role}
                          onChange={(ev) => updateEmp(e.id, { job_role: ev.target.value })}
                          className="rounded-lg border p-1">
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
                        <button className="rounded-full border border-black px-3 py-1 hover:bg-black hover:text-white"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={confirmReject} className="w-full max-w-md space-y-3 rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold">Reject this work</h3>
            <textarea
              className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-[#0000FF]"
              placeholder="What needs to be fixed?" required
              value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectId(null)}
                className="rounded-full border border-black px-4 py-1.5">Cancel</button>
              <button className="rounded-full bg-red-600 px-5 py-1.5 text-white hover:bg-red-700">Reject</button>
            </div>
          </form>
        </div>
      )}
      {confirmBox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <p className="font-medium">{confirmBox.text}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmBox(null)}
                className="rounded-full border border-black px-4 py-1.5">Cancel</button>
              <button
                onClick={async () => { await confirmBox.action(); setConfirmBox(null); }}
                className="rounded-full bg-[#0000FF] px-5 py-1.5 text-white hover:bg-black">Confirm</button>
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
        <div className="fixed bottom-4 right-4 z-50 rounded-2xl bg-black px-5 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}