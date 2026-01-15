const { Queue, Worker } = require('bullmq');
const twilio = require('twilio');
const IORedis = require('ioredis');

// Redis connection using IORedis
const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null
});

// Create the SMS queue
const smsQueue = new Queue('sms-sending', {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 100
    }
});

// Twilio client (will be initialized in setupWorker)
let twilioClient = null;
let socketIO = null;

/**
 * Initialize the SMS worker with Twilio credentials and Socket.io instance
 * @param {Object} io - Socket.io server instance
 */
function setupSmsWorker(io) {
    socketIO = io;

    // Initialize Twilio client
    twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );

    // Create the worker to process SMS jobs
    const worker = new Worker('sms-sending', async (job) => {
        const { phoneNumber, message, batchId, jobIndex, totalJobs } = job.data;

        console.log(`📤 Processing SMS job ${jobIndex + 1}/${totalJobs} to ${phoneNumber}`);

        // Emit job started event
        socketIO.emit('sms_job_started', {
            batchId,
            phoneNumber,
            jobIndex,
            totalJobs,
            status: 'sending'
        });

        try {
            // Send SMS via Twilio
            const twilioMessage = await twilioClient.messages.create({
                body: message,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phoneNumber
            });

            console.log(`✅ SMS sent to ${phoneNumber} - SID: ${twilioMessage.sid}`);

            // Emit success event
            socketIO.emit('sms_job_completed', {
                batchId,
                phoneNumber,
                jobIndex,
                totalJobs,
                status: 'sent',
                sid: twilioMessage.sid
            });

            return {
                success: true,
                phoneNumber,
                sid: twilioMessage.sid,
                status: twilioMessage.status
            };

        } catch (error) {
            console.error(`❌ Failed to send SMS to ${phoneNumber}:`, error.message);

            // Emit failure event
            socketIO.emit('sms_job_failed', {
                batchId,
                phoneNumber,
                jobIndex,
                totalJobs,
                status: 'failed',
                error: error.message
            });

            throw error;
        }
    }, {
        connection,
        concurrency: 1, // Process one SMS at a time to avoid rate limits
        limiter: {
            max: 1,
            duration: 1000 // 1 SMS per second max
        }
    });

    // Worker event handlers
    worker.on('completed', (job, result) => {
        console.log(`✅ Job ${job.id} completed for ${result.phoneNumber}`);
    });

    worker.on('failed', (job, err) => {
        console.error(`❌ Job ${job.id} failed:`, err.message);
    });

    worker.on('error', (err) => {
        console.error('Worker error:', err);
    });

    console.log('📱 SMS Queue Worker started');

    return worker;
}

/**
 * Add multiple SMS jobs to the queue
 * @param {Array<string>} phoneNumbers - Array of phone numbers
 * @param {string} message - Message body to send
 * @returns {Object} Batch info
 */
async function addBulkSmsJobs(phoneNumbers, message) {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const jobs = [];

    for (let i = 0; i < phoneNumbers.length; i++) {
        const job = await smsQueue.add('send-sms', {
            phoneNumber: phoneNumbers[i],
            message,
            batchId,
            jobIndex: i,
            totalJobs: phoneNumbers.length
        }, {
            jobId: `${batchId}_${i}`
        });
        jobs.push({
            id: job.id,
            phoneNumber: phoneNumbers[i],
            status: 'queued'
        });
    }

    console.log(`📋 Added ${phoneNumbers.length} SMS jobs to queue (Batch: ${batchId})`);

    // Emit batch queued event
    if (socketIO) {
        socketIO.emit('sms_batch_queued', {
            batchId,
            totalJobs: phoneNumbers.length,
            jobs: jobs.map(j => ({ phoneNumber: j.phoneNumber, status: 'queued' }))
        });
    }

    return {
        batchId,
        totalJobs: phoneNumbers.length,
        jobs
    };
}

/**
 * Get queue stats
 */
async function getQueueStats() {
    const waiting = await smsQueue.getWaitingCount();
    const active = await smsQueue.getActiveCount();
    const completed = await smsQueue.getCompletedCount();
    const failed = await smsQueue.getFailedCount();

    return { waiting, active, completed, failed };
}

module.exports = {
    smsQueue,
    setupSmsWorker,
    addBulkSmsJobs,
    getQueueStats
};
