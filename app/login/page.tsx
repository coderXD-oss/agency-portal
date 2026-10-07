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
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setLoading(true);
    const { error } = signup
      ? await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setMsg(error.message);
    router.push("/");
  }

  const input =
    "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-black placeholder-gray-400 outline-none transition focus:border-[#0000FF] focus:ring-4 focus:ring-[#0000FF]/15";

  return (
    <main
      className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat p-4"
      style={{ backgroundImage: "url('/login-gradient-bg.png')" }}
    >
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        {/* Left brand panel */}
        <section className="relative hidden flex-col justify-between bg-[#0000FF] p-10 text-white md:flex">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="absolute -bottom-20 -left-12 h-64 w-64 rounded-full bg-black/20" />

          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white p-2 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Agency logo" className="max-h-full max-w-full object-contain" />
          </div>

          <div className="relative">
            <h2 className="text-3xl font-bold leading-tight">
              Your work.<br />Your tasks.<br />One place.
            </h2>
            <p className="mt-4 text-sm text-white/80">
              Pick up tasks, submit your work, and track your earnings with our team portal.
            </p>
          </div>

          <p className="relative text-xs text-white/60">
            LEAPOFF<sup className="ml-0.5 text-[0.6em]">TM</sup> SINCE 2022
          </p>
        </section>

        {/* Right form panel */}
        <section className="flex items-center p-8 sm:p-12">
          <form onSubmit={submit} className="w-full space-y-4">
            {/* Logo shown on mobile only */}
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0000FF] p-2 md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Agency logo" className="max-h-full max-w-full rounded-lg bg-white object-contain p-1" />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-black">
                {signup ? "Create account" : "Welcome back"}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {signup ? "Sign up to join the team portal." : "Log in to your employee account."}
              </p>
            </div>

            {signup && (
              <input
                className={input}
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}
            <input
              className={input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className={input}
              type="password"
              placeholder="Password (min 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {msg && (
              <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{msg}</p>
            )}

            <button
              disabled={loading}
              className="w-full rounded-xl bg-[#0000FF] py-3 font-semibold text-white shadow-lg shadow-[#0000FF]/30 transition hover:bg-black disabled:opacity-60"
            >
              {loading ? "Please wait…" : signup ? "Sign up" : "Log in"}
            </button>

            <button
              type="button"
              className="w-full text-sm font-medium text-black hover:text-[#0000FF]"
              onClick={() => setSignup(!signup)}
            >
              {signup ? "I already have an account" : "New employee? Create account"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}