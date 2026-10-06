export type Task = {
  id: string;
  title: string;
  description: string | null;
  requirements: string | null;
  price: number;
  deadline: string | null;
  required_role: string | null;
  mode: "open" | "direct";
  status: "open" | "taken" | "in_progress" | "submitted" | "approved" | "rejected";
  assigned_to: string | null;
  submission_url: string | null;
  submission_notes: string | null;
  admin_feedback: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  job_role: string;
  is_admin: boolean;
  is_active: boolean;
};

export const ROLES = [
  "Graphic Designer",
  "Video Editor",
  "Content Writer",
  "Social Media Manager",
  "Digital Marketer",
  "Other",
];