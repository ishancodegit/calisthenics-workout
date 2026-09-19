# Habit Tracker with Accountability

A full-stack web application for tracking daily habits with built-in accountability features. Share your progress with friends, maintain streaks, and provide proof of completion.

## Features

- **User authentication** with email and password
- **Create and manage daily habits** with descriptions
- **Daily check-ins** with optional proof/notes for completion
- **Streak tracking** with flame emoji visual indicators
- **Accountability system** to add friends and view their habits
- **Real-time dashboard** showing all your active habits and their current streaks
- **Responsive mobile-first design** that works on all devices
- **Friend requests** to build accountability partnerships

## Tech Stack

### Frontend
- React 19 with Next.js 15 (App Router)
- TypeScript for type safety
- Tailwind CSS 4 for styling
- Lucide React for icons

### Backend
- Next.js API Routes
- Prisma ORM for database access
- JWT authentication with HTTP-only cookies

### Database
- PostgreSQL

## Local Setup

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL 12+
- Git

### Installation

1. Clone and navigate to project:
```bash
cd habit-tracker
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env.local` from template:
```bash
cp .env.example .env.local
```

4. Update `.env.local` with your database URL:
```
DATABASE_URL="postgresql://user:password@localhost:5432/habit_tracker"
JWT_SECRET="your-super-secret-key-change-in-production"
```

5. Create the PostgreSQL database:
```bash
createdb habit_tracker
```

6. Generate Prisma client:
```bash
npm run prisma:generate
```

7. Push schema to database:
```bash
npm run db:push
```

8. Seed with sample data:
```bash
npm run prisma:seed
```

9. Start development server:
```bash
npm run dev
```

10. Open [http://localhost:3000](http://localhost:3000)

## Demo Accounts

After seeding, you can login with:

**Account 1:**
- Email: `alex@example.com`
- Password: `password123`

**Account 2:**
- Email: `jordan@example.com`
- Password: `password456`

These accounts are already friends and have sample habits with streaks.

## Database Schema

### Users Table
- `id` (string, primary key)
- `email` (string, unique)
- `username` (string, unique)
- `password` (hashed string)
- `createdAt`, `updatedAt`

### Habits Table
- `id` (string, primary key)
- `title` (string)
- `description` (string, optional)
- `frequency` (string: "daily" or "weekly")
- `userId` (foreign key)
- `createdAt`, `updatedAt`

### Checkins Table
- `id` (string, primary key)
- `date` (date)
- `proof` (string, optional text note or image URL)
- `completed` (boolean)
- `habitId` (foreign key)
- `userId` (foreign key)
- `createdAt`, `updatedAt`

### Friendships Table
- `id` (string, primary key)
- `requesterId` (foreign key)
- `recipientId` (foreign key)
- `status` ("pending", "accepted", or "rejected")
- `createdAt`, `updatedAt`

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Habits
- `GET /api/habits` - Get all user habits with streaks
- `POST /api/habits` - Create new habit
- `POST /api/habits/checkin` - Check in on a habit

### Friends
- `GET /api/friends` - Get list of accepted friends
- `POST /api/friends` - Send friend request
- `PATCH /api/friends/[id]` - Accept/reject request
- `DELETE /api/friends/[id]` - Remove friend
- `GET /api/friends/habits` - Get friends' habits

## Key Features Explained

### Streak Calculation
Streaks count consecutive days of check-ins. Missing a day resets the streak. The algorithm sorts check-ins by date and counts backwards from today, stopping at any gap.

### Accountability
Add friends by username to see their habits and streaks. This creates accountability partnerships where you both stay motivated.

### Proof System
When checking in, optionally add text notes or image URLs as proof of completion. This helps make the accountability system more credible.

## Available Commands

```bash
npm run dev              # Start development server
npm run build            # Build for production
npm start                # Start production server
npm run prisma:generate  # Generate Prisma client
npm run db:push          # Push schema to database
npm run prisma:seed      # Seed with sample data
npm run db:studio        # Open Prisma visual explorer
```

## Troubleshooting

**Database connection error?**
- Ensure PostgreSQL is running
- Check DATABASE_URL format in .env.local
- Verify database exists: `psql -l`

**Prisma client errors?**
```bash
npm run prisma:generate
rm -rf node_modules package-lock.json
npm install
```

**Port 3000 already in use?**
```bash
npm run dev -- -p 3001
```

## Project Structure

```
src/
├── app/                # Next.js App Router pages and API routes
├── components/         # React components (HabitCard, etc.)
├── hooks/             # Custom React hooks (useAuth)
├── lib/               # Utilities (auth, database, helpers)
└── types/             # TypeScript type definitions
prisma/
├── schema.prisma      # Database schema
└── seed.ts            # Sample data
```

Built with Next.js 15, React 19, TypeScript, Tailwind CSS, and PostgreSQL.
