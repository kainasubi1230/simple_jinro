
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase"; // 作成したファイルの場所に合わせて調整してください

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // 🚪 部屋を新しく作る（ホストになる）
  const handleCreateRoom = async () => {
    if (!name) return alert("名前を入力してください");
    setIsLoading(true);

    try {
      // 1. roomsテーブルに新しい部屋を作成
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .insert([{ status: "waiting", phase: "day", day_count: 1 }])
        .select()
        .single();

      if (roomError) throw roomError;

      // 2. playersテーブルに自分を「ホスト」として登録
      const { error: playerError } = await supabase
        .from("players")
        .insert([{ 
          room_id: roomData.id, 
          name: name, 
          is_host: true 
        }]);

      if (playerError) throw playerError;

      // 3. 待機部屋へ移動
      router.push(`/rooms/${roomData.id}`);
    } catch (error) {
      console.error(error);
      alert("部屋の作成に失敗しました");
      setIsLoading(false);
    }
  };

  // 🤝 既存の部屋に参加する
  const handleJoinRoom = async () => {
    if (!name || !joinRoomId) return alert("名前とルームIDを入力してください");
    setIsLoading(true);

    try {
      // 1. 部屋が存在するか確認
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id")
        .eq("id", joinRoomId)
        .single();

      if (roomError || !roomData) throw new Error("部屋が見つかりません");

      // 2. playersテーブルに自分を登録（ホストではない）
      const { error: playerError } = await supabase
        .from("players")
        .insert([{ 
          room_id: roomData.id, 
          name: name, 
          is_host: false 
        }]);

      if (playerError) throw playerError;

      // 3. 待機部屋へ移動
      router.push(`/rooms/${roomData.id}`);
    } catch (error) {
      console.error(error);
      alert("参加に失敗しました。ルームIDを確認してください");
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
      <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-8 space-y-8">
        <h1 className="text-3xl font-bold text-center text-red-500">簡易 人狼ゲーム</h1>

        {/* 名前入力エリア */}
        <div className="space-y-2">
          <label className="text-sm text-gray-400">あなたの名前</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-3 rounded bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="例: 村人A"
          />
        </div>

        <hr className="border-gray-600" />

        {/* 部屋を作るボタン */}
        <button
          onClick={handleCreateRoom}
          disabled={isLoading}
          className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded transition disabled:opacity-50"
        >
          {isLoading ? "処理中..." : "新しく部屋を作る"}
        </button>

        <div className="text-center text-gray-400 text-sm">または</div>

        {/* 部屋に参加するエリア */}
        <div className="space-y-4">
          <input
            type="text"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            className="w-full p-3 rounded bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="ルームIDを入力"
          />
          <button
            onClick={handleJoinRoom}
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded transition disabled:opacity-50"
          >
            {isLoading ? "処理中..." : "部屋に参加する"}
          </button>
        </div>
      </div>
    </main>
  );
}