"use client";

import { useEffect, useState } from "react";
import { Friendship, User, Habit } from "@/types";
import { HabitCard } from "@/components/HabitCard";
import { Users, Plus } from "lucide-react";

export default function FriendsPage() {
  const [friends, setFriends] = useState<
    Array<{ id: string; friend: User; status: string }>
  >([]);
  const [friendsHabits, setFriendsHabits] = useState<
    Array<Habit & { user: User; checkins: Array<{ date: string; completed: boolean }> }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFriends();
    fetchFriendsHabits();
  }, []);

  const fetchFriends = async () => {
    try {
      const response = await fetch("/api/friends");
      const data = await response.json();

      if (response.ok) {
        setFriends(data.friends);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch friends");
    }
  };

  const fetchFriendsHabits = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/friends/habits");
      const data = await response.json();

      if (response.ok) {
        setFriendsHabits(data.friendsHabits);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch friends' habits");
    } finally {
      setLoading(false);
    }
  };

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (response.ok) {
        setUsername("");
        setShowModal(false);
        await fetchFriends();
        alert("Friend request sent!");
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add friend");
    }
  };

  const groupedHabits = friendsHabits.reduce(
    (acc, habit) => {
      const userId = habit.user.id;
      if (!acc[userId]) {
        acc[userId] = { user: habit.user, habits: [] };
      }
      acc[userId].habits.push(habit);
      return acc;
    },
    {} as Record<string, { user: User; habits: typeof friendsHabits }>
  );

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Accountability</h1>
          <p className="text-gray-600 mt-2">
            See your friends' habits and keep each other accountable
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Friend
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
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Add Friend</h2>
            <form onSubmit={handleAddFriend} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field"
                  placeholder="Enter friend's username"
                  required
                />
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
                  Send Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Loading friends' habits...</p>
        </div>
      ) : Object.keys(groupedHabits).length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">No friends added yet.</p>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add First Friend
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedHabits).map(([userId, { user, habits }]) => (
            <div key={userId}>
              <div className="mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  {user.username}'s Habits
                </h2>
                <p className="text-sm text-gray-600">{user.email}</p>
              </div>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {habits.map((habit) => (
                  <div key={habit.id} className="card p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {habit.title}
                        </h3>
                        {habit.description && (
                          <p className="text-sm text-gray-600 mt-1">
                            {habit.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-center p-4 bg-gradient-to-r from-orange-50 to-red-50 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Current Streak</p>
                      <p className="text-3xl font-bold text-orange-600">
                        {habit.currentStreak || 0}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
