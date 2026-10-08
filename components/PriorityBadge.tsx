const styles: Record<string, string> = {
  urgent: "bg-red-600 text-white",
  high: "bg-black text-white",
  medium: "bg-blue-100 text-[#0000FF]",
  low: "bg-gray-200 text-gray-700",
};

export default function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[priority] ?? styles.medium}`}>
      {priority}
    </span>
  );
}
