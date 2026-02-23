// app/rooms/[id]/play/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Player = { id: string; name: string; role: string; is_alive: boolean; is_host: boolean; };
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
type Message = { id: string; player_id: string; content: string; };

export default function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;
  const router = useRouter();

  const [me, setMe] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(180); 

  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [hasActed, setHasActed] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");

  useEffect(() => {
    // ... （初期化処理：前回と同じなので省略せずそのまま使います）
    const init = async () => {
      const myPlayerId = localStorage.getItem("myPlayerId");
      if (!myPlayerId) return router.push("/");
      
      const { data: myData } = await supabase.from("players").select("*").eq("id", myPlayerId).single();
      if (myData) setMe(myData);

      const fetchAll = async () => {
        const { data: roomData } = await supabase.from("rooms").select("*").eq("id", roomId).single();
        if (roomData) setRoom(roomData);
        const { data: playersData } = await supabase.from("players").select("*").eq("room_id", roomId);
        if (playersData) setPlayers(playersData);
      };

      const fetchMessages = async () => {
        const { data } = await supabase.from("messages").select("*").eq("room_id", roomId).order("created_at", { ascending: true });
        if (data) setMessages(data);
      };

      await fetchAll(); await fetchMessages(); setIsLoading(false);

      const channel = supabase.channel(`play_${roomId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, 
          (payload) => { setRoom(payload.new as Room); setHasActed(false); setSelectedTarget(null); }
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => fetchAll())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
          (payload) => setMessages((prev) => [...prev, payload.new as Message])
        ).subscribe();

      return () => { supabase.removeChannel(channel); };
    };
    init();
  }, [roomId, router]);

  useEffect(() => {
    if (room?.phase === "day" && timeLeft > 0) {
      const timerId = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
      return () => clearInterval(timerId);
    }
  }, [room?.phase, timeLeft]);

  // ==========================================
  // 👑 GM（ホスト）の進行ロジック
  // ==========================================
  const handleProceedToVote = async () => {
    if (!confirm("議論を終了して投票に進みますか？")) return;
    await supabase.from("rooms").update({ phase: "vote" }).eq("id", roomId);
  };

  // 🌇 処刑の実行（てるてる坊主の判定もここ）
  const handleExecute = async () => {
    if (!confirm("投票を締め切りますか？")) return;
    const { data: votes } = await supabase.from("actions").select("*").eq("room_id", roomId).eq("day_count", room!.day_count).eq("phase", "vote");
    
    let victimId = null;
    if (votes && votes.length > 0) {
      const voteCounts: Record<string, number> = {};
      votes.forEach(v => { voteCounts[v.target_id] = (voteCounts[v.target_id] || 0) + 1; });
      let maxVotes = 0;
      for (const [targetId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) { maxVotes = count; victimId = targetId; } 
        else if (count === maxVotes && Math.random() > 0.5) victimId = targetId;
      }
    }

    if (victimId) {
      const victim = players.find(p => p.id === victimId);
      await supabase.from("players").update({ is_alive: false }).eq("id", victimId);
      // てるてる坊主が処刑されたら勝利フラグON！
      if (victim?.role === "teruteru") {
        await supabase.from("rooms").update({ teruteru_won: true }).eq("id", roomId);
      }
    }
    await checkWinOrNextPhase("night");
  };

  // ☀️ 朝にする（襲撃・護衛・呪殺の全処理）
  const handleExecuteMorning = async () => {
    if (!confirm("朝にしますか？夜の行動が処理されます。")) return;
    const { data: actions } = await supabase.from("actions").select("*").eq("room_id", roomId).eq("day_count", room!.day_count).eq("phase", "night");

    const guardAction = actions?.find(a => a.action_type === "guard");
    const guardedId = guardAction ? guardAction.target_id : null;

    const seeAction = actions?.find(a => a.action_type === "see");
    const seerTargetId = seeAction ? seeAction.target_id : null;

    let wolfTargetId = null;
    const attacks = actions?.filter(a => a.action_type === "attack") || [];
    if (attacks.length > 0) {
      const attackCounts: Record<string, number> = {};
      attacks.forEach(v => { attackCounts[v.target_id] = (attackCounts[v.target_id] || 0) + 1; });
      let maxVotes = 0;
      for (const [targetId, count] of Object.entries(attackCounts)) {
        if (count > maxVotes) { maxVotes = count; wolfTargetId = targetId; }
        else if (count === maxVotes && Math.random() > 0.5) wolfTargetId = targetId;
      }
    }

    let victimIds: string[] = [];

    // 1. 人狼の襲撃判定
    if (wolfTargetId) {
      const targetPlayer = players.find(p => p.id === wolfTargetId);
      if (wolfTargetId === guardedId) { /* 護衛成功：死なない */ }
      else if (targetPlayer?.role === "fox") { /* 妖狐：噛まれても死なない */ }
      else { victimIds.push(wolfTargetId); }
    }

    // 2. 占い師の呪殺判定（対象が妖狐なら死亡）
    if (seerTargetId) {
      const targetPlayer = players.find(p => p.id === seerTargetId);
      if (targetPlayer?.role === "fox" && !victimIds.includes(seerTargetId)) {
        victimIds.push(seerTargetId);
      }
    }

    // DB更新
    const victimNames = victimIds.map(id => players.find(p => p.id === id)?.name).join(" と ");
    const lastVictimsText = victimIds.length > 0 ? victimNames : "なし";

    if (victimIds.length > 0) {
      for (const vId of victimIds) {
        await supabase.from("players").update({ is_alive: false }).eq("id", vId);
      }
    }

    await supabase.from("rooms").update({ last_victims: lastVictimsText }).eq("id", roomId);
    await checkWinOrNextPhase("day");
  };

  // 🏆 勝敗判定
  const checkWinOrNextPhase = async (nextPhase: string) => {
    const { data: currentPlayers } = await supabase.from("players").select("*").eq("room_id", roomId).eq("is_alive", true);
    if (!currentPlayers) return;

    const wolfCount = currentPlayers.filter(p => p.role === "werewolf").length;
    const humanCount = currentPlayers.length - wolfCount;
    const foxAlive = currentPlayers.some(p => p.role === "fox");

    let newStatus = room!.status;
    let newPhase = nextPhase;

    if (wolfCount === 0) {
      newStatus = "finished";
      newPhase = foxAlive ? "fox_win" : "human_win"; // 妖狐が生きていれば妖狐の横取り勝利
    } else if (wolfCount >= humanCount) {
      newStatus = "finished";
      newPhase = foxAlive ? "fox_win" : "wolf_win";
    }

    await supabase.from("rooms").update({ status: newStatus, phase: newPhase, day_count: nextPhase === "day" ? room!.day_count + 1 : room!.day_count }).eq("id", roomId);
    if (nextPhase === "day" && newStatus !== "finished") setTimeLeft(180);
  };

  // ==========================================
  // 🧑‍🌾 個人のアクション処理
  // ==========================================
  const handleAction = async (actionType: string) => {
    if (!selectedTarget || !me || !room) return;
    try {
      await supabase.from("actions").insert([{ room_id: roomId, day_count: room.day_count, phase: room.phase, actor_id: me.id, target_id: selectedTarget, action_type: actionType }]);
      setHasActed(true);

      const target = players.find(p => p.id === selectedTarget);
      if (actionType === "see") {
        // 占い：妖狐は「市民」と出る
        const isWolf = target?.role === "werewolf";
        alert(`🔮占い結果: ${target?.name} は【${isWolf ? "人狼" : "市民陣営"}】です。`);
      } else if (actionType === "medium") {
        // 霊媒：妖狐は「市民」と出る
        const isWolf = target?.role === "werewolf";
        alert(`👻霊媒結果: ${target?.name} は【${isWolf ? "人狼" : "市民陣営"}】でした。`);
      }
    } catch (error) { console.error(error); }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !me) return;
    await supabase.from("messages").insert([{ room_id: roomId, player_id: me.id, content: chatInput }]);
    setChatInput("");
  };

  if (isLoading || !me || !room) return <div>読み込み中...</div>;

  const aliveOtherPlayers = players.filter(p => p.is_alive && p.id !== me.id);
  const deadPlayers = players.filter(p => !p.is_alive);
  const isBakerAlive = players.some(p => p.role === "baker" && p.is_alive);

  const getRoleName = (r: string) => {
    const roles: Record<string, string> = { werewolf: "🐺 人狼", seer: "🔮 占い師", villager: "🧑‍🌾 市民", medium: "👻 霊媒師", hunter: "🛡️ 狩人", fox: "🦊 妖狐", baker: "🍞 パン屋", teruteru: "☔ てるてる坊主" };
    return roles[r] || r;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-8 pb-32">
      <div className="w-full max-w-md space-y-6">
        
        {/* ヘッダー */}
        <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg shadow border border-gray-700">
          <div>
            <p className="text-xs text-gray-400">あなたの役職</p>
            <p className="font-bold text-yellow-400">{getRoleName(me.role)} {!me.is_alive && " (死亡)"}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">{room.day_count}日目</p>
            <p className="font-bold text-red-400">{room.phase === "day" ? "☀️ 昼" : room.phase === "vote" ? "🌇 投票" : room.phase === "night" ? "🌙 夜" : "🏁 終了"}</p>
          </div>
        </div>

        {/* 🏆 終了画面 */}
        {room.status === "finished" && (
          <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700 shadow-lg">
            <h2 className="text-3xl font-bold mb-4">
              {room.phase === "human_win" ? "🎉 村人陣営の勝利！" : room.phase === "wolf_win" ? "🐺 人狼陣営の勝利！" : "🦊 妖狐の勝利！(横取り)"}
            </h2>
            {room.teruteru_won && (
              <p className="text-xl text-blue-400 font-bold mt-4 animate-bounce">☔ てるてる坊主も追加勝利！</p>
            )}
            <button onClick={() => router.push("/")} className="w-full py-4 bg-gray-600 text-white font-bold rounded mt-8">トップに戻る</button>
          </div>
        )}

        {/* ☀️ 昼のフェーズ */}
        {me.is_alive && room.status !== "finished" && room.phase === "day" && (
          <div className="bg-gray-800 rounded-xl p-8 text-center space-y-4 border border-gray-700 shadow-lg">
            {room.day_count > 1 && (
              <div className="bg-gray-900 p-4 rounded mb-4">
                <p className="text-sm text-gray-400">昨晩の犠牲者</p>
                <p className="text-xl font-bold text-red-400">{room.last_victims}</p>
              </div>
            )}
            {isBakerAlive && room.day_count > 1 && (
              <p className="text-yellow-300 font-bold bg-yellow-900/50 py-2 rounded">🥐 おいしいパンが配られました</p>
            )}
            <div className="text-6xl font-mono">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}</div>
            {me.is_host && <button onClick={handleProceedToVote} className="w-full mt-4 py-4 bg-red-600 text-white font-bold rounded">議論を終了して「投票」へ</button>}
          </div>
        )}

        {/* 🌇 投票フェーズ */}
        {me.is_alive && room.status !== "finished" && room.phase === "vote" && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
            {hasActed ? (
              <div className="text-center py-10">
                <p className="text-xl text-green-400 font-bold mb-4">投票完了！</p>
                {me.is_host && <button onClick={handleExecute} className="w-full py-3 bg-red-600 text-white font-bold rounded">開票する</button>}
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-center text-red-400 mb-4">処刑する人を選んでください</h2>
                <div className="space-y-2">
                  {aliveOtherPlayers.map(p => (
                    <label key={p.id} className={`flex items-center p-4 rounded-lg border cursor-pointer ${selectedTarget === p.id ? "bg-red-900 border-red-500" : "bg-gray-700 border-gray-600"}`}>
                      <input type="radio" value={p.id} onChange={() => setSelectedTarget(p.id)} className="hidden" />
                      <span className="font-medium">{p.name}</span>
                    </label>
                  ))}
                </div>
                <button onClick={() => handleAction("vote")} disabled={!selectedTarget} className="w-full py-4 bg-red-600 text-white font-bold rounded mt-4 disabled:opacity-50">投票する</button>
              </>
            )}
          </div>
        )}

        {/* 🌙 夜のフェーズ */}
        {me.is_alive && room.status !== "finished" && room.phase === "night" && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
              
              {/* 各役職の行動UI */}
              {hasActed || ["villager", "baker", "teruteru", "fox"].includes(me.role) ? (
                <div className="text-center py-10"><p className="text-green-400 font-bold">静かに朝を待っています...</p></div>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-center text-blue-400 mb-4">
                    {me.role === "werewolf" && "襲撃先を選んでください🐺"}
                    {me.role === "seer" && "占う相手を選んでください🔮"}
                    {me.role === "medium" && "霊媒する相手を選んでください👻"}
                    {me.role === "hunter" && "護衛する相手を選んでください🛡️"}
                  </h2>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {/* 霊媒師は死者、それ以外は生者（人狼は仲間以外）を表示 */}
                    {(me.role === "medium" ? deadPlayers : aliveOtherPlayers.filter(p => me.role === "werewolf" ? p.role !== "werewolf" : true)).map(p => (
                      <label key={p.id} className={`flex items-center p-4 rounded-lg border cursor-pointer ${selectedTarget === p.id ? "bg-blue-900 border-blue-500" : "bg-gray-700 border-gray-600"}`}>
                        <input type="radio" value={p.id} onChange={() => setSelectedTarget(p.id)} className="hidden" />
                        <span className="font-medium">{p.name}</span>
                      </label>
                    ))}
                  </div>
                  <button onClick={() => handleAction(me.role === "werewolf" ? "attack" : me.role === "hunter" ? "guard" : me.role === "medium" ? "medium" : "see")} disabled={!selectedTarget} className="w-full py-4 bg-blue-600 text-white font-bold rounded mt-4">決定する</button>
                </>
              )}
              {me.is_host && <button onClick={handleExecuteMorning} className="w-full mt-6 py-3 border border-red-500 text-red-400 rounded">全員の行動が終わったら「朝」にする☀️</button>}
            </div>

            {/* 人狼チャット（前回と同じ） */}
            {me.role === "werewolf" && (
              <div className="bg-gray-800 rounded-xl p-4 border border-red-900 shadow-lg flex flex-col h-48">
                <p className="text-xs text-red-400 font-bold mb-2">🐺 人狼チャット</p>
                <div className="flex-1 overflow-y-auto space-y-2 p-2"><div className="text-gray-400 text-xs">（省略...実装済みのチャットを入れてください）</div></div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}