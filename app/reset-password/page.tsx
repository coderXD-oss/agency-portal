"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && active) setReady(true);
      if (event === "SIGNED_OUT" && active) setReady(false);
      if (session && active) setReady(true);
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setErr(error.message);
      if (data.session) setReady(true);
      setChecked(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (password.length < 6) {
      setErr("Password must contain at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(error.message);
        return;
      }
      setDone(true);
      window.setTimeout(() => router.push("/"), 1200);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not update your password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 text-black"
      style={{ background: "linear-gradient(135deg,#000000 0%,#02021f 38%,#0a0a8c 72%,#0000FF 100%)" }}
    >
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#0000FF] opacity-70 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 h-[460px] w-[460px] rounded-full bg-[#3b3bff] opacity-60 blur-[120px]" />

      <div className="relative w-full max-w-md rounded-[2rem] border border-white/25 bg-white/85 p-8 shadow-[0_20px_80px_rgba(0,0,255,0.45)] backdrop-blur-2xl sm:p-10">
        <p className="text-sm font-semibold text-[#0000FF]">LeapOff Employee Workspace</p>
        <h1 className="mt-1 text-3xl font-bold">Choose a new password</h1>

        {!checked ? (
          <p className="mt-6 text-gray-600">Checking your link…</p>
        ) : !ready ? (
          <div className="mt-6 space-y-4">
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err || "This reset link is invalid or has expired. Request a new one from the login page."}
            </p>
            <Link
              href="/login"
              className="block w-full rounded-xl bg-[#0000FF] py-3 text-center font-semibold text-white hover:bg-black"
            >
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1 block text-sm font-medium">New password</label>
              <div className="relative">
                <input
                  id="new-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={6}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-gray-200 bg-white/70 px-4 py-3 pr-16 outline-none transition focus:border-[#0000FF] focus:bg-white focus:ring-4 focus:ring-[#0000FF]/20"
                />
                <button
                  type="button"
                  onClick={() => setShow((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-600 hover:text-[#0000FF]"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            {err && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {err}
              </p>
            )}
            {done && (
              <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                Password updated. Redirecting…
              </p>
            )}
            <button
              disabled={loading || done}
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white shadow-[0_8px_24px_rgba(0,0,255,0.35)] transition disabled:cursor-not-allowed disabled:opacity-70 ${
                done ? "bg-green-600" : "bg-[#0000FF] hover:bg-black"
              }`}
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Saving…
                </>
              ) : done ? "Password updated" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
