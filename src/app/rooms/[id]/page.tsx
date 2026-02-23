// app/rooms/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

// プレイヤーの型定義（TypeScript用）
type Player = {
  id: string;
  name: string;
  is_host: boolean;
};

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;
  const router = useRouter();

  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    // ① 最初に参加者一覧をデータベースから取得する
    const fetchPlayers = async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true }); // 参加した順に並べる

      if (error) {
        console.error("プレイヤー取得エラー:", error);
      } else if (data) {
        setPlayers(data);
      }
    };

    fetchPlayers();

    // ② リアルタイム通信（誰かが入ってきたら自動更新する設定）
    const channel = supabase
      .channel(`room_${roomId}`)
      .on(
        "postgres_changes",
        { 
          event: "INSERT", // 新しいデータが追加された時
          schema: "public", 
          table: "players", 
          filter: `room_id=eq.${roomId}` // この部屋のデータだけを監視
        },
        () => {
          // 変更を検知したら、もう一度リストを取得し直す
          fetchPlayers();
        }
      )
      .subscribe();

    // ③ ページを離れたらリアルタイム通信を解除する（お作法）
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-8">
      <div className="w-full max-w-md space-y-8">
        
        {/* ヘッダー部分 */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-red-500">待機部屋</h1>
          <p className="text-gray-400">みんなにこのルームIDを教えてね👇</p>
          <div className="bg-gray-800 p-3 rounded font-mono text-center break-all select-all border border-gray-700">
            {roomId}
          </div>
        </div>

        {/* 参加者リスト */}
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700">
          <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2">
            参加者 ({players.length}人)
          </h2>
          <ul className="space-y-3">
            {players.map((player) => (
              <li key={player.id} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                <span className="font-medium">{player.name}</span>
                {player.is_host && (
                  <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full font-bold">
                    ホスト
                  </span>
                )}
              </li>
            ))}
          </ul>
          
          {players.length === 0 && (
            <p className="text-gray-400 text-center py-4">参加者を待っています...</p>
          )}
        </div>

        {/* 今後のゲーム開始ボタンを置く場所 */}
        <div className="pt-4">
            <button className="w-full py-4 bg-gray-600 text-gray-300 font-bold rounded cursor-not-allowed">
              ゲームを開始する (準備中...)
            </button>
        </div>

      </div>
    </div>
  );
}