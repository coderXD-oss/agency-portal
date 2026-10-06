"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace("/login");
      const { data: p } = await supabase
        .from("profiles").select("is_admin").eq("id", user.id).single();
      router.replace(p?.is_admin ? "/admin" : "/dashboard");
    })();
  }, [router]);
  return <p className="p-8">Loading…</p>;
}