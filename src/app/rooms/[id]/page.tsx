// app/rooms/[id]/page.tsx
"use client";

import { use } from "react";

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 15+ の場合は params を use() で展開します
  const resolvedParams = use(params);
  
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl font-bold mb-4">待機部屋</h1>
      <p className="text-gray-400 mb-2">みんなにこのルームIDを教えてね👇</p>
      <div className="bg-gray-800 p-4 rounded text-center break-all select-all text-sm mb-8">
        {resolvedParams.id}
      </div>
      <p>現在、プレイヤーの参加を待っています...</p>
    </div>
  );
}