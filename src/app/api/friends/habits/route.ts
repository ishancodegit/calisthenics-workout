import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculateStreak } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all accepted friendships
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: user.userId, status: "accepted" },
          { recipientId: user.userId, status: "accepted" },
        ],
      },
    });

    if (friendships.length === 0) {
      return NextResponse.json(
        { success: true, friendsHabits: [] },
        { status: 200 }
      );
    }

    const friendIds = friendships.map((f) =>
      f.requesterId === user.userId ? f.recipientId : f.requesterId
    );

    const friendsHabits = await prisma.habit.findMany({
      where: {
        userId: {
          in: friendIds,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        checkins: {
          orderBy: { date: "desc" },
          take: 30,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const habitsWithStreaks = friendsHabits.map((habit) => ({
      ...habit,
      currentStreak: calculateStreak(habit.checkins, habit.createdAt.toISOString()),
      lastCheckinDate:
        habit.checkins.length > 0 ? habit.checkins[0].date : null,
    }));

    return NextResponse.json(
      { success: true, friendsHabits: habitsWithStreaks },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get friends habits error:", error);
    return NextResponse.json(
      { error: "Failed to fetch friends' habits" },
      { status: 500 }
    );
  }
}
