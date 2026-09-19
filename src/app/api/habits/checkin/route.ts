import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { habitId, proof } = await request.json();

    if (!habitId) {
      return NextResponse.json(
        { error: "Habit ID is required" },
        { status: 400 }
      );
    }

    // Verify habit belongs to user
    const habit = await prisma.habit.findFirst({
      where: { id: habitId, userId: user.userId },
    });

    if (!habit) {
      return NextResponse.json(
        { error: "Habit not found" },
        { status: 404 }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if already checked in today
    const existingCheckin = await prisma.checkin.findFirst({
      where: {
        habitId,
        userId: user.userId,
        date: today,
      },
    });

    if (existingCheckin) {
      return NextResponse.json(
        { error: "Already checked in today" },
        { status: 400 }
      );
    }

    const checkin = await prisma.checkin.create({
      data: {
        habitId,
        userId: user.userId,
        date: today,
        proof: proof || undefined,
        completed: true,
      },
    });

    return NextResponse.json(
      { success: true, checkin },
      { status: 201 }
    );
  } catch (error) {
    console.error("Checkin error:", error);
    return NextResponse.json(
      { error: "Failed to check in" },
      { status: 500 }
    );
  }
}
