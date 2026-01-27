# Campaign API Example

## Create a Campaign with New Release (Draft)

### Endpoint
```
POST /campaigns
```

### Option 1: Create New Release + Tracks + Campaign
```json
{
  "release_data": {
    "title": "Summer Vibes Album",
    "release_type": "album",
    "primary_artist_id": "440e8400-e29b-41d4-a716-446655440000",
    "primary_genre": "Pop",
    "secondary_genre": "R&B",
    "is_already_distributed": false,
    "preferred_distributor": "DistroKid",
    "copyright_year": 2026,
    "copyright_owner": "Artist Name",
    "publishing_year": 2026,
    "publishing_owner": "Artist Name"
  },
  "goal_amount": 50000.00,
  "story": "This album represents my journey...",
  "creative_vision": "We're creating a unique fusion of...",
  "start_date": "2026-02-01T00:00:00Z",
  "end_date": "2026-03-31T23:59:59Z",
  "tracks": [
    {
      "track_data": {
        "track_title": "Summer Dreams",
        "track_number": 1,
        "duration_seconds": 240,
        "explicit": false,
        "audio_language": "English",
        "title_language": "English",
        "contributors": [
          {
            "name": "John Doe",
            "role": "producer",
            "royalty_split_percent": 15.00
          },
          {
            "name": "Jane Smith",
            "role": "songwriter",
            "royalty_split_percent": 10.00
          }
        ]
      },
      "royalty_share_percent": 50.00,
      "budget_items": [
        {
          "category": "recording",
          "amount": 5000.00,
          "khapeetar_mode": "self"
        },
        {
          "category": "mixing",
          "amount": 3000.00,
          "khapeetar_mode": "platform",
          "khapeetar_id": "770e8400-e29b-41d4-a716-446655440002"
        }
      ]
    },
    {
      "track_data": {
        "track_title": "Sunset Groove",
        "track_number": 2,
        "duration_seconds": 210,
        "explicit": false,
        "audio_language": "English",
        "title_language": "English",
        "contributors": [
          {
            "name": "Mike Producer",
            "role": "producer",
            "royalty_split_percent": 20.00
          }
        ]
      },
      "royalty_share_percent": 75.00,
      "budget_items": [
        {
          "category": "recording",
          "amount": 4000.00,
          "khapeetar_mode": "self"
        }
      ]
    }
  ]
}
```

### Option 2: Use Existing Release
```json
{
  "release_id": "550e8400-e29b-41d4-a716-446655440000",
  "goal_amount": 50000.00,
  "story": "This album represents my journey...",
  "creative_vision": "We're creating a unique fusion of...",
  "start_date": "2026-02-01T00:00:00Z",
  "end_date": "2026-03-31T23:59:59Z",
  "tracks": [
    {
      "track_id": "660e8400-e29b-41d4-a716-446655440001",
      "royalty_share_percent": 50.00,
      "budget_items": [
        {
          "category": "recording",
          "amount": 5000.00,
          "khapeetar_mode": "self"
        }
      ]
    }
  ]
}
```

### Option 3: Mixed - Existing Release with New Tracks
```json
{
  "release_id": "550e8400-e29b-41d4-a716-446655440000",
  "goal_amount": 50000.00,
  "start_date": "2026-02-01T00:00:00Z",
  "end_date": "2026-03-31T23:59:59Z",
  "tracks": [
    {
      "track_id": "660e8400-e29b-41d4-a716-446655440001",
      "royalty_share_percent": 50.00,
      "budget_items": []
    },
    {
      "track_data": {
        "track_title": "Brand New Track",
        "track_number": 3,
        "audio_language": "English",
        "title_language": "English"
      },
      "royalty_share_percent": 60.00,
      "budget_items": [
        {
          "category": "recording",
          "amount": 3000.00,
          "khapeetar_mode": "self"
        }
      ]
    }
  ]
}
```

### Response
```json
{
  "campaign": {
    "id": "880e8400-e29b-41d4-a716-446655440004",
    "release_id": "550e8400-e29b-41d4-a716-446655440000",
    "goal_amount": "50000.00",
    "story": "This album represents my journey...",
    "creative_vision": "We're creating a unique fusion of...",
    "start_date": "2026-02-01T00:00:00.000Z",
    "end_date": "2026-03-31T23:59:59.000Z",
    "status": "draft",
    "created_at": "2026-01-27T10:30:00.000Z",
    "updated_at": "2026-01-27T10:30:00.000Z"
  }
}
```

## Publish Campaign
```
POST /campaigns/:id/publish
```

This will change the status from `draft` to `live`.

## Field Validations

- `goal_amount`: NUMERIC(12,2), required
- `start_date`: TIMESTAMPTZ, required
- `end_date`: TIMESTAMPTZ, required
- `story`: TEXT, optional
- `creative_vision`: TEXT, optional
- `royalty_share_percent`: NUMERIC(5,2), must be between 20 and 100
- `budget_item.amount`: NUMERIC(12,2), must be >= 0
- `status`: One of: 'draft', 'live', 'funded', 'failed', 'closed'

## Notes

1. Campaign starts in `draft` status by default
2. `release_id` must reference an existing release
3. All `track_id` values must belong to the specified release
4. Track contributors are stored separately in the `track_contributors` table
5. Budget items default to `draft` status when created
