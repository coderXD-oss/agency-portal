"use client";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
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
  const pool = tasks.filter((t) => t.mode === "open" && t.assigned_to !== uid);
  const earned = mine.filter((t) => t.status === "approved").reduce((s, t) => s + Number(t.price), 0);
  const pending = mine.filter((t) => t.status === "submitted").reduce((s, t) => s + Number(t.price), 0);

  if (!active)

    return (
      <main className="min-h-screen flex items-center justify-center bg-black p-6 text-black">
        <div className="max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
          <h1 className="text-xl font-bold">Hi {name}</h1>
          <p className="mt-2 text-gray-600">Your account is waiting for admin approval.</p>
        </div>
      </main>
    );

  return (
    <main className="min-h-screen bg-gray-100 text-black">
      <header className="bg-black px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <h1 className="text-xl font-bold text-white">Hi {name} 👋</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/earnings"
              className="rounded-full border border-white px-4 py-1.5 text-sm text-white hover:bg-white hover:text-black"
            >
              My earnings
            </Link>
            <button
              className="rounded-full bg-[#0000FF] px-4 py-1.5 text-sm text-white hover:bg-white hover:text-black"
              onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-8 p-6">
        <section className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
          <Stat label="Earned (approved)" value={earned} />
          <Stat label="Paid to you" value={paid} />
          <Stat label="Awaiting review" value={pending} />
        </section>

        {msg && <p className="rounded-xl bg-blue-50 p-3 text-[#0000FF]">{msg}</p>}

        {submitId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <form onSubmit={confirmSubmit} className="w-full max-w-md space-y-3 rounded-3xl bg-white p-6 text-black shadow-2xl">
              <h3 className="text-lg font-bold">Submit your work</h3>
              <label className="block cursor-pointer rounded-xl border border-dashed border-[#0000FF] p-4 text-center text-sm hover:bg-blue-50">
                <span className="font-medium text-[#0000FF]">Attach files</span> (up to 50 MB each)
                <input type="file" multiple className="hidden"
                  onChange={(e) => setSubFiles(Array.from(e.target.files ?? []))} />
              </label>
              {subFiles.length > 0 && (
                <ul className="space-y-1 text-sm text-gray-700">
                  {subFiles.map((f) => (
                    <li key={f.name + f.size}>📄 {f.name} ({(f.size / 1048576).toFixed(1)} MB)</li>
                  ))}
                </ul>
              )}
              <input
                className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-[#0000FF]"
                placeholder="Or a link (Google Drive, Frame.io, etc.)"
                type="url" value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)} />
              <textarea
                className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-[#0000FF]"
                placeholder="Notes for the admin (optional)"
                value={subNotes} onChange={(e) => setSubNotes(e.target.value)} />
              <p className="text-xs text-gray-500">
                Attached files are deleted automatically 7 days after you submit.
              </p>
              {subErr && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{subErr}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" disabled={uploading} onClick={() => setSubmitId(null)}
                  className="rounded-full border border-black px-4 py-1.5">Cancel</button>
                <button disabled={uploading}
                  className="rounded-full bg-[#0000FF] px-5 py-1.5 text-white hover:bg-black disabled:opacity-60">
                  {uploading ? "Uploading…" : "Submit"}
                </button>
              </div>
            </form>
          </div>
        )}

        <section>

          <h2 className="mb-3 text-xl font-semibold">Available tasks</h2>
          <div className="space-y-3">
            {pool.length === 0 && <p className="text-gray-500">No tasks right now.</p>}
            {pool.map((t) => (
              <TaskCard key={t.id} t={t}>
                {t.status === "open" ? (
                  <button onClick={() => take(t.id)}
                    className="rounded-full bg-[#0000FF] px-5 py-1.5 text-white hover:bg-black">
                    Take task
                  </button>
                ) : (
                  <span className="rounded-full bg-gray-200 px-4 py-1 text-sm">Taken</span>
                )}
              </TaskCard>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">My tasks</h2>
          <div className="space-y-3">
            {mine.length === 0 && <p className="text-gray-500">You have no tasks yet.</p>}
            {mine.map((t) => (
              <TaskCard key={t.id} t={t}>
                <span className="text-sm font-medium uppercase text-[#0000FF]">
                  {t.status.replace("_", " ")}
                </span>
                {t.status === "taken" && (
                  <button onClick={() => start(t.id)}
                    className="rounded-full border border-black px-4 py-1 hover:bg-black hover:text-white">
                    Start
                  </button>

                )}
                {["taken", "in_progress", "rejected"].includes(t.status) && (
                  <button onClick={() => submitWork(t.id)}
                    className="rounded-full bg-black px-4 py-1 text-white hover:bg-[#0000FF]">
                    Submit work
                  </button>
                )}
                <button onClick={() => setCommentTask(t)}
                  className="rounded-full border border-gray-300 px-4 py-1 text-sm hover:border-[#0000FF] hover:text-[#0000FF]">
                  💬 Comments
                </button>
                {t.status === "rejected" && t.admin_feedback && (
                  <p className="w-full text-sm text-red-600">Feedback: {t.admin_feedback}</p>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-bold text-[#0000FF]">LKR {value.toLocaleString()}</p>
    </div>
  );
}

function TaskCard({ t, children }: { t: Task; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow">
      <div className="flex justify-between gap-3">

        <h3 className="font-semibold">{t.title}</h3>
        <span className="font-bold text-[#0000FF]">LKR {Number(t.price).toLocaleString()}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">{t.description}</p>
      {t.requirements && (
        <p className="mt-1 text-sm"><b>Requirements:</b> {t.requirements}</p>
      )}
      <p className="mt-1 text-xs text-gray-500">
        {t.required_role ?? "Any role"} · Deadline:{" "}
        {t.deadline ? new Date(t.deadline).toLocaleString() : "none"}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}