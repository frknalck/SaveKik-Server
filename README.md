# SaveKik Converter Server

Node.js server for converting M3U8 playlists to MP4 videos using FFmpeg.

## Features

- M3U8 to MP4 conversion
- Segment selection (start_time, end_time)
- Automatic file cleanup
- Health check endpoint
- CORS enabled for mobile apps

## Deployment

### Railway Deploy

1. Fork this repository
2. Connect to Railway: https://railway.app
3. Deploy from GitHub
4. Environment will automatically install FFmpeg

### Local Development

```bash
npm install
npm run dev
```

## API Endpoints

### Health Check
```
GET /health
```

### Convert M3U8 to MP4
```
POST /convert
Content-Type: application/json

{
  "m3u8_url": "https://example.com/playlist.m3u8",
  "filename": "video_name",
  "start_time": 60,    // optional - start time in seconds
  "end_time": 120      // optional - end time in seconds
}
```

Response:
```json
{
  "success": true,
  "job_id": "uuid",
  "download_url": "https://server.com/downloads/video.mp4",
  "filename": "video.mp4",
  "size": 12345678
}
```

### Download File
```
GET /downloads/{filename}
```

## Swift Integration

Update the `serverURL` in `CustomServerService.swift` with your deployed Railway URL.

## Environment Variables

- `PORT` - Server port (default: 3000)

## File Cleanup

Files are automatically deleted after 1 hour to save storage space.