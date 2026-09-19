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

    const habits = await prisma.habit.findMany({
      where: { userId: user.userId },
      include: {
        checkins: {
          orderBy: { date: "desc" },
          take: 30,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const habitsWithStreaks = habits.map((habit) => ({
      ...habit,
      currentStreak: calculateStreak(habit.checkins, habit.createdAt.toISOString()),
      lastCheckinDate:
        habit.checkins.length > 0 ? habit.checkins[0].date : null,
    }));

    return NextResponse.json(
      { success: true, habits: habitsWithStreaks },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get habits error:", error);
    return NextResponse.json(
      { error: "Failed to fetch habits" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { title, description, frequency } = await request.json();

    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    const habit = await prisma.habit.create({
      data: {
        title,
        description,
        frequency: frequency || "daily",
        userId: user.userId,
      },
    });

    return NextResponse.json(
      { success: true, habit },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create habit error:", error);
    return NextResponse.json(
      { error: "Failed to create habit" },
      { status: 500 }
    );
  }
}
