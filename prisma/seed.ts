import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clear existing data
  await prisma.checkin.deleteMany();
  await prisma.friendship.deleteMany();
  await prisma.habit.deleteMany();
  await prisma.user.deleteMany();

  // Create sample users
  const hashedPassword1 = await bcrypt.hash("password123", 10);
  const hashedPassword2 = await bcrypt.hash("password456", 10);

  const user1 = await prisma.user.create({
    data: {
      email: "alex@example.com",
      username: "alex_fit",
      password: hashedPassword1,
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: "jordan@example.com",
      username: "jordan_reader",
      password: hashedPassword2,
    },
  });

  console.log("Created users:", { user1: user1.email, user2: user2.email });

  // Create habits for user1
  const habit1 = await prisma.habit.create({
    data: {
      title: "Gym",
      description: "30 minutes of strength training",
      frequency: "daily",
      userId: user1.id,
    },
  });

  const habit2 = await prisma.habit.create({
    data: {
      title: "Read 10 Pages",
      description: "Daily reading habit",
      frequency: "daily",
      userId: user1.id,
    },
  });

  // Create habits for user2
  const habit3 = await prisma.habit.create({
    data: {
      title: "Meditation",
      description: "10 minutes of meditation",
      frequency: "daily",
      userId: user2.id,
    },
  });

  const habit4 = await prisma.habit.create({
    data: {
      title: "Cold Shower",
      description: "Take a cold shower",
      frequency: "daily",
      userId: user2.id,
    },
  });

  console.log("Created habits for both users");

  // Create check-ins for the past 10 days
  const today = new Date();
  for (let i = 0; i < 10; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // User1 check-ins
    if (i < 8) {
      // 8 day streak for gym
      await prisma.checkin.create({
        data: {
          habitId: habit1.id,
          userId: user1.id,
          date: date,
          completed: true,
          proof: `Completed gym session on ${date.toDateString()}`,
        },
      });
    }

    if (i < 6) {
      // 6 day streak for reading
      await prisma.checkin.create({
        data: {
          habitId: habit2.id,
          userId: user1.id,
          date: date,
          completed: true,
          proof: `Read 10 pages of my current book`,
        },
      });
    }

    // User2 check-ins
    if (i < 9) {
      // 9 day streak for meditation
      await prisma.checkin.create({
        data: {
          habitId: habit3.id,
          userId: user2.id,
          date: date,
          completed: true,
          proof: `Completed 10 min meditation session`,
        },
      });
    }

    if (i < 4) {
      // 4 day streak for cold shower
      await prisma.checkin.create({
        data: {
          habitId: habit4.id,
          userId: user2.id,
          date: date,
          completed: true,
          proof: `Took a 3 minute cold shower`,
        },
      });
    }
  }

  console.log("Created check-ins with streaks");

  // Create friendship (accepted)
  const friendship = await prisma.friendship.create({
    data: {
      requesterId: user1.id,
      recipientId: user2.id,
      status: "accepted",
    },
  });

  console.log("Created friendship between users");

  console.log("Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
