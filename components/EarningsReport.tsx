"use client";
import { useMemo, useState } from "react";
import type { Profile, Task } from "@/lib/types";

type Payout = { employee_id: string; amount: number; paid_at: string };
type Cell = string | number;

const clean = (v: Cell) =>
  typeof v === "number" ? v : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;

function downloadCsv(filename: string, rows: Cell[][]) {
  const text = rows
    .map((r) => r.map((v) => `"${String(clean(v)).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EarningsReport({
  tasks, emps, payouts,
}: { tasks: Task[]; emps: Profile[]; payouts: Payout[] }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const rows = useMemo(() => {
    if (!month) return [];
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1).getTime();
    const end = new Date(y, m, 1).getTime();
    const inMonth = (d: string | null) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= start && t < end;
    };
    const sum = (n: number[]) => n.reduce((s, x) => s + x, 0);

    return emps
      .map((e) => {
        const monthTasks = tasks.filter(
          (t) => t.assigned_to === e.id && t.status === "approved" && inMonth(t.approved_at)
        );
        const earned = sum(monthTasks.map((t) => Number(t.price)));
        const paid = sum(
          payouts.filter((p) => p.employee_id === e.id && inMonth(p.paid_at)).map((p) => Number(p.amount))
        );
        const allEarned = sum(
          tasks.filter((t) => t.assigned_to === e.id && t.status === "approved").map((t) => Number(t.price))
        );
        const allPaid = sum(
          payouts.filter((p) => p.employee_id === e.id).map((p) => Number(p.amount))
        );
        return { e, monthTasks, earned, paid, owed: allEarned - allPaid };
      })
      .filter((r) => r.monthTasks.length > 0 || r.paid > 0 || r.owed > 0);
  }, [month, tasks, emps, payouts]);

  const totalEarned = rows.reduce((s, r) => s + r.earned, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalOwed = rows.reduce((s, r) => s + r.owed, 0);
  const lkr = (n: number) => n.toLocaleString();

  function exportSummary() {
    downloadCsv(`earnings-summary-${month}.csv`, [
      ["Employee", "Email", "Role", "Tasks approved", "Earned (LKR)", "Paid (LKR)", "Total owed now (LKR)"],
      ...rows.map((r) => [
        r.e.full_name ?? "", r.e.email ?? "", r.e.job_role,
        r.monthTasks.length, r.earned, r.paid, r.owed,
      ]),
      ["TOTAL", "", "", "", totalEarned, totalPaid, totalOwed],
    ]);
  }

  function exportDetails() {
    downloadCsv(`earnings-tasks-${month}.csv`, [
      ["Employee", "Role", "Task", "Price (LKR)", "Approved on"],
      ...rows.flatMap((r) =>
        r.monthTasks.map((t) => [
          r.e.full_name ?? "", r.e.job_role, t.title, Number(t.price),
          t.approved_at ? new Date(t.approved_at).toLocaleDateString("en-GB") : "",
        ])
      ),
    ]);
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Monthly earnings report</h2>
        <input
          type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-full border border-gray-300 bg-white px-4 py-1.5 outline-none focus:border-[#0000FF]" />
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-3">Employee</th>
              <th>Role</th>
              <th>Tasks approved</th>
              <th>Earned this month</th>
              <th>Paid this month</th>
              <th>Total owed now</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-gray-500">No activity in this month.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.e.id} className="border-b">
                <td className="p-3">{r.e.full_name}</td>
                <td>{r.e.job_role}</td>
                <td>{r.monthTasks.length}</td>
                <td>LKR {lkr(r.earned)}</td>
                <td>LKR {lkr(r.paid)}</td>
                <td className="font-bold text-[#0000FF]">LKR {lkr(r.owed)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold">
                <td className="p-3" colSpan={3}>Total</td>
                <td>LKR {lkr(totalEarned)}</td>
                <td>LKR {lkr(totalPaid)}</td>
                <td>LKR {lkr(totalOwed)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={exportSummary} disabled={rows.length === 0}
          className="rounded-full bg-[#0000FF] px-5 py-1.5 text-white hover:bg-black disabled:opacity-50">
          Download summary (CSV)
        </button>
        <button onClick={exportDetails} disabled={rows.length === 0}
          className="rounded-full border border-black px-5 py-1.5 hover:bg-black hover:text-white disabled:opacity-50">
          Download task details (CSV)
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        &quot;Earned&quot; counts tasks approved in the chosen month. &quot;Total owed now&quot; is everything
        approved minus everything paid so far, across all months.
      </p>
    </section>
  );
}
