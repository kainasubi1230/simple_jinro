// app/rooms/[id]/play/page.tsx
"use client";

import { use, useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Player = { id: string; name: string; role: string; is_alive: boolean; is_host: boolean; };
// ⏱️ 変更点：型定義に day_end_time を追加
type Room = { 
  id: string; status: string; phase: string; day_count: number; 
  last_victims: string | null; last_executed: string | null; teruteru_won: boolean; day_end_time: string | null; 
};
type Message = { id: string; player_id: string; content: string; };
type GameLog = { id: string; day_count: number; message: string; created_at: string; };

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
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [showExecutionOverlay, setShowExecutionOverlay] = useState(false);

  // ⏭️ 新規追加：スキップした人数と自分がスキップしたか
  const [skipCount, setSkipCount] = useState(0);
  const [hasSkipped, setHasSkipped] = useState(false);

  useEffect(() => {
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
        
        // ⏭️ 自分がスキップ済みか、合計何人スキップしているかを取得
        if (roomData?.phase === "day") {
          const { data: actions } = await supabase.from("actions").select("*").eq("room_id", roomId).eq("day_count", roomData.day_count).eq("phase", "day").eq("action_type", "skip");
          setSkipCount(actions?.length || 0);
          setHasSkipped(actions?.some(a => a.actor_id === myPlayerId) || false);
        }
      };

      const fetchMessagesAndLogs = async () => {
        const { data: msgData } = await supabase.from("messages").select("*").eq("room_id", roomId).order("created_at", { ascending: true });
        if (msgData) setMessages(msgData);
        const { data: logData } = await supabase.from("game_logs").select("*").eq("room_id", roomId).order("created_at", { ascending: true });
        if (logData) setLogs(logData);
      };

      await fetchAll(); await fetchMessagesAndLogs(); setIsLoading(false);

      const channel = supabase.channel(`play_${roomId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, 
          (payload) => { 
            setRoom(payload.new as Room); setHasActed(false); setSelectedTarget(null); setHasSkipped(false); 
          }
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => fetchAll())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, (payload) => setMessages((prev) => [...prev, payload.new as Message]))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_logs", filter: `room_id=eq.${roomId}` }, (payload) => setLogs((prev) => [...prev, payload.new as GameLog]))
        // ⏭️ スキップ投票のリアルタイム更新
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "actions", filter: `room_id=eq.${roomId}` }, () => {
          fetchAll();
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    };
    init();
  }, [roomId, router]);

  // ⏱️ 変更点：リロードしてもズレない絶対タイマーの計算！
  // ⏱️ 変更点：リロードしてもズレない絶対タイマーの計算！
  useEffect(() => {
    if (room?.phase === "day" && room.day_end_time) {
      // 💡 ここがポイント！絶対に文字（string）だと確定させてからタイマーの中で使う
      const endTimeStr = room.day_end_time; 

      const updateTimer = () => {
        const end = new Date(endTimeStr).getTime();
        const now = Date.now();
        const remain = Math.max(0, Math.floor((end - now) / 1000));
        setTimeLeft(remain);
      };
      
      updateTimer(); // 即時反映
      const timerId = setInterval(updateTimer, 1000);
      return () => clearInterval(timerId);
    }
  }, [room?.phase, room?.day_end_time]);

  useEffect(() => {
    if (room?.phase === "night") {
      setShowExecutionOverlay(true);
      const timer = setTimeout(() => { setShowExecutionOverlay(false); }, 4000);
      return () => clearTimeout(timer);
    }
  }, [room?.phase]);

  useEffect(() => {
    if (room?.status === "finished") {
      const timer = setTimeout(() => { router.push("/"); }, 10000);
      return () => clearTimeout(timer);
    }
  }, [room?.status, router]);

  const checkWinOrNextPhase = useCallback(async (nextPhase: string) => {
    const { data: currentPlayers } = await supabase.from("players").select("*").eq("room_id", roomId).eq("is_alive", true);
    if (!currentPlayers) return;

    const wolfCount = currentPlayers.filter(p => p.role === "werewolf").length;
    const humanCount = currentPlayers.length - wolfCount;
    const foxAlive = currentPlayers.some(p => p.role === "fox");

    let newStatus = room!.status; let newPhase = nextPhase;
    if (wolfCount === 0) { newStatus = "finished"; newPhase = foxAlive ? "fox_win" : "human_win"; } 
    else if (wolfCount >= humanCount) { newStatus = "finished"; newPhase = foxAlive ? "fox_win" : "wolf_win"; }

    // ⏱️ 朝になる時にも新しくタイマーの終了時刻をセットする
    const endTime = new Date(Date.now() + 180 * 1000).toISOString();
    await supabase.from("rooms").update({ 
      status: newStatus, phase: newPhase, 
      day_count: nextPhase === "day" ? room!.day_count + 1 : room!.day_count,
      day_end_time: nextPhase === "day" ? endTime : null 
    }).eq("id", roomId);
  }, [room, roomId]);

  // 🤖 オートメーションエンジン（裏側進行）
  const handleExecuteVote = useCallback(async () => {
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

    let executedName = "なし（同票、または投票なし）";
    if (victimId) {
      const victim = players.find(p => p.id === victimId);
      executedName = victim?.name || "不明";
      await supabase.from("players").update({ is_alive: false }).eq("id", victimId);
      if (victim?.role === "teruteru") { await supabase.from("rooms").update({ teruteru_won: true }).eq("id", roomId); }
    }
    
    await supabase.from("rooms").update({ last_executed: executedName }).eq("id", roomId);
    const logMsg = victimId ? `投票の結果、【${executedName}】が処刑されました。` : `投票の結果、本日の処刑者は出ませんでした。`;
    await supabase.from("game_logs").insert([{ room_id: roomId, day_count: room!.day_count, message: logMsg }]);

    await checkWinOrNextPhase("night");
  }, [roomId, room, players, checkWinOrNextPhase]);

  const handleExecuteMorning = useCallback(async () => {
    const { data: actions } = await supabase.from("actions").select("*").eq("room_id", roomId).eq("day_count", room!.day_count).eq("phase", "night");

    const guardAction = actions?.find(a => a.action_type === "guard"); const guardedId = guardAction ? guardAction.target_id : null;
    const seeAction = actions?.find(a => a.action_type === "see"); const seerTargetId = seeAction ? seeAction.target_id : null;

    let wolfTargetId = null;
    const attacks = actions?.filter(a => a.action_type === "attack") || [];
    if (attacks.length > 0) {
      const attackCounts: Record<string, number> = {};
      attacks.forEach(v => { attackCounts[v.target_id] = (attackCounts[v.target_id] || 0) + 1; });
      let maxVotes = 0;
      for (const [targetId, count] of Object.entries(attackCounts)) {
        if (count > maxVotes) { maxVotes = count; wolfTargetId = targetId; } else if (count === maxVotes && Math.random() > 0.5) wolfTargetId = targetId;
      }
    }

    let victimIds: string[] = [];
    if (wolfTargetId) {
      const targetPlayer = players.find(p => p.id === wolfTargetId);
      if (wolfTargetId === guardedId) { /* 護衛成功 */ } else if (targetPlayer?.role === "fox") { /* 妖狐無敵 */ } else { victimIds.push(wolfTargetId); }
    }
    if (seerTargetId) {
      const targetPlayer = players.find(p => p.id === seerTargetId);
      if (targetPlayer?.role === "fox" && !victimIds.includes(seerTargetId)) { victimIds.push(seerTargetId); }
    }

    const victimNames = victimIds.map(id => players.find(p => p.id === id)?.name).join(" と ");
    const lastVictimsText = victimIds.length > 0 ? victimNames : "なし";

    if (victimIds.length > 0) { for (const vId of victimIds) { await supabase.from("players").update({ is_alive: false }).eq("id", vId); } }

    await supabase.from("rooms").update({ last_victims: lastVictimsText }).eq("id", roomId);
    const logMsg = victimIds.length > 0 ? `無残な姿で発見されたのは【${lastVictimsText}】でした。` : `昨晩は誰も犠牲になりませんでした。平和な朝です。`;
    await supabase.from("game_logs").insert([{ room_id: roomId, day_count: room!.day_count + 1, message: logMsg }]);

    await checkWinOrNextPhase("day");
  }, [roomId, room, players, checkWinOrNextPhase]);

  // 🔥 オートメーションエンジン（ホスト監視用）
  useEffect(() => {
    if (!me?.is_host || room?.status === "finished") return;

    // 【昼の自動進行・時間切れ】
    if (room?.phase === "day" && timeLeft === 0) {
      supabase.from("rooms").update({ phase: "vote" }).eq("id", roomId);
    }
    
    // 【昼の自動進行・全員スキップ】
    if (room?.phase === "day") {
      const checkSkip = async () => {
        const aliveCount = players.filter(p => p.is_alive).length;
        const { count } = await supabase.from("actions").select("*", { count: "exact", head: true }).eq("room_id", roomId).eq("day_count", room.day_count).eq("phase", "day").eq("action_type", "skip");
        if (count !== null && count >= aliveCount && aliveCount > 0) {
          supabase.from("rooms").update({ phase: "vote" }).eq("id", roomId);
        }
      };
      checkSkip();
    }

    // 【夕方の自動進行】全員投票
    if (room?.phase === "vote") {
      const checkVoting = async () => {
        const aliveCount = players.filter(p => p.is_alive).length;
        const { count } = await supabase.from("actions").select("*", { count: "exact", head: true }).eq("room_id", roomId).eq("day_count", room.day_count).eq("phase", "vote");
        if (count !== null && count >= aliveCount) setTimeout(() => { handleExecuteVote(); }, 3000);
      };
      checkVoting();
    }

    // 【夜の自動進行】全員行動
    if (room?.phase === "night") {
      const checkMorning = async () => {
        const nightActionRoles = ["werewolf", "seer", "medium", "hunter"];
        const requiredActionCount = players.filter(p => p.is_alive && nightActionRoles.includes(p.role)).length;
        const { count } = await supabase.from("actions").select("*", { count: "exact", head: true }).eq("room_id", roomId).eq("day_count", room.day_count).eq("phase", "night");
        if (count !== null && count >= requiredActionCount) setTimeout(() => { handleExecuteMorning(); }, 3000);
      };
      checkMorning();
    }
  }, [room?.phase, room?.day_count, room?.status, timeLeft, players, me?.is_host, roomId, handleExecuteVote, handleExecuteMorning, skipCount]);

  // ⏭️ 自分がスキップ投票をする関数
  const handleSkipVote = async () => {
    if (!me || hasSkipped) return;
    try {
      await supabase.from("actions").insert([{ room_id: roomId, day_count: room!.day_count, phase: "day", actor_id: me.id, target_id: me.id, action_type: "skip" }]);
      setHasSkipped(true);
    } catch (error) { console.error(error); }
  };

  const handleAction = async (actionType: string) => {
    if (!selectedTarget || !me || !room) return;
    try {
      await supabase.from("actions").insert([{ room_id: roomId, day_count: room.day_count, phase: room.phase, actor_id: me.id, target_id: selectedTarget, action_type: actionType }]);
      setHasActed(true);

      const target = players.find(p => p.id === selectedTarget);
      if (actionType === "see") alert(`🔮占い結果: ${target?.name} は【${target?.role === "werewolf" ? "人狼" : "市民陣営"}】です。`);
      else if (actionType === "medium") alert(`👻霊媒結果: ${target?.name} は【${target?.role === "werewolf" ? "人狼" : "市民陣営"}】でした。`);
    } catch (error) { console.error(error); }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !me) return;
    await supabase.from("messages").insert([{ room_id: roomId, player_id: me.id, content: chatInput }]);
    setChatInput("");
  };

  if (isLoading || !me || !room) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">読み込み中...</div>;

  if (showExecutionOverlay && room.status !== "finished") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center space-y-6 animate-pulse p-4">
        <p className="text-gray-400 text-xl tracking-widest">本日の処刑者</p>
        <h1 className="text-5xl font-extrabold text-red-600 drop-shadow-[0_0_15px_rgba(220,38,38,0.8)] text-center break-all">{room.last_executed}</h1>
        <p className="text-sm text-gray-500 mt-12">恐ろしい夜が訪れます...</p>
      </div>
    );
  }

  const aliveOtherPlayers = players.filter(p => p.is_alive && p.id !== me.id);
  const deadPlayers = players.filter(p => !p.is_alive);
  const isBakerAlive = players.some(p => p.role === "baker" && p.is_alive);
  const aliveTotalCount = players.filter(p => p.is_alive).length; // ⏭️ 生きている全人数

  const getRoleName = (r: string) => {
    const roles: Record<string, string> = { werewolf: "🐺 人狼", seer: "🔮 占い師", villager: "🧑‍🌾 市民", medium: "👻 霊媒師", hunter: "🛡️ 狩人", fox: "🦊 妖狐", baker: "🍞 パン屋", teruteru: "☔ てるてる坊主" };
    return roles[r] || r;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-8 pb-32">
      <div className="w-full max-w-md space-y-6">
        
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
            {room.teruteru_won && <p className="text-xl text-blue-400 font-bold mt-4 animate-bounce">☔ てるてる坊主も追加勝利！</p>}
            
            <p className="text-sm text-gray-400 mt-6">10秒後に自動でトップに戻ります...</p>
            <button onClick={() => router.push("/")} className="w-full py-4 bg-gray-600 text-white font-bold rounded mt-2">今すぐトップに戻る</button>
          </div>
        )}

        {/* 死亡時の画面 */}
        {!me.is_alive && room.status !== "finished" && (
          <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-bold text-gray-400 mb-2">あなたは死亡しました👻</h2>
            <p className="text-sm text-gray-500">ゲームの行く末を静かに見守りましょう...</p>
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
            {isBakerAlive && room.day_count > 1 && <p className="text-yellow-300 font-bold bg-yellow-900/50 py-2 rounded shadow-inner">🥐 おいしいパンが配られました</p>}
            
            <div className="text-6xl font-mono">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}</div>
            <p className="text-xs text-gray-400">0になると自動で投票に移ります</p>

            {/* ⏭️ 全員スキップボタン */}
            <div className="pt-4 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-2">生存者全員が同意すると時間を飛ばせます ({skipCount}/{aliveTotalCount}人 準備OK)</p>
              <button onClick={handleSkipVote} disabled={hasSkipped} className="w-full py-3 border border-blue-500 text-blue-400 hover:bg-blue-900/30 rounded disabled:opacity-50 disabled:border-gray-600 disabled:text-gray-500 transition">
                {hasSkipped ? "同意済み (他の人待ち)" : "議論を早く切り上げる (スキップ同意)"}
              </button>
            </div>
          </div>
        )}

        {/* 🌇 投票フェーズ */}
        {me.is_alive && room.status !== "finished" && room.phase === "vote" && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
            {hasActed ? (
              <div className="text-center py-10">
                <p className="text-xl text-green-400 font-bold mb-4">投票完了！</p>
                <p className="text-sm text-gray-400">全員が投票すると自動で開票されます</p>
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
        {me.is_alive && room.status !== "finished" && room.phase === "night" && !showExecutionOverlay && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
              {hasActed || ["villager", "baker", "teruteru", "fox"].includes(me.role) ? (
                <div className="text-center py-10">
                  <p className="text-green-400 font-bold animate-pulse">行動完了！</p>
                  <p className="text-sm text-gray-400 mt-2">全員の行動が終わると自動で朝になります</p>
                </div>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-center text-blue-400 mb-4">
                    {me.role === "werewolf" && "襲撃先を選んでください🐺"}
                    {me.role === "seer" && "占う相手を選んでください🔮"}
                    {me.role === "medium" && "霊媒する相手を選んでください👻"}
                    {me.role === "hunter" && "護衛する相手を選んでください🛡️"}
                  </h2>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
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
            </div>

            {/* 人狼チャット */}
            {me.role === "werewolf" && (
              <div className="bg-gray-800 rounded-xl p-4 border border-red-900 shadow-lg flex flex-col h-48">
                <p className="text-xs text-red-400 font-bold mb-2">🐺 人狼チャット</p>
                <div className="flex-1 overflow-y-auto space-y-2 p-2 bg-gray-900 rounded">
                  {messages.map(msg => {
                    const sender = players.find(p => p.id === msg.player_id);
                    return (
                      <div key={msg.id} className={`text-sm ${msg.player_id === me.id ? "text-right" : "text-left"}`}>
                        <span className="text-xs text-gray-500">{sender?.name}</span>
                        <div className={`inline-block px-3 py-1 rounded-lg ${msg.player_id === me.id ? "bg-red-700 text-white" : "bg-gray-700 text-gray-200"}`}>{msg.content}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex mt-2">
                  <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSendMessage()} className="flex-1 bg-gray-700 text-white p-2 rounded-l border-none focus:ring-0" placeholder="メッセージ..." />
                  <button onClick={handleSendMessage} className="bg-red-600 px-4 rounded-r font-bold text-white">送信</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 📖 ゲームログ */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg mt-8">
          <h3 className="text-lg font-bold text-gray-300 mb-4 border-b border-gray-600 pb-2">📖 ゲームログ</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto text-sm flex flex-col-reverse">
            {logs.length === 0 ? <p className="text-gray-500 text-center py-4">まだ記録はありません</p> : (
              [...logs].reverse().map((log) => (
                <div key={log.id} className="bg-gray-900 p-3 rounded border border-gray-700">
                  <span className="text-gray-500 font-bold mr-3">[{log.day_count}日目]</span>
                  <span className="text-gray-300">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}