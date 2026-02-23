// app/rooms/[id]/play/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

// 型定義
type Player = { id: string; name: string; role: string; is_alive: boolean; is_host: boolean; };
type Room = { id: string; status: string; phase: string; day_count: number; };

export default function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;
  const router = useRouter();

  const [me, setMe] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  
  // ⏱️ タイマー（初期値は180秒＝3分）
  const [timeLeft, setTimeLeft] = useState(180); 
  
  // 🗳️ 投票用のステート
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);

  useEffect(() => {
    const init = async () => {
      const myPlayerId = localStorage.getItem("myPlayerId");
      if (!myPlayerId) {
        alert("プレイヤー情報がありません");
        router.push("/");
        return;
      }

      // 自分の情報を取得
      const { data: myData } = await supabase.from("players").select("*").eq("id", myPlayerId).single();
      if (myData) setMe(myData);

      // 部屋の情報を取得
      const { data: roomData } = await supabase.from("rooms").select("*").eq("id", roomId).single();
      if (roomData) setRoom(roomData);

      // 全プレイヤーの情報を取得
      const { data: playersData } = await supabase.from("players").select("*").eq("room_id", roomId);
      if (playersData) setPlayers(playersData);

      setIsLoading(false);
    };
    init();

    // 📡 リアルタイム検知（ホストがフェーズを変えたら全員の画面を切り替える）
    const channel = supabase
      .channel(`play_${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          setRoom(payload.new as Room); // 部屋の情報（phaseなど）を最新にする
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId, router]);

  // ⏱️ タイマーのカウントダウン処理（昼のフェーズのみ動く）
  useEffect(() => {
    if (room?.phase === "day" && timeLeft > 0) {
      const timerId = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
      return () => clearInterval(timerId);
    }
  }, [room?.phase, timeLeft]);

  // 👑 ホスト用：議論を強制終了して「投票フェーズ」へ進む
  const handleProceedToVote = async () => {
    if (!confirm("議論を終了して、投票フェーズに進みますか？")) return;
    // データベースのphaseを「vote(投票)」に更新！
    await supabase.from("rooms").update({ phase: "vote" }).eq("id", roomId);
  };

  // 🗳️ 投票ボタンを押した時の処理
  const handleVote = async () => {
    if (!selectedTarget || !me || !room) return;
    
    try {
      // actions（行動履歴）テーブルに「誰が誰に投票したか」を保存する
      const { error } = await supabase.from("actions").insert([{
        room_id: roomId,
        day_count: room.day_count,
        phase: "vote",
        actor_id: me.id,
        target_id: selectedTarget,
        action_type: "vote"
      }]);

      if (error) throw error;
      
      setHasVoted(true); // 自分の画面を「投票完了」にする
    } catch (error) {
      console.error(error);
      alert("投票に失敗しました。");
    }
  };

  if (isLoading || !me || !room) {
    return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">読み込み中...</div>;
  }

  // 生きている「自分以外」のプレイヤーをリストアップ（投票先の候補）
  const aliveOtherPlayers = players.filter(p => p.is_alive && p.id !== me.id);

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case "werewolf": return "🐺 人狼";
      case "seer": return "🔮 占い師";
      case "villager": return "🧑‍🌾 市民";
      default: return "不明";
    }
  };

  // 秒数を「分：秒」の形式にする関数
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-8">
      <div className="w-full max-w-md space-y-6">
        
        {/* 上部ステータスバー（自分の役職と現在のフェーズ） */}
        <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg shadow border border-gray-700">
          <div>
            <p className="text-xs text-gray-400">あなたの役職</p>
            <p className="font-bold text-yellow-400">{getRoleDisplayName(me.role)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">{room.day_count}日目</p>
            <p className="font-bold text-red-400">
              {room.phase === "day" ? "☀️ 昼 (議論)" : room.phase === "vote" ? "🌇 夕方 (投票)" : "🌙 夜 (行動)"}
            </p>
          </div>
        </div>

        {/* =========================================================
            ☀️ 昼のフェーズ（タイマーと議論） 
        ========================================================= */}
        {room.phase === "day" && (
          <div className="bg-gray-800 rounded-xl p-8 text-center space-y-6 border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-bold text-yellow-100">話し合いの時間です</h2>
            <div className="text-6xl font-mono text-white drop-shadow-md">
              {formatTime(timeLeft)}
            </div>
            <p className="text-gray-400 text-sm">怪しい人を探してリアルで議論しましょう！</p>
            
            {/* ホストだけに表示されるボタン */}
            {me.is_host ? (
              <button
                onClick={handleProceedToVote}
                className="w-full mt-4 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded shadow-lg transition"
              >
                議論を終了して「投票」へ進む
              </button>
            ) : (
              <div className="mt-4 p-4 border border-gray-600 rounded text-gray-400 text-sm">
                ホストが投票を開始するのを待っています...
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            🌇 投票フェーズ 
        ========================================================= */}
        {room.phase === "vote" && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg space-y-4">
            <h2 className="text-xl font-bold text-center text-red-400 mb-4">処刑する人を選んでください</h2>
            
            {hasVoted ? (
              <div className="text-center py-10 text-gray-300">
                <p className="text-xl font-bold text-green-400 mb-2">投票完了！</p>
                <p className="text-sm">他の人が投票し終わるのを待っています...</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {aliveOtherPlayers.map(p => (
                    <label
                      key={p.id}
                      className={`flex items-center p-4 rounded-lg border cursor-pointer transition ${
                        selectedTarget === p.id 
                          ? "bg-red-900 border-red-500" 
                          : "bg-gray-700 border-gray-600 hover:bg-gray-600"
                      }`}
                    >
                      <input
                        type="radio"
                        name="voteTarget"
                        value={p.id}
                        checked={selectedTarget === p.id}
                        onChange={() => setSelectedTarget(p.id)}
                        className="hidden"
                      />
                      <span className="font-medium text-lg">{p.name}</span>
                    </label>
                  ))}
                </div>
                <button
                  onClick={handleVote}
                  disabled={!selectedTarget}
                  className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                >
                  この人に投票する
                </button>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}