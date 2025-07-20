const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// M3U8 to MP4 conversion endpoint (placeholder for now)
app.post('/convert', async (req, res) => {
    const { m3u8_url, filename, start_time, end_time } = req.body;
    
    if (!m3u8_url || !filename) {
        return res.status(400).json({
            error: 'Missing required fields: m3u8_url, filename'
        });
    }

    const jobId = uuidv4();
    
    console.log(`🚀 Conversion request received: ${jobId}`);
    console.log(`📂 Input M3U8: ${m3u8_url}`);
    console.log(`📁 Filename: ${filename}`);
    
    // For now, return a placeholder response
    // We'll add FFmpeg functionality once deployment works
    setTimeout(() => {
        // Simulate processing time
        res.json({
            success: true,
            job_id: jobId,
            message: 'Conversion endpoint is working - FFmpeg integration coming next',
            input_url: m3u8_url,
            filename: filename,
            start_time: start_time,
            end_time: end_time,
            status: 'placeholder'
        });
    }, 2000);
});

app.listen(PORT, () => {
    console.log(`🚀 SaveKik Converter Server running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`🌐 API docs: http://localhost:${PORT}/`);
});