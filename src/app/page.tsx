// app/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [wolfCount, setWolfCount] = useState(1);
  const [seerCount, setSeerCount] = useState(0);

  // 🚪 部屋を新しく作る
  const handleCreateRoom = async () => {
    if (!name) return alert("名前を入力してください");
    setIsLoading(true);

    try {
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .insert([{ status: "waiting", phase: "day", day_count: 1, wolf_count: wolfCount, seer_count: seerCount }])
        .select()
        .single();
      if (roomError) throw roomError;

      // 🔥 修正ポイント: select().single() を追加して、登録した自分のデータを受け取る
      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .insert([{ room_id: roomData.id, name: name, is_host: true }])
        .select()
        .single();
      if (playerError) throw playerError;

      // 🧠 スマホのLocalStorageに自分のIDを記憶させる！
      localStorage.setItem("myPlayerId", playerData.id);

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
      // 💡 変更点1: idだけでなく「status（現在の状態）」も一緒に取得する
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, status")
        .eq("id", joinRoomId)
        .single();

      if (roomError || !roomData) {
        setIsLoading(false);
        return alert("部屋が見つかりません。ルームIDを確認してください。");
      }

      // 🔥 変更点2: ゲームがすでに始まっていたらブロックする！
      if (roomData.status !== "waiting") {
        setIsLoading(false);
        return alert("この部屋はすでにゲームが開始されているため、途中参加できません🙅‍♂️");
      }

      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .insert([{ room_id: roomData.id, name: name, is_host: false }])
        .select()
        .single();

      if (playerError) throw playerError;

      localStorage.setItem("myPlayerId", playerData.id);

      router.push(`/rooms/${roomData.id}`);
    } catch (error) {
      console.error(error);
      alert("参加に失敗しました。");
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
      <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-8 space-y-8">
        <h1 className="text-3xl font-bold text-center text-red-500">簡易 人狼ゲーム</h1>

        <div className="space-y-2">
          <label className="text-sm text-gray-400">あなたの名前</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-3 rounded bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="例: 村人A" />
        </div>

        <hr className="border-gray-600" />

        <div className="space-y-4 bg-gray-700 p-4 rounded-lg">
          <p className="text-sm text-gray-300 font-bold mb-2">配役の設定（部屋を作る人）</p>
          <div className="flex items-center justify-between">
            <span className="text-red-400 font-medium">人狼の数</span>
            <div className="flex items-center space-x-3">
              <button onClick={() => setWolfCount(Math.max(1, wolfCount - 1))} className="bg-gray-600 w-8 h-8 rounded-full font-bold hover:bg-gray-500">-</button>
              <span className="w-4 text-center">{wolfCount}</span>
              <button onClick={() => setWolfCount(wolfCount + 1)} className="bg-gray-600 w-8 h-8 rounded-full font-bold hover:bg-gray-500">+</button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-blue-400 font-medium">占い師の数</span>
            <div className="flex items-center space-x-3">
              <button onClick={() => setSeerCount(Math.max(0, seerCount - 1))} className="bg-gray-600 w-8 h-8 rounded-full font-bold hover:bg-gray-500">-</button>
              <span className="w-4 text-center">{seerCount}</span>
              <button onClick={() => setSeerCount(seerCount + 1)} className="bg-gray-600 w-8 h-8 rounded-full font-bold hover:bg-gray-500">+</button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">※残りの人数は自動的に「市民」になります。</p>
        </div>

        <button onClick={handleCreateRoom} disabled={isLoading} className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded transition disabled:opacity-50">
          {isLoading ? "処理中..." : "配役を決定して部屋を作る"}
        </button>

        <div className="text-center text-gray-400 text-sm">または</div>

        <div className="space-y-4">
          <input type="text" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} className="w-full p-3 rounded bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="ルームIDを入力して参加" />
          <button onClick={handleJoinRoom} disabled={isLoading} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded transition disabled:opacity-50">
            {isLoading ? "処理中..." : "部屋に参加する"}
          </button>
        </div>
      </div>
    </main>
  );
}