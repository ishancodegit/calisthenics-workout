"use client";

import { Flame, Check } from "lucide-react";
import { Habit } from "@/types";

interface HabitCardProps {
  habit: Habit & { checkins: Array<{ date: string; completed: boolean }> };
  onCheckIn: (habitId: string) => void;
  loading?: boolean;
  todayChecked?: boolean;
}

export function HabitCard({
  habit,
  onCheckIn,
  loading = false,
  todayChecked = false,
}: HabitCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">{habit.title}</h3>
          {habit.description && (
            <p className="text-sm text-gray-600 mt-1">{habit.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-4">
          <Flame className="w-6 h-6 text-orange-500" />
          <span className="text-2xl font-bold text-orange-500">
            {habit.currentStreak || 0}
          </span>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <button
          onClick={() => onCheckIn(habit.id)}
          disabled={loading || todayChecked}
          className={`flex-1 py-2 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${
            todayChecked
              ? "bg-green-100 text-green-700 cursor-not-allowed"
              : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
          }`}
        >
          {todayChecked ? (
            <>
              <Check className="w-5 h-5" />
              Done Today
            </>
          ) : (
            <>
              {loading ? "Checking in..." : "Check In"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
