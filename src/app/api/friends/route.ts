import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get accepted friendships
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: user.userId, status: "accepted" },
          { recipientId: user.userId, status: "accepted" },
        ],
      },
      include: {
        requester: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        recipient: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    const friends = friendships.map((f) => {
      const friend =
        f.requesterId === user.userId ? f.recipient : f.requester;
      return {
        id: f.id,
        friend,
        status: f.status,
      };
    });

    return NextResponse.json(
      { success: true, friends },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get friends error:", error);
    return NextResponse.json(
      { error: "Failed to fetch friends" },
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

    const { username } = await request.json();

    if (!username) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    const recipient = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });

    if (!recipient) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (recipient.id === user.userId) {
      return NextResponse.json(
        { error: "Cannot add yourself as a friend" },
        { status: 400 }
      );
    }

    // Check if friendship already exists
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          {
            requesterId: user.userId,
            recipientId: recipient.id,
          },
          {
            requesterId: recipient.id,
            recipientId: user.userId,
          },
        ],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Friendship request already exists" },
        { status: 400 }
      );
    }

    const friendship = await prisma.friendship.create({
      data: {
        requesterId: user.userId,
        recipientId: recipient.id,
        status: "pending",
      },
      include: {
        recipient: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json(
      { success: true, friendship },
      { status: 201 }
    );
  } catch (error) {
    console.error("Add friend error:", error);
    return NextResponse.json(
      { error: "Failed to add friend" },
      { status: 500 }
    );
  }
}
