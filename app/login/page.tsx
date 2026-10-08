"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signup, setSignup] = useState(false);
  const [reset, setReset] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setSuccess("");
    setLoading(true);
    try {
      if (reset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
          setMsg(error.message);
        } else {
          setSuccess("If an account exists for that email, a password reset link is on its way.");
        }
        return;
      }

      const { error } = signup
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMsg(error.message);
        return;
      }
      router.push("/");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-black placeholder-gray-400 outline-none transition focus:border-[#0000FF] focus:ring-4 focus:ring-[#0000FF]/15";
  const heading = reset ? "Reset your password" : signup ? "Create account" : "Welcome back";

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cover bg-center bg-no-repeat p-4"
      style={{ backgroundImage: "url('/login-gradient-bg.png')" }}
    >
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#0000FF] opacity-60 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 h-[460px] w-[460px] rounded-full bg-[#3b3bff] opacity-50 blur-[120px]" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/25 bg-white/85 shadow-[0_20px_80px_rgba(0,0,255,0.35)] backdrop-blur-2xl md:grid-cols-2">
        <section className="relative hidden flex-col justify-between overflow-hidden bg-[#0000FF] p-10 text-white md:flex">
          <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div aria-hidden className="absolute -bottom-20 -left-12 h-64 w-64 rounded-full bg-black/20" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white p-2 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Agency logo" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="relative">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
              LeapOff Employee Workspace
            </p>
            <h2 className="text-4xl font-bold leading-tight">
              Your work.<br />Your tasks.<br />One place.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/80">
              Pick up tasks, submit your work, and keep track of your earnings with your team.
            </p>
          </div>
          <p className="relative text-xs text-white/60">
            LEAPOFF<sup className="ml-0.5 text-[0.6em]">TM</sup> SINCE 2022
          </p>
        </section>

        <section className="flex items-center p-7 sm:p-12">
          <form onSubmit={submit} className="w-full space-y-5">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0000FF] p-2 md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Agency logo" className="max-h-full max-w-full rounded-lg bg-white object-contain p-1" />
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0000FF]">LeapOff Employee Workspace</p>
              <h1 className="mt-1 text-3xl font-bold text-black">{heading}</h1>
              <p className="mt-2 text-sm text-gray-500">
                {reset
                  ? "Enter your account email and we’ll send you a secure reset link."
                  : signup
                    ? "Sign up to join the team portal."
                    : "Log in to your employee account."}
              </p>
            </div>

            {signup && (
              <div>
                <label htmlFor="full-name" className="mb-1.5 block text-sm font-medium text-gray-700">Full name</label>
                <input
                  id="full-name"
                  className={input}
                  autoComplete="name"
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">Email address</label>
              <input
                id="email"
                className={input}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {!reset && (
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    className={`${input} pr-16`}
                    type={showPassword ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
                    placeholder={signup ? "At least 6 characters" : "Enter your password"}
                    minLength={signup ? 6 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((show) => !show)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500 hover:text-[#0000FF]"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            )}

            {!signup && !reset && (
              <div className="-mt-2 text-right">
                <button
                  type="button"
                  className="text-sm font-medium text-[#0000FF] hover:underline"
                  onClick={() => { setMsg(""); setSuccess(""); setReset(true); }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {msg && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {msg}
              </p>
            )}
            {success && (
              <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {success}
              </p>
            )}

            <button
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0000FF] py-3 font-semibold text-white shadow-lg shadow-[#0000FF]/30 transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Please wait…
                </>
              ) : reset ? "Send reset link" : signup ? "Create account" : "Log in"}
            </button>

            <div className="text-center text-sm">
              {reset ? (
                <button
                  type="button"
                  className="font-medium text-black hover:text-[#0000FF]"
                  onClick={() => { setReset(false); setMsg(""); setSuccess(""); }}
                >
                  Back to log in
                </button>
              ) : (
                <button
                  type="button"
                  className="font-medium text-black hover:text-[#0000FF]"
                  onClick={() => { setSignup((value) => !value); setMsg(""); setSuccess(""); }}
                >
                  {signup ? "Already have an account? Log in" : "New employee? Create an account"}
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}