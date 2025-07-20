const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/downloads', express.static('downloads'));

// Create downloads directory
fs.ensureDirSync('./downloads');

// Get CRF value based on quality selection
function getCRFValue(quality) {
    // CRF: 0-51, lower = better quality, larger file size
    // 18-28 is considered reasonable range
    switch(quality) {
        case 'high':
            return '20';    // High quality, larger file
        case 'medium':
            return '23';    // Balanced quality/size (default)
        case 'low':
            return '28';    // Lower quality, smaller file
        default:
            return '23';    // Default to medium
    }
}

// Check FFmpeg availability
function checkFFmpeg() {
    return new Promise((resolve) => {
        exec('ffmpeg -version', (error) => {
            if (error) {
                console.log('❌ FFmpeg not found, trying alternative paths...');
                exec('which ffmpeg', (error2, stdout) => {
                    if (error2) {
                        console.log('❌ FFmpeg not available on system');
                        resolve(false);
                    } else {
                        console.log(`✅ FFmpeg found at: ${stdout.trim()}`);
                        ffmpeg.setFfmpegPath(stdout.trim());
                        resolve(true);
                    }
                });
            } else {
                console.log('✅ FFmpeg is available');
                resolve(true);
            }
        });
    });
}

// Initialize FFmpeg check on startup
let ffmpegAvailable = false;
checkFFmpeg().then(available => {
    ffmpegAvailable = available;
    console.log(`🎬 FFmpeg status: ${available ? 'Ready' : 'Not available'}`);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'SaveKik Converter Server is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        ffmpeg: ffmpegAvailable ? 'Available' : 'Not available'
    });
});

// Test endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'SaveKik Converter API',
        status: 'running',
        endpoints: {
            health: '/health',
            convert: 'POST /convert'
        }
    });
});

// Job status storage
const jobProgress = new Map();

// Get job progress endpoint
app.get('/progress/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const progress = jobProgress.get(jobId) || { 
        status: 'not_found', 
        progress: 0, 
        message: 'Job not found' 
    };
    res.json(progress);
});

// M3U8 to MP4 conversion endpoint
app.post('/convert', async (req, res) => {
    const { m3u8_url, filename, start_time, end_time, quality } = req.body;
    
    if (!m3u8_url || !filename) {
        return res.status(400).json({
            error: 'Missing required fields: m3u8_url, filename'
        });
    }

    const jobId = uuidv4();
    const cleanFilename = filename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const outputFilename = `${cleanFilename}_${jobId}.mp4`;
    const outputPath = path.join('./downloads', outputFilename);
    
    console.log(`🚀 Starting FFmpeg conversion: ${jobId}`);
    console.log(`📂 Input M3U8: ${m3u8_url}`);
    console.log(`📁 Output: ${outputFilename}`);
    
    // Initialize job progress
    jobProgress.set(jobId, {
        status: 'starting',
        progress: 0,
        message: 'Starting conversion...'
    });
    
    // Check if FFmpeg is available
    if (!ffmpegAvailable) {
        console.log('❌ FFmpeg not available on server');
        return res.status(500).json({
            error: 'FFmpeg not installed on server',
            details: 'Server needs FFmpeg to convert videos'
        });
    }
    
    try {
        // Create FFmpeg command with optimization
        let command = ffmpeg(m3u8_url)
            .inputOptions([
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                '-user_agent', 'SaveKik/1.0',
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5'
            ])
            .outputOptions([
                '-c:v', 'libx264',      // Use H.264 codec for better compression
                '-preset', 'fast',       // Fast encoding with good compression
                '-crf', getCRFValue(quality), // Dynamic CRF based on quality
                '-c:a', 'aac',          // AAC audio codec
                '-b:a', '128k',         // Audio bitrate 128kbps
                '-movflags', '+faststart', // Web optimization
                '-max_muxing_queue_size', '9999'
            ]);

        // Add segment selection if provided
        if (start_time !== undefined && end_time !== undefined) {
            const duration = end_time - start_time;
            command = command
                .seekInput(start_time)
                .duration(duration);
            console.log(`✂️ Segment: ${start_time}s - ${end_time}s (duration: ${duration}s)`);
        }

        // Return job ID immediately for client to start polling
        res.json({
            success: true,
            job_id: jobId,
            message: 'Conversion started, use job_id to check progress'
        });

        // Set output and start conversion
        command
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('📼 FFmpeg command:', commandLine);
                jobProgress.set(jobId, {
                    status: 'processing',
                    progress: 5,
                    message: 'FFmpeg started, downloading segments...'
                });
            })
            .on('progress', (progress) => {
                const percent = Math.round(progress.percent || 0);
                console.log(`⏳ Progress: ${percent}%`);
                
                // Better progress mapping for copy operations
                let mappedProgress = percent;
                if (percent > 0 && percent < 10) {
                    mappedProgress = 10 + (percent * 2); // 10-30% range
                } else if (percent >= 10 && percent < 50) {
                    mappedProgress = 30 + (percent - 10); // 30-70% range
                } else if (percent >= 50) {
                    mappedProgress = Math.min(90, 70 + (percent - 50) * 0.5); // 70-90% range
                }
                
                jobProgress.set(jobId, {
                    status: 'processing',
                    progress: Math.max(10, mappedProgress),
                    message: `Converting video... ${mappedProgress}%`
                });
            })
            .on('end', () => {
                console.log(`✅ Conversion completed: ${outputFilename}`);
                
                // Check if file exists and has content
                if (fs.existsSync(outputPath)) {
                    const stats = fs.statSync(outputPath);
                    console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                    
                    if (stats.size > 0) {
                        const downloadUrl = `${req.protocol}://${req.get('host')}/downloads/${outputFilename}`;
                        
                        jobProgress.set(jobId, {
                            status: 'completed',
                            progress: 100,
                            message: 'Conversion completed successfully',
                            download_url: downloadUrl,
                            filename: outputFilename,
                            size: stats.size
                        });
                        
                        // Clean up progress after 10 minutes
                        setTimeout(() => {
                            jobProgress.delete(jobId);
                        }, 10 * 60 * 1000);
                        
                    } else {
                        console.log('❌ Output file is empty');
                        jobProgress.set(jobId, {
                            status: 'error',
                            progress: 0,
                            message: 'Conversion produced empty file'
                        });
                    }
                } else {
                    console.log('❌ Output file was not created');
                    jobProgress.set(jobId, {
                        status: 'error',
                        progress: 0,
                        message: 'Conversion failed - no output file'
                    });
                }
            })
            .on('error', (err) => {
                console.log(`❌ FFmpeg error: ${err.message}`);
                jobProgress.set(jobId, {
                    status: 'error',
                    progress: 0,
                    message: `Conversion failed: ${err.message}`
                });
            })
            .run();

    } catch (error) {
        console.log(`❌ Server error: ${error.message}`);
        jobProgress.set(jobId, {
            status: 'error',
            progress: 0,
            message: `Server error: ${error.message}`
        });
    }
});

// Delete specific file endpoint
app.delete('/downloads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join('./downloads', filename);
    
    // Security: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({
            error: 'Invalid filename'
        });
    }
    
    fs.unlink(filePath, (err) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return res.status(404).json({
                    error: 'File not found'
                });
            }
            console.log(`❌ Error deleting file: ${err.message}`);
            return res.status(500).json({
                error: 'Failed to delete file'
            });
        }
        
        console.log(`🗑️ Deleted file: ${filename}`);
        res.json({
            success: true,
            message: 'File deleted successfully'
        });
    });
});

// Cleanup old files (run every hour)
setInterval(() => {
    const downloadsDir = './downloads';
    const maxAge = 60 * 60 * 1000; // 1 hour in milliseconds
    
    fs.readdir(downloadsDir, (err, files) => {
        if (err) return;
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                
                const now = Date.now();
                const fileAge = now - stats.mtime.getTime();
                
                if (fileAge > maxAge) {
                    fs.unlink(filePath, (err) => {
                        if (!err) {
                            console.log(`🗑️ Cleaned up old file: ${file}`);
                        }
                    });
                }
            });
        });
    });
}, 60 * 60 * 1000); // Run every hour

app.listen(PORT, () => {
    console.log(`🚀 SaveKik Converter Server running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`🌐 API docs: http://localhost:${PORT}/`);
});