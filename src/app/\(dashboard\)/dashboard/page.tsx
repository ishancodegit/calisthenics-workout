"use client";

import { useEffect, useState } from "react";
import { Habit } from "@/types";
import { HabitCard } from "@/components/HabitCard";
import { Plus } from "lucide-react";

export default function DashboardPage() {
  const [habits, setHabits] = useState<
    Array<Habit & { checkins: Array<{ date: string; completed: boolean }> }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [newHabit, setNewHabit] = useState({
    title: "",
    description: "",
    frequency: "daily",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHabits();
  }, []);

  const fetchHabits = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/habits");
      const data = await response.json();

      if (response.ok) {
        setHabits(data.habits);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch habits");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const response = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newHabit),
      });

      const data = await response.json();

      if (response.ok) {
        setNewHabit({ title: "", description: "", frequency: "daily" });
        setShowModal(false);
        await fetchHabits();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create habit");
    }
  };

  const handleCheckIn = async (habitId: string) => {
    setChecking(habitId);
    try {
      const proofText = prompt("Add a note or proof (optional):");

      const response = await fetch("/api/habits/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          habitId,
          proof: proofText || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        await fetchHabits();
      } else {
        alert(data.error || "Check-in failed");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setChecking(null);
    }
  };

  const todayCheckins = new Set(
    habits
      .flatMap((h) => h.checkins)
      .filter((c) => {
        const checkinDate = new Date(c.date);
        const today = new Date();
        return (
          checkinDate.toDateString() === today.toDateString() && c.completed
        );
      })
      .map((c) => c.id)
  );

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Loading your habits...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Habits</h1>
          <p className="text-gray-600 mt-2">
            Track your daily habits and build consistency
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          New Habit
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Create New Habit
            </h2>
            <form onSubmit={handleCreateHabit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Habit Name
                </label>
                <input
                  type="text"
                  value={newHabit.title}
                  onChange={(e) =>
                    setNewHabit({ ...newHabit, title: e.target.value })
                  }
                  className="input-field"
                  placeholder="e.g., Gym, Read, Meditate"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={newHabit.description}
                  onChange={(e) =>
                    setNewHabit({ ...newHabit, description: e.target.value })
                  }
                  className="input-field"
                  placeholder="What does this habit involve?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Frequency
                </label>
                <select
                  value={newHabit.frequency}
                  onChange={(e) =>
                    setNewHabit({ ...newHabit, frequency: e.target.value })
                  }
                  className="input-field"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {habits.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-600 mb-4">No habits yet. Create one to get started!</p>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Create First Habit
          </button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onCheckIn={handleCheckIn}
              loading={checking === habit.id}
              todayChecked={todayCheckins.has(habit.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
