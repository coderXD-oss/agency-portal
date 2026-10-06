"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "@/lib/supabase";

type Comment = { id: string; author_id: string; body: string; created_at: string };

export default function TaskComments({
  taskId, taskTitle, myId, otherLabel, onClose,
}: {
  taskId: string;
  taskTitle: string;
  myId: string;
  otherLabel: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    const refresh = () => {
      supabase
        .from("task_comments")
        .select("id,author_id,body,created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true })
        .then(({ data }) => {
          if (active) setItems((data as Comment[]) ?? []);
        });
    };

    refresh();
    const ch = supabase.channel(`comments-${taskId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` },
        () => refresh())
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [taskId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setErr("");
    const { data, error } = await supabase
      .from("task_comments")
      .insert({ task_id: taskId, author_id: myId, body: text.trim() })
      .select("id,author_id,body,created_at")
      .single();
    setSending(false);
    if (error) return setErr(error.message);
    setText("");
    // show my message straight away (the live update will sync the full list too)
    if (data) {
      setItems((prev) =>
        prev.some((c) => c.id === data.id) ? prev : [...prev, data as Comment]
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-black">
      <div className="flex h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0000FF] px-5 py-4 text-white">
          <div>
            <p className="text-xs text-blue-100">Comments</p>
            <h3 className="font-bold">{taskTitle}</h3>
          </div>
          <button onClick={onClose} className="rounded-full bg-white/20 px-3 py-1 text-sm hover:bg-white/30">
            Close
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
          {items.length === 0 && (
            <p className="mt-10 text-center text-sm text-gray-500">No messages yet. Say hello 👋</p>
          )}
          {items.map((c) => {
            const mine = c.author_id === myId;
            return (
              <div key={c.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  mine ? "bg-[#0000FF] text-white" : "bg-white shadow"}`}>
                  <p className={`mb-0.5 text-xs ${mine ? "text-blue-100" : "text-gray-500"}`}>
                    {mine ? "You" : otherLabel} · {new Date(c.created_at).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap wrap-break-word">{c.body}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>

        <form onSubmit={send} className="space-y-2 border-t p-3">
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-full border border-gray-300 px-4 py-2 outline-none focus:border-[#0000FF]"
              placeholder="Write a message…" value={text}
              onChange={(e) => setText(e.target.value)} />
            <button disabled={sending}
              className="rounded-full bg-black px-5 py-2 text-white hover:bg-[#0000FF] disabled:opacity-60">
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}