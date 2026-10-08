"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadReferences } from "@/lib/references";

type ReferenceFile = {
  id: string;
  path: string;
  file_name: string;
  size_bytes: number | null;
};

export default function ReferenceFiles({
  taskId,
  canEdit,
}: {
  taskId: string;
  canEdit: boolean;
}) {
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("task_references")
      .select("id,path,file_name,size_bytes")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    if (error) {
      setErr(error.message);
      return;
    }
    setFiles((data as ReferenceFile[]) ?? []);
  }, [taskId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function download(file: ReferenceFile) {
    setErr("");
    const { data, error } = await supabase.storage
      .from("task-references")
      .createSignedUrl(file.path, 300, { download: file.file_name });
    if (error || !data) {
      setErr(error?.message ?? "Could not create the download link.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = data.signedUrl;
    anchor.rel = "noreferrer";
    anchor.click();
  }

  async function add(picked: File[]) {
    if (picked.length === 0) return;
    setBusy(true);
    setErr("");
    const error = await uploadReferences(taskId, picked);
    setBusy(false);
    if (error) setErr(error);
    await load();
  }

  async function remove(file: ReferenceFile) {
    setConfirmId(null);
    setErr("");
    const { error: storageError } = await supabase.storage
      .from("task-references")
      .remove([file.path]);
    if (storageError) {
      setErr(storageError.message);
      return;
    }

    const { error: recordError } = await supabase
      .from("task_references")
      .delete()
      .eq("id", file.id);
    if (recordError) {
      setErr(`File removed, but its record could not be deleted: ${recordError.message}`);
      await load();
      return;
    }
    await load();
  }

  if (!canEdit && files.length === 0 && !err) return null;

  return (
    <div className="w-full space-y-1">
      {files.length > 0 && <p className="text-xs font-medium text-gray-500">Reference files</p>}
      {files.map((file) => (
        <div key={file.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
          <span>📎 {file.file_name}</span>
          {file.size_bytes != null && (
            <span className="text-gray-500">({(file.size_bytes / 1048576).toFixed(1)} MB)</span>
          )}
          <button type="button" onClick={() => void download(file)}
            className="rounded-full bg-[#0000FF] px-3 py-0.5 text-white hover:bg-black">Download</button>
          {canEdit && (confirmId === file.id ? (
            <>
              <span className="text-xs">Remove?</span>
              <button type="button" onClick={() => void remove(file)} className="text-xs text-red-600 underline">Yes</button>
              <button type="button" onClick={() => setConfirmId(null)} className="text-xs underline">No</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmId(file.id)} className="text-xs text-red-600 underline">Remove</button>
          ))}
        </div>
      ))}
      {canEdit && (
        <label className="inline-block cursor-pointer rounded-full border border-dashed border-[#0000FF] px-3 py-1 text-xs text-[#0000FF] hover:bg-blue-50">
          {busy ? "Uploading…" : "+ Add reference files"}
          <input type="file" multiple className="hidden" disabled={busy}
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              void add(picked);
            }} />
        </label>
      )}
      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
