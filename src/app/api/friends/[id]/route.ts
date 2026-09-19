import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface RouteParams {
  params: {
    id: string;
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { status } = await request.json();

    if (!["accepted", "rejected"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    const friendship = await prisma.friendship.findFirst({
      where: {
        id: params.id,
        recipientId: user.userId,
        status: "pending",
      },
    });

    if (!friendship) {
      return NextResponse.json(
        { error: "Friendship request not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.friendship.update({
      where: { id: params.id },
      data: { status },
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

    return NextResponse.json(
      { success: true, friendship: updated },
      { status: 200 }
    );
  } catch (error) {
    console.error("Update friendship error:", error);
    return NextResponse.json(
      { error: "Failed to update friendship" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const friendship = await prisma.friendship.findFirst({
      where: {
        id: params.id,
        OR: [{ requesterId: user.userId }, { recipientId: user.userId }],
      },
    });

    if (!friendship) {
      return NextResponse.json(
        { error: "Friendship not found" },
        { status: 404 }
      );
    }

    await prisma.friendship.delete({
      where: { id: params.id },
    });

    return NextResponse.json(
      { success: true },
      { status: 200 }
    );
  } catch (error) {
    console.error("Delete friendship error:", error);
    return NextResponse.json(
      { error: "Failed to delete friendship" },
      { status: 500 }
    );
  }
}
