"use client";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PriorityBadge from "@/components/PriorityBadge";
import TaskComments from "@/components/TaskComments";
import type { Task } from "@/lib/types";

export default function Dashboard() {
  const router = useRouter();
  const [uid, setUid] = useState("");
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [paid, setPaid] = useState(0);
  const [msg, setMsg] = useState("");
  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [submitId, setSubmitId] = useState<string | null>(null);
  const [subUrl, setSubUrl] = useState("");
  const [subNotes, setSubNotes] = useState("");
  const [subFiles, setSubFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [subErr, setSubErr] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("tasks").select("*").order("created_at", { ascending: false });
    setTasks((data as Task[]) ?? []);
    const { data: pay } = await supabase.from("payouts").select("amount");
    setPaid((pay ?? []).reduce((s, p) => s + Number(p.amount), 0));
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace("/login");
      setUid(user.id);
      const { data: p } = await supabase
        .from("profiles").select("full_name,is_active").eq("id", user.id).single();
      setName(p?.full_name ?? "");
      setActive(!!p?.is_active);

      load();
    })();
    // live updates: any change to tasks refreshes the list
    const ch = supabase.channel("tasks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [router, load]);

  async function take(id: string) {
    const { data, error } = await supabase.rpc("claim_task", { p_task_id: id });
    setMsg(error ? error.message : data ? "✅ Task is yours!" : "Sorry, this task was just taken.");
    load();
  }
  async function start(id: string) {
    await supabase.rpc("start_task", { p_task_id: id });
    load();
  }
  function submitWork(id: string) {
    setSubUrl("");
    setSubNotes("");
    setSubFiles([]);
    setSubErr("");
    setSubmitId(id);
  }
  async function confirmSubmit(e: FormEvent) {
    e.preventDefault();
    if (!submitId) return;

    if (!subUrl.trim() && subFiles.length === 0)
      return setSubErr("Add a link or attach at least one file.");
    if (subFiles.some((f) => f.size > 50 * 1024 * 1024))
      return setSubErr("Each file must be under 50 MB. For bigger files, use a link instead.");

    setUploading(true);
    setSubErr("");

    const saved: { path: string; name: string; size: number }[] = [];
    for (const file of subFiles) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${submitId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("submissions").upload(path, file);
      if (error) {
        setUploading(false);
        return setSubErr(`Could not upload ${file.name}: ${error.message}`);
      }
      saved.push({ path, name: file.name, size: file.size });
    }

    for (const s of saved) {
      const { error } = await supabase.rpc("add_task_file", {
        p_task_id: submitId, p_path: s.path, p_name: s.name, p_size: s.size,
      });
      if (error) {
        setUploading(false);
        return setSubErr(error.message);
      }
    }

    const { error: subError } = await supabase.rpc("submit_task", {
      p_task_id: submitId, p_url: subUrl.trim(), p_notes: subNotes,
    });
    if (subError) {
      setUploading(false);
      return setSubErr(subError.message);
    }

    const fileNote = saved.length ? ` (${saved.length} file${saved.length > 1 ? "s" : ""} attached)` : "";
    await supabase.from("task_comments").insert({
      task_id: submitId, author_id: uid,
      body: "📎 Submitted: " + (subUrl.trim() || "files only") + fileNote + (subNotes ? " — " + subNotes : ""),
    });

    setUploading(false);
    setSubmitId(null);
    setSubFiles([]);
    setMsg("✅ Work submitted. The admin will review it.");
    load();
  }

  const mine = tasks.filter((t) => t.assigned_to === uid);
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
  const pool = tasks
    .filter((t) => t.mode === "open" && t.status === "open" && t.assigned_to !== uid)
    .sort((a, b) => rank[a.priority] - rank[b.priority]);
  const earned = mine.filter((t) => t.status === "approved").reduce((s, t) => s + Number(t.price), 0);
  const pending = mine.filter((t) => t.status === "submitted").reduce((s, t) => s + Number(t.price), 0);

  if (!active)

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-black">
        <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-2xl text-[#0000FF]">⌛</div>
          <p className="mt-5 text-sm font-semibold uppercase tracking-[0.16em] text-[#0000FF]">LeapOff workspace</p>
          <h1 className="mt-2 text-2xl font-bold">Hi {name || "there"}</h1>
          <p className="mt-2 leading-6 text-gray-600">Your account is waiting for admin approval. You’ll be able to access your tasks once your account is active.</p>
        </div>
      </main>
    );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0000FF] text-sm font-black text-white shadow-md shadow-blue-200">L</span>
            <span className="min-w-0">
              <span className="block truncate font-bold leading-tight">LeapOff</span>
              <span className="block text-xs text-slate-500">Employee workspace</span>
            </span>
          </Link>
          <nav aria-label="Account navigation" className="flex shrink-0 items-center gap-2">
            <Link
              href="/dashboard/earnings"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0000FF] sm:px-4"
            >
              My earnings
            </Link>
            <button
              className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#0000FF] sm:px-4"
              onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>
              Log out
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-7 sm:px-6 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0000FF] via-blue-700 to-indigo-950 p-6 text-white shadow-xl shadow-blue-950/15 sm:p-9">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border-[36px] border-white/10" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 right-1/3 h-64 w-64 rounded-full bg-blue-400/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold tracking-wide text-blue-100">YOUR TEAM WORKSPACE</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Welcome back{name ? `, ${name}` : ""}!</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100 sm:text-base">
                Find your next opportunity, keep your work moving, and follow your earnings all in one place.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3 text-sm">
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
                <span className="block text-2xl font-bold">{pool.filter((t) => t.status === "open").length}</span>
                <span className="text-blue-100">Open opportunities</span>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
                <span className="block text-2xl font-bold">{mine.length}</span>
                <span className="text-blue-100">Your tasks</span>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Earnings summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Earned from approved work" value={earned} accent="blue" icon="↗" />
          <Stat label="Paid to you" value={paid} accent="green" icon="✓" />
          <Stat label="Awaiting review" value={pending} accent="amber" icon="◷" />
        </section>

        {msg && (
          <p role="status" className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
            {msg}
          </p>
        )}

        {submitId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <form onSubmit={confirmSubmit} className="w-full max-w-lg space-y-5 rounded-3xl bg-white p-6 text-black shadow-2xl sm:p-8">
              <div>
                <p className="text-sm font-semibold text-[#0000FF]">HAND IN YOUR WORK</p>
                <h3 className="mt-1 text-2xl font-bold">Submit your work</h3>
                <p className="mt-1 text-sm text-slate-500">Add a link or attach your files for the admin to review.</p>
              </div>
              <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-5 text-center text-sm transition hover:border-[#0000FF] hover:bg-blue-50">
                <span className="mb-1 block text-2xl">↥</span>
                <span className="font-semibold text-[#0000FF]">Choose files to attach</span>
                <span className="mt-1 block text-xs text-slate-500">Up to 50 MB per file</span>
                <input type="file" multiple className="hidden"
                  onChange={(e) => setSubFiles(Array.from(e.target.files ?? []))} />
              </label>
              {subFiles.length > 0 && (
                <ul className="max-h-28 space-y-2 overflow-y-auto text-sm text-gray-700">
                  {subFiles.map((f) => (
                    <li key={f.name + f.size} className="flex justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                      <span className="truncate">📄 {f.name}</span>
                      <span className="shrink-0 text-slate-500">{(f.size / 1048576).toFixed(1)} MB</span>
                    </li>
                  ))}
                </ul>
              )}
              <input
                className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-[#0000FF] focus:ring-4 focus:ring-blue-100"
                placeholder="Paste a work link (Google Drive, Frame.io…)"
                type="url" value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)} />
              <textarea
                className="w-full resize-y rounded-xl border border-slate-200 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-[#0000FF] focus:ring-4 focus:ring-blue-100"
                placeholder="Add a note for the admin (optional)"
                value={subNotes} onChange={(e) => setSubNotes(e.target.value)} />
              <p className="text-xs leading-5 text-slate-500">
                Attached files are deleted automatically 7 days after you submit.
              </p>
              {subErr && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{subErr}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" disabled={uploading} onClick={() => setSubmitId(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button disabled={uploading}
                  className="rounded-xl bg-[#0000FF] px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60">
                  {uploading ? "Uploading…" : "Submit"}
                </button>
              </div>
            </form>
          </div>
        )}

        <section aria-labelledby="available-tasks-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0000FF]">Find your next opportunity</p>
              <h2 id="available-tasks-heading" className="mt-1 text-2xl font-bold tracking-tight">Available tasks</h2>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-[#0000FF]">
              {pool.filter((t) => t.status === "open").length} open
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {pool.length === 0 && (
              <EmptyState title="No opportunities just yet" text="New tasks will appear here as soon as they’re available." />
            )}
            {pool.map((t) => (
              <TaskCard key={t.id} t={t}>
                {t.status === "open" ? (
                  <button onClick={() => take(t.id)}
                    className="rounded-xl bg-[#0000FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-200">
                    Take task
                  </button>
                ) : (
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">Taken</span>
                )}
              </TaskCard>
            ))}
          </div>
        </section>

        <section aria-labelledby="my-tasks-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0000FF]">Your current workload</p>
              <h2 id="my-tasks-heading" className="mt-1 text-2xl font-bold tracking-tight">My tasks</h2>
            </div>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
              {mine.length} total
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {mine.length === 0 && (
              <EmptyState title="Your task list is clear" text="Tasks you take or are assigned will show up here." />
            )}
            {mine.map((t) => (
              <TaskCard key={t.id} t={t}>
                {t.status === "taken" && (
                  <button onClick={() => start(t.id)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#0000FF] hover:text-[#0000FF]">
                    Start
                  </button>

                )}
                {["taken", "in_progress", "rejected"].includes(t.status) && (
                  <button onClick={() => submitWork(t.id)}
                    className="rounded-xl bg-[#0000FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800">
                    Submit work
                  </button>
                )}
                <button onClick={() => setCommentTask(t)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0000FF]">
                  💬 Comments
                </button>
                {t.status === "rejected" && t.admin_feedback && (
                  <p className="w-full rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
                    <span className="font-semibold">Admin feedback:</span> {t.admin_feedback}
                  </p>
                )}
              </TaskCard>
            ))}
          </div>
        </section>
      </div>

      {commentTask && (
        <TaskComments taskId={commentTask.id} taskTitle={commentTask.title}
          myId={uid} otherLabel="Admin" onClose={() => setCommentTask(null)} />
      )}
    </main>
  );
}

function Stat({ label, value, accent, icon }: {
  label: string;
  value: number;
  accent: "blue" | "green" | "amber";
  icon: string;
}) {
  const accents = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold ring-1 ${accents[accent]}`}>
          {icon}
        </span>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
        <span className="mr-1 text-sm font-semibold text-slate-400">LKR</span>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function TaskCard({ t, children }: { t: Task; children: React.ReactNode }) {
  const statusStyle: Record<string, string> = {
    open: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    taken: "bg-blue-50 text-blue-700 ring-blue-600/10",
    in_progress: "bg-indigo-50 text-indigo-700 ring-indigo-600/10",
    submitted: "bg-amber-50 text-amber-700 ring-amber-600/10",
    approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    rejected: "bg-red-50 text-red-700 ring-red-600/10",
  };

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-950/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset ${statusStyle[t.status] ?? "bg-slate-100 text-slate-700 ring-slate-500/10"}`}>
            {t.status.replace("_", " ")}
          </span>
          <h3 className="mt-3 break-words text-base font-bold leading-6 text-slate-900">{t.title}</h3>
        </div>
        <span className="shrink-0 rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-[#0000FF]">
          LKR {Number(t.price).toLocaleString()}
        </span>
      </div>
      {t.description && (
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{t.description}</p>
      )}
      {t.requirements && (
        <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-5 text-slate-600">
          <span className="font-semibold text-slate-800">Requirements:</span> {t.requirements}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <PriorityBadge priority={t.priority} />
        {t.task_type && <span className="rounded-full bg-gray-100 px-2 py-0.5">{t.task_type}</span>}
        {t.client_name && <span className="text-gray-600">Client: <b>{t.client_name}</b></span>}
      </div>
      {t.client_notes && (
        <p className="mt-2 rounded-xl bg-blue-50 p-3 text-sm">
          <b>Client notes:</b> {t.client_notes}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-500">
        <span className="rounded-lg bg-slate-100 px-2.5 py-1.5">{t.required_role ?? "Any role"}</span>
        <span className="rounded-lg bg-slate-100 px-2.5 py-1.5">
          {t.deadline ? `Due ${new Date(t.deadline).toLocaleString()}` : "No deadline"}
        </span>
      </div>
      {children && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
          {children}
        </div>
      )}
    </article>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center lg:col-span-2">
      <span aria-hidden className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-xl text-slate-500">✦</span>
      <h3 className="mt-3 font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}