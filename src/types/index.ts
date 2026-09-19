export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  title: string;
  description?: string;
  frequency: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  currentStreak?: number;
  lastCheckinDate?: string;
}

export interface Checkin {
  id: string;
  date: string;
  proof?: string;
  completed: boolean;
  habitId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Friendship {
  id: string;
  requesterId: string;
  requester?: User;
  recipientId: string;
  recipient?: User;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
