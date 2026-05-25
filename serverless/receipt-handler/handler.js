'use strict';
/**
 * serverless/receipt-handler/handler.js
 *
 * Lambda-style handlers for the kijani-receipts serverless service.
 *
 * Functions:
 *   health              GET  /health   → { status: "ok" }  (Kubernetes readinessProbe)
 *   generateReceipt     POST /receipts → write receipt-{paymentId}.json to S3
 *   processReceiptUpload               → S3 ObjectCreated trigger, logs receipt chain event
 *
 * Local dev:
 *   sls offline start          (HTTP API :3000, local S3 :4569)
 *   node upload-test.js        (upload a file to fire the S3 trigger)
 *   sls invoke local --function processReceiptUpload --data '{"Records":[...]}'
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.BUCKET_NAME || 'kk-payments-receipts';
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:4569';
const IS_PROD = process.env.NODE_ENV === 'production';

const s3 = new S3Client(
	IS_PROD
		? { region: process.env.AWS_REGION || 'af-south-1' }
		: {
				endpoint: S3_ENDPOINT,
				region: 'af-south-1',
				credentials: {
					accessKeyId: 'S3RVER',
					secretAccessKey: 'S3RVER',
				},
				forcePathStyle: true,
			},
);

// ── Health probe (Kubernetes readinessProbe) ──────────────────────────────────
const health = async () => ({
	statusCode: 200,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ status: 'ok' }),
});

// ── POST /receipts ────────────────────────────────────────────────────────────
// Called by kk-payments writeReceipt() after a payment is created.
// Writes receipt-{paymentId}.json to the S3 bucket, which triggers
// processReceiptUpload via the S3 ObjectCreated event.
const generateReceipt = async (event) => {
	let body;
	try {
		body = JSON.parse(event.body || '{}');
	} catch {
		return {
			statusCode: 400,
			body: JSON.stringify({ error: 'invalid JSON' }),
		};
	}

	const { paymentId, amount, currency, method } = body;
	if (!paymentId) {
		return {
			statusCode: 422,
			body: JSON.stringify({ error: 'paymentId required' }),
		};
	}

	const receipt = {
		paymentId,
		amount,
		currency: currency || process.env.DEFAULT_CURRENCY || 'KES',
		method,
		bucket: BUCKET,
		timestamp: new Date().toISOString(),
		status: 'generated',
	};

	const key = `receipt-${paymentId}.json`;
	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: key,
			Body: JSON.stringify(receipt),
			ContentType: 'application/json',
		}),
	);

	console.log(
		JSON.stringify({ event: 'receipt_generated', key, ...receipt }),
	);

	return {
		statusCode: 200,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			received: true,
			key,
			timestamp: receipt.timestamp,
		}),
	};
};

// ── S3 ObjectCreated trigger ──────────────────────────────────────────────────
// Fires automatically when receipt-*.json is written to kk-payments-receipts.
// Iterates all records in the event batch so multiple simultaneous uploads each
// produce their own log line. Verify with:
//   sls invoke local --function processReceiptUpload --data '{"Records":[{...},{...}]}'
const processReceiptUpload = async (event) => {
	for (const record of event.Records) {
		const bucketName = record.s3.bucket.name;
		const objectKey = decodeURIComponent(
			record.s3.object.key.replace(/\+/g, ' '),
		);
		const objectSize = record.s3.object.size;
		const eventTime = record.eventTime;

		// Parse the orderId from the object key (e.g. receipt-ORD-001.json → ORD-001)
		const orderId = objectKey
			.replace(/^receipt-/, '')
			.replace(/\.json$/, '');

		// Build a structured log entry
		const logEntry = {
			event: 'receipt_processed',
			bucketName,
			objectKey,
			objectSize,
			eventTime,
			orderId,
			processedAt: new Date().toISOString(),
			handler: 'processReceiptUpload',
		};

		console.log(JSON.stringify(logEntry));
		console.log(
			`[kk-receipts] Processing upload: bucket=${bucketName} key=${objectKey} size=${objectSize}b`,
		);
	}
	// Storage triggers do not return an HTTP response
};

module.exports = { health, generateReceipt, processReceiptUpload };
