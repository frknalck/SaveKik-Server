const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/downloads', express.static('downloads'));

// Create downloads directory
fs.ensureDirSync('./downloads');

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'SaveKik Converter Server is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
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

// M3U8 to MP4 conversion endpoint
app.post('/convert', async (req, res) => {
    const { m3u8_url, filename, start_time, end_time } = req.body;
    
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
    
    try {
        // Create FFmpeg command
        let command = ffmpeg(m3u8_url)
            .inputOptions([
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                '-user_agent', 'SaveKik/1.0 (iOS; Mobile)',
                '-headers', 'Referer: https://kick.com/',
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5'
            ])
            .outputOptions([
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-preset', 'medium', 
                '-crf', '23',
                '-movflags', '+faststart',
                '-avoid_negative_ts', 'make_zero'
            ]);

        // Add segment selection if provided
        if (start_time !== undefined && end_time !== undefined) {
            const duration = end_time - start_time;
            command = command
                .seekInput(start_time)
                .duration(duration);
            console.log(`✂️ Segment: ${start_time}s - ${end_time}s (duration: ${duration}s)`);
        }

        // Set output and start conversion
        command
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('📼 FFmpeg command:', commandLine);
            })
            .on('progress', (progress) => {
                console.log(`⏳ Progress: ${Math.round(progress.percent || 0)}%`);
            })
            .on('end', () => {
                console.log(`✅ Conversion completed: ${outputFilename}`);
                
                // Check if file exists and has content
                if (fs.existsSync(outputPath)) {
                    const stats = fs.statSync(outputPath);
                    console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                    
                    if (stats.size > 0) {
                        const downloadUrl = `${req.protocol}://${req.get('host')}/downloads/${outputFilename}`;
                        res.json({
                            success: true,
                            job_id: jobId,
                            download_url: downloadUrl,
                            filename: outputFilename,
                            size: stats.size
                        });
                    } else {
                        console.log('❌ Output file is empty');
                        res.status(500).json({
                            error: 'Conversion produced empty file'
                        });
                    }
                } else {
                    console.log('❌ Output file was not created');
                    res.status(500).json({
                        error: 'Conversion failed - no output file'
                    });
                }
            })
            .on('error', (err) => {
                console.log(`❌ FFmpeg error: ${err.message}`);
                res.status(500).json({
                    error: 'Conversion failed',
                    details: err.message
                });
            })
            .run();

    } catch (error) {
        console.log(`❌ Server error: ${error.message}`);
        res.status(500).json({
            error: 'Server error',
            details: error.message
        });
    }
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