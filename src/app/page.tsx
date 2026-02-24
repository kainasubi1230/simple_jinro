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

  // 🎭 全役職の人数設定用ステート
  const [wolfCount, setWolfCount] = useState(1);
  const [seerCount, setSeerCount] = useState(0);
  const [mediumCount, setMediumCount] = useState(0);
  const [hunterCount, setHunterCount] = useState(0);
  const [foxCount, setFoxCount] = useState(0);
  const [bakerCount, setBakerCount] = useState(0);
  const [teruteruCount, setTeruteruCount] = useState(0);

  // 🚪 部屋を新しく作る
  const handleCreateRoom = async () => {
    if (!name) return alert("名前を入力しろyeah");
    setIsLoading(true);

    try {
      // roomsテーブルに全役職の人数を保存して作成
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .insert([
          {
            status: "waiting",
            phase: "day",
            day_count: 1,
            wolf_count: wolfCount,
            seer_count: seerCount,
            medium_count: mediumCount,
            hunter_count: hunterCount,
            fox_count: foxCount,
            baker_count: bakerCount,
            teruteru_count: teruteruCount,
          },
        ])
        .select()
        .single();

      if (roomError) throw roomError;

      // 自分のプレイヤーデータをホストとして登録
      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .insert([{ room_id: roomData.id, name: name, is_host: true }])
        .select()
        .single();

      if (playerError) throw playerError;

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
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, status")
        .eq("id", joinRoomId)
        .single();

      if (roomError || !roomData) {
        setIsLoading(false);
        return alert("部屋が見つかりません。ルームIDを確認してください。");
      }

      if (roomData.status !== "waiting") {
        setIsLoading(false);
        return alert(
          "この部屋はすでにゲームが開始されているため、途中参加できません🙅‍♂️",
        );
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

  // ＋－ボタンを作るための便利関数
  const CounterRow = ({
    label,
    count,
    setter,
    min,
    color,
  }: {
    label: string;
    count: number;
    setter: (n: number) => void;
    min: number;
    color: string;
  }) => (
    <div className="flex items-center justify-between py-1">
      <span className={`${color} font-medium`}>{label}</span>
      <div className="flex items-center space-x-3">
        <button
          onClick={() => setter(Math.max(min, count - 1))}
          className="bg-gray-600 w-8 h-8 rounded-full font-bold hover:bg-gray-500 text-white"
        >
          -
        </button>
        <span className="w-4 text-center">{count}</span>
        <button
          onClick={() => setter(count + 1)}
          className="bg-gray-600 w-8 h-8 rounded-full font-bold hover:bg-gray-500 text-white"
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4 py-10">
      <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-8 space-y-8">
        <h1 className="text-3xl font-bold text-center text-red-500">
          簡易 人狼ゲーム
        </h1>

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

        {/* 🎭 役職設定エリア（ホストのみ） */}
        <div className="space-y-2 bg-gray-700 p-4 rounded-lg">
          <p className="text-sm text-gray-300 font-bold mb-3 border-b border-gray-600 pb-2">
            配役の設定（部屋を作る人）
          </p>

          <CounterRow
            label="🐺 人狼"
            count={wolfCount}
            setter={setWolfCount}
            min={1}
            color="text-red-400"
          />
          <CounterRow
            label="🔮 占い師"
            count={seerCount}
            setter={setSeerCount}
            min={0}
            color="text-blue-400"
          />
          <CounterRow
            label="👻 霊媒師"
            count={mediumCount}
            setter={setMediumCount}
            min={0}
            color="text-purple-400"
          />
          <CounterRow
            label="🛡️ 狩人"
            count={hunterCount}
            setter={setHunterCount}
            min={0}
            color="text-green-400"
          />
          <CounterRow
            label="🦊 妖狐"
            count={foxCount}
            setter={setFoxCount}
            min={0}
            color="text-pink-400"
          />
          <CounterRow
            label="🍞 パン屋"
            count={bakerCount}
            setter={setBakerCount}
            min={0}
            color="text-yellow-400"
          />
          <CounterRow
            label="☔ てるてる坊主"
            count={teruteruCount}
            setter={setTeruteruCount}
            min={0}
            color="text-gray-300"
          />

          <p className="text-xs text-gray-400 mt-4 pt-2 border-t border-gray-600">
            ※残りの人数は自動的に「🧑‍🌾 市民」になります。
          </p>
        </div>

        {/* 部屋を作るボタン */}
        <button
          onClick={handleCreateRoom}
          disabled={isLoading}
          className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded transition disabled:opacity-50"
        >
          {isLoading ? "処理中..." : "配役を決定して部屋を作る"}
        </button>

        <div className="text-center text-gray-400 text-sm">または</div>

        {/* 部屋に参加するエリア */}
        <div className="space-y-4">
          <input
            type="text"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            className="w-full p-3 rounded bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="ルームIDを入力して参加"
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
