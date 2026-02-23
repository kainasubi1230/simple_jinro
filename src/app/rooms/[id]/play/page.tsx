// app/rooms/[id]/play/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Player = { id: string; name: string; role: string; is_alive: boolean };

export default function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;
  const router = useRouter();

  const [me, setMe] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMyRole = async () => {
      // 🧠 さっき保存した自分のIDを金庫(LocalStorage)から取り出す
      const myPlayerId = localStorage.getItem("myPlayerId");
      
      if (!myPlayerId) {
        alert("プレイヤー情報が見つかりません。トップに戻ります。");
        router.push("/");
        return;
      }

      // データベースから自分の役職を取得する
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("id", myPlayerId)
        .single();

      if (error || !data) {
        console.error("役職の取得エラー:", error);
        router.push("/");
      } else {
        setMe(data); // 自分のデータをセット！
      }
      setIsLoading(false);
    };

    fetchMyRole();
  }, [roomId, router]);

  // 役職の英語名を、かっこいい日本語に変換する関数
  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case "werewolf": return "🐺 人狼";
      case "seer": return "🔮 占い師";
      case "villager": return "🧑‍🌾 市民";
      default: return "不明";
    }
  };

  if (isLoading) {
    return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">運命を決定中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-8">
      <div className="w-full max-w-md space-y-8 text-center">
        
        <h1 className="text-3xl font-bold text-red-500">ゲーム開始！</h1>
        
        {/* 役職発表カード */}
        <div className="bg-gray-800 rounded-xl p-8 shadow-lg border border-gray-700">
          <p className="text-gray-400 mb-2">{me?.name} さんの役職は...</p>
          <h2 className="text-4xl font-extrabold my-6 text-yellow-400 drop-shadow-lg">
            {getRoleDisplayName(me?.role || "")}
          </h2>
          <p className="text-sm text-red-400 font-bold mt-4">
            ⚠️ 絶対に他の人に画面を見せないでください！
          </p>
        </div>

        <div className="pt-8">
          <p className="text-gray-400 animate-pulse">現在は【昼】の議論時間です...</p>
        </div>

      </div>
    </div>
  );
}