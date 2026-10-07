"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type T = { id: string; title: string; price: number; status: string; approved_at: string | null };
type P = { id: string; amount: number; paid_at: string; note: string | null };

const lkr = (n: number) => `LKR ${n.toLocaleString()}`;
const monthKey = (d: string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (k: string, short = false) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    "en-GB",
    short ? { month: "short" } : { month: "long", year: "numeric" }
  );
};
const sum = (n: number[]) => n.reduce((s, x) => s + x, 0);

export default function Earnings() {
  const router = useRouter();
  const [tasks, setTasks] = useState<T[]>([]);
  const [payouts, setPayouts] = useState<P[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) {
        if (!cancelled) {
          setError(authError.message);
          setLoading(false);
        }
        return;
      }
      if (!user) {
        router.replace("/login");
        return;
      }

      const [taskResult, payoutResult] = await Promise.all([
        supabase
          .from("tasks")
          .select("id,title,price,status,approved_at")
          .eq("assigned_to", user.id),
        supabase
          .from("payouts")
          .select("id,amount,paid_at,note")
          .eq("employee_id", user.id)
          .order("paid_at", { ascending: false }),
      ]);

      if (cancelled) return;
      if (taskResult.error || payoutResult.error) {
        setError(taskResult.error?.message ?? payoutResult.error?.message ?? "Could not load earnings.");
        setLoading(false);
        return;
      }

      setTasks((taskResult.data as T[]) ?? []);
      setPayouts((payoutResult.data as P[]) ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const data = useMemo(() => {
    const approved = tasks.filter((t) => t.status === "approved" && t.approved_at);
    const keys = new Set<string>([
      ...approved.map((t) => monthKey(t.approved_at!)),
      ...payouts.map((p) => monthKey(p.paid_at)),
    ]);
    const months = Array.from(keys).sort().reverse().map((key) => {
      const mt = approved.filter((t) => monthKey(t.approved_at!) === key);
      const mp = payouts.filter((p) => monthKey(p.paid_at) === key);
      return {
        key,
        label: monthLabel(key),
        tasks: mt,
        pays: mp,
        earned: sum(mt.map((t) => Number(t.price))),
        paid: sum(mp.map((p) => Number(p.amount))),
      };
    });
    const totalEarned = sum(approved.map((t) => Number(t.price)));
    const totalPaid = sum(payouts.map((p) => Number(p.amount)));
    const awaiting = sum(
      tasks.filter((t) => t.status === "submitted").map((t) => Number(t.price))
    );
    const thisKey = monthKey(new Date().toISOString());
    const thisMonth = months.find((m) => m.key === thisKey)?.earned ?? 0;
    return { months, totalEarned, totalPaid, owed: totalEarned - totalPaid, awaiting, thisMonth };
  }, [tasks, payouts]);

  const last6 = data.months.slice(0, 6).reverse();
  const max = Math.max(1, ...last6.map((m) => m.earned));

  return (
    <main className="min-h-screen bg-gray-100 text-black">
      <header className="bg-black px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <h1 className="text-xl font-bold text-white">My earnings</h1>
          <Link
            href="/dashboard"
            className="rounded-full bg-[#0000FF] px-4 py-1.5 text-sm text-white hover:bg-white hover:text-black"
          >
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-8 p-6">
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : error ? (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
            Could not load your earnings: {error}
          </p>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-4 text-center lg:grid-cols-4">
              <Stat label="Total earned" value={lkr(data.totalEarned)} />
              <Stat label="Total paid to you" value={lkr(data.totalPaid)} />
              <Stat label="Balance owed to you" value={lkr(data.owed)} highlight />
              <Stat label="This month" value={lkr(data.thisMonth)} />
            </section>
            {data.awaiting > 0 && (
              <p className="rounded-xl bg-blue-50 p-3 text-sm text-[#0000FF]">
                {lkr(data.awaiting)} is waiting for the admin to review. It will be added once approved.
              </p>
            )}

            {last6.length > 0 && (
              <section className="rounded-2xl bg-white p-5 shadow">
                <h2 className="mb-4 font-semibold">Earned per month</h2>
                <div className="flex items-end gap-3">
                  {last6.map((m) => (
                    <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs text-gray-600">{m.earned.toLocaleString()}</span>
                      <div
                        className="w-full rounded-t-xl bg-[#0000FF]"
                        style={{ height: `${Math.max(4, Math.round((m.earned / max) * 120))}px` }}
                      />
                      <span className="text-xs">{monthLabel(m.key, true)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Month by month</h2>
              {data.months.length === 0 && (
                <p className="rounded-2xl bg-white p-5 text-gray-500 shadow">
                  No earnings yet. Once your work is approved, it will show up here.
                </p>
              )}
              {data.months.map((m) => (
                <details key={m.key} className="rounded-2xl bg-white shadow">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
                    <span className="font-semibold">{m.label}</span>
                    <span className="text-sm text-gray-600">
                      {m.tasks.length} task(s) · Earned{" "}
                      <b className="text-[#0000FF]">{lkr(m.earned)}</b> · Paid <b>{lkr(m.paid)}</b>
                    </span>
                  </summary>
                  <div className="space-y-4 border-t p-4 text-sm">
                    {m.tasks.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium">Approved tasks</p>
                        <ul className="space-y-1">
                          {m.tasks.map((t) => (
                            <li key={t.id} className="flex justify-between gap-3">
                              <span>
                                {t.title}{" "}
                                <span className="text-gray-500">
                                  ({new Date(t.approved_at!).toLocaleDateString("en-GB")})
                                </span>
                              </span>
                              <span className="font-medium">{lkr(Number(t.price))}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {m.pays.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium">Payments received</p>
                        <ul className="space-y-1">
                          {m.pays.map((p) => (
                            <li key={p.id} className="flex justify-between gap-3">
                              <span>
                                {new Date(p.paid_at).toLocaleDateString("en-GB")}
                                {p.note ? ` · ${p.note}` : ""}
                              </span>
                              <span className="font-medium">{lkr(Number(p.amount))}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight ? "text-[#0000FF]" : ""}`}>{value}</p>
    </div>
  );
}
