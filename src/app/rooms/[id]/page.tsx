// app/rooms/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Player = { id: string; name: string; is_host: boolean; };
type Room = { 
  id: string; 
  status: string; 
  phase: string; 
  day_count: number; 
  wolf_count: number;
  seer_count: number;
  medium_count: number;
  hunter_count: number;
  fox_count: number;
  baker_count: number;
  teruteru_count: number;
  last_victims: string | null;
  teruteru_won: boolean;
};

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;
  const router = useRouter();

  const [players, setPlayers] = useState<Player[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);

  useEffect(() => {
    // ① 自分のIDをスマホの金庫(LocalStorage)から取り出す
    const pid = localStorage.getItem("myPlayerId");
    setMyPlayerId(pid);

    const fetchRoom = async () => {
      const { data } = await supabase.from("rooms").select("*").eq("id", roomId).single();
      if (data) {
        setRoom(data);
        if (data.status === "playing") router.push(`/rooms/${roomId}/play`);
      } else {
        // 💡 参加しようとした部屋がすでに無かった場合
        alert("この部屋はすでに解散されています。");
        router.push("/");
      }
    };
    fetchRoom();

    const fetchPlayers = async () => {
      const { data } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      if (data) setPlayers(data);
    };
    fetchPlayers();

    const channel = supabase
      .channel(`room_${roomId}`)
      // 🔥 変更点1: INSERTだけでなく DELETE(誰かが抜けた時) も検知してリストを更新する "*" に変更！
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        () => fetchPlayers()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.new.status === "playing") {
            router.push(`/rooms/${roomId}/play`);
          }
        }
      )
      // 🔥 変更点2: ホストが部屋を削除（解散）した時のリアルタイム検知！
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        () => {
          alert("ホストが部屋を解散しました。トップに戻ります。");
          router.push("/");
        }
      )
      .subscribe();

    // 💡 変更点3: 誤ってタブを閉じようとした時の警告を出す（ブラウザ標準の機能）
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // これを書くとブラウザが「サイトを離れますか？」と聞いてくれる
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => { 
      supabase.removeChannel(channel); 
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [roomId, router]);

  // 🚪 退出・解散ボタンを押した時の処理
  const handleLeaveRoom = async () => {
    if (!myPlayerId) return;
    const isHost = players.find((p) => p.id === myPlayerId)?.is_host;

    const confirmMessage = isHost 
      ? "本当に部屋を解散しますか？全員がトップに戻されます。" 
      : "本当に部屋を退出しますか？";
      
    if (!confirm(confirmMessage)) return; // キャンセルしたら何もしない

    if (isHost) {
      // ホスト：部屋のデータを丸ごと消す！ (playersのデータも一緒に自動で消えます)
      await supabase.from("rooms").delete().eq("id", roomId);
      // ※削除が完了すると、上のDELETE検知が走って全員トップへ強制送還されます
    } else {
      // 参加者：自分のデータだけを消す
      await supabase.from("players").delete().eq("id", myPlayerId);
      router.push("/");
    }
  };

  // 🎲 ゲーム開始ボタンを押した時の処理
  const handleStartGame = async () => {
    if (!room) return;
    const totalRoles = room.wolf_count + room.seer_count + room.medium_count + room.hunter_count + room.fox_count + room.baker_count + room.teruteru_count;
    
    if (players.length <= totalRoles) {
      alert(`参加者が足りません！人狼(${room.wolf_count}人)と占い師(${room.seer_count}人)の合計より多くの参加者が必要です。`);
      return;
    }

    setIsStarting(true);

    try {
      const shuffled = [...players].sort(() => Math.random() - 0.5);
      const updates = shuffled.map((player, index) => {
        let role = "villager";
        let count = 0;
  
        if (index < (count += room.wolf_count)) role = "werewolf";
        else if (index < (count += room.seer_count)) role = "seer";
        else if (index < (count += room.medium_count)) role = "medium";
        else if (index < (count += room.hunter_count)) role = "hunter";
        else if (index < (count += room.fox_count)) role = "fox";
        else if (index < (count += room.baker_count)) role = "baker";
        else if (index < (count += room.teruteru_count)) role = "teruteru";
  
        return { id: player.id, role };
    });

      for (const update of updates) {
        await supabase.from("players").update({ role: update.role }).eq("id", update.id);
      }
      await supabase.from("rooms").update({ status: "playing" }).eq("id", roomId);

    } catch (error) {
      console.error(error);
      alert("ゲームの開始に失敗しました。");
      setIsStarting(false);
    }
  };

  // 自分がホストかどうかを判定（ボタンの表示切り替えに使う）
  const isHost = players.find((p) => p.id === myPlayerId)?.is_host;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-8">
      <div className="w-full max-w-md space-y-8">
        
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-red-500">待機部屋</h1>
          <p className="text-gray-400">みんなにこのルームIDを教えてね👇</p>
          <div className="bg-gray-800 p-3 rounded font-mono text-center break-all select-all border border-gray-700">
            {roomId}
          </div>
          {room && (
            <p className="text-sm text-gray-400 mt-2">
              設定: 人狼 {room.wolf_count}人 / 占い師 {room.seer_count}人
            </p>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700">
          <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2">
            参加者 ({players.length}人)
          </h2>
          <ul className="space-y-3">
            {players.map((player) => (
              <li key={player.id} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                <span className="font-medium">{player.name}</span>
                {player.is_host && (
                  <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full font-bold">ホスト</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* ボタンエリア */}
        <div className="pt-4 space-y-4">
          
          {/* ホストなら「開始ボタン」、参加者なら「待機メッセージ」を表示 */}
          {isHost ? (
            <button
              onClick={handleStartGame}
              disabled={isStarting}
              className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded shadow-lg transition disabled:opacity-50"
            >
              {isStarting ? "役職を配布中..." : "ゲームを開始する！"}
            </button>
          ) : (
            <div className="w-full py-4 bg-gray-700 text-gray-300 font-bold rounded text-center border border-gray-600 shadow-inner">
              ホストが開始するのを待っています...
            </div>
          )}

          {/* 退出・解散ボタン */}
          <button
            onClick={handleLeaveRoom}
            className="w-full py-3 border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white font-bold rounded transition"
          >
            {isHost ? "部屋を解散してトップに戻る" : "部屋を退出する"}
          </button>
        </div>

      </div>
    </div>
  );
}