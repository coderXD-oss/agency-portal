"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type FileRow = {
  id: string; path: string; file_name: string;
  size_bytes: number | null; expires_at: string;
};

export default function SubmissionFiles({ taskId }: { taskId: string }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [err, setErr] = useState("");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    supabase.from("task_files")
      .select("id,path,file_name,size_bytes,expires_at")
      .eq("task_id", taskId)
      .order("submitted_at", { ascending: true })
      .then(({ data }) => setFiles((data as FileRow[]) ?? []));
    return () => window.cancelAnimationFrame(frame);
  }, [taskId]);

  async function download(f: FileRow) {
    setErr("");
    const { data, error } = await supabase.storage
      .from("submissions")
      .createSignedUrl(f.path, 300, { download: f.file_name });
    if (error || !data) return setErr(error?.message ?? "Could not create the download link.");
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.click();
  }

  const daysLeft = (d: string, currentTime: number): number | null => {
    const expiresAt = new Date(d).getTime();
    if (!Number.isFinite(expiresAt)) return null;
    return Math.max(0, Math.ceil((expiresAt - currentTime) / 86400000));
  };

  if (files.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {files.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
          <span>📄 {f.file_name}</span>
          {f.size_bytes != null && (
            <span className="text-gray-500">({(f.size_bytes / 1048576).toFixed(1)} MB)</span>
          )}
          <button onClick={() => download(f)}
            className="rounded-full bg-[#0000FF] px-3 py-0.5 text-white hover:bg-black">Download</button>
          <span className="text-xs text-red-600">
            {now === null
              ? "Checking expiry…"
              : daysLeft(f.expires_at, now) === null
                ? "Expiry date unavailable"
                : `Deletes in ${daysLeft(f.expires_at, now)} day(s)`}
          </span>
        </div>
      ))}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}