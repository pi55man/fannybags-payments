# Supabase Migration Guide

## Setup Instructions

### 1. Install Dependencies
```bash
pnpm install
```

This will install `@supabase/supabase-js` package.

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in your Supabase credentials:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Where to find these:**
- Go to your Supabase project dashboard
- Navigate to Project Settings → API
- `SUPABASE_URL` is the "Project URL"
- `SUPABASE_SERVICE_ROLE_KEY` is the "service_role" secret key (⚠️ keep this secret!)

### 3. Database Schema
Your Supabase database should already have these tables:
- `releases`
- `tracks`
- `track_contributors`
- `campaigns`
- `campaign_tracks`
- `campaign_track_budget_items`

### 4. Run the Application
```bash
pnpm run dev
```

## What Changed

### ✅ Updated Files
1. **[src/db/pool.ts](src/db/pool.ts)** - Now uses Supabase client instead of pg.Pool
2. **[src/db/modules/campaigns/campaign.service.ts](src/db/modules/campaigns/campaign.service.ts)** - Uses Supabase SDK
3. **[src/db/modules/campaigns/campaign.queries.ts](src/db/modules/campaigns/campaign.queries.ts)** - Uses Supabase SDK
4. **[src/routes/api.ts](src/routes/api.ts)** - Uses Supabase client

### Key Differences

#### Before (PostgreSQL)
```typescript
const client = await pool.connect();
await client.query('BEGIN');
const { rows } = await client.query('SELECT * FROM campaigns WHERE id = $1', [id]);
await client.query('COMMIT');
client.release();
```

#### After (Supabase)
```typescript
const { data, error } = await supabase
  .from('campaigns')
  .select('*')
  .eq('id', id)
  .single();
```

### Benefits
- ✅ No manual transaction management (Supabase handles it)
- ✅ No client connection pooling needed
- ✅ Cleaner, more readable code
- ✅ Automatic error handling
- ✅ Built-in type safety with TypeScript
- ✅ Auto-commit on success, auto-rollback on error

## API Endpoints

### Create Campaign
```bash
POST /campaigns
Content-Type: application/json

{
  "release_data": { ... },
  "goal_amount": 50000,
  "start_date": "2026-02-01T00:00:00Z",
  "end_date": "2026-03-31T23:59:59Z",
  "tracks": [...]
}
```

### Get All Campaigns
```bash
GET /campaigns?status=draft&limit=10
```

### Get Campaign by ID
```bash
GET /campaigns/:id
```

### Get Campaign with Full Details
```bash
GET /campaigns/:id/details
```

## Testing

Test the campaign creation:
```bash
curl -X POST http://localhost:3000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "release_data": {
      "title": "Test Album",
      "release_type": "album",
      "primary_artist_id": "artist-uuid-here",
      "primary_genre": "Pop",
      "audio_language": "English",
      "title_language": "English"
    },
    "goal_amount": 10000,
    "start_date": "2026-02-01T00:00:00Z",
    "end_date": "2026-03-31T23:59:59Z",
    "tracks": []
  }'
```
