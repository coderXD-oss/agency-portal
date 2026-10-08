import { supabase } from "@/lib/supabase";

export const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;

export async function uploadReferences(taskId: string, files: File[]): Promise<string | null> {
  for (const file of files) {
    if (file.size > MAX_REFERENCE_BYTES)
      return `${file.name} is over 50 MB. Put a link in the description instead.`;

    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${taskId}/${crypto.randomUUID()}-${safe}`;
    const { error: uploadError } = await supabase.storage
      .from("task-references")
      .upload(path, file);
    if (uploadError) return `Could not upload ${file.name}: ${uploadError.message}`;

    const { error: recordError } = await supabase.from("task_references").insert({
      task_id: taskId,
      path,
      file_name: file.name,
      size_bytes: file.size,
    });
    if (recordError) {
      const { error: cleanupError } = await supabase.storage
        .from("task-references")
        .remove([path]);
      const cleanupNote = cleanupError ? ` File cleanup failed: ${cleanupError.message}` : "";
      return `Could not save ${file.name}: ${recordError.message}.${cleanupNote}`;
    }
  }

  return null;
}
